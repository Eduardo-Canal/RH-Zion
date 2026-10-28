import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixSprintWebhookUrl } from '../_shared/get-bitrix-sprint-url.ts'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import {
  resolveAndCacheUsers,
  backfillWorkPositions,
} from '../_shared/resolve-bitrix-users.ts'

// Sincroniza o quadro Bitrix "Sprint" para sprint_groups/sprint_stages/sprint_tasks/
// sprint_sprints/sprint_elapsed/timeman_entries — usado pelas telas Não Conformidades
// e Sprint (módulo Auditoria).
//
// Sem `groupId` no body: acha sozinho o grupo "[ NC ]" (uso da tela Não Conformidades).
// Com `groupId` no body: sincroniza o grupo escolhido, incluindo horas apontadas,
// campos de DDI e ponto batido das sprints fechadas (uso da tela Sprint).
//
// Todas as chamadas em lote (elapsed, timeman) usam o endpoint `batch` do Bitrix
// (até 50 comandos = 1 requisição pro limite de frequência da conta) — ver
// _shared/bitrix-client.ts pros limites reais confirmados pelo Eduardo (2026-07-02).
//
// Fora do escopo: cruzamento com chamados do CRM (crm_deals/crm_categories) — o
// Órbita não sincroniza CRM Bitrix genérico hoje, é um projeto à parte. Ver BACKLOG.md.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Bypass de auth SÓ pro secret da automação diária (settings.
    // sprint_sync_automation_config.secret_key) — pg_cron/sprint-sync-automation
    // não têm um JWT de usuário pra passar. Mesmo padrão do
    // integrations-health-check: sem secret configurado, essa comparação
    // nunca bate (string vazia não autentica string vazia) e cai no fluxo de
    // usuário normal abaixo.
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const { data: automationCfg } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'sprint_sync_automation_config')
      .maybeSingle()
    const automationSecret: string =
      (automationCfg?.value as any)?.secret_key || ''
    const isAutomationCall =
      Boolean(automationSecret) && token === automationSecret

    if (!isAutomationCall) {
      const {
        data: { user: userData },
        error: authErr,
      } = await supabaseAdmin.auth.getUser(token)
      if (authErr || !userData) {
        return new Response(JSON.stringify({ error: 'Token inválido' }), {
          status: 401,
          headers: corsHeaders,
        })
      }
    }

    const baseUrl = await getBitrixSprintWebhookUrl(supabaseAdmin)
    const {
      callBitrix,
      callBitrixBatch,
      callBitrixBatchComErros,
      primeiroErroDeBatch,
      callBitrixAllPages,
      callBitrixAllPagesByOffset,
      callBitrixPagedEach,
    } = createBitrixClient(supabaseUrl, serviceRoleKey, baseUrl)

    // Recarrega os apontamentos de hora de um conjunto de tarefas.
    //
    // Extraída da fase 5 (que continua sendo a única chamadora no sync
    // completo) pra poder rodar SOZINHA no modo elapsedOnly: atualizar o
    // histórico de horas não precisa refazer tarefas/UF/ponto/etapas.
    //
    // DELETE + INSERT, não upsert: sprint_elapsed não tem chave natural única
    // — a mesma pessoa pode ter vários lançamentos na mesma tarefa no mesmo
    // dia. Recarregar do zero é o que mantém a tabela fiel ao Bitrix quando um
    // apontamento é editado ou apagado lá.
    async function recarregarElapsed(
      elapsedTaskIds: string[],
    ): Promise<{ count: number; userIds: Set<string> }> {
      const userIds = new Set<string>()
      let count = 0

      await supabaseAdmin
        .from('sprint_elapsed')
        .delete()
        .in('task_id', elapsedTaskIds.length ? elapsedTaskIds : ['__none__'])

      const BATCH_SIZE = 49
      for (let i = 0; i < elapsedTaskIds.length; i += BATCH_SIZE) {
        const chunk = elapsedTaskIds.slice(i, i + BATCH_SIZE)
        const cmds: Record<string, string> = {}
        chunk.forEach((tid, idx) => {
          cmds[`t${idx}`] =
            `task.elapseditem.getlist?taskId=${tid}&order[ID]=asc`
        })

        try {
          const results = await callBitrixBatch(cmds)
          const items: any[] = []
          Object.values(results || {}).forEach((r: any) => {
            if (Array.isArray(r)) items.push(...r)
            else if (r?.items) items.push(...r.items)
          })
          // Acumula as linhas do lote e grava com 1 insert(array) — não 1
          // insert por apontamento. Uma tarefa pode ter ~19 apontamentos; um
          // lote de 49 tarefas vira centenas de INSERTs sequenciais (~100ms
          // cada), o gap de 54s medido no Prompt 117 vinha disso, não do
          // Bitrix.
          const rows = items
            .map((e) => {
              const taskId = String(e.TASK_ID ?? e.taskId ?? '')
              const userId = String(e.USER_ID ?? e.userId ?? '')
              if (!taskId || !userId) return null
              const rawDate = e.CREATED_DATE ?? e.createdDate ?? null
              // Janela de relógio do lançamento (Everton, 2026-08-28: conferir o
              // tempo e ver quando foi digitado na mão). Gravadas CRUAS de
              // propósito.
              //
              // A hipótese de que CREATED_DATE/DATE_START trocam de significado em
              // lançamento manual era errada (achado 2026-09-01, dado real do
              // elapsedDryRun contra a tarefa 103744): em 9 dos 10 apontamentos
              // manuais, DATE_START vem ~6h DEPOIS de CREATED_DATE — e no único com
              // janela de relógio real, os dois campos são idênticos. CREATED_DATE é
              // quem de fato guarda quando o registro foi digitado; nunca foi bug de
              // fuso, era ler o campo errado pro selo "lançado" na tela. Por isso
              // created_at (hora completa) grava CREATED_DATE, não DATE_START —
              // created_date continua sendo só a DATA (sem hora), de propósito,
              // porque outras partes do sistema dependem dela ser só data.
              const parseTs = (v: unknown) => {
                if (v === null || v === undefined || v === '') return null
                const d = new Date(String(v))
                return isNaN(d.getTime()) ? null : d.toISOString()
              }
              const src = e.SOURCE ?? e.source ?? null
              return {
                task_id: taskId,
                user_id: userId,
                seconds: parseInt(e.SECONDS ?? e.seconds ?? 0) || 0,
                created_date: rawDate
                  ? new Date(rawDate).toISOString().slice(0, 10)
                  : null,
                created_at: parseTs(rawDate),
                bitrix_id: String(e.ID ?? e.id ?? '') || null,
                date_start: parseTs(e.DATE_START ?? e.dateStart),
                date_stop: parseTs(e.DATE_STOP ?? e.dateStop),
                // SOURCE cru: a doc do Bitrix não publica o significado dos
                // valores, então fica guardado pra ser conferido com dado real em
                // vez de virar regra adivinhada (ver migration 20260828170000).
                source:
                  src !== null && src !== '' ? String(src).slice(0, 20) : null,
                comment_text:
                  String(e.COMMENT_TEXT ?? e.commentText ?? '') || null,
                synced_at: new Date().toISOString(),
              }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
          if (rows.length) {
            const { error: insertErr } = await supabaseAdmin
              .from('sprint_elapsed')
              .insert(rows)
            if (!insertErr) {
              count += rows.length
              for (const r of rows) userIds.add(r.user_id)
            }
          }
        } catch (e) {
          console.warn(
            '[sync-sprint-bitrix] batchElapsed falhou num lote:',
            (e as Error).message,
          )
        }
      }

      return { count, userIds }
    }

    // Extrai segundos trabalhados de um dia do relatório de ponto do Bitrix.
    //
    // CORREÇÃO 2026-08-18 (relatado pelo Everton: ponto da Isabela na sprint
    // 2026.07.2.1 do MLW batia 101h52 na grade do Bitrix e 101h26 aqui, com os
    // mesmos 13 dias — ou seja, minuto perdido DENTRO dos dias). Duas coisas
    // neste extrator comiam tempo real:
    //
    //   1. A escolha do campo usava `??`, que só pula null/undefined. Um
    //      `workday_duration_final: 0` (dia lançado e ainda não aprovado)
    //      vencia um `workday_duration` de 7h e zerava o dia. Agora vale o
    //      primeiro campo com valor POSITIVO, na mesma ordem de preferência.
    //
    //   2. A janela do relógio (saída − entrada) era usada como TETO: duração
    //      informada maior que a janela era descartada e trocada pela janela.
    //      Só que a duração do Bitrix é o total do dia (soma dos turnos, mais
    //      ajuste aprovado pelo gestor), enquanto entrada/saída podem ser só do
    //      primeiro turno — nesse caso o teto cortava tempo que existiu. A
    //      janela voltou a ser o que devia sempre ter sido: FALLBACK pra quando
    //      o Bitrix não informa duração nenhuma.
    //
    // O único limite que sobrou é o indiscutível: um dia do calendário não cabe
    // mais de 24h. Ponto esquecido em aberto continua tratado onde sempre foi —
    // a tela marca "ponto suspeito" acima de 14h/dia de média (ver
    // OciosidadePessoaTab.jsx) em vez de reescrever o número em silêncio.
    function timemanSeconds(day: any): number {
      const candidatos = [
        day.workday_duration,
        day.WORKDAY_DURATION,
        day.workday_duration_final,
        day.WORKDAY_DURATION_FINAL,
        day.TIME_FULL_DAY,
        day.DURATION,
      ]

      let seconds = 0
      for (const v of candidatos) {
        if (v === undefined || v === null || v === '') continue
        let n = 0
        if (typeof v === 'string' && v.includes(':')) {
          const [h, m, s] = v.split(':').map(Number)
          n = (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
        } else {
          const parsed = parseInt(String(v))
          if (!isNaN(parsed)) n = parsed
        }
        if (n > 0) {
          seconds = n
          break
        }
      }

      // Fallback (não teto): sem duração informada, a janela do relógio é o
      // único sinal que existe pra aquele dia.
      if (seconds === 0 && day.workday_date_start && day.workday_date_finish) {
        seconds = Math.round(
          (new Date(day.workday_date_finish).getTime() -
            new Date(day.workday_date_start).getTime()) /
            1000,
        )
      }

      if (!Number.isFinite(seconds)) return 0
      return Math.min(Math.max(seconds, 0), 24 * 3600)
    }

    // Data do dia do relatório, no CALENDÁRIO DO BITRIX.
    //
    // CORREÇÃO 2026-08-18: a data saía de
    // `new Date(workday_date_start).toISOString()`, isto é, convertida pra UTC.
    // O Bitrix manda o timestamp no fuso da conta (+03:00 nesta), então jornada
    // que começa de madrugada caía no dia errado — e dois dias distintos podiam
    // colidir na mesma data, caso em que o dedup antigo (Math.max) descartava
    // um dia inteiro. O campo `index` (AAAAMMDD) é o dia como o próprio Bitrix
    // agrupa na grade ("Qui 23"), sem conta de fuso nenhuma: é ele que manda, e
    // o timestamp fica só como reserva pra relatório que venha sem index.
    function diaDoRelatorio(day: any, chave?: string): string | null {
      for (const bruto of [day?.index, day?.INDEX, chave]) {
        const s = String(bruto ?? '').replace(/\D/g, '')
        if (s.length === 8)
          return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
      }
      const ts = day?.workday_date_start || day?.WORKDAY_DATE_START
      if (ts) {
        const d = new Date(ts)
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
      }
      return null
    }

    // ECO de virada de dia. CASO REAL: Vinicius Bueno, 28→29/08/2026 — entrou
    // 28/08 14h35, saiu 29/08 00h03 (3 min depois da meia-noite). O relatório
    // do Bitrix devolveu esse MESMO turno duas vezes: um item com index
    // 20260828 e outro com index 20260829, os dois com `workday_date_start`
    // idêntico e a duração CHEIA (28412s) em ambos — não dividida entre os
    // dias. A grade do Bitrix só mostra o turno no dia em que ele começou
    // (confirmado: "não apontou nada no sábado"), então o item cujo dia de
    // início não bate com o próprio índice é eco do turno anterior, não
    // jornada nova — e entra duplicado se não for descartado.
    //
    // Comparação por fatia de string (não `new Date().toISOString()`): o
    // timestamp já vem no fuso da conta (+03:00), converter pra UTC é o
    // mesmo erro corrigido em 18/08 (ver diaDoRelatorio acima).
    function ehEcoDeTurnoAnterior(day: any, dataDoIndice: string): boolean {
      const inicio = String(
        day?.workday_date_start || day?.WORKDAY_DATE_START || '',
      )
      if (inicio.length < 10) return false
      return inicio.slice(0, 10) !== dataDoIndice
    }

    // Trunca a mensagem de erro (que já inclui a resposta/descrição real do
    // Bitrix, vinda de bitrix-client.ts) para não inchar o response nem logar
    // payloads gigantes.
    function truncar(msg: string, max = 200): string {
      const s = msg || 'Erro desconhecido'
      return s.length > max ? s.slice(0, max) + '…' : s
    }

    function monthsInRange(dateFrom: string, dateTo: string) {
      const months: { month: number; year: number }[] = []
      let cur = new Date(dateFrom + 'T00:00:00')
      const end = new Date(dateTo + 'T00:00:00')
      while (cur <= end) {
        months.push({ month: cur.getMonth() + 1, year: cur.getFullYear() })
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      }
      return months
    }

    const {
      groupId: requestedGroupId,
      dateFrom,
      sprintId,
      sprintsOnly,
      elapsedOnly,
      timemanDryRun,
      elapsedDryRun,
    } = await req.json().catch(() => ({}))

    // ── Diagnóstico dos apontamentos manuais: lê o Bitrix e NÃO GRAVA NADA ──
    //
    // Nasceu do caso do Gabriel Bordotti (01/09/2026): o chat do Bitrix registra
    // a criação do apontamento manual terça 11/08 18:23, e a aba Apontamentos
    // mostrava "lançado 12/08 00:23" — 6h a mais E o dia errado. Mesma lição do
    // timemanDryRun acima: teoria sobre offset de fuso não conserta nada sem ver
    // o DATE_START cru que o Bitrix manda pra esse item.
    //
    // Zero INSERT, zero DELETE, zero UPDATE — sai antes de qualquer fase.
    //
    // Uso:
    //   { "elapsedDryRun": { "taskId": "12345" } }
    if (elapsedDryRun) {
      const { taskId: dryTaskId } = elapsedDryRun
      if (!dryTaskId) {
        return new Response(
          JSON.stringify({ error: 'elapsedDryRun exige taskId.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const fmtBR = (v: unknown) => {
        if (v === null || v === undefined || v === '') return null
        const d = new Date(String(v))
        if (isNaN(d.getTime())) return null
        return d
          .toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          })
          .replace(',', '')
      }

      let itens: any[] = []
      try {
        const r: any = await callBitrix('task.elapseditem.getlist', {
          taskId: String(dryTaskId),
          order: { ID: 'asc' },
        })
        itens = Array.isArray(r) ? r : (r?.items ?? [])
      } catch (e) {
        return new Response(
          JSON.stringify({
            error: `task.elapseditem.getlist falhou: ${(e as Error).message}`,
          }),
          {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const linhas = itens.map((e: any) => {
        const rawStart = e.DATE_START ?? e.dateStart ?? null
        const rawCreated = e.CREATED_DATE ?? e.createdDate ?? null
        return {
          bitrixId: String(e.ID ?? e.id ?? ''),
          userId: String(e.USER_ID ?? e.userId ?? ''),
          seconds: parseInt(e.SECONDS ?? e.seconds ?? 0) || 0,
          source: e.SOURCE ?? e.source ?? null,
          comentario: String(e.COMMENT_TEXT ?? e.commentText ?? '') || null,
          // O que o Bitrix manda, sem tocar em nada.
          cru: { DATE_START: rawStart, CREATED_DATE: rawCreated },
          // O que a gente exibiria hoje na coluna "lançado" (fmtDataHoraBR do
          // SprintPage), pra comparar direto com o horário real do chat do Bitrix.
          exibiriamos: {
            date_start: fmtBR(rawStart),
            created_date: fmtBR(rawCreated),
          },
        }
      })

      return new Response(
        JSON.stringify({
          dryRun: true,
          gravado: false,
          taskId: String(dryTaskId),
          itens: linhas,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // ── Diagnóstico do ponto: lê o Bitrix e NÃO GRAVA NADA ──────────────────
    //
    // Nasceu do caso da Isabela (18/08/2026): a grade do Bitrix dava 101h52 no
    // topo, a soma das células do próprio Bitrix dava 101h46 (a tela corta os
    // segundos de cada dia) e o Órbita, 101h26. Sobravam ~20 minutos que
    // faltavam de verdade, e sem ver o relatório cru só dava pra teorizar sobre
    // qual campo o Bitrix considera "horas do dia" — teoria não conserta conta.
    //
    // Este modo responde isso com evidência: devolve, dia a dia, os campos
    // brutos que o Bitrix manda e quantos segundos o nosso extrator tira de
    // cada um. Zero INSERT, zero DELETE, zero UPDATE — sai daqui antes de
    // qualquer fase da sincronização. Pode rodar em produção sem medo: pra o
    // banco, é como se não tivesse rodado.
    //
    // Uso:
    //   { "timemanDryRun": { "nome": "Isabela", "dateFrom": "2026-07-13", "dateTo": "2026-07-31" } }
    if (timemanDryRun) {
      const {
        nome,
        userId: dryUserId,
        dateFrom: dryFrom,
        dateTo: dryTo,
      } = timemanDryRun
      if ((!nome && !dryUserId) || !dryFrom || !dryTo) {
        return new Response(
          JSON.stringify({
            error: 'timemanDryRun exige nome (ou userId) + dateFrom + dateTo.',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      let alvos: { id: string; name: string }[] = []
      if (dryUserId) {
        alvos = [{ id: String(dryUserId), name: `Usuário ${dryUserId}` }]
      } else {
        const { data: achados } = await supabaseAdmin
          .from('b24_users')
          .select('id, name')
          .ilike('name', `%${nome}%`)
          .limit(5)
        alvos = (achados || []).map((u: any) => ({
          id: String(u.id),
          name: String(u.name),
        }))
      }

      if (!alvos.length) {
        return new Response(
          JSON.stringify({
            error: `Ninguém em b24_users com nome parecido com "${nome}".`,
            gravado: false,
          }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const hhmm = (seg: number) =>
        `${Math.floor(seg / 3600)}h${String(Math.round((seg % 3600) / 60)).padStart(2, '0')}`
      const pessoas: any[] = []

      for (const alvo of alvos) {
        const dias: any[] = []
        for (const { month, year } of monthsInRange(dryFrom, dryTo)) {
          const report = await callBitrix('timeman.timecontrol.reports.get', {
            USER_ID: alvo.id,
            MONTH: month,
            YEAR: year,
          })
          const rawDays = (report as any)?.report?.days ?? []
          const lista: [string, any][] = Array.isArray(rawDays)
            ? rawDays.map((d: any, i: number) => [String(i), d])
            : Object.entries((rawDays || {}) as Record<string, any>)

          for (const [chave, day] of lista) {
            if (!day || typeof day !== 'object') continue
            const data = diaDoRelatorio(day, chave)
            if (!data || data < dryFrom || data > dryTo) continue
            const seg = timemanSeconds(day)
            dias.push({
              data,
              nosso: hhmm(seg),
              segundos: seg,
              // true = eco de um turno que começou em outro dia (ver
              // ehEcoDeTurnoAnterior acima) — a sincronização real descarta
              // essas linhas; aqui ficam visíveis, marcadas, pra dar pra
              // conferir o bruto que o Bitrix mandou.
              ecoDeTurnoAnterior: ehEcoDeTurnoAnterior(day, data),
              // Os candidatos na ordem em que o extrator olha, pra dar pra ver
              // qual deles corresponde à célula da grade do Bitrix.
              campos: {
                workday_duration_final:
                  day.workday_duration_final ??
                  day.WORKDAY_DURATION_FINAL ??
                  null,
                workday_duration:
                  day.workday_duration ?? day.WORKDAY_DURATION ?? null,
                TIME_FULL_DAY: day.TIME_FULL_DAY ?? null,
                DURATION: day.DURATION ?? null,
                workday_date_start: day.workday_date_start ?? null,
                workday_date_finish: day.workday_date_finish ?? null,
              },
              // O dia inteiro como o Bitrix manda — é aqui que aparece pausa,
              // ajuste e qualquer campo que a gente ainda não esteja olhando.
              cru: day,
            })
          }
        }

        dias.sort((a, b) => (a.data < b.data ? -1 : 1))

        // Um dia com mais de uma linha = mais de um turno. Era exatamente o que
        // o `Math.max` antigo descartava, então o diagnóstico conta separado.
        // Ecos de virada de dia (ecoDeTurnoAnterior) ficam fora da soma real:
        // eles não são um segundo turno, são o mesmo turno contado de novo.
        const diasReais = dias.filter((d) => !d.ecoDeTurnoAnterior)
        const porDia = new Map<string, number>()
        for (const d of diasReais)
          porDia.set(d.data, (porDia.get(d.data) ?? 0) + d.segundos)
        const totalSeg = [...porDia.values()].reduce((s, v) => s + v, 0)

        pessoas.push({
          userId: alvo.id,
          nome: alvo.name,
          dias,
          diasComMaisDeUmTurno: [...porDia.keys()].filter(
            (dia) => diasReais.filter((d) => d.data === dia).length > 1,
          ),
          total: { dias: porDia.size, segundos: totalSeg, hm: hhmm(totalSeg) },
        })
      }

      return new Response(
        JSON.stringify({
          dryRun: true,
          gravado: false,
          periodo: { dateFrom: dryFrom, dateTo: dryTo },
          pessoas,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // Resultado por fase — cada fase abaixo roda protegida no seu próprio
    // try/catch, então uma falha (ex.: escopo do webhook Sprint sem permissão
    // para um método) não aborta as fases seguintes nem devolve um 500
    // genérico. status 500 fica só para erros estruturais (auth, JSON do
    // body, webhook não configurado) que já retornam antes deste ponto.
    type FaseResultado =
      | { ok: true; count: number; pulado?: boolean; parcial?: number }
      | { ok: false; erro: string; parcial?: number }
    const fases: Record<string, FaseResultado> = {}

    let groupId: string
    let groupName: string
    let groupsSynced = 0

    if (requestedGroupId) {
      // Sync de um grupo específico (tela Sprint): o grupo já está no banco —
      // veio do dropdown, que só lista grupos já sincronizados. Pula a fase 1
      // (sonet_group.get, 5 páginas pros 228 grupos) inteira, que não muda
      // entre uma sync e outra e só competia à toa pela cota global do rate
      // limiter (ver diagnóstico do Prompt 110 — 500 por timeout/contenção).
      groupId = String(requestedGroupId)
      const [{ data: localGroup }, { count }] = await Promise.all([
        supabaseAdmin
          .from('sprint_groups')
          .select('id, name')
          .eq('id', groupId)
          .maybeSingle(),
        supabaseAdmin
          .from('sprint_groups')
          .select('*', { count: 'exact', head: true }),
      ])
      groupName = localGroup?.name || groupId
      groupsSynced = count || 0
      fases.groups = { ok: true, count: groupsSynced, pulado: true }
    } else {
      // Bootstrap / Não Conformidades: precisa da lista completa pra descobrir
      // o grupo (a NC não sabe o id de antemão) — roda a fase 1 normalmente.
      const groups = await callBitrixAllPages('sonet_group.get', {
        ORDER: { NAME: 'ASC' },
      })
      for (const g of groups) {
        await supabaseAdmin
          .from('sprint_groups')
          .upsert(
            {
              id: String(g.ID),
              name: g.NAME || '',
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
          )
      }
      groupsSynced = groups.length
      fases.groups = { ok: true, count: groupsSynced }

      // Sem groupId explícito: acha o grupo "Não Conformidades" (nome contém "[ NC ]")
      const { data: ncGroup } = await supabaseAdmin
        .from('sprint_groups')
        .select('id, name')
        .ilike('name', '%[ NC ]%')
        .limit(1)
        .maybeSingle()

      if (!ncGroup) {
        return new Response(
          JSON.stringify({
            success: true,
            groupsSynced,
            warning:
              'Nenhum grupo com "[ NC ]" no nome foi encontrado no Bitrix — nada mais sincronizado.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
      groupId = ncGroup.id
      groupName = ncGroup.name
    }

    // ── elapsedOnly: só recarrega as horas apontadas da sprint ──────────────
    // Pedido do Everton (2026-08-29): o chefe dele não pode depender de alguém
    // clicar em "Sincronizar" sprint a sprint pra ver hora apontada. A
    // automação de hora em hora já cuidava disso, mas só da sprint ATIVA de
    // cada grupo — sprint fechada nunca era revisitada.
    //
    // Rodar o sync COMPLETO de cada sprint fechada seria caro à toa: tarefa,
    // campo UF, etapa e ponto de sprint encerrada não mudam mais. O que muda
    // (e o que falta pro relatório de horas manuais) é só a fase 5. Este modo
    // roda ela sozinha, sobre as tarefas que a sprint JÁ tem no banco — por
    // isso ele depende de um sync completo anterior: sem sprint_tasks, não há
    // o que consultar no Bitrix.
    //
    // Custo: ~1 requisição ao Bitrix a cada 49 tarefas da sprint. Uma sprint
    // de 200 tarefas são 4 chamadas, contra as dezenas do sync completo.
    //
    // Entra ANTES das fases 2/3 de propósito: lista de sprints e etapas do
    // grupo não fazem falta nenhuma aqui, e cada uma custaria chamada ao
    // Bitrix. A fase 1 (grupos) já foi pulada acima por vir com groupId.
    if (elapsedOnly) {
      if (!requestedGroupId || !sprintId) {
        return new Response(
          JSON.stringify({ error: 'elapsedOnly exige groupId e sprintId.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const { data: sprintTaskRows } = await supabaseAdmin
        .from('sprint_tasks')
        .select('id')
        .eq('sprint_id', String(sprintId))
      const idsDaSprint = (sprintTaskRows || []).map((t: any) => String(t.id))

      if (!idsDaSprint.length) {
        // Sprint sem nenhuma tarefa no banco: não há o que recarregar, e
        // carimbar elapsed_synced_at aqui seria MENTIRA — a sprint passaria a
        // se apresentar como "atualizada, 0h apontadas" quando na verdade ela
        // nunca teve o sync completo. Sem carimbo, ela continua aparecendo no
        // relatório como pendente, que é a verdade.
        return new Response(
          JSON.stringify({
            success: true,
            groupId,
            sprintId,
            tarefas: 0,
            fases: { elapsed: { ok: true, count: 0, pulado: true } },
            aviso:
              'Nenhuma tarefa desta sprint no banco — rode o sync completo da sprint antes.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      try {
        const recarga = await recarregarElapsed(idsDaSprint)
        fases.elapsed = { ok: true, count: recarga.count }

        // Carimbo só no caminho de sucesso: é ele que autoriza o relatório a
        // mostrar o % dessa sprint. Sem ele, a tela mostra "aguardando" em vez
        // de um número — sprint_apontamento_manual devolve "manual" pra
        // apontamento sem janela de relógio, então uma sprint ainda não
        // recarregada apareceria como 100% manual, o que é falso.
        await supabaseAdmin
          .from('sprint_sprints')
          .update({ elapsed_synced_at: new Date().toISOString() })
          .eq('id', String(sprintId))

        // Nome de quem apontou: objetivo secundário, no seu próprio try/catch
        // (mesmo motivo da fase 5) — falhar aqui não pode desfazer o ok acima.
        try {
          if (recarga.userIds.size) {
            await resolveAndCacheUsers(
              supabaseAdmin,
              Array.from(recarga.userIds),
            )
          }
        } catch (e: any) {
          console.warn(
            '[sync-sprint-bitrix] resolução de nome (elapsedOnly) falhou, seguindo sem: ' +
              (e?.message ?? e),
          )
        }

        // Cargo do Bitrix como sugestão (mesmo motivo da fase 5): sem isto
        // aqui, quem só aparece via automação de histórico (elapsedOnly)
        // nunca teria o cargo preenchido em b24_users — só sincronização
        // completa (sprint ativa) backfillaria.
        try {
          if (recarga.userIds.size) {
            await backfillWorkPositions(
              supabaseAdmin,
              Array.from(recarga.userIds),
            )
          }
        } catch (e: any) {
          console.warn(
            '[sync-sprint-bitrix] backfill de cargo (elapsedOnly) falhou, seguindo sem: ' +
              (e?.message ?? e),
          )
        }
      } catch (e) {
        const msg = truncar((e as Error).message)
        console.warn('[sync-sprint-bitrix] elapsedOnly falhou:', msg)
        fases.elapsed = { ok: false, erro: msg }
      }

      return new Response(
        JSON.stringify({
          success: fases.elapsed.ok,
          groupId,
          sprintId,
          tarefas: idsDaSprint.length,
          fases,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 2. tasks.api.scrum.sprint.list → sprint_sprints (lista de sprints do grupo)
    // callBitrixAllPagesByOffset — grupos com muitas sprints (semanais desde
    // 2021+) passam das 50 por página do Bitrix; uma chamada sem paginação
    // trazia só a primeira página (as mais antigas) e a sprint em andamento
    // nunca aparecia. Achado no grupo 384 (EVOLUÇÃO - MLW), 2026-07-14 — a 1ª
    // tentativa de correção trocou pra callBitrixAllPages, mas esse método do
    // Bitrix não devolve `next`/`total` na resposta (confirmado na doc
    // oficial), então continuava preso na 1ª página. callBitrixAllPagesByOffset
    // avança por `start` sem depender de `next` — ver _shared/bitrix-client.ts.
    let sprintsSynced = 0
    // Hoisted: a fase 3b precisa saber quais sprints estão ativas pra buscar as
    // etapas do kanban de cada uma (os painéis Dev/QA são multi-grupo).
    let sprintList: any[] = []
    try {
      sprintList = await callBitrixAllPagesByOffset(
        'tasks.api.scrum.sprint.list',
        { filter: { GROUP_ID: Number(groupId) } },
      )
      for (const s of sprintList as any[]) {
        const id = String(s.id ?? s.ID ?? '')
        if (!id) continue
        const rawStart = s.dateStart ?? s.DATE_START ?? null
        const rawFinish = s.dateFinish ?? s.DATE_FINISH ?? null
        await supabaseAdmin.from('sprint_sprints').upsert(
          {
            id,
            group_id: String(groupId),
            name: String(s.name ?? s.NAME ?? `Sprint ${id}`),
            status: String(s.status ?? s.STATUS ?? ''),
            date_start: rawStart
              ? new Date(rawStart).toISOString().slice(0, 10)
              : null,
            date_finish: rawFinish
              ? new Date(rawFinish).toISOString().slice(0, 10)
              : null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
        sprintsSynced++
      }
      fases.sprints = { ok: true, count: sprintsSynced }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn(
        '[sync-sprint-bitrix] sprint.list falhou (grupo pode não usar Scrum):',
        msg,
      )
      fases.sprints = { ok: false, erro: msg }
    }

    // 3. task.stages.get → sprint_stages (kanban do grupo)
    let stageList: any[] = []
    try {
      const stages =
        (await callBitrix('task.stages.get', { entityId: Number(groupId) })) ||
        {}
      stageList = Array.isArray(stages) ? stages : Object.values(stages)
      for (const s of stageList as any[]) {
        await supabaseAdmin.from('sprint_stages').upsert(
          {
            id: String(s.STATUS_ID ?? s.statusId ?? s.ID ?? s.id ?? ''),
            scope: String(groupId),
            name: s.TITLE ?? s.title ?? s.NAME ?? s.name ?? '',
            sort: parseInt(s.SORT ?? s.sort ?? '0') || 0,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'id,scope' },
        )
      }
      fases.stages = { ok: true, count: stageList.length }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn('[sync-sprint-bitrix] task.stages.get falhou:', msg)
      fases.stages = { ok: false, erro: msg }
    }

    // 3b. tasks.api.scrum.kanban.getStages → sprint_stages com scope = sprintId.
    // A fase 3 (task.stages.get) traz o kanban CLÁSSICO do grupo — os ids dela
    // não batem com sprint_tasks.stage_id em grupos Scrum, então a coluna
    // "Etapa" da tela Sprint caía no fallback e mostrava o id cru (9396, 9406…).
    // Num grupo Scrum a tarefa vive no kanban DA SPRINT, cujas etapas vêm deste
    // endpoint — é o mesmo que o módulo MPS já usa contra o Bitrix real
    // (mps-audit-automation/index.ts), onde task.stageId casa com stage.id.
    // Achado 2026-08-12, relatado pelo Everton ("A Etapa não trás").
    //
    // ADITIVO de propósito: grava numa scope nova (o id da sprint) em vez de
    // sobrescrever a scope do grupo, porque as telas Não Conformidades e TV
    // dependem das etapas group-scoped da fase 3. Nada do que existe muda.
    //
    // Cobre a sprint selecionada E todas as sprints ATIVAS do grupo: os painéis
    // "Cards em Em Dev / Em Teste" cruzam todos os grupos, então dependem de ter
    // o nome da etapa de qualquer sprint aberta — não só daquela que o usuário
    // abriu na tela. Sprints fechadas ficam de fora de propósito (um card de
    // sprint encerrada não está "em Dev agora") e o custo fica baixo: são poucas
    // ativas por grupo e cada chamada devolve uma lista pequena.
    const sprintsParaEtapas = [
      ...new Set([
        ...(sprintId ? [String(sprintId)] : []),
        ...sprintList
          .filter(
            (s: any) =>
              String(s.status ?? s.STATUS ?? '').toLowerCase() === 'active',
          )
          .map((s: any) => String(s.id ?? s.ID ?? ''))
          .filter(Boolean),
      ]),
    ]
    if (sprintsParaEtapas.length) {
      let scrumSynced = 0
      const errosEtapas: string[] = []
      for (const sid of sprintsParaEtapas) {
        try {
          const scrumStages =
            (await callBitrix('tasks.api.scrum.kanban.getStages', {
              sprintId: Number(sid),
            })) || {}
          const scrumList = Array.isArray(scrumStages)
            ? scrumStages
            : Object.values(scrumStages)
          for (const s of scrumList as any[]) {
            const id = String(s.id ?? s.ID ?? '')
            const name = String(s.name ?? s.NAME ?? s.TITLE ?? s.title ?? '')
            if (!id || !name) continue
            const { error: upErr } = await supabaseAdmin
              .from('sprint_stages')
              .upsert(
                {
                  id,
                  scope: String(sid),
                  name,
                  sort: parseInt(s.sort ?? s.SORT ?? '0') || 0,
                  synced_at: new Date().toISOString(),
                },
                { onConflict: 'id,scope' },
              )
            if (!upErr) scrumSynced++
          }
        } catch (e) {
          // Uma sprint que falha não pode derrubar as outras nem a fase inteira.
          errosEtapas.push(`sprint ${sid}: ${truncar((e as Error).message)}`)
        }
      }
      fases.sprintStages =
        errosEtapas.length && scrumSynced === 0
          ? { ok: false, erro: errosEtapas.join(' · ') }
          : { ok: true, count: scrumSynced }
      if (errosEtapas.length)
        console.warn(
          '[sync-sprint-bitrix] scrum.kanban.getStages parcial:',
          errosEtapas.join(' · '),
        )
    }

    // sprintsOnly: só "semeia" grupos+sprints+stages (leve) — usado pela tela
    // Sprint pra popular o dropdown de sprints de um grupo recém-selecionado,
    // sem tocar tarefas/elapsed/UF/timeman (pesado). O usuário escolhe a
    // sprint depois e sincroniza de novo, agora com sprintId (fase 4 filtrada).
    if (sprintsOnly) {
      return new Response(
        JSON.stringify({
          success: fases.sprints.ok,
          groupId,
          groupName,
          groupsSynced,
          fases,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 4. tasks.task.list → sprint_tasks, gravado PÁGINA A PÁGINA (não acumula
    // tudo em memória) — um grupo grande (ex.: 2001 tarefas = 41 páginas) que só
    // grava no final perde TUDO se a invocação estourar o tempo limite no meio
    // da paginação. Com sprintId, filtra só aquela sprint (rápido, poucas
    // tarefas) e, se já houver um sync anterior bem-sucedido dessa sprint
    // (sprint_sprints.tasks_synced_at), soma >=CHANGED_DATE — traz só o que
    // mudou desde então (re-syncs ficam leves). Sem tasks_synced_at (1ª vez
    // ou grupo grande demais pra caber os 42/tantas tarefas de uma sprint),
    // traz tudo da sprint. Sem sprintId, cai no dateFrom opcional
    // (CREATED_DATE) — usado pelo bootstrap/Não Conformidades.
    const taskIds: string[] = []
    let tasksSynced = 0
    // Manutenção de b24_users a partir da fase de tasks (Prompt 169, Parte B):
    // responsible_name já vem DE GRAÇA no payload de tasks.task.list (Passo 1
    // do Prompt 167) — pra esses, upsert direto em b24_users, sem gastar cota
    // do Bitrix. Só os que vierem sem nome (raro) caem no helper (user.get
    // via webhook CRM). Isso também pré-aquece o cache pra fase de elapsed
    // logo abaixo, que resolve os mesmos usuários na maioria dos casos.
    const responsiblesComNome = new Map<string, string>()
    const responsiblesSemNome = new Set<string>()
    try {
      const filter: Record<string, unknown> = { GROUP_ID: Number(groupId) }
      if (sprintId) {
        filter['SPRINT_ID'] = Number(sprintId)
        const { data: sprintRow } = await supabaseAdmin
          .from('sprint_sprints')
          .select('tasks_synced_at')
          .eq('id', String(sprintId))
          .maybeSingle()
        if (sprintRow?.tasks_synced_at)
          filter['>=CHANGED_DATE'] = sprintRow.tasks_synced_at
      } else if (dateFrom) {
        filter['>=CREATED_DATE'] = dateFrom
      }

      await callBitrixPagedEach(
        'tasks.task.list',
        {
          filter,
          select: [
            'ID',
            'TITLE',
            'STAGE_ID',
            'STATUS',
            'RESPONSIBLE_ID',
            'CREATED_DATE',
            'DEADLINE',
            'TIME_ESTIMATE',
            'TIME_SPENT_IN_LOGS',
            'SPRINT_ID',
            'TAGS',
          ],
        },
        async (chunk) => {
          for (const t of chunk) {
            const responsibleName = t.responsible?.name
              ? `${t.responsible.name} ${t.responsible.lastName || ''}`.trim()
              : (t.responsibleName ?? t.RESPONSIBLE_NAME ?? '')

            // sprintId real do Bitrix (0/vazio = tarefa sem sprint = backlog local).
            const rawSprintId = t.sprintId ?? t.SPRINT_ID
            const taskSprintId =
              rawSprintId && String(rawSprintId) !== '0'
                ? String(rawSprintId)
                : 'BACKLOG'

            const id = String(t.id ?? t.ID)
            const { error } = await supabaseAdmin.from('sprint_tasks').upsert(
              {
                id,
                title: t.title ?? t.TITLE ?? '',
                group_id: String(groupId),
                sprint_id: taskSprintId,
                stage_id: String(t.stageId ?? t.STAGE_ID ?? t.stage?.id ?? ''),
                status: String(t.status ?? t.STATUS ?? ''),
                responsible_id: String(
                  t.responsibleId ??
                    t.RESPONSIBLE_ID ??
                    t.responsible?.id ??
                    '',
                ),
                responsible_name: responsibleName,
                time_estimate:
                  parseInt(String(t.timeEstimate ?? t.TIME_ESTIMATE ?? 0)) || 0,
                time_spent_in_logs:
                  parseInt(
                    String(t.timeSpentInLogs ?? t.TIME_SPENT_IN_LOGS ?? 0),
                  ) || 0,
                // TAGS vem como array de strings ("Fixo", "Proj: MLW", ...) — junta
                // em CSV porque isFixed() (sprint-fixo.js) espera tags.split(',').
                tags: (() => {
                  const raw = t.tags ?? t.TAGS
                  return Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
                })(),
                date_create:
                  t.createdDate ?? t.CREATED_DATE ?? t.dateCreate ?? null,
                deadline: t.deadline ?? t.DEADLINE ?? null,
                synced_at: new Date().toISOString(),
              },
              { onConflict: 'id' },
            )
            if (!error) {
              tasksSynced++
              taskIds.push(id)
              const responsibleId = String(
                t.responsibleId ?? t.RESPONSIBLE_ID ?? t.responsible?.id ?? '',
              )
              if (responsibleId) {
                if (responsibleName)
                  responsiblesComNome.set(responsibleId, responsibleName)
                else responsiblesSemNome.add(responsibleId)
              }
            }
          }
        },
      )
      fases.tasks = { ok: true, count: tasksSynced }

      // Resolução/cache de nome é objetivo SECUNDÁRIO — isolada num try/catch
      // próprio (Prompt 170/171): se falhar, não pode reescrever fases.tasks
      // (já ok:true acima) pra falha, nem pular o carimbo do incremental logo
      // abaixo. 1 vez por fase (agregado), não por tarefa. Nomes já
      // conhecidos (responsibleName veio de graça) vão direto, sem gastar
      // cota do Bitrix; só os sem nome passam pelo helper (user.get via
      // webhook CRM).
      try {
        if (responsiblesComNome.size) {
          const rows = Array.from(responsiblesComNome.entries()).map(
            ([id, name]) => ({
              id,
              name,
              synced_at: new Date().toISOString(),
            }),
          )
          await supabaseAdmin
            .from('b24_users')
            .upsert(rows, { onConflict: 'id' })
        }
        const respSemNomeRestantes = Array.from(responsiblesSemNome).filter(
          (id) => !responsiblesComNome.has(id),
        )
        if (respSemNomeRestantes.length) {
          await resolveAndCacheUsers(supabaseAdmin, respSemNomeRestantes)
        }
      } catch (e: any) {
        console.warn(
          '[sync-sprint-bitrix] resolução de nome (tasks) falhou, seguindo sem: ' +
            (e?.message ?? e),
        )
      }

      // Carimba o corte do incremental só quando a fase terminou OK — se
      // gravássemos isso mesmo com erro, a próxima sync pensaria que já
      // trouxe tarefas que na verdade falharam no meio do caminho.
      // Margem de 10min (em vez de "agora" cru): cobre tarefas alteradas
      // durante o próprio sync e qualquer defasagem de relógio Supabase↔
      // Bitrix. Reprocessar essa janela de novo não duplica nada — upsert é
      // por id, então re-ler tarefas já sincronizadas é idempotente.
      if (sprintId) {
        const carimbo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
        await supabaseAdmin
          .from('sprint_sprints')
          .update({ tasks_synced_at: carimbo })
          .eq('id', String(sprintId))
      }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn('[sync-sprint-bitrix] tasks.task.list falhou:', msg)
      // parcial: o que já foi upsertado página a página antes do erro NÃO se
      // perde (diferente do comportamento anterior, que só gravava no final).
      fases.tasks = { ok: false, erro: msg, parcial: tasksSynced }
    }

    // 4b. Backfill de sprint_tasks.time_spent_in_logs pras tarefas da sprint
    // que a fase 4 NÃO trouxe nesta rodada — MESMA CLASSE DE BUG da fase
    // "elapsed" (corrigida em 18/07): apontar hora numa tarefa não muda o
    // CHANGED_DATE dela no Bitrix, então o filtro incremental da fase 4
    // (>=CHANGED_DATE) nunca via essa tarefa de novo. A correção de 18/07 só
    // cobriu sprint_elapsed (tabela detalhada, usada no gráfico de horas por
    // pessoa) — esse campo (usado no card de total "Horas Apontadas") ficou
    // de fora e continuava congelado, mesmo depois daquela correção. Achado
    // 2026-07-20, relatado pelo Everton (sprint MLW com X horas no Bitrix,
    // valor não subia no DataviZION mesmo clicando em Sincronizar).
    // Só busca de novo as tarefas que a fase 4 NÃO trouxe (as que trouxe já
    // vêm com o valor atual, gravado ali mesmo) — evita refazer uma chamada
    // que acabou de ser feita. Usa tasks.task.get em lote (batch, até 49 por
    // requisição), mesmo padrão das fases elapsed/timeman.
    if (sprintId) {
      try {
        const { data: sprintTaskRows } = await supabaseAdmin
          .from('sprint_tasks')
          .select('id')
          .eq('sprint_id', String(sprintId))
        const localIds = (sprintTaskRows || []).map((t: any) => String(t.id))
        const staleIds = localIds.filter((id) => !taskIds.includes(id))

        const TIME_BATCH_SIZE = 49
        let backfillSynced = 0
        for (let i = 0; i < staleIds.length; i += TIME_BATCH_SIZE) {
          const chunk = staleIds.slice(i, i + TIME_BATCH_SIZE)
          const cmds: Record<string, string> = {}
          chunk.forEach((tid, idx) => {
            cmds[`tt${idx}`] =
              `tasks.task.get?taskId=${tid}&select[]=ID&select[]=TIME_SPENT_IN_LOGS`
          })

          try {
            const results = await callBitrixBatch(cmds)
            for (const r of Object.values(results || {})) {
              const task = (r as any)?.task
              if (!task) continue
              const id = String(task.id ?? task.ID ?? '')
              if (!id) continue
              const timeSpent =
                parseInt(
                  String(task.timeSpentInLogs ?? task.TIME_SPENT_IN_LOGS ?? 0),
                ) || 0
              const { error: updErr } = await supabaseAdmin
                .from('sprint_tasks')
                .update({ time_spent_in_logs: timeSpent })
                .eq('id', id)
              if (!updErr) backfillSynced++
            }
          } catch (e) {
            console.warn(
              '[sync-sprint-bitrix] backfill time_spent_in_logs falhou num lote:',
              (e as Error).message,
            )
          }
        }
        fases.timeSpentBackfill = { ok: true, count: backfillSynced }
      } catch (e) {
        const msg = truncar((e as Error).message)
        console.warn(
          '[sync-sprint-bitrix] backfill time_spent_in_logs falhou:',
          msg,
        )
        fases.timeSpentBackfill = { ok: false, erro: msg }
      }
    }

    // 5. Horas apontadas por tarefa (task.elapseditem.getlist via `batch`,
    // até 49 tarefas por requisição HTTP) → sprint_elapsed
    // ANTI-REGRESSÃO (mesma classe de bug da fase "uf", Prompt 116/120):
    // apontar hora numa tarefa não muda o CHANGED_DATE dela no Bitrix, então
    // o filtro incremental da fase 4 (>=CHANGED_DATE) nunca via essa tarefa
    // de novo — depois do 1º sync de uma sprint, sprint_elapsed ficava
    // congelado pra sempre (sprint aberta ou fechada, clicar em Sincronizar
    // não trazia hora nenhuma nova). Achado 2026-07-18, relatado pelo Everton.
    // Com sprintId, usa a UNIÃO de taskIds (fase 4, tarefas re-sincronizadas
    // nesta rodada) + todas as tarefas já conhecidas da sprint no banco —
    // mesma solução já aplicada na fase "uf" abaixo. Sem sprintId
    // (bootstrap/Não Conformidades), mantém taskIds: o DELETE nunca atinge
    // tarefas fora do período pedido (dateFrom), então elapsed de tarefas
    // antigas não filtradas nesta rodada permanece intacto.
    let elapsedSynced = 0
    const elapsedUserIds = new Set<string>() // agregado da rodada inteira — 1 chamada ao helper no final, não por lote (Prompt 169, Parte B)
    try {
      let elapsedTaskIds = taskIds
      if (sprintId) {
        const { data: sprintTaskRows } = await supabaseAdmin
          .from('sprint_tasks')
          .select('id')
          .eq('sprint_id', String(sprintId))
        const localIds = (sprintTaskRows || []).map((t: any) => String(t.id))
        elapsedTaskIds = Array.from(new Set([...taskIds, ...localIds]))
      }

      const recarga = await recarregarElapsed(elapsedTaskIds)
      elapsedSynced = recarga.count
      for (const uid of recarga.userIds) elapsedUserIds.add(uid)
      fases.elapsed = { ok: true, count: elapsedSynced }

      // Mesmo carimbo do modo elapsedOnly: sprint sincronizada por aqui
      // também fica com apontamento detalhado (janela de relógio), então ela
      // não pode aparecer no relatório de horas manuais como "aguardando
      // atualização". Sem sprintId (bootstrap/Não Conformidades) não há uma
      // sprint específica pra carimbar — o DELETE/INSERT ali é por período,
      // não por sprint.
      if (sprintId) {
        await supabaseAdmin
          .from('sprint_sprints')
          .update({ elapsed_synced_at: new Date().toISOString() })
          .eq('id', String(sprintId))
      }

      // Resolução/cache de nome é objetivo SECUNDÁRIO — isolada num try/catch
      // próprio (Prompt 170/171): se falhar, não pode reescrever fases.elapsed
      // (já ok:true acima) pra falha. 1 chamada agregada pro helper (que já
      // reaproveita o cache aquecido pelos responsáveis da fase de tasks
      // acima; só consulta o Bitrix pelos IDs que sobrarem sem nome nos dois
      // passos).
      try {
        if (elapsedUserIds.size) {
          await resolveAndCacheUsers(supabaseAdmin, Array.from(elapsedUserIds))
        }
      } catch (e: any) {
        console.warn(
          '[sync-sprint-bitrix] resolução de nome (elapsed) falhou, seguindo sem: ' +
            (e?.message ?? e),
        )
      }

      // Cargo do Bitrix como SUGESTÃO na tela (Everton, 27/08/2026) — objetivo
      // TERCIÁRIO, próprio try/catch pelo mesmo motivo do bloco acima: falhar
      // aqui não pode apagar o ok:true de fases.elapsed, e um erro de nome não
      // deve impedir a tentativa de cargo (são consultas independentes).
      try {
        if (elapsedUserIds.size) {
          await backfillWorkPositions(supabaseAdmin, Array.from(elapsedUserIds))
        }
      } catch (e: any) {
        console.warn(
          '[sync-sprint-bitrix] backfill de cargo (elapsed) falhou, seguindo sem: ' +
            (e?.message ?? e),
        )
      }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn('[sync-sprint-bitrix] elapsed falhou:', msg)
      fases.elapsed = { ok: false, erro: msg }
    }

    // 6. Campos UF customizados (indicadores de DDI) via task.item.getlist (legado,
    // único endpoint que retorna UF_* de tarefas) → sprint_tasks.uf_fields.
    // Com sprintId, busca as tarefas da sprint em lotes de 50 via FILTER: { ID }
    // — sem isso, o 546/WORKER_LIMIT vinha daqui: paginava as 2001 tarefas do
    // GRUPO inteiro mesmo sincronizando 1 sprint com 42 tarefas (Prompt 115).
    // O conjunto buscado é a UNIÃO de (a) taskIds que a fase 4 trouxe nesta
    // rodada (respeitando o incremental) e (b) tarefas da sprint que já estão
    // no banco mas SEM uf_fields — backfill de buracos deixados por qualquer
    // falha passada da fase 6 (ex.: a regressão do Prompt 116), que o
    // incremental por si só nunca reprocessaria (CHANGED_DATE é sobre a
    // TAREFA ter mudado, não sobre o UF estar faltando — ver diagnóstico do
    // Prompt 120: 34/50 tarefas de uma sprint tinham UF no Bitrix e 0 no banco).
    // Sem sprintId (bootstrap/Não Conformidades), mantém o comportamento por
    // grupo, página a página. Se a união vier vazia, o loop de lotes
    // simplesmente não roda — fases.uf = { ok:true, count:0 }, sem chamada ao Bitrix.
    const UF_SELECT = [
      'ID',
      'UF_AUTO_590743268884',
      'UF_AUTO_721166635527',
      'UF_AUTO_549562325367',
      'UF_AUTO_974284666955',
      'UF_AUTO_101694691332',
      'UF_AUTO_915113699222',
      'UF_AUTO_640830147865',
      'UF_AUTO_553278156374',
    ]
    let ufSynced = 0
    async function applyUfTasks(ufResult: unknown): Promise<number> {
      const ufTasks = Array.isArray(ufResult) ? ufResult : []
      for (const t of ufTasks as any[]) {
        const id = String(t.ID ?? t.id ?? '')
        if (!id) continue
        const ufFields: Record<string, unknown> = {}
        Object.keys(t).forEach((k) => {
          if (k.toUpperCase().startsWith('UF_'))
            ufFields[k.toUpperCase()] = t[k]
        })
        await supabaseAdmin
          .from('sprint_tasks')
          .update({ uf_fields: ufFields })
          .eq('id', id)
        ufSynced++
      }
      return ufTasks.length
    }
    try {
      if (sprintId) {
        // Busca id+uf_fields de TODA a sprint (poucas dezenas/centenas de
        // tarefas, não é o volume pesado do grupo) e filtra no código quem
        // está sem UF — evita depender de sintaxe de filtro jsonb (is null OU
        // = '{}'::jsonb) no PostgREST, que não tem como validar sem invocar
        // a function de verdade.
        const { data: sprintTaskRows } = await supabaseAdmin
          .from('sprint_tasks')
          .select('id, uf_fields')
          .eq('sprint_id', String(sprintId))
        const semUfIds = (sprintTaskRows || [])
          .filter(
            (t: any) => !t.uf_fields || Object.keys(t.uf_fields).length === 0,
          )
          .map((t: any) => String(t.id))
        const ufTaskIds = Array.from(new Set([...taskIds, ...semUfIds]))

        // ATENÇÃO — regressão real do Prompt 116, confirmada e corrigida no
        // Prompt 118/119: task.item.getlist (ctaskitem::getlist) é um método
        // legado de parâmetros POSICIONAIS (#0=arOrder, #1=arFilter, #2=arParams,
        // #3=arSelect). Se ORDER e PARAMS não vierem no body — mesmo vazios —
        // o Bitrix desloca os valores pra posição errada e devolve
        // "arFilter must not contain key 0", mesmo filtrando por 1 ID só.
        // NUNCA remover ORDER/PARAMS desta chamada, mesmo parecendo redundante.
        const UF_BATCH_SIZE = 50
        for (let i = 0; i < ufTaskIds.length; i += UF_BATCH_SIZE) {
          const chunk = ufTaskIds.slice(i, i + UF_BATCH_SIZE)
          const ufResult = await callBitrix('task.item.getlist', {
            ORDER: { ID: 'ASC' },
            FILTER: { ID: chunk },
            PARAMS: {},
            SELECT: UF_SELECT,
          })
          await applyUfTasks(ufResult)
        }
      } else {
        const ufPageSize = 50
        let page = 1
        while (true) {
          const ufResult = await callBitrix('task.item.getlist', {
            ORDER: { ID: 'ASC' },
            FILTER: { GROUP_ID: Number(groupId) },
            PARAMS: { NAV_PARAMS: { nPageSize: ufPageSize, iNumPage: page } },
            SELECT: UF_SELECT,
          })
          const count = await applyUfTasks(ufResult)
          if (count < ufPageSize) break
          page++
        }
      }
      fases.uf = { ok: true, count: ufSynced }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn('[sync-sprint-bitrix] fetchLegacyUfMap falhou:', msg)
      fases.uf = { ok: false, erro: msg }
    }

    // 6.5. Histórico de mudança de ETAPA por tarefa → sprint_task_stage_history
    // (Everton, 2026-08-28: "quantas vezes um card entrou para DEV vindo do QA").
    //
    // sprint_tasks guarda só a etapa ATUAL e cada sync a sobrescreve — sem este
    // histórico não há como contar ida e volta entre Dev e QA. O Bitrix mantém a
    // trilha completa desde a criação do card, então cards ANTIGOS também vêm
    // (não é "só passa a contar de hoje em diante").
    //
    // O filtro por campo (ver HIST_FIELD abaixo) é essencial: o histórico bruto inclui comentário,
    // prazo, responsável etc., e o método devolve UMA página de no máx. 50
    // registros (confirmado na doc oficial — não manda `next`/`total`, igual ao
    // tasks.api.scrum.sprint.list já tratado em callBitrixAllPagesByOffset). Sem
    // o filtro, 50 comentários enterrariam as mudanças de coluna e a conta sairia
    // errada em silêncio. Com o filtro, 50 mudanças de etapa num card é muito
    // acima do real — mas se acontecer, o card é repaginado individualmente
    // abaixo em vez de truncar calado (regra 6 do CLAUDE.md).
    //
    // Escrita por UPSERT em (task_id, event_id), sem DELETE: histórico é imutável
    // e só cresce, então uma rodada que falhe no meio não apaga o que já veio —
    // ao contrário de sprint_elapsed, que é recarregada de propósito.
    let stageHistSynced = 0
    try {
      // Mesma união do elapsed: tarefas re-sincronizadas nesta rodada + todas as
      // já conhecidas da sprint. Mover um card de coluna mexe no CHANGED_DATE,
      // mas depender só disso deixaria de fora card movido antes do 1º sync.
      let histTaskIds = taskIds
      if (sprintId) {
        const { data: sprintTaskRows } = await supabaseAdmin
          .from('sprint_tasks')
          .select('id')
          .eq('sprint_id', String(sprintId))
        const localIds = (sprintTaskRows || []).map((t: any) => String(t.id))
        histTaskIds = Array.from(new Set([...taskIds, ...localIds]))
      }

      const HIST_PAGE_SIZE = 50

      // CONSULTA OS DOIS NOMES DE CAMPO — de propósito (Everton, 28/08/2026:
      // "a documentação fala que existe stage_id, e se mudarem o nome quebra?").
      //
      // A doc oficial do Bitrix lista STAGE_ID entre os valores de `field` e NÃO
      // lista STAGE. O histórico real deste portal devolve STAGE, com o NOME da
      // etapa no valor (não o id):
      //   {"field":"STAGE","value":{"from":"Em Desenvolvimento","to":"Em Teste"}}
      // A 1ª versão apostou na doc, filtrou STAGE_ID e gravou zero em silêncio.
      //
      // Apostar agora no oposto seria repetir o erro com outro palpite: a
      // verificação foi feita em UM card, de sprint. Não há como afirmar que
      // quadro Kanban (que os painéis Dev/QA também cobrem) usa o mesmo nome.
      // Consultar os dois custa uma consulta a mais por tarefa e imuniza contra
      // as duas hipóteses — inclusive se o Bitrix mudar numa atualização.
      // Evento repetido nos dois filtros não duplica: a PK é (task_id,event_id).
      const HIST_FIELDS = ['STAGE', 'STAGE_ID']

      // Formato da resposta: a doc documenta camelCase (id/createdDate/field/
      // value.from/value.to/user.id), mas os métodos de tarefa do Bitrix
      // costumam variar entre camelCase e MAIÚSCULAS conforme a versão da conta.
      // Lê os dois em vez de apostar num — se mudar de forma, não volta zero
      // calado.
      const parseHistRow = (h: any, taskId: string) => {
        const eventId = String(h.id ?? h.ID ?? '')
        if (!eventId) return null
        const rawDate = h.createdDate ?? h.CREATED_DATE ?? h.createdTime ?? null
        const val = h.value ?? h.VALUE ?? {}
        const from = val.from ?? val.FROM ?? h.fromValue ?? h.FROM_VALUE ?? null
        const to = val.to ?? val.TO ?? h.toValue ?? h.TO_VALUE ?? null
        const userId = h.user?.id ?? h.USER?.ID ?? h.userId ?? h.USER_ID ?? null
        const d = rawDate ? new Date(rawDate) : null
        if (!d || isNaN(d.getTime())) return null
        return {
          task_id: taskId,
          event_id: eventId,
          created_date: d.toISOString(),
          stage_from: from !== null && from !== '' ? String(from) : null,
          stage_to: to !== null && to !== '' ? String(to) : null,
          user_id: userId ? String(userId) : null,
          synced_at: new Date().toISOString(),
        }
      }

      const unwrapHist = (r: any): any[] => {
        if (Array.isArray(r)) return r
        if (Array.isArray(r?.list)) return r.list
        if (Array.isArray(r?.result?.list)) return r.result.list
        if (r && typeof r === 'object')
          return Object.values(r).filter(
            (v) => v && typeof v === 'object',
          ) as any[]
        return []
      }

      const gravarHist = async (rows: any[]) => {
        if (!rows.length) return
        const { error: upErr } = await supabaseAdmin
          .from('sprint_task_stage_history')
          .upsert(rows, { onConflict: 'task_id,event_id' })
        if (!upErr) stageHistSynced += rows.length
        else
          console.warn(
            '[sync-sprint-bitrix] upsert de stage history falhou:',
            upErr.message,
          )
      }

      // SONDA (2026-08-28): uma chamada ÚNICA antes do lote, porque erro dentro
      // de `batch` com halt:0 não vira exceção — vem em result_error, comando a
      // comando. Sem isso, um método fora do escopo do webhook fazia a fase
      // gravar zero e reportar sucesso (falha invisível encontrada em produção).
      // callBitrix propaga a exceção, então a causa aparece em fases.stageHistory.
      if (histTaskIds.length) {
        await callBitrix('tasks.task.history.list', { taskId: histTaskIds[0] })
      }

      // Dois comandos por tarefa (um por nome de campo), então o lote leva
      // metade das tarefas pra caber nos 50 comandos do batch do Bitrix.
      const BATCH_SIZE = Math.floor(49 / HIST_FIELDS.length)
      const truncados: Array<{ tid: string; field: string }> = []
      let errosDeComando = 0
      let primeiroErro: string | null = null
      const achadosPorCampo: Record<string, number> = {}

      for (let i = 0; i < histTaskIds.length; i += BATCH_SIZE) {
        const chunk = histTaskIds.slice(i, i + BATCH_SIZE)
        const cmds: Record<string, string> = {}
        chunk.forEach((tid, idx) => {
          HIST_FIELDS.forEach((field, fi) => {
            cmds[`h${idx}_${fi}`] =
              `tasks.task.history.list?taskId=${tid}&filter[FIELD]=${field}`
          })
        })

        try {
          const { result: results, errors } =
            await callBitrixBatchComErros(cmds)
          const qtdErros = Object.keys(errors || {}).length
          if (qtdErros) {
            errosDeComando += qtdErros
            primeiroErro = primeiroErro ?? primeiroErroDeBatch(errors)
            console.warn(
              `[sync-sprint-bitrix] stage history: ${qtdErros} comando(s) do lote falharam — ${primeiroErro ?? 'sem detalhe'}`,
            )
          }
          const rows: any[] = []
          chunk.forEach((tid, idx) => {
            HIST_FIELDS.forEach((field, fi) => {
              const items = unwrapHist(results?.[`h${idx}_${fi}`])
              if (items.length)
                achadosPorCampo[field] =
                  (achadosPorCampo[field] || 0) + items.length
              // Página cheia = pode haver mais que o método não devolveu nesta
              // chamada; marca pra repaginar por offset fora do batch.
              if (items.length >= HIST_PAGE_SIZE) truncados.push({ tid, field })
              items.forEach((h) => {
                const row = parseHistRow(h, tid)
                if (row) rows.push(row)
              })
            })
          })
          await gravarHist(rows)
        } catch (e) {
          console.warn(
            '[sync-sprint-bitrix] batch de stage history falhou num lote:',
            (e as Error).message,
          )
          primeiroErro = primeiroErro ?? (e as Error).message
        }
      }

      // Cards com histórico de etapa maior que uma página: repagina um por um
      // avançando `start` (o método não manda `next`, então o critério de parada
      // é a página vir menor que 50 — mesma técnica do callBitrixAllPagesByOffset).
      for (const { tid, field } of truncados) {
        try {
          let start = 0
          for (let page = 0; page < 20; page++) {
            const raw = await callBitrix('tasks.task.history.list', {
              taskId: tid,
              filter: { FIELD: field },
              start,
            })
            const items = unwrapHist(raw)
            const rows = items.map((h) => parseHistRow(h, tid)).filter(Boolean)
            await gravarHist(rows as any[])
            if (items.length < HIST_PAGE_SIZE) break
            start += items.length
          }
        } catch (e) {
          console.warn(
            `[sync-sprint-bitrix] repaginação de stage history da tarefa ${tid} (${field}) falhou:`,
            (e as Error).message,
          )
        }
      }

      // Qual nome de campo respondeu de verdade. Vai pro log de propósito: é a
      // resposta definitiva pra dúvida "é STAGE ou STAGE_ID?" — medida no portal,
      // não deduzida da doc (que diverge). Se um dia só um dos dois aparecer com
      // zero, dá pra parar de consultar o outro com segurança.
      console.log(
        '[sync-sprint-bitrix] stage history por campo:',
        JSON.stringify(achadosPorCampo),
      )

      // Comando que falhou NÃO pode virar "fase ok com zero" — foi assim que a
      // causa ficou escondida da primeira vez.
      if (errosDeComando > 0 && stageHistSynced === 0) {
        fases.stageHistory = {
          ok: false,
          erro: truncar(
            `Bitrix recusou ${errosDeComando} consulta(s) de histórico: ${primeiroErro ?? 'sem detalhe'}`,
          ),
        }
      } else if (errosDeComando > 0) {
        fases.stageHistory = {
          ok: true,
          count: stageHistSynced,
          parcial: errosDeComando,
        }
      } else if (stageHistSynced === 0 && histTaskIds.length > 0) {
        // Nenhum erro E nenhum registro, com tarefas para consultar: é um zero
        // SUSPEITO. Card que andou pelo quadro tem que ter mudança de etapa.
        // O caso conhecido é o campo mudar de nome (a doc do Bitrix diz
        // STAGE_ID, este portal usa STAGE) — foi assim que a 1ª versão gravou
        // zero e reportou sucesso. Zero legítimo existe (sprint recém-criada),
        // por isso é aviso e não erro: some assim que um card se mover.
        fases.stageHistory = {
          ok: false,
          erro: `Nenhuma mudança de etapa encontrada em ${histTaskIds.length} tarefa(s) — o campo "${HIST_FIELDS.join('/')}" pode ter mudado no Bitrix. Sem isso a contagem de voltas fica zerada.`,
        }
      } else {
        fases.stageHistory = { ok: true, count: stageHistSynced }
      }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn('[sync-sprint-bitrix] sync de stage history falhou:', msg)
      fases.stageHistory = { ok: false, erro: msg }
    }

    // 7. Ponto batido (timeman) — só para sprints já fechadas/completas. Com
    // sprintId, restringe a ESSA sprint — sem isso, sincronizar 1 sprint ativa
    // disparava timeman pras 49 sprints fechadas do grupo inteiro (outra causa
    // do 546/WORKER_LIMIT, ver Prompt 115). Sem sprintId (bootstrap/Não
    // Conformidades), mantém todas as sprints do grupo.
    // Monta a lista de (usuário, mês/ano) das sprints fechadas primeiro, e só
    // depois busca no Bitrix em lotes de até 49 via `batch` — timeman.timecontrol.
    // reports.get só aceita 1 mês por chamada, então cada (usuário, mês) é 1 comando
    // dentro do batch (bem mais barato que 1 requisição HTTP por combinação).
    let timemanSynced = 0
    try {
      const sprintsScope = sprintId
        ? supabaseAdmin
            .from('sprint_sprints')
            .select('id, name, status, date_start, date_finish')
            .eq('id', String(sprintId))
        : supabaseAdmin
            .from('sprint_sprints')
            .select('id, name, status, date_start, date_finish')
            .eq('group_id', String(groupId))
      const { data: allSprints } = await sprintsScope

      // Sprint ATIVA entra também (Everton, 2026-08-28: "parcial, claro — meu
      // chefe quer ver todo dia"). Antes só sprint encerrada tinha ponto, e a
      // aba Ociosidade por Pessoa ficava vazia a sprint inteira, virando um
      // relatório de post-mortem.
      //
      // `planned` continua fora: sprint que não começou não tem jornada pra
      // buscar, e pedir ponto dela seriam chamadas certas de voltar vazias.
      //
      // O CUSTO é real e por isso não era assim: timeman.timecontrol.reports.get
      // aceita 1 mês por chamada, então cada (pessoa, mês) é um comando. Uma
      // sprint ativa de 15 pessoas em 2 meses = 30 comandos a mais por
      // sincronização — o que cabe no batch, mas passa a acontecer TODA vez, e
      // não só quando a sprint fecha.
      const sprintsComPonto = (allSprints || []).filter(
        (s: any) =>
          !['planned', ''].includes(String(s.status || '').toLowerCase()),
      )

      // A sprint em andamento só tem jornada até hoje: pedir o período inteiro
      // ao Bitrix traria dias que ainda não aconteceram, e a tela mostraria a
      // pessoa "ociosa" pelo futuro que ela ainda vai trabalhar.
      const hojeISO = new Date().toISOString().slice(0, 10)
      const ehAtiva = (s: any) =>
        String(s.status || '').toLowerCase() === 'active'

      const GRACE_DAYS = 10
      type TimemanJob = {
        sprintId: string
        userId: string
        month: number
        year: number
        dateFrom: string
        dateTo: string
      }
      const jobs: TimemanJob[] = []
      const sprintsToClear = new Set<string>()

      for (const cs of sprintsComPonto) {
        const csId = String(cs.id)
        let dateFrom: string | null = cs.date_start
        let dateTo: string | null = cs.date_finish

        if (!dateFrom || !dateTo) {
          const m = (cs.name || '').match(
            /\((\d{2})\/(\d{2})\/(\d{4})\s*(?:->|[–→-])\s*(\d{2})\/(\d{2})\/(\d{4})\)/,
          )
          if (m) {
            dateFrom = dateFrom || `${m[3]}-${m[2]}-${m[1]}`
            dateTo = dateTo || `${m[6]}-${m[5]}-${m[4]}`
            await supabaseAdmin
              .from('sprint_sprints')
              .update({ date_start: dateFrom, date_finish: dateTo })
              .eq('id', csId)
          }
        }
        if (!dateFrom || !dateTo) continue

        // Corta o fim no dia de hoje quando a sprint ainda está rodando. Sem
        // isso, os dias que faltam entram como jornada zero e a pessoa aparece
        // ociosa por um tempo que ela ainda nem tinha pra trabalhar.
        if (ehAtiva(cs) && dateTo > hojeISO) dateTo = hojeISO
        // Sprint que começa no futuro (ou hoje, antes de bater ponto) não tem o
        // que buscar — evita pedir um período invertido ao Bitrix.
        if (dateFrom > dateTo) continue

        // ANTI-REGRESSÃO (achado 2026-08-17, relatado pelo Everton): esta lista
        // buscava SÓ os responsáveis pelas tarefas da sprint. Quem apenas aponta
        // hora no card de outra pessoa nunca tinha o ponto pedido ao Bitrix e
        // aparecia sem jornada nenhuma — na sprint 2026.07.2.1 do MLW, 12 das 14
        // pessoas que apontaram hora ficaram sem ponto por causa disso. É a mesma
        // classe de bug das fases "elapsed" e "uf" (buscar por um conjunto mais
        // estreito do que o necessário), e a solução é a mesma: UNIÃO.
        const { data: sprintTaskRowsTm } = await supabaseAdmin
          .from('sprint_tasks')
          .select('id, responsible_id')
          .eq('sprint_id', csId)

        const sprintTaskIds = (sprintTaskRowsTm || []).map((r: any) =>
          String(r.id),
        )

        // Tarefas de cada responsável, montadas em memória a partir do SELECT
        // acima — antes isso era 1 query por usuário dentro do laço. Com a união
        // a lista de usuários cresce (2 -> 14 no caso do MLW), e o custo dessas
        // idas ao banco cresce junto.
        const tarefasPorResponsavel = new Map<string, string[]>()
        for (const r of sprintTaskRowsTm || []) {
          const rid = String((r as any).responsible_id ?? '')
          if (!rid) continue
          const lista = tarefasPorResponsavel.get(rid) ?? []
          lista.push(String((r as any).id))
          tarefasPorResponsavel.set(rid, lista)
        }

        let apontadores: string[] = []
        if (sprintTaskIds.length) {
          const { data: elapsedUsers } = await supabaseAdmin
            .from('sprint_elapsed')
            .select('user_id')
            .in('task_id', sprintTaskIds)
            .not('user_id', 'is', null)
          apontadores = (elapsedUsers || [])
            .map((r: any) => String(r.user_id ?? ''))
            .filter((id: string) => id !== '')
        }

        const distinctUsers = Array.from(
          new Set([...tarefasPorResponsavel.keys(), ...apontadores]),
        ) as string[]
        if (!distinctUsers.length) continue

        const graceCap = new Date(dateTo)
        graceCap.setDate(graceCap.getDate() + GRACE_DAYS)
        const graceCapStr = graceCap.toISOString().slice(0, 10)

        sprintsToClear.add(csId)

        for (const responsibleId of distinctUsers) {
          // Vazio para quem só apontou hora sem ser responsável — nesse caso o
          // "dia de graça" não se aplica e a janela do ponto fica no período da
          // própria sprint, que é o comportamento correto.
          const userTaskIds = tarefasPorResponsavel.get(responsibleId) ?? []

          let lastElapsedDate: string | null = null
          if (userTaskIds.length) {
            const { data: lastElapsedRow } = await supabaseAdmin
              .from('sprint_elapsed')
              .select('created_date')
              .in('task_id', userTaskIds)
              .order('created_date', { ascending: false })
              .limit(1)
              .maybeSingle()
            lastElapsedDate = lastElapsedRow?.created_date ?? null
          }

          const userLastDate = lastElapsedDate ?? dateTo
          const effectiveLast =
            userLastDate <= graceCapStr ? userLastDate : dateTo
          const userDateTo = effectiveLast > dateTo ? effectiveLast : dateTo

          for (const { month, year } of monthsInRange(dateFrom, userDateTo)) {
            jobs.push({
              sprintId: csId,
              userId: responsibleId,
              month,
              year,
              dateFrom,
              dateTo: userDateTo,
            })
          }
        }
      }

      for (const csId of sprintsToClear) {
        await supabaseAdmin
          .from('timeman_entries')
          .delete()
          .eq('sprint_id', csId)
      }

      // Dedup de jobs idênticos (mesmo usuário+mês pode repetir entre sprints
      // vizinhas por causa do "dia de graça") — mantém 1 chamada Bitrix por
      // combinação real, mas aplica o resultado a todas as sprints que pediram.
      const jobKey = (j: TimemanJob) => `${j.userId}:${j.month}:${j.year}`
      const uniqueByKey = new Map<
        string,
        { userId: string; month: number; year: number }
      >()
      for (const j of jobs)
        uniqueByKey.set(jobKey(j), {
          userId: j.userId,
          month: j.month,
          year: j.year,
        })
      const uniqueJobs = Array.from(uniqueByKey.entries())

      // Resultado bruto por (userId,mês,ano) — filtragem por período de cada sprint
      // acontece depois, ao consumir reportsByKey.
      const reportsByKey = new Map<
        string,
        { date: string; seconds: number }[]
      >()

      const BATCH_SIZE_TM = 49
      for (let i = 0; i < uniqueJobs.length; i += BATCH_SIZE_TM) {
        const chunk = uniqueJobs.slice(i, i + BATCH_SIZE_TM)
        const cmds: Record<string, string> = {}
        chunk.forEach(([key, j], idx) => {
          cmds[`tm${idx}`] =
            `timeman.timecontrol.reports.get?USER_ID=${j.userId}&MONTH=${j.month}&YEAR=${j.year}`
        })

        try {
          const results = await callBitrixBatch(cmds)
          chunk.forEach(([key], idx) => {
            const report = (results as any)[`tm${idx}`]
            const rawDays = report?.report?.days ?? []
            // `days` vem como LISTA em algumas contas/versões e como OBJETO
            // indexado por AAAAMMDD em outras. `for...of` num objeto estoura, e
            // o catch do lote engolia o erro: um relatório em formato de objeto
            // derrubava o ponto de até 49 pessoas de uma vez, sem aviso.
            const dayEntries: [string, any][] = Array.isArray(rawDays)
              ? rawDays.map((d: any, i: number) => [String(i), d])
              : Object.entries((rawDays || {}) as Record<string, any>)

            const entries: { date: string; seconds: number }[] = []
            for (const [chave, day] of dayEntries) {
              if (!day || typeof day !== 'object') continue
              const dateStr = diaDoRelatorio(day, chave)
              if (!dateStr) continue
              if (ehEcoDeTurnoAnterior(day, dateStr)) continue
              const seconds = timemanSeconds(day)
              if (seconds > 0) entries.push({ date: dateStr, seconds })
            }
            reportsByKey.set(key, entries)
          })
        } catch (e) {
          console.warn(
            '[sync-sprint-bitrix] timeman batch falhou num lote:',
            (e as Error).message,
          )
        }
      }

      // Aplica os relatórios buscados a cada job original (sprint + período
      // específico) — acumula TODAS as linhas primeiro e grava com 1
      // insert(array) no final, não 1 insert por (sprint,usuário,dia). Mesmo
      // motivo da fase 5 (elapsed): centenas de INSERTs sequenciais é o que
      // causava o gap medido no Prompt 117, não espera do Bitrix.
      const timemanRows: {
        sprint_id: string
        user_id: string
        date_entry: string
        seconds: number
        synced_at: string
      }[] = []
      for (const j of jobs) {
        const entries = reportsByKey.get(jobKey(j)) || []
        const from = new Date(j.dateFrom + 'T00:00:00Z')
        const to = new Date(j.dateTo + 'T23:59:59Z')
        const perDay = new Map<string, number>()
        for (const { date, seconds } of entries) {
          const d = new Date(date + 'T00:00:00Z')
          if (d < from || d > to) continue
          // CORREÇÃO 2026-08-18: aqui era `Math.max`, com o comentário "dedup
          // fuso +03:00". O dedup existia porque a data vinha convertida pra
          // UTC e dois dias diferentes colidiam na mesma chave. Com a data
          // saindo do `index` do Bitrix (ver diaDoRelatorio) essa colisão
          // acabou, e data repetida passa a significar o que de fato é: mais de
          // um turno no mesmo dia (a pessoa fechou o ponto e reabriu). A grade
          // do Bitrix soma os turnos na linha do dia; o `Math.max` jogava o
          // turno menor no lixo — é daí que vinham os minutos faltando.
          perDay.set(date, (perDay.get(date) ?? 0) + seconds)
        }
        for (const [date, seconds] of perDay) {
          timemanRows.push({
            sprint_id: j.sprintId,
            user_id: j.userId,
            date_entry: date,
            // Mesmo limite do extrator, agora sobre a soma dos turnos: 24h é o
            // que um dia do calendário comporta.
            seconds: Math.min(seconds, 24 * 3600),
            synced_at: new Date().toISOString(),
          })
        }
      }
      if (timemanRows.length) {
        const { error: insertErr } = await supabaseAdmin
          .from('timeman_entries')
          .insert(timemanRows)
        if (!insertErr) timemanSynced = timemanRows.length
      }
      fases.timeman = { ok: true, count: timemanSynced }
    } catch (e) {
      const msg = truncar((e as Error).message)
      console.warn('[sync-sprint-bitrix] sync de timeman falhou:', msg)
      fases.timeman = { ok: false, erro: msg }
    }

    // success exige pelo menos grupos (já garantido por ter chegado até aqui)
    // + sprints + tasks OK — as demais fases (stages/elapsed/uf/timeman) são
    // complementares e não bloqueiam o sync ser considerado bem-sucedido.
    const success = fases.sprints.ok && fases.tasks.ok

    return new Response(
      JSON.stringify({
        success,
        groupId,
        groupName,
        groupsSynced,
        fases,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
})
