import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Sincroniza chamados do TomTicket (API v2, https://tomticket.tomticket.com/kb/api)
// pra dentro de public.suporte_chamados. Diferente do resto da Auditoria,
// não existe sync original pra portar — o projeto do Everton lia direto de
// um Postgres já populado por fora. Este mapeamento API→tabela é desenho
// novo (ver comentário no topo da migration 20260707110000).
//
// Volume real: ~33.800 chamados, API limitada a 50/página e 3 req/s — cada
// clique em "Sincronizar" processa até PAGE_LIMIT páginas (sempre reforça a
// página 1, mais recente, e avança o "last_page" pra ir trazendo o
// histórico aos poucos). Clicar várias vezes completa a sincronização.
const API_BASE = 'https://api.tomticket.com/v2.0'
const PAGE_LIMIT = 25
const RATE_DELAY_MS = 350 // ~3 req/s permitido pela API

// "Motivo da abertura de chamado", "Sistema Alvo" e "Processo" são campos
// personalizados do TomTicket (ver migrations 20260724100000, 20260724120000
// e 20260724130000) — só vêm no endpoint de detalhe (1 chamada por chamado),
// não no /ticket/list em massa. Os três vêm na MESMA resposta de detalhe
// (custom_fields.open), então extrair Sistema Alvo/Processo não custa
// nenhuma chamada de API extra além da que já existia pro Motivo. Por isso o
// backfill é limitado por invocação (MOTIVO_DETAIL_BUDGET chamadas de
// detalhe, no máximo) — o resto fica pra próxima sincronização (manual ou
// automática de hora em hora), nunca trava a sincronização normal de chamados.
const MOTIVO_FIELD_LABEL = 'Motivo da abertura de chamado'
const SISTEMA_ALVO_FIELD_LABEL = 'Sistema Alvo'
const PROCESSO_FIELD_LABEL = 'Processo'
const VERSAO_SISTEMA_ALVO_FIELD_LABEL = 'Versão Sistema Alvo'
const MOTIVO_DETAIL_BUDGET = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function mapTicket(t: any) {
  const firstReply = t.first_reply_date
    ? new Date(t.first_reply_date).toISOString()
    : null
  const creation = t.creation_date
    ? new Date(t.creation_date).toISOString()
    : null
  return {
    id: t.id,
    protocol: t.protocol ?? null,
    subject: t.subject ?? null,
    customer_name: t.customer?.name ?? null,
    customer_email: t.customer?.email ?? null,
    organization_id: t.customer?.organization?.id ?? null,
    organization_name: t.customer?.organization?.name ?? null,
    priority: t.priority ?? null,
    ticket_type: t.ticket_type ?? null,
    situation_id: t.situation?.id ?? null,
    situation_description: t.situation?.description ?? null,
    category_id: t.category?.id ?? null,
    category_name: t.category?.name ?? null,
    department_id: t.department?.id ?? null,
    department_name: t.department?.name ?? null,
    operator_name: t.operator?.name ?? null,
    creation_date: creation,
    first_reply_date: firstReply,
    end_date: t.end_date ? new Date(t.end_date).toISOString() : null,
    sla_startup_accomplished: t.sla?.startup?.accomplished ?? null,
    sla_deadline_accomplished: t.sla?.deadline?.accomplished ?? null,
    elapsed_time_sec: t.elapsed_time ?? null,
    work_time_sec: t.work_time ?? null,
    // Avaliação do cliente — já vinha no /ticket/list, só não era extraída
    // (achado em 2026-07-10 ao investigar o bloqueio da aba Qualidade, ver
    // migration 20260710190000). grade: 1-5 direto da API; problem_solved: bool.
    evaluation_grade: t.evaluation?.grade ?? null,
    evaluation_problem_solved: t.evaluation?.problem_solved ?? null,
    synced_at: new Date().toISOString(),
  }
}

async function fetchPage(token: string, page: number) {
  const res = await fetch(`${API_BASE}/ticket/list?page=${page}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(data.message || `TomTicket API retornou ${res.status}`)
  }
  return data
}

async function fetchTicketDetail(token: string, ticketId: string) {
  const res = await fetch(
    `${API_BASE}/ticket/detail?ticket_id=${encodeURIComponent(ticketId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(
      data.message || `TomTicket API (detail) retornou ${res.status}`,
    )
  }
  return data.data
}

function extractCustomField(detail: any, label: string): string | null {
  const campos = detail?.custom_fields?.open || []
  const campo = campos.find((c: any) => c?.label === label)
  return campo?.value ?? null
}

// Busca Motivo e Sistema Alvo (mesma chamada de detalhe) só dos chamados
// desta página que ainda não têm os custom fields verificados
// (custom_fields_synced = false) — chamados FECHADOS já verificados uma vez
// nunca entram aqui de novo (os campos não mudam depois do fechamento).
// Respeita um orçamento compartilhado entre todas as páginas desta
// invocação (budgetRef), pra não estourar o tempo de execução da function
// nem o rate limit da API.
async function syncCustomFields(
  supabaseAdmin: any,
  ttToken: string,
  rows: any[],
  budgetRef: { remaining: number },
) {
  if (budgetRef.remaining <= 0 || rows.length === 0) return

  const ids = rows.map((r) => r.id)
  const { data: pendentes } = await supabaseAdmin
    .from('suporte_chamados')
    .select('id')
    .in('id', ids)
    .eq('custom_fields_synced', false)
  const pendingIds = new Set((pendentes || []).map((r: any) => r.id))
  const endDateById = new Map(rows.map((r) => [r.id, r.end_date]))

  for (const id of pendingIds) {
    if (budgetRef.remaining <= 0) break
    try {
      const detail = await fetchTicketDetail(ttToken, id)
      const motivo = extractCustomField(detail, MOTIVO_FIELD_LABEL)
      const sistemaAlvo = extractCustomField(detail, SISTEMA_ALVO_FIELD_LABEL)
      const processo = extractCustomField(detail, PROCESSO_FIELD_LABEL)
      const versaoSistemaAlvo = extractCustomField(
        detail,
        VERSAO_SISTEMA_ALVO_FIELD_LABEL,
      )
      await supabaseAdmin
        .from('suporte_chamados')
        .update({
          motivo_abertura: motivo,
          sistema_alvo: sistemaAlvo,
          processo_field: processo,
          versao_sistema_alvo: versaoSistemaAlvo,
          custom_fields_synced: Boolean(endDateById.get(id)), // fechado → definitivo; aberto → revisita no próximo ciclo
        })
        .eq('id', id)
    } catch (e) {
      console.warn(
        `[sync-tomticket] falha ao buscar campos personalizados do chamado ${id}:`,
        (e as Error).message,
      )
    }
    budgetRef.remaining -= 1
    await sleep(RATE_DELAY_MS)
  }
}

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

    // Bypass de auth SÓ pro secret da automação de hora em hora (settings.
    // tomticket_sync_automation_config.secret_key) — pg_cron não tem um JWT
    // de usuário pra passar. Mesmo padrão do sync-sprint-bitrix/
    // integrations-health-check: sem secret configurado, essa comparação
    // nunca bate (string vazia não autentica string vazia) e cai no fluxo de
    // usuário normal abaixo.
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const { data: automationCfg } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'tomticket_sync_automation_config')
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

    const { data: settingsRow, error: settingsErr } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'tomticket_config')
      .maybeSingle()
    if (settingsErr) throw settingsErr
    const ttToken = settingsRow?.value?.access_token
    if (!ttToken) {
      return new Response(
        JSON.stringify({
          error: 'TomTicket não configurado — preencha o Token em Integrações',
        }),
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    const body = await req.json().catch(() => ({}))
    const action = body.action || 'sync'

    // Ação leve pro botão "Testar Conexão" — só confirma que o token funciona.
    if (action === 'test') {
      const first = await fetchPage(ttToken, 1)
      return new Response(
        JSON.stringify({
          ok: true,
          total: first.size ?? first.data?.length ?? 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const { data: statusRow } = await supabaseAdmin
      .from('suporte_sync_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle()

    // Cooldown de 30 minutos (Prompt #3) — só para action:sync (action:test já
    // retornou acima). Decisão revisada do Eduardo: sem checagem de permissão
    // aqui, qualquer usuário com acesso à página pode sincronizar; a proteção
    // real é este cooldown no servidor + diálogo de confirmação na tela.
    // Responde 200 (não 429) — o front trata como informação, não erro.
    const SYNC_COOLDOWN_MS = 30 * 60 * 1000
    if (statusRow?.last_synced_at) {
      const msSinceLastSync =
        Date.now() - new Date(statusRow.last_synced_at).getTime()
      if (msSinceLastSync < SYNC_COOLDOWN_MS) {
        const minutesAgo = Math.floor(msSinceLastSync / 60000)
        const minutosTexto =
          minutesAgo < 1
            ? 'menos de 1 minuto'
            : `${minutesAgo} minuto${minutesAgo === 1 ? '' : 's'}`
        return new Response(
          JSON.stringify({
            skipped: true,
            last_synced_at: statusRow.last_synced_at,
            minutes_ago: minutesAgo,
            message: `Sincronizado há ${minutosTexto} — dados já atualizados.`,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    }

    const lastPage = statusRow?.last_page || 0

    let totalSynced = 0
    let newLastPage = lastPage
    let totalPages = 1
    const motivoBudget = { remaining: MOTIVO_DETAIL_BUDGET }

    // Página 1 sempre é reforçada (chamados mais recentes podem ter mudado).
    const firstPage = await fetchPage(ttToken, 1)
    totalPages = firstPage.pages || 1
    if (firstPage.data?.length) {
      const rows = firstPage.data.map(mapTicket)
      const { error } = await supabaseAdmin
        .from('suporte_chamados')
        .upsert(rows, { onConflict: 'id' })
      if (error) throw error
      totalSynced += rows.length
      await syncCustomFields(supabaseAdmin, ttToken, rows, motivoBudget)
    }
    await sleep(RATE_DELAY_MS)

    // Avança o histórico a partir de onde parou, até PAGE_LIMIT páginas nesta chamada.
    const startPage = Math.max(lastPage + 1, 2)
    const endPage = Math.min(startPage + PAGE_LIMIT - 1, totalPages)
    for (let page = startPage; page <= endPage; page++) {
      const pageData = await fetchPage(ttToken, page)
      if (pageData.data?.length) {
        const rows = pageData.data.map(mapTicket)
        const { error } = await supabaseAdmin
          .from('suporte_chamados')
          .upsert(rows, { onConflict: 'id' })
        if (error) throw error
        totalSynced += rows.length
        await syncCustomFields(supabaseAdmin, ttToken, rows, motivoBudget)
      }
      newLastPage = page
      await sleep(RATE_DELAY_MS)
    }
    // Terminou o histórico todo — próxima sincronização recomeça o avanço do zero.
    if (newLastPage >= totalPages) newLastPage = 0

    await supabaseAdmin.from('suporte_sync_status').upsert(
      {
        id: 1,
        last_page: newLastPage,
        last_synced_at: new Date().toISOString(),
        total_synced: totalSynced,
      },
      { onConflict: 'id' },
    )

    return new Response(
      JSON.stringify({
        synced: totalSynced,
        pages_done: endPage - startPage + 1 + 1,
        total_pages: totalPages,
        resume_from_page: newLastPage + 1,
        complete: newLastPage === 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
