import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Sincronização automática da Sprint (Everton, 2026-07-18): ressincroniza
// a sprint ATIVA de cada grupo já usado na tela Sprint (todo grupo com pelo
// menos 1 sprint em sprint_sprints), sem precisar clicar em "Sincronizar".
// Invocada por pg_cron (migration 20260718100000_sprint_sync_automation.sql,
// hoje de hora em hora — ver 20260721110000 e 20260727130000) — nunca chamada
// pela UI.
//
// Não reimplementa nenhuma fase de sync: chama sync-sprint-bitrix via HTTP,
// por grupo, em 2 passos —
//   1. { groupId, sprintsOnly: true } — atualiza a lista de sprints do grupo
//      (leve; usa callBitrixAllPagesByOffset, então pega sprint nova que
//      tenha virado ativa, mesmo em grupos com >50 sprints).
//   2. { groupId, sprintId } com a sprint ativa já sincronizada localmente —
//      dispara o sync pesado (tarefas/horas/UF/ponto) da fase 2.
// Um grupo sem sprint ativa (todas fechadas/planejadas) é pulado com aviso,
// não erro — nada a sincronizar não é uma falha.
//
// ── SEGUNDA PASSADA: O HISTÓRICO (Everton, 2026-08-29) ──────────────────────
// Até aqui a automação cuidava só da sprint ATIVA de cada grupo. Sprint fechada
// nunca era revisitada, e sprint antiga que ninguém tinha aberto ainda nunca
// tinha sido sincronizada nenhuma vez. Na prática (relatado pelo Everton
// direto da produção): escolher uma sprint passada na tela mostrava ela VAZIA,
// e só aparecia dado depois de clicar em "Sincronizar" naquela sprint. Com ~50
// sprints por grupo, isso não é rotina que se peça a alguém — muito menos ao
// chefe dele, que é justamente quem olha o histórico.
//
// A passada de histórico roda DEPOIS das sprints ativas de propósito: o dado do
// dia é o que mais importa e não pode ficar esperando o passado.
//
// Ela trabalha uma fila de 3 níveis, nesta ordem:
//   A. Sprint que NUNCA foi sincronizada (tasks_synced_at nulo) → sync
//      COMPLETO. É o caso da "tela vazia": sem tarefa no banco não há o que
//      mostrar, então recarregar só as horas não resolveria nada.
//   B. Sprint com tarefas, mas com apontamento sem detalhe (elapsed_synced_at
//      nulo) → modo `elapsedOnly`, que recarrega SÓ as horas (~1 requisição ao
//      Bitrix a cada 49 tarefas). Tarefa/UF/etapa/ponto de sprint encerrada não
//      mudam mais, então o sync completo aqui seria caro à toa.
//   C. Sprint encerrada há pouco, reconferida 1x por dia → `elapsedOnly`.
//      Apontamento retroativo ("trabalhei 2h na semana passada") é real e
//      chegaria depois do carimbo do nível B.
//
// ORÇAMENTO DE TEMPO, não limite de sprints: a fila roda até acabar ou até
// gastar ORCAMENTO_HISTORICO_MS, e para no meio SEM DRAMA porque cada sprint é
// carimbada individualmente assim que termina (tasks_synced_at no nível A,
// elapsed_synced_at nos níveis B/C). A rodada seguinte pega de onde esta parou.
// É isso que evita a classe de bug que já mordeu este projeto antes: invocação
// que estoura o tempo limite no meio da paginação e perde tudo o que fez.

// Quanto tempo a passada de histórico pode gastar por rodada. O teto real da
// Edge Function é maior; a folga existe pra sobrar tempo pras sprints ativas
// (que rodam antes) e pro overhead de rede. Com o cron de hora em hora, um
// backfill inicial de ~50 sprints se resolve em poucas rodadas — e depois disso
// a fila fica vazia quase sempre.
const ORCAMENTO_HISTORICO_MS = 90_000

// Por quantos dias uma sprint encerrada continua sendo reconferida (nível C).
// Passado o prazo o número não muda mais na prática e a sprint sai da fila pra
// sempre — é o que mantém o custo em regime permanente perto de zero, mesmo com
// o histórico inteiro já carimbado.
const DIAS_SPRINT_RECENTE = 14

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  const inicio = Date.now()

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const { data: cfg } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'sprint_sync_automation_config')
      .maybeSingle()
    const expectedSecret: string = (cfg?.value as any)?.secret_key || ''

    if (!expectedSecret) {
      console.warn(
        '[sprint-sync-automation] secret_key não configurado — recusando execução.',
      )
      return json(
        { error: 'sprint_sync_automation_config.secret_key não configurado.' },
        500,
      )
    }

    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.error(
        '[sprint-sync-automation] Authorization ausente ou inválido',
      )
      return json({ error: 'unauthorized' }, 401)
    }

    const { data: gruposComSprint } = await supabaseAdmin
      .from('sprint_sprints')
      .select('group_id')
    const groupIds = Array.from(
      new Set((gruposComSprint || []).map((r: any) => String(r.group_id))),
    )

    const resultados: Record<string, unknown> = {}
    // Sprint ativa já sincronizada por completo nesta rodada — não pode entrar
    // de novo na fila do histórico.
    const jaSincronizadas = new Set<string>()

    // ── Passada 1: sprint ativa de cada grupo (sync completo) ───────────────
    for (const groupId of groupIds) {
      try {
        await chamarSyncSprintBitrix(supabaseUrl, expectedSecret, {
          groupId,
          sprintsOnly: true,
        })

        const { data: sprintAtiva } = await supabaseAdmin
          .from('sprint_sprints')
          .select('id')
          .eq('group_id', groupId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()

        if (!sprintAtiva) {
          resultados[groupId] = {
            ok: true,
            aviso: 'Nenhuma sprint ativa encontrada — nada sincronizado.',
          }
          continue
        }

        const syncRes = await chamarSyncSprintBitrix(
          supabaseUrl,
          expectedSecret,
          {
            groupId,
            sprintId: sprintAtiva.id,
          },
        )
        jaSincronizadas.add(String(sprintAtiva.id))
        resultados[groupId] = syncRes
      } catch (e: any) {
        console.warn(
          `[sprint-sync-automation] grupo ${groupId} falhou:`,
          e.message,
        )
        resultados[groupId] = { ok: false, erro: e.message }
      }
    }

    // ── Passada 2: histórico das demais sprints ─────────────────────────────
    const historico = await atualizarHistorico(
      supabaseAdmin,
      supabaseUrl,
      expectedSecret,
      jaSincronizadas,
      inicio,
    )

    return json({
      success: true,
      gruposProcessados: groupIds.length,
      resultados,
      historico,
      duracaoMs: Date.now() - inicio,
    })
  } catch (error: any) {
    return json({ success: false, error: error.message }, 500)
  }
})

// Monta e processa a fila do histórico (níveis A/B/C descritos no topo) até
// acabar a fila ou o orçamento de tempo.
async function atualizarHistorico(
  supabaseAdmin: any,
  supabaseUrl: string,
  secret: string,
  jaSincronizadas: Set<string>,
  inicio: number,
) {
  const agora = new Date()
  const limiteRecente = new Date(
    agora.getTime() - DIAS_SPRINT_RECENTE * 24 * 3600 * 1000,
  )
    .toISOString()
    .slice(0, 10)
  // "Já conferida hoje": evita repetir a mesma sprint recente a cada rodada de
  // hora em hora — 1x por dia é de sobra pra apontamento retroativo.
  const inicioDoDia = agora.toISOString().slice(0, 10) + 'T00:00:00.000Z'

  type ItemFila = {
    id: string
    groupId: string
    nivel: 'nunca-sincronizada' | 'sem-detalhe' | 'retroativo'
  }
  const fila: ItemFila[] = []
  const naFila = new Set<string>()

  const enfileirar = (linhas: any[] | null, nivel: ItemFila['nivel']) => {
    for (const s of linhas || []) {
      const id = String(s.id)
      const groupId = String(s.group_id || '')
      // Sprint sem grupo não tem como ser sincronizada (o sync exige groupId),
      // e sprint já feita nesta rodada não entra duas vezes.
      if (!groupId || naFila.has(id) || jaSincronizadas.has(id)) continue
      naFila.add(id)
      fila.push({ id, groupId, nivel })
    }
  }

  // Nível A — nunca sincronizada: é a "tela vazia". Da mais nova pra mais
  // antiga, que é a ordem em que alguém vai procurar.
  const { data: nuncaSincronizadas } = await supabaseAdmin
    .from('sprint_sprints')
    .select('id, group_id')
    .is('tasks_synced_at', null)
    .order('id', { ascending: false })
  enfileirar(nuncaSincronizadas, 'nunca-sincronizada')

  // Nível B — tem tarefa, mas o apontamento ainda não tem janela de relógio.
  const { data: semDetalhe } = await supabaseAdmin
    .from('sprint_sprints')
    .select('id, group_id')
    .not('tasks_synced_at', 'is', null)
    .is('elapsed_synced_at', null)
    .order('id', { ascending: false })
  enfileirar(semDetalhe, 'sem-detalhe')

  // Nível C — encerrada há pouco, reconferida 1x por dia.
  const { data: recentes } = await supabaseAdmin
    .from('sprint_sprints')
    .select('id, group_id')
    .gte('date_finish', limiteRecente)
    .lt('elapsed_synced_at', inicioDoDia)
    .order('id', { ascending: false })
  enfileirar(recentes, 'retroativo')

  let sincronizadasCompletas = 0
  let horasAtualizadas = 0
  let semTarefas = 0
  let falhas = 0
  let processadas = 0
  const erros: string[] = []

  for (const sprint of fila) {
    // Confere o orçamento ANTES de começar mais uma: parar ENTRE sprints deixa
    // o carimbo da anterior íntegro; parar no meio de uma, não.
    if (Date.now() - inicio > ORCAMENTO_HISTORICO_MS) break

    processadas++
    try {
      if (sprint.nivel === 'nunca-sincronizada') {
        // Sync completo: sem tarefa no banco, recarregar só as horas não teria
        // sobre o que rodar (e é exatamente esse o caso da tela vazia).
        await chamarSyncSprintBitrix(supabaseUrl, secret, {
          groupId: sprint.groupId,
          sprintId: sprint.id,
        })
        sincronizadasCompletas++
      } else {
        const res: any = await chamarSyncSprintBitrix(supabaseUrl, secret, {
          groupId: sprint.groupId,
          sprintId: sprint.id,
          elapsedOnly: true,
        })
        // Sprint sem tarefa no banco volta com aviso e SEM carimbo (de
        // propósito, ver sync-sprint-bitrix): ela continua na fila em vez de se
        // apresentar como "atualizada, 0h". Contar à parte evita ler isso como
        // sucesso.
        if (res?.aviso) semTarefas++
        else horasAtualizadas++
      }
    } catch (e: any) {
      falhas++
      // Uma sprint que falha não derruba a fila: como não houve carimbo, a
      // próxima rodada tenta de novo.
      if (erros.length < 5) erros.push(`sprint ${sprint.id}: ${e.message}`)
      console.warn(
        `[sprint-sync-automation] histórico da sprint ${sprint.id} falhou:`,
        e.message,
      )
    }
  }

  const restantes = fila.length - processadas

  return {
    naFila: fila.length,
    sincronizadasCompletas,
    horasAtualizadas,
    semTarefas,
    falhas,
    restantes,
    orcamentoEsgotado: restantes > 0,
    ...(erros.length ? { erros } : {}),
  }
}

async function chamarSyncSprintBitrix(
  supabaseUrl: string,
  secret: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`${supabaseUrl}/functions/v1/sync-sprint-bitrix`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error(data?.error || `sync-sprint-bitrix HTTP ${res.status}`)
  return data
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
