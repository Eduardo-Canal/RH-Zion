import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import { resolveAndCacheUsers } from '../_shared/resolve-bitrix-users.ts'

// Trunca a mensagem de erro (que já inclui a resposta/descrição real do
// Bitrix) pra não inchar o response nem logar payloads gigantes.
function truncar(msg: string, max = 200): string {
  const s = msg || 'Erro desconhecido'
  return s.length > max ? s.slice(0, max) + '…' : s
}

// DATE_CLOSED de lead vem do Bitrix como campo de DATA (não hora real) — ex:
// "2026-08-24T00:00:00+03:00", sempre meia-noite, num fuso que não é o do
// portal (-03:00). Meia-noite em +03:00 = 21h do dia ANTERIOR em Brasília,
// então qualquer conversão "correta" de fuso empurra a data um dia pra trás
// (achado do Everton, 27/08/2026 — confirmado direto na API do Bitrix).
// Em vez de converter o horário fictício, pegamos só a data que o Bitrix quis
// dizer e ancoramos ao meio-dia de Brasília, onde nenhuma leitura de fuso real
// consegue empurrar pro dia errado.
function normalizarDataFechamento(v: string | null | undefined): string | null {
  if (!v) return null
  const dataPart = String(v).slice(0, 10) // "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPart)) return v
  return `${dataPart}T12:00:00-03:00`
}

// Chaves em `settings` pro cursor de retomada e pro watermark incremental da
// fase de leads (Prompt 122) — sem migration nova, settings já é jsonb livre.
const CURSOR_KEY = 'mkt_sync_cursor'
const WATERMARK_KEY = 'mkt_leads_synced_at'
const CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000 // cursor mais velho que isso é descartado, recomeça do zero

// Sincroniza leads/funil de marketing do Bitrix CRM — usado pela tela MKT
// (módulo Auditoria). Reaproveita o webhook de CRM que o Órbita já tem
// (settings.bitrix24_webhook_url), mesmo do CS COM.
//
// Inclui o histórico completo de estágio por negócio (crm_deal_stage_history_full,
// com timestamp — 1 chamada ao Bitrix por negócio único), que alimenta o gráfico
// "Velocidade do Funil" da própria tela MKT. Diferente do funil simples (aba
// principal), que usa um cache mais leve (crm_deal_stage_history, sem data),
// populado sob demanda pela Edge Function mkt-data, não aqui.
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

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
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

    const baseUrl = await getBitrixWebhookUrl(supabaseAdmin)
    const {
      callBitrix,
      callBitrixAllPages,
      callBitrixBatch,
      callBitrixPagedEach,
    } = createBitrixClient(supabaseUrl, serviceRoleKey, baseUrl)

    const syncStart = new Date().toISOString()

    // 1. Status de lead (STATUS + geral, dedup) → crm_lead_statuses
    const [statuses, allStatuses] = await Promise.all([
      callBitrixAllPages('crm.status.list', {
        filter: { ENTITY_ID: 'STATUS' },
      }),
      callBitrixAllPages('crm.status.list', {}),
    ])
    // Dedup por ENTITY_ID+STATUS_ID (não só STATUS_ID) — o Bitrix reutiliza
    // códigos como "NEW" em entidades diferentes (ex: status de lead "Novo" E
    // a etapa inicial do funil padrão de negócio), então dedup só por
    // STATUS_ID descartava silenciosamente a etapa de negócio.
    const allLeadStatuses = [
      ...new Map(
        [...statuses, ...allStatuses].map((s: any) => [
          `${s.ENTITY_ID}:${s.STATUS_ID}`,
          s,
        ]),
      ).values(),
    ] as any[]
    for (const s of allLeadStatuses) {
      await supabaseAdmin
        .from('crm_lead_statuses')
        .upsert(
          {
            id: String(s.STATUS_ID),
            name: s.NAME || '',
            semantic: s.SEMANTICS || null,
            sort: parseInt(s.SORT) || 0,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
    }

    // 2. Origens de lead → crm_lead_sources
    const sources = await callBitrixAllPages('crm.status.list', {
      filter: { ENTITY_ID: 'SOURCE' },
    })
    for (const s of sources as any[]) {
      await supabaseAdmin
        .from('crm_lead_sources')
        .upsert(
          {
            id: String(s.STATUS_ID),
            name: s.NAME || '',
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
    }

    // 3. Estágios de negócio (reaproveita allLeadStatuses) → crm_deal_stages
    let dealStagesSynced = 0
    for (const s of allLeadStatuses) {
      if (s.ENTITY_ID && String(s.ENTITY_ID).includes('DEAL_STAGE')) {
        await supabaseAdmin
          .from('crm_deal_stages')
          .upsert(
            {
              id: String(s.STATUS_ID),
              name: s.NAME || '',
              sort: parseInt(s.SORT) || 0,
              semantic: s.SEMANTICS || null,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
          )
        dealStagesSynced++
      }
    }

    // 4. Todos os leads → crm_leads (+ b24_users a partir de ASSIGNED_BY, sem
    // chamada extra), gravado PÁGINA A PÁGINA EM LOTE (1 upsert por página em
    // cada tabela, não 1 por lead — o upsert individual era o que causava o
    // timeout de wall-clock, ver diagnóstico do Prompt 120). leadsLite guarda
    // só os campos que os passos seguintes (4b, 5, 5b, 5c) precisam — não o
    // lead inteiro, pra não recriar o problema de memória do Sprint.
    // Três modos, decididos pelo estado em `settings` ANTES de começar:
    //   - 'resume': existe cursor válido (< 24h) → retoma de cursor.start.
    //   - 'incremental': sem cursor, mas existe watermark → filtra por
    //     >=DATE_MODIFY (margem de 10min, mesmo padrão do Sprint).
    //   - 'full': nem cursor nem watermark → do zero, sem filtro.
    // O cursor é salvo em `settings` depois de CADA página bem-sucedida.
    const [{ data: cursorRow }, { data: watermarkRow }] = await Promise.all([
      supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', CURSOR_KEY)
        .maybeSingle(),
      supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', WATERMARK_KEY)
        .maybeSingle(),
    ])

    let cursor = cursorRow?.value as {
      start: number
      startedAt: string
      mode: 'full' | 'incremental'
      filter: Record<string, unknown>
    } | null
    if (cursor && (cursor.mode === undefined || cursor.filter === undefined)) {
      cursor = null // formato antigo (sem mode/filter, Prompt 122) — inválido, recomeça do zero
    }
    if (
      cursor?.startedAt &&
      Date.now() - new Date(cursor.startedAt).getTime() > CURSOR_MAX_AGE_MS
    ) {
      cursor = null // cursor obsoleto (>24h) — recomeça do zero
    }
    const watermark = (watermarkRow?.value as string | null) || null

    let mode: 'full' | 'resume' | 'incremental' = 'full'
    let cursorMode: 'full' | 'incremental' = 'full' // modo de ORIGEM gravado no cursor — sobrevive a vários "resume" em cadeia
    let leadFilter: Record<string, unknown> = {}
    let startAt = 0
    if (cursor) {
      mode = 'resume'
      cursorMode = cursor.mode
      startAt = cursor.start
      leadFilter = cursor.filter // reaplica EXATAMENTE o filtro salvo no cursor, não recalcula
    } else if (watermark) {
      mode = 'incremental'
      cursorMode = 'incremental'
      leadFilter['>=DATE_MODIFY'] = watermark
    }
    const cursorStartedAt = cursor?.startedAt ?? new Date().toISOString()

    const leadsLite: {
      ID: string
      STATUS_ID: string
      COMPANY_ID: string
      CONTACT_ID: string
    }[] = []
    let leadsSynced = 0
    let leadsOk = false
    let leadsTruncated = false
    let leadsErro: string | undefined
    let pagesProcessed = 0
    let lastCursorStart = startAt
    try {
      const { truncated } = await callBitrixPagedEach(
        'crm.lead.list',
        {
          filter: leadFilter,
          select: [
            'ID',
            'TITLE',
            'NAME',
            'STATUS_ID',
            'SOURCE_ID',
            'ASSIGNED_BY_ID',
            'ASSIGNED_BY_NAME',
            'DATE_CREATE',
            'DATE_CLOSED',
            'DATE_MODIFY',
            'CONTACT_ID',
            'COMPANY_ID',
            'UTM_SOURCE',
            'UTM_MEDIUM',
            'UTM_CAMPAIGN',
            'UTM_CONTENT',
            'UTM_TERM',
          ],
        },
        async (chunk, meta) => {
          pagesProcessed++

          // b24_users: usuários únicos DESSA página (dedup por ID), 1 upsert
          // em lote — antes do upsert de leads, igual à ordem original.
          const userMap = new Map<string, string>()
          const semNomeNaPagina = new Set<string>()
          for (const lead of chunk) {
            if (!lead.ASSIGNED_BY_ID) continue
            if (lead.ASSIGNED_BY_NAME) {
              userMap.set(String(lead.ASSIGNED_BY_ID), lead.ASSIGNED_BY_NAME)
            } else {
              semNomeNaPagina.add(String(lead.ASSIGNED_BY_ID))
            }
          }
          // Resolução/cache de nome é objetivo SECUNDÁRIO — isolada num
          // try/catch próprio (Prompt 170/171): se falhar por qualquer motivo,
          // não pode impedir a gravação dos leads (dado principal) logo abaixo.
          try {
            if (userMap.size) {
              const userRows = Array.from(userMap.entries()).map(
                ([id, name]) => ({
                  id,
                  name,
                  synced_at: new Date().toISOString(),
                }),
              )
              await supabaseAdmin
                .from('b24_users')
                .upsert(userRows, { onConflict: 'id' })
            }
            // Manutenção contínua de b24_users (Prompt 169, Parte B): só os IDs
            // desta página que vieram SEM ASSIGNED_BY_NAME (caminho feliz acima
            // não cobriu) — 1 chamada ao helper por página, nunca por lead,
            // senão multiplicaria requisições ao Bitrix. Sempre via webhook CRM
            // (dentro do helper), não pelo webhook Sprint.
            const faltantesNaPagina = Array.from(semNomeNaPagina).filter(
              (id) => !userMap.has(id),
            )
            if (faltantesNaPagina.length) {
              await resolveAndCacheUsers(supabaseAdmin, faltantesNaPagina)
            }
          } catch (e: any) {
            console.warn(
              '[sync-mkt-bitrix] resolução de nome falhou, seguindo sem: ' +
                (e?.message ?? e),
            )
          }

          const leadRows = chunk.map((lead: any) => ({
            id: String(lead.ID),
            title: lead.TITLE || '',
            name: lead.NAME || '',
            status_id: lead.STATUS_ID || '',
            source_id: lead.SOURCE_ID || '',
            assigned_by_id: lead.ASSIGNED_BY_ID || '',
            date_create: lead.DATE_CREATE || null,
            date_closed: normalizarDataFechamento(lead.DATE_CLOSED),
            date_modify: lead.DATE_MODIFY || null,
            contact_id: lead.CONTACT_ID || '',
            company_id: lead.COMPANY_ID || '',
            utm_source: lead.UTM_SOURCE || null,
            utm_medium: lead.UTM_MEDIUM || null,
            utm_campaign: lead.UTM_CAMPAIGN || null,
            utm_content: lead.UTM_CONTENT || null,
            utm_term: lead.UTM_TERM || null,
            synced_at: new Date().toISOString(),
          }))
          if (leadRows.length) {
            const { error } = await supabaseAdmin
              .from('crm_leads')
              .upsert(leadRows, { onConflict: 'id' })
            if (!error) {
              leadsSynced += leadRows.length
              for (const r of leadRows) {
                leadsLite.push({
                  ID: r.id,
                  STATUS_ID: String(r.status_id || ''),
                  COMPANY_ID: String(r.company_id || ''),
                  CONTACT_ID: String(r.contact_id || ''),
                })
              }
            }
          }

          // Persiste o cursor depois de cada página (com mode/filter da
          // ORIGEM, não recalculados) — se a invocação morrer logo em
          // seguida, a próxima retoma exatamente daqui com o mesmo filtro.
          if (meta.next !== null) {
            lastCursorStart = meta.next
            await supabaseAdmin
              .from('settings')
              .upsert(
                {
                  key: CURSOR_KEY,
                  value: {
                    start: meta.next,
                    startedAt: cursorStartedAt,
                    mode: cursorMode,
                    filter: leadFilter,
                  },
                },
                { onConflict: 'key' },
              )
          }
        },
        { startAt },
      )

      if (truncated) {
        // Atingiu o teto de páginas DESSA invocação (callBitrixPagedEach) —
        // NÃO é conclusão. O cursor já foi gravado apontando pra próxima
        // página (dentro do callback acima); aqui só evitamos tratar isso
        // como sucesso: sem watermark novo, sem apagar cursor, sem DELETE.
        leadsTruncated = true
        leadsErro =
          'Atingiu o teto de páginas desta invocação — cursor mantido, clique em Sincronizar novamente para continuar.'
      } else {
        leadsOk = true
        // Sync completo — não há mais nada pra retomar.
        await supabaseAdmin.from('settings').delete().eq('key', CURSOR_KEY)
        // Watermark ANCORADO no início da varredura (cursorStartedAt), não na
        // conclusão — uma varredura pode levar várias invocações, e um lead
        // alterado nesse meio-tempo precisa continuar visível pro próximo
        // incremental. Margem de 10min sobre esse início (não sobre "agora")
        // cobre defasagem de relógio Supabase↔Bitrix.
        const novoWatermark = new Date(
          new Date(cursorStartedAt).getTime() - 10 * 60 * 1000,
        ).toISOString()
        await supabaseAdmin
          .from('settings')
          .upsert(
            { key: WATERMARK_KEY, value: novoWatermark },
            { onConflict: 'key' },
          )
      }
    } catch (e) {
      leadsErro = truncar((e as Error).message)
      console.warn('[sync-mkt-bitrix] crm.lead.list falhou:', leadsErro)
    }

    // 4b. Empresas referenciadas pelos leads → crm_companies
    const uniqueCompanyIds = [
      ...new Set(
        leadsLite.map((l) => l.COMPANY_ID).filter((id) => id && id !== '0'),
      ),
    ]
    let companiesSynced = 0
    for (let i = 0; i < uniqueCompanyIds.length; i += 50) {
      const chunk = uniqueCompanyIds.slice(i, i + 50)
      try {
        const companies = await callBitrixAllPages('crm.company.list', {
          filter: { ID: chunk },
          select: ['ID', 'TITLE'],
        })
        for (const c of companies as any[]) {
          await supabaseAdmin
            .from('crm_companies')
            .upsert(
              {
                id: String(c.ID),
                title: c.TITLE || '',
                synced_at: new Date().toISOString(),
              },
              { onConflict: 'id' },
            )
          companiesSynced++
        }
      } catch (e) {
        console.warn(
          '[sync-mkt-bitrix] crm.company.list falhou num lote:',
          (e as Error).message,
        )
      }
    }

    // 5. Negócios de leads convertidos → crm_deal_leads (3 estratégias: LEAD_ID,
    // depois CONTACT_ID e COMPANY_ID como fallback pra convertidos sem deal linkado)
    const convertedStatusIds = new Set(
      (statuses as any[])
        .filter((s) => s.SEMANTICS === 'S' || s.STATUS_ID === 'CONVERTED')
        .map((s) => String(s.STATUS_ID)),
    )
    const convertedLeadIds = leadsLite
      .filter((l) => convertedStatusIds.has(l.STATUS_ID))
      .map((l) => l.ID)

    let dealsSynced = 0
    const allDealIds: string[] = []
    // Quais leads já ficaram vinculados NESTA invocação (5/5b/5c/5d escrevem
    // aqui) — usado pelo backfill (5d) pra saber quem ainda precisa da
    // próxima estratégia de fallback, sem precisar reconsultar o banco a
    // cada passo.
    const linkedLeadIdsThisRun = new Set<string>()

    // Instrumentação (Prompt 136): antes, um erro no upsert de crm_deal_leads
    // (ou no upsert de settings do sem-deal, ver 5d) era engolido em silêncio
    // — `if (!error)` só tratava o caminho feliz. Diagnóstico de convergência
    // zerada mesmo com várias chamadas Bitrix bem-sucedidas (Prompt 135) não
    // teve como distinguir "nenhum deal encontrado" de "upsert falhando" sem
    // acesso aos logs da function. Agora todo erro de upsert (de qualquer
    // chamador — 5/5b/5c/5d) é contado aqui e a primeira mensagem é
    // preservada, exposta em linkBackfill (único lugar da response com
    // espaço pra diagnóstico) mesmo que a falha não tenha vindo do backfill.
    let upsertErrors = 0
    let firstUpsertError: string | null = null

    async function upsertDealLead(deal: any, leadId: string) {
      const { error } = await supabaseAdmin.from('crm_deal_leads').upsert(
        {
          deal_id: String(deal.ID),
          lead_id: leadId,
          deal_title: deal.TITLE || '',
          company_id: deal.COMPANY_ID || '',
          stage_id: deal.STAGE_ID || '',
          opportunity: parseFloat(deal.OPPORTUNITY) || 0,
          contact_id: deal.CONTACT_ID || '',
          source_id: deal.SOURCE_ID || '',
          category_id: deal.CATEGORY_ID || '',
          // CLOSED do Bitrix ('Y'/'N') — usado pelo passo 5e (reconferência)
          // pra parar de reconferir negócio que já terminou (ganho ou
          // perdido). Achado 30/08/2026: sem isso, um negócio de ciclo longo
          // some pra sempre da janela incremental depois que o LEAD dele para
          // de mudar, e o stage_id aqui fica congelado no estado antigo.
          closed: deal.CLOSED === 'Y',
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'deal_id,lead_id' },
      )
      if (!error) {
        linkedLeadIdsThisRun.add(leadId)
        if (!allDealIds.includes(String(deal.ID))) {
          allDealIds.push(String(deal.ID))
          dealsSynced++
        }
      } else {
        upsertErrors++
        if (!firstUpsertError) firstUpsertError = truncar(error.message)
      }
    }

    for (let i = 0; i < convertedLeadIds.length; i += 50) {
      const chunk = convertedLeadIds.slice(i, i + 50)
      const chunkDeals = await callBitrixAllPages('crm.deal.list', {
        filter: { '=LEAD_ID': chunk },
        select: [
          'ID',
          'TITLE',
          'STAGE_ID',
          'LEAD_ID',
          'CONTACT_ID',
          'COMPANY_ID',
          'SOURCE_ID',
          'CATEGORY_ID',
          'OPPORTUNITY',
          'DATE_CREATE',
          'CLOSED',
        ],
      })
      for (const deal of chunkDeals as any[])
        await upsertDealLead(deal, String(deal.LEAD_ID))
    }

    // 5b. Fallback via CONTACT_ID — escopado a leadsLite DESTA RODADA (Prompt
    // 128, Parte A). Antes consultava crm_leads inteiro por status_id=
    // 'CONVERTED', o que em incremental (poucos leads na rodada) era
    // desperdício puro e no backfill completo estourava o tempo de execução
    // (546) antes de terminar — mesmo padrão do fix de escopo do Sprint
    // (commit 1061062). Leads convertidos de rodadas ANTERIORES que nunca
    // passaram por aqui são cobertos pelo backfill convergente (passo 5d).
    try {
      const candidatosContato = leadsLite.filter(
        (l) =>
          convertedStatusIds.has(l.STATUS_ID) &&
          l.CONTACT_ID &&
          !linkedLeadIdsThisRun.has(l.ID),
      )
      if (candidatosContato.length) {
        const roundIds = candidatosContato.map((l) => l.ID)
        const { data: existingLinks } = await supabaseAdmin
          .from('crm_deal_leads')
          .select('lead_id')
          .in('lead_id', roundIds)
        const linkedIds = new Set(
          (existingLinks || []).map((r: any) => r.lead_id),
        )
        const contactToLeads: Record<string, string[]> = {}
        for (const l of candidatosContato) {
          if (linkedIds.has(l.ID)) continue
          if (!contactToLeads[l.CONTACT_ID]) contactToLeads[l.CONTACT_ID] = []
          contactToLeads[l.CONTACT_ID].push(l.ID)
        }
        const uniqueContacts = Object.keys(contactToLeads)
        for (let i = 0; i < uniqueContacts.length; i += 50) {
          const chunk = uniqueContacts.slice(i, i + 50)
          const cDeals = await callBitrixAllPages('crm.deal.list', {
            filter: { '=CONTACT_ID': chunk },
            select: [
              'ID',
              'TITLE',
              'STAGE_ID',
              'LEAD_ID',
              'CONTACT_ID',
              'COMPANY_ID',
              'SOURCE_ID',
              'CATEGORY_ID',
              'OPPORTUNITY',
              'CLOSED',
            ],
          })
          for (const deal of cDeals as any[]) {
            for (const leadId of contactToLeads[String(deal.CONTACT_ID)] || [])
              await upsertDealLead(deal, leadId)
          }
        }
      }
    } catch (e) {
      console.warn(
        '[sync-mkt-bitrix] fallback por contato falhou:',
        (e as Error).message,
      )
    }

    // 5c. Fallback via COMPANY_ID — escopado a leadsLite DESTA RODADA (Prompt
    // 128, Parte A), mesmo raciocínio do 5b acima.
    try {
      const candidatosEmpresa = leadsLite.filter(
        (l) =>
          convertedStatusIds.has(l.STATUS_ID) &&
          l.COMPANY_ID &&
          l.COMPANY_ID !== '0' &&
          !linkedLeadIdsThisRun.has(l.ID),
      )
      if (candidatosEmpresa.length) {
        const roundIds = candidatosEmpresa.map((l) => l.ID)
        const { data: existingLinks } = await supabaseAdmin
          .from('crm_deal_leads')
          .select('lead_id')
          .in('lead_id', roundIds)
        const linkedIds = new Set(
          (existingLinks || []).map((r: any) => r.lead_id),
        )
        const companyToLeads: Record<string, string[]> = {}
        for (const l of candidatosEmpresa) {
          if (linkedIds.has(l.ID)) continue
          if (!companyToLeads[l.COMPANY_ID]) companyToLeads[l.COMPANY_ID] = []
          companyToLeads[l.COMPANY_ID].push(l.ID)
        }
        const uniqueCompanies = Object.keys(companyToLeads)
        for (let i = 0; i < uniqueCompanies.length; i += 50) {
          const chunk = uniqueCompanies.slice(i, i + 50)
          const coDeals = await callBitrixAllPages('crm.deal.list', {
            filter: { '=COMPANY_ID': chunk },
            select: [
              'ID',
              'TITLE',
              'STAGE_ID',
              'LEAD_ID',
              'CONTACT_ID',
              'COMPANY_ID',
              'SOURCE_ID',
              'CATEGORY_ID',
              'OPPORTUNITY',
              'CLOSED',
            ],
          })
          for (const deal of coDeals as any[]) {
            for (const leadId of companyToLeads[String(deal.COMPANY_ID)] || [])
              await upsertDealLead(deal, leadId)
          }
        }
      }
    } catch (e) {
      console.warn(
        '[sync-mkt-bitrix] fallback por empresa falhou:',
        (e as Error).message,
      )
    }

    // 5d. Backfill convergente de vínculos históricos — leads CONVERTED de
    // rodadas ANTERIORES que nunca passaram pelos passos 5/5b/5c porque, até
    // o Prompt 128, esses passos varriam a base inteira em toda invocação (e
    // por isso a sincronização inteira morria em 546 antes de progredir).
    // Agora que 5/5b/5c são escopados a leadsLite (Parte A), esse backlog
    // histórico só converge aqui, com orçamento fixo por invocação — nunca
    // reintroduz o 546. Sem cursor: cada rodada pega os próximos
    // BACKFILL_MAX_BATCHES lotes de leads convertidos ainda sem vínculo;
    // cliques repetidos avançam até esgotar (mesmo espírito de convergência
    // por cliques do cursor da fase 4, Prompt 122).
    //
    // GATE POR MODO (Prompt 128.2, Parte D): só roda em mode==='incremental'.
    // 'full'/'resume' já gastam o wall-clock da invocação paginando
    // crm.lead.list (fases 1-4b) — empilhar mais até ~30 chamadas Bitrix do
    // backfill em cima disso arrisca reintroduzir o próprio 546 que a Parte A
    // existiu pra matar. O backlog histórico converge nos incrementais
    // seguintes, que são leves e sobram no orçamento de tempo.
    //
    // Descoberta de candidatos via RPC auditoria_mkt_leads_sem_vinculo
    // (Prompt 128.2, Parte B/C) — antes eram duas selects sem LIMIT
    // filtradas em memória: (a) usavam status_id='CONVERTED' literal, sem a
    // semântica 'S' que o passo 5 usa (perdia leads convertidos com outros
    // status_id); (b) sem LIMIT/range, sujeitas ao teto padrão de 1000
    // linhas do PostgREST (db.max_rows) — truncavam candidatos/já-vinculados
    // silenciosamente. A RPC decide o critério de convertido no SQL (mesma
    // regra do passo 5) e devolve `total` de um count() sem limit (nunca
    // truncado) + `leads` já limitado ao orçamento da rodada.
    //
    // Leads que esgotam as 3 estratégias sem achar negócio (legitimamente
    // sem deal no Bitrix) são marcados em settings.mkt_leads_sem_deal — sem
    // isso, seriam re-tentados pra sempre, consumindo o orçamento de
    // chamadas Bitrix da rodada sem nunca convergir. TRADE-OFF conhecido:
    // essa lista só cresce (nunca é podada) — numa base com muitos milhares
    // de leads convertidos sem negócio vinculável, o array em settings pode
    // ficar grande. Aceitável por ora (evita migration nova sem necessidade
    // concreta), mas documentado aqui pro Eduardo decidir se compensa uma
    // tabela própria mais adiante.
    //
    // RESILIÊNCIA (Prompt 134): o lote inteiro é processado em SUB-LOTES de
    // BACKFILL_BATCH_SIZE, cada um com suas 3 estratégias completas seguidas
    // da gravação IMEDIATA em mkt_leads_sem_deal de quem esgotou sem achar
    // negócio — não mais uma gravação só no final do lote inteiro. Diagnóstico
    // do Prompt 134: o rate limiter global (15 req/min, compartilhado com
    // CRM/bot) força pausas de 15-35s no meio de um lote grande, e a
    // invocação pode morrer (timeout de plataforma) antes de terminar as 3
    // estratégias do lote inteiro — nesse desenho antigo, isso perdia o
    // progresso de TODOS os sub-lotes já processados (nada era gravado até o
    // fim), e os mesmos candidatos eram re-tentados do zero no próximo
    // clique, sem nunca convergir. Processando por sub-lote de 50, uma morte
    // no sub-lote N preserva o que os sub-lotes 1..N-1 já gravaram.
    // BACKFILL_MAX_BATCHES reduzido de 10 pra 4 (200 leads/rodada em vez de
    // 500) — com o backlog atual (dezenas), irrelevante pra convergência, mas
    // reduz a chance de um novo backfill grande (milhares) esgotar o
    // orçamento de tempo da invocação no meio de um sub-lote.
    // BACKFILL_BATCH_SIZE reduzido de 50 pra 15 (Prompt 137): sub-lotes de 15
    // leads ≈ 3-6 chamadas Bitrix cada, gravando progresso a ~30-40s —
    // cabendo várias conclusões parciais dentro dos ~150s de wall-clock de
    // uma invocação mesmo respeitando o rate limit padrão de 15/min.
    const BACKFILL_BATCH_SIZE = 15
    const BACKFILL_MAX_BATCHES = 4
    const SEM_DEAL_KEY = 'mkt_leads_sem_deal'
    // Diagnóstico persistente (Prompt 137): 504/546 na plataforma não deixa
    // acessar os logs de console da function — essa chave em settings vira a
    // "última palavra" do 5d antes de morrer, gravada em 3 momentos: logo
    // após a RPC (prova que o 5d começou), ao fim de cada sub-lote (progresso
    // parcial) e no catch (erro + o que já tinha sido processado).
    const BACKFILL_DIAG_KEY = 'mkt_backfill_last_run'

    let backfillProcessed = 0
    let backfillLinked = 0
    let backfillRemaining: number | null = 0
    let backfillSkipped: string | null = null
    let backfillError: string | null = null
    const backfillPorEstrategia = { leadId: 0, contactId: 0, companyId: 0 }

    if (mode !== 'incremental') {
      backfillSkipped = 'mode'
      backfillRemaining = null
    } else {
      const backfillStartedAt = new Date().toISOString()
      let diagTotal: number | null = null
      let diagLoteSize: number | null = null

      const salvarDiagnostico = async (extra: Record<string, unknown> = {}) => {
        await supabaseAdmin.from('settings').upsert(
          {
            key: BACKFILL_DIAG_KEY,
            value: {
              startedAt: backfillStartedAt,
              total: diagTotal,
              loteSize: diagLoteSize,
              processed: backfillProcessed,
              linked: backfillLinked,
              porEstrategia: backfillPorEstrategia,
              upsertErrors,
              ...(firstUpsertError ? { firstUpsertError } : {}),
              ...extra,
            },
          },
          { onConflict: 'key' },
        )
      }

      try {
        const { data: semDealRow } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', SEM_DEAL_KEY)
          .maybeSingle()
        const semDealIds = new Set(
          ((semDealRow?.value as string[]) || []).map(String),
        )

        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
          'auditoria_mkt_leads_sem_vinculo',
          {
            p_excluidos: [...semDealIds],
            p_limit: BACKFILL_BATCH_SIZE * BACKFILL_MAX_BATCHES,
          },
        )
        if (rpcError) throw rpcError

        const total = (rpcResult as any)?.total ?? 0
        const lote = ((rpcResult as any)?.leads ?? []) as {
          id: string
          contact_id: string
          company_id: string
        }[]
        backfillRemaining = total - lote.length
        diagTotal = total
        diagLoteSize = lote.length

        // (a) Logo após a RPC — prova que o 5d começou, mesmo que a
        // invocação morra em seguida sem processar nenhum sub-lote.
        await salvarDiagnostico()

        const semDealAcumulado = new Set(semDealIds)
        for (let i = 0; i < lote.length; i += BACKFILL_BATCH_SIZE) {
          const subLote = lote.slice(i, i + BACKFILL_BATCH_SIZE)

          // Estratégia 1: LEAD_ID
          let linkedAntes = linkedLeadIdsThisRun.size
          const chunkDeals = await callBitrixAllPages('crm.deal.list', {
            filter: { '=LEAD_ID': subLote.map((l: any) => l.id) },
            select: [
              'ID',
              'TITLE',
              'STAGE_ID',
              'LEAD_ID',
              'CONTACT_ID',
              'COMPANY_ID',
              'SOURCE_ID',
              'CATEGORY_ID',
              'OPPORTUNITY',
              'DATE_CREATE',
              'CLOSED',
            ],
          })
          for (const deal of chunkDeals as any[])
            await upsertDealLead(deal, String(deal.LEAD_ID))
          backfillPorEstrategia.leadId +=
            linkedLeadIdsThisRun.size - linkedAntes

          // Estratégia 2: CONTACT_ID (só quem sobrou da estratégia 1, dentro do sub-lote)
          const semDeal2 = subLote.filter(
            (l: any) => !linkedLeadIdsThisRun.has(String(l.id)) && l.contact_id,
          )
          const contactToLeads: Record<string, string[]> = {}
          for (const l of semDeal2) {
            const cid = String(l.contact_id)
            if (!contactToLeads[cid]) contactToLeads[cid] = []
            contactToLeads[cid].push(String(l.id))
          }
          const uniqueContacts = Object.keys(contactToLeads)
          if (uniqueContacts.length) {
            linkedAntes = linkedLeadIdsThisRun.size
            const cDeals = await callBitrixAllPages('crm.deal.list', {
              filter: { '=CONTACT_ID': uniqueContacts },
              select: [
                'ID',
                'TITLE',
                'STAGE_ID',
                'LEAD_ID',
                'CONTACT_ID',
                'COMPANY_ID',
                'SOURCE_ID',
                'CATEGORY_ID',
                'OPPORTUNITY',
                'CLOSED',
              ],
            })
            for (const deal of cDeals as any[]) {
              for (const leadId of contactToLeads[String(deal.CONTACT_ID)] ||
                [])
                await upsertDealLead(deal, leadId)
            }
            backfillPorEstrategia.contactId +=
              linkedLeadIdsThisRun.size - linkedAntes
          }

          // Estratégia 3: COMPANY_ID (só quem sobrou da estratégia 2, dentro do sub-lote)
          const semDeal3 = subLote.filter(
            (l: any) =>
              !linkedLeadIdsThisRun.has(String(l.id)) &&
              l.company_id &&
              l.company_id !== '0',
          )
          const companyToLeads: Record<string, string[]> = {}
          for (const l of semDeal3) {
            const coid = String(l.company_id)
            if (!companyToLeads[coid]) companyToLeads[coid] = []
            companyToLeads[coid].push(String(l.id))
          }
          const uniqueCompanies = Object.keys(companyToLeads)
          if (uniqueCompanies.length) {
            linkedAntes = linkedLeadIdsThisRun.size
            const coDeals = await callBitrixAllPages('crm.deal.list', {
              filter: { '=COMPANY_ID': uniqueCompanies },
              select: [
                'ID',
                'TITLE',
                'STAGE_ID',
                'LEAD_ID',
                'CONTACT_ID',
                'COMPANY_ID',
                'SOURCE_ID',
                'CATEGORY_ID',
                'OPPORTUNITY',
                'CLOSED',
              ],
            })
            for (const deal of coDeals as any[]) {
              for (const leadId of companyToLeads[String(deal.COMPANY_ID)] ||
                [])
                await upsertDealLead(deal, leadId)
            }
            backfillPorEstrategia.companyId +=
              linkedLeadIdsThisRun.size - linkedAntes
          }

          // Quem esgotou as 3 estratégias sem achar negócio NESTE sub-lote →
          // grava em mkt_leads_sem_deal AGORA, não no final do lote inteiro —
          // preserva o progresso se a invocação morrer no próximo sub-lote.
          const subSemDeal = subLote
            .filter((l: any) => !linkedLeadIdsThisRun.has(String(l.id)))
            .map((l: any) => String(l.id))
          backfillProcessed += subLote.length
          backfillLinked += subLote.length - subSemDeal.length
          if (subSemDeal.length) {
            subSemDeal.forEach((id) => semDealAcumulado.add(id))
            const { error: semDealError } = await supabaseAdmin
              .from('settings')
              .upsert(
                { key: SEM_DEAL_KEY, value: Array.from(semDealAcumulado) },
                { onConflict: 'key' },
              )
            if (semDealError) {
              upsertErrors++
              if (!firstUpsertError)
                firstUpsertError = truncar(semDealError.message)
            }
          }

          // (b) Fim de cada sub-lote — progresso parcial sobrevive mesmo se
          // o PRÓXIMO sub-lote nunca rodar (504/546 no meio do lote).
          await salvarDiagnostico()
        }
      } catch (e) {
        backfillError = truncar((e as Error).message)
        console.warn(
          '[sync-mkt-bitrix] backfill de vínculos falhou:',
          (e as Error).message,
        )
        // (c) No catch — erro + o que já tinha sido processado até aqui.
        await salvarDiagnostico({ error: backfillError }).catch(() => {})
      }
    }

    // 5e. Reconferência de negócios JÁ VINCULADOS (Prompt 30/08/2026) — o 5d
    // acima só cobre lead convertido SEM nenhum vínculo ainda. Um negócio que
    // já tem linha em crm_deal_leads nunca era revisitado, e o stage_id
    // gravado ficava congelado pra sempre no estado de quando o LEAD dele
    // saiu da janela incremental (DATE_MODIFY do lead não muda mais depois da
    // conversão, mas o NEGÓCIO continua avançando de etapa por semanas/meses
    // — ciclo de venda longo é o normal aqui). Achado investigando o negócio
    // 27042 (Gema do Brasil): Bitrix mostrava WON desde 28/07, crm_deal_leads
    // guardava "2.11 Em Negociação" (estado de 23/06) — o negócio passou por
    // TODAS as etapas nomeadas 2.4-2.15 antes de fechar (confirmado via
    // crm.stagehistory.list), então não é etapa pulada: é vínculo nunca
    // reconferido depois de criado.
    //
    // GATE POR MODO, mesmo motivo do 5d: só roda em mode==='incremental'.
    //
    // Critério de "não precisa mais reconferir": campo CLOSED do Bitrix
    // ('Y'/'N', ver migration 20260830140000) — mais robusto que inferir por
    // nome/semantic de etapa, que varia por categoria/pipeline. Descoberta de
    // candidatos via RPC auditoria_mkt_deals_desatualizados (mesmo padrão do
    // 5d: total via count() sem limit, lista já limitada ao orçamento da
    // rodada), priorizando quem está há mais tempo sem checar (synced_at mais
    // antigo primeiro) — então mesmo um backlog grande converge aos poucos,
    // sem nenhum negócio ficar preso pra sempre atrás de outros.
    //
    // Busca por ID do negócio direto (não mais por LEAD_ID/CONTACT_ID/
    // COMPANY_ID como 5/5b/5c/5d) — o vínculo já existe, só a etapa/opportunity/
    // closed precisam ser atualizados. Reusa upsertDealLead com o MESMO
    // lead_id que a RPC devolveu (o já gravado em crm_deal_leads), não o
    // LEAD_ID que o Bitrix devolver no negócio — evita criar uma linha nova
    // por engano se esses dois algum dia divergirem.
    const REFRESH_BATCH_SIZE = 50
    const REFRESH_MAX_BATCHES = 4
    const REFRESH_DIAG_KEY = 'mkt_deal_refresh_last_run'

    let refreshProcessed = 0
    let refreshUpdated = 0
    let refreshRemaining: number | null = 0
    let refreshError: string | null = null
    let refreshSkipped: string | null = null

    if (mode !== 'incremental') {
      refreshSkipped = 'mode'
      refreshRemaining = null
    } else {
      const refreshStartedAt = new Date().toISOString()
      let diagTotal: number | null = null
      let diagLoteSize: number | null = null

      const salvarDiagnosticoRefresh = async (
        extra: Record<string, unknown> = {},
      ) => {
        await supabaseAdmin.from('settings').upsert(
          {
            key: REFRESH_DIAG_KEY,
            value: {
              startedAt: refreshStartedAt,
              total: diagTotal,
              loteSize: diagLoteSize,
              processed: refreshProcessed,
              updated: refreshUpdated,
              ...extra,
            },
          },
          { onConflict: 'key' },
        )
      }

      try {
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
          'auditoria_mkt_deals_desatualizados',
          {
            p_limit: REFRESH_BATCH_SIZE * REFRESH_MAX_BATCHES,
          },
        )
        if (rpcError) throw rpcError

        const total = (rpcResult as any)?.total ?? 0
        const lote = ((rpcResult as any)?.deals ?? []) as {
          deal_id: string
          lead_id: string
        }[]
        refreshRemaining = total - lote.length
        diagTotal = total
        diagLoteSize = lote.length

        // (a-refresh) Logo após a RPC — prova que o 5e começou, mesmo que a
        // invocação morra em seguida sem processar nenhum sub-lote.
        await salvarDiagnosticoRefresh()

        for (let i = 0; i < lote.length; i += REFRESH_BATCH_SIZE) {
          const subLote = lote.slice(i, i + REFRESH_BATCH_SIZE)
          const leadIdPorDeal = new Map(
            subLote.map((d) => [String(d.deal_id), String(d.lead_id)]),
          )

          try {
            const deals = await callBitrixAllPages('crm.deal.list', {
              filter: { '=ID': subLote.map((d) => d.deal_id) },
              select: [
                'ID',
                'TITLE',
                'STAGE_ID',
                'LEAD_ID',
                'CONTACT_ID',
                'COMPANY_ID',
                'SOURCE_ID',
                'CATEGORY_ID',
                'OPPORTUNITY',
                'CLOSED',
              ],
            })
            for (const deal of deals as any[]) {
              const leadId = leadIdPorDeal.get(String(deal.ID))
              if (leadId) await upsertDealLead(deal, leadId)
            }
            refreshUpdated += (deals as any[]).length
          } catch (e) {
            console.warn(
              '[sync-mkt-bitrix] reconferência de negócios falhou num sub-lote:',
              (e as Error).message,
            )
          }
          refreshProcessed += subLote.length

          // (b-refresh) Fim de cada sub-lote — progresso parcial sobrevive
          // mesmo se o PRÓXIMO sub-lote nunca rodar (504/546 no meio do lote).
          await salvarDiagnosticoRefresh()
        }
      } catch (e) {
        refreshError = truncar((e as Error).message)
        console.warn(
          '[sync-mkt-bitrix] reconferência de negócios falhou:',
          (e as Error).message,
        )
        // (c-refresh) No catch — erro + o que já tinha sido processado até aqui.
        await salvarDiagnosticoRefresh({ error: refreshError }).catch(() => {})
      }
    }

    // 6. Histórico completo de estágio por negócio (com timestamp) → alimenta o
    // gráfico "Velocidade do Funil". BACKFILL CONVERGENTE (Prompt 149), mesmo
    // molde do 5d — antes este passo processava só allDealIds (deals
    // sincronizados NESTA invocação via 5/5b/5c/5d); em mode 'full'/'resume'
    // isso é essencialmente o funil histórico inteiro de uma vez, e a
    // invocação morria em 546 (WORKER_RESOURCE_LIMIT) antes de convergir —
    // diagnóstico do Prompt 149: crm_deal_stage_history_full com 39 registros
    // contra 863 vínculos em crm_deal_leads.
    //
    // Descoberta de candidatos via RPC mkt_stage_history_pending (migration
    // própria) — decide "sem histórico" no SQL (NOT EXISTS) e devolve `total`
    // real (count sem limit) + `deal_ids` já limitado ao orçamento da rodada,
    // mesma razão de ser da RPC do 5d (auditoria_mkt_leads_sem_vinculo): sem
    // isso, qualquer select em memória fica sujeita ao teto de 1000 linhas do
    // PostgREST.
    //
    // Orçamento por invocação: STAGE_HISTORY_MAX_BATCHES sub-lotes de
    // HISTORY_BATCH_SIZE (o mesmo tamanho de sub-lote que este passo já usava
    // pro callBitrixBatch — só reorquestrado, sem trocar o método Bitrix).
    // Cada sub-lote é 1 requisição HTTP (batch, até 49 comandos); progresso é
    // gravado em settings.mkt_stage_history_backfill a cada sub-lote — uma
    // morte no meio preserva o que os sub-lotes anteriores já gravaram, igual
    // ao diagnóstico persistente do 5d (Prompt 137). Convergência: quando a
    // RPC não devolve mais nenhum deal_id pendente, grava converged:true e
    // não faz nenhuma chamada Bitrix nesta rodada.
    //
    // Erro num sub-lote (ex.: um deal com payload inesperado) é registrado no
    // diagnóstico (historyErrosPorSubLote) e a invocação segue pro próximo
    // sub-lote — mesmo espírito do resto do sync, nenhum erro isolado derruba
    // a invocação inteira.
    //
    // TRADE-OFF aceito (mesmo espírito do 5d): só busca histórico pra deals
    // que NUNCA foram verificados — um deal que já tem histórico e muda de
    // estágio depois não é reprocessado automaticamente aqui. Fora do escopo
    // deste prompt (que resolve especificamente a convergência do backlog
    // zerado); "refresh" de histórico existente fica pra um prompt futuro se
    // o Eduardo decidir que é necessário.
    //
    // BUG DE CONVERGÊNCIA corrigido no Prompt 149.1: um deal cujo Bitrix
    // devolve histórico vazio nunca gravava nenhuma linha em
    // crm_deal_stage_history_full — nada distinguia "ainda não verificado"
    // de "verificado, sem histórico real", então a RPC (que antes olhava
    // direto pra crm_deal_stage_history_full) redescobria esse deal em toda
    // invocação, sem nunca convergir. A tabela mkt_stage_history_checked
    // registra TODO deal já verificado (had_history true OU false) — a RPC
    // passou a olhar pra ela, não mais pra crm_deal_stage_history_full.
    // Deals de um sub-lote cujo callBitrixBatch falhou NÃO são marcados —
    // ficam pendentes e são retentados na próxima invocação (semântica de
    // retry correta: só "verificado com sucesso" sai da fila).
    const HISTORY_BATCH_SIZE = 49
    const STAGE_HISTORY_MAX_BATCHES = 4
    const STAGE_HISTORY_DIAG_KEY = 'mkt_stage_history_backfill'

    let historySynced = 0
    let historyProcessed = 0
    let historyRemaining: number | null = 0
    let historyError: string | null = null
    let historyConverged = false
    let historySemHistorico = 0
    const historyErrosPorSubLote: string[] = []

    {
      const historyStartedAt = new Date().toISOString()
      let diagTotal: number | null = null
      let diagLoteSize: number | null = null

      const salvarDiagnosticoHistory = async (
        extra: Record<string, unknown> = {},
      ) => {
        await supabaseAdmin.from('settings').upsert(
          {
            key: STAGE_HISTORY_DIAG_KEY,
            value: {
              startedAt: historyStartedAt,
              total: diagTotal,
              loteSize: diagLoteSize,
              processed: historyProcessed,
              synced: historySynced,
              semHistorico: historySemHistorico,
              errosPorSubLote: historyErrosPorSubLote,
              ...extra,
            },
          },
          { onConflict: 'key' },
        )
      }

      try {
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
          'mkt_stage_history_pending',
          {
            p_limit: HISTORY_BATCH_SIZE * STAGE_HISTORY_MAX_BATCHES,
          },
        )
        if (rpcError) throw rpcError

        const total = (rpcResult as any)?.total ?? 0
        const lote = ((rpcResult as any)?.deal_ids ?? []) as string[]
        historyRemaining = total - lote.length
        diagTotal = total
        diagLoteSize = lote.length

        if (!lote.length) {
          // CONVERGÊNCIA: nada mais pendente — grava e não faz nenhuma
          // chamada Bitrix nesta rodada.
          historyConverged = true
          await supabaseAdmin
            .from('settings')
            .upsert(
              {
                key: STAGE_HISTORY_DIAG_KEY,
                value: { converged: true, at: new Date().toISOString() },
              },
              { onConflict: 'key' },
            )
        } else {
          // (a-histórico) Logo após a RPC — prova que o backfill de histórico
          // começou, mesmo que a invocação morra em seguida sem processar
          // nenhum sub-lote.
          await salvarDiagnosticoHistory()

          for (let i = 0; i < lote.length; i += HISTORY_BATCH_SIZE) {
            const chunk = lote.slice(i, i + HISTORY_BATCH_SIZE)
            const cmds: Record<string, string> = {}
            chunk.forEach((dealId, idx) => {
              cmds[`h${idx}`] =
                `crm.stagehistory.list?entityTypeId=2&filter[OWNER_ID]=${dealId}&order[CREATED_TIME]=ASC`
            })

            try {
              const results = await callBitrixBatch(cmds)
              // Deals deste sub-lote (Bitrix respondeu com sucesso) — marcados
              // em mkt_stage_history_checked TODOS de uma vez ao final,
              // tenha ou não histórico real, pra sair da fila de pendentes.
              const checkedRows: { deal_id: string; had_history: boolean }[] =
                []
              for (let idx = 0; idx < chunk.length; idx++) {
                const dealId = chunk[idx]
                const rows = ((results as any)[`h${idx}`]?.items ??
                  (results as any)[`h${idx}`] ??
                  []) as any[]
                historyProcessed++
                const validRows = (Array.isArray(rows) ? rows : [])
                  .map((row) => ({
                    stageId: row.STAGE_ID || row.STATUS_ID || row.STAGE || '',
                    createdTime:
                      row.CREATED_TIME ||
                      row.CREATED_DATE ||
                      row.DATE_CREATE ||
                      row.TIME ||
                      null,
                  }))
                  .filter((r) => r.stageId)

                if (validRows.length) {
                  await supabaseAdmin
                    .from('crm_deal_stage_history_full')
                    .delete()
                    .eq('deal_id', dealId)
                  await supabaseAdmin
                    .from('crm_deal_stage_history_full')
                    .insert(
                      validRows.map((r) => ({
                        deal_id: dealId,
                        stage_id: r.stageId,
                        created_time: r.createdTime,
                        synced_at: new Date().toISOString(),
                      })),
                    )
                  historySynced += validRows.length
                } else {
                  historySemHistorico++
                }
                checkedRows.push({
                  deal_id: dealId,
                  had_history: validRows.length > 0,
                })
              }
              if (checkedRows.length) {
                await supabaseAdmin
                  .from('mkt_stage_history_checked')
                  .upsert(checkedRows, { onConflict: 'deal_id' })
              }
            } catch (e) {
              historyErrosPorSubLote.push(truncar((e as Error).message))
              console.warn(
                '[sync-mkt-bitrix] stagehistory batch falhou num sub-lote:',
                (e as Error).message,
              )
            }

            // (b-histórico) Fim de cada sub-lote de histórico — progresso
            // parcial sobrevive mesmo se o PRÓXIMO sub-lote nunca rodar
            // (504/546 no meio do lote).
            await salvarDiagnosticoHistory()
          }
        }
      } catch (e) {
        historyError = truncar((e as Error).message)
        console.warn(
          '[sync-mkt-bitrix] backfill de histórico de estágio falhou:',
          (e as Error).message,
        )
        // (c-histórico) No catch — erro + o que já tinha sido processado até aqui.
        await salvarDiagnosticoHistory({ error: historyError }).catch(() => {})
      }
    }

    // Remove leads fantasma: só quando (a) o sync de leads terminou OK e (b)
    // essa invocação começou do ZERO (mode 'full') — nunca em 'resume' ou
    // 'incremental', pelo mesmo motivo conservador do sync-cs-bitrix: um sync
    // retomado só é "completo" na soma de várias invocações, e incremental por
    // definição só olha uma fatia. Na dúvida, não limpa.
    let deletedCount = 0
    let limpezaExecutada = false
    if (leadsOk && mode === 'full') {
      const { count } = await supabaseAdmin
        .from('crm_leads')
        .delete({ count: 'exact' })
        .lt('synced_at', syncStart)
      deletedCount = count ?? 0
      limpezaExecutada = true
    }

    const cursorFinal = leadsOk
      ? null
      : {
          start: lastCursorStart,
          startedAt: cursorStartedAt,
          mode: cursorMode,
          filter: leadFilter,
        }

    return new Response(
      JSON.stringify({
        success: leadsOk,
        mode,
        truncated: leadsTruncated,
        pagesProcessed,
        totalUpserted: leadsSynced,
        cursor: cursorFinal,
        sincronizados: {
          leads: leadsSynced,
          dealStages: dealStagesSynced,
          companies: companiesSynced,
          deals: dealsSynced,
          history: historySynced,
        },
        linkBackfill: {
          processed: backfillProcessed,
          linked: backfillLinked,
          remaining: backfillRemaining,
          porEstrategia: backfillPorEstrategia,
          upsertErrors,
          ...(firstUpsertError ? { firstUpsertError } : {}),
          ...(backfillSkipped ? { skipped: backfillSkipped } : {}),
          ...(backfillError ? { error: backfillError } : {}),
        },
        stageHistoryBackfill: {
          processed: historyProcessed,
          synced: historySynced,
          remaining: historyRemaining,
          converged: historyConverged,
          semHistorico: historySemHistorico,
          errosPorSubLote: historyErrosPorSubLote,
          ...(historyError ? { error: historyError } : {}),
        },
        dealRefresh: {
          processed: refreshProcessed,
          updated: refreshUpdated,
          remaining: refreshRemaining,
          ...(refreshSkipped ? { skipped: refreshSkipped } : {}),
          ...(refreshError ? { error: refreshError } : {}),
        },
        ...(leadsOk ? {} : { parcial: leadsSynced, error: leadsErro }),
        deleted: deletedCount,
        limpezaExecutada,
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
