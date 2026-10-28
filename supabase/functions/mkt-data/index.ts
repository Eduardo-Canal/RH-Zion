import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { createBitrixClient } from '../_shared/bitrix-client.ts'

// Roteador único para a tela MKT (módulo Auditoria). A view 'funnel' é especial:
// faz chamadas ao vivo ao Bitrix (crm.stagehistory.list, via `batch`) pra deals
// ainda sem histórico em cache (crm_deal_stage_history) — não é populada pela
// sincronização em lote, é sob demanda, exatamente como o /funnel do original.
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

    const payload = await req.json().catch(() => ({}))
    const {
      view,
      dateFrom,
      dateTo,
      statusId,
      assignedById,
      leadIds,
      stageId,
      year,
      mes,
      fonteName,
      sourceId,
      type,
    } = payload

    let result: any

    switch (view) {
      case 'statuses': {
        const { data, error } = await supabaseAdmin
          .from('crm_lead_statuses')
          .select('id, name, semantic, sort')
          .order('sort')
        if (error) throw error
        result = data
        break
      }
      case 'sources': {
        const { data, error } = await supabaseAdmin
          .from('crm_lead_sources')
          .select('id, name')
          .order('name')
        if (error) throw error
        result = data
        break
      }
      case 'deal-stages': {
        const { data, error } = await supabaseAdmin
          .from('crm_deal_stages')
          .select('id, name, sort, semantic')
          .order('sort')
        if (error) throw error
        result = data
        break
      }
      case 'users': {
        const { data: leads, error } = await supabaseAdmin
          .from('crm_leads')
          .select('assigned_by_id')
          .not('assigned_by_id', 'is', null)
          .neq('assigned_by_id', '')
        if (error) throw error
        const ids = [
          ...new Set((leads || []).map((l: any) => l.assigned_by_id)),
        ]
        const { data: users } = await supabaseAdmin
          .from('b24_users')
          .select('id, name')
          .in('id', ids.length ? ids : ['__none__'])
        const nameMap = new Map((users || []).map((u: any) => [u.id, u.name]))
        result = ids
          .map((id) => ({ id, name: nameMap.get(id) || id }))
          .sort((a, b) => a.name.localeCompare(b.name))
        break
      }
      case 'leads': {
        const { data, error } = await supabaseAdmin.rpc('auditoria_mkt_leads', {
          p_date_from: dateFrom ?? null,
          p_date_to: dateTo ?? null,
          p_status_id: statusId ?? null,
          p_assigned_by_id: assignedById ?? null,
        })
        if (error) throw error
        result = data
        break
      }
      case 'leads-closed': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_leads_closed',
          {
            p_date_from: dateFrom ?? null,
            p_date_to: dateTo ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'deals': {
        const ids = Array.isArray(leadIds)
          ? leadIds.map(String)
          : String(leadIds || '')
              .split(',')
              .filter(Boolean)
        if (!ids.length) {
          result = []
          break
        }
        const { data, error } = await supabaseAdmin.rpc('auditoria_mkt_deals', {
          p_lead_ids: ids,
        })
        if (error) throw error
        result = data
        break
      }
      case 'leads-today': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_leads_today',
        )
        if (error) throw error
        result = data
        break
      }
      case 'leads-teste': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_leads_teste',
        )
        if (error) throw error
        result = data
        break
      }
      case 'funnel': {
        result = await computeFunnel(
          supabaseAdmin,
          supabaseUrl,
          serviceRoleKey,
          leadIds,
        )
        break
      }

      // ── Views da tela MKT Analytics (reaproveita sync-mkt-bitrix, sem sync própria) ──
      case 'utm-summary': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_utm_summary',
          {
            p_date_from: dateFrom ?? null,
            p_date_to: dateTo ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'setup': {
        const [
          { data: statuses },
          { data: sources },
          { data: dealStages },
          { data: crmStages },
        ] = await Promise.all([
          supabaseAdmin
            .from('crm_lead_statuses')
            .select('id, name, sort')
            .order('sort'),
          supabaseAdmin
            .from('crm_lead_sources')
            .select('id, name')
            .order('name'),
          supabaseAdmin
            .from('crm_deal_stages')
            .select('id, name, sort, semantic'),
          supabaseAdmin
            .from('crm_stages')
            .select('id, name, sort, semantic, entity_id')
            .ilike('entity_id', '%DEAL_STAGE%'),
        ])
        const allStatuses = [
          ...(dealStages || []).map((s: any) => ({
            ENTITY_ID: 'DEAL_STAGE',
            STATUS_ID: s.id,
            NAME: s.name,
            SORT: s.sort,
            SEMANTICS: s.semantic,
          })),
          ...(crmStages || []).map((s: any) => ({
            ENTITY_ID: s.entity_id,
            STATUS_ID: s.id,
            NAME: s.name,
            SORT: s.sort,
            SEMANTICS: s.semantic,
          })),
        ].sort((a, b) => (a.SORT ?? 0) - (b.SORT ?? 0))
        result = {
          statuses: (statuses || []).map((s: any) => ({
            STATUS_ID: s.id,
            NAME: s.name,
            SORT: s.sort,
          })),
          sources: (sources || []).map((s: any) => ({
            STATUS_ID: s.id,
            NAME: s.name,
          })),
          allStatuses,
        }
        break
      }
      case 'analyze': {
        if (!dateFrom || !dateTo) {
          return new Response(
            JSON.stringify({ error: 'dateFrom e dateTo obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_analytics_analyze',
          {
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_stage_id: stageId ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'won-periodo': {
        if (!dateFrom || !dateTo) {
          return new Response(
            JSON.stringify({ error: 'dateFrom e dateTo obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_analytics_won_periodo',
          {
            p_date_from: dateFrom,
            p_date_to: dateTo,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'funil-fonte': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_analytics_funil_fonte',
          {
            p_year: year ?? new Date().getFullYear(),
            p_source_id: sourceId ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'funil-fonte-detail': {
        if (!year || !type) {
          return new Response(
            JSON.stringify({ error: 'year e type obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_analytics_funil_fonte_detail',
          {
            p_year: year,
            p_type: type,
            p_mes: mes ?? null,
            p_fonte_name: fonteName ?? null,
            p_source_id: sourceId ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }

      case 'velocity': {
        if (!dateFrom || !dateTo) {
          return new Response(
            JSON.stringify({ error: 'dateFrom e dateTo obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data: raw, error } = await supabaseAdmin.rpc(
          'auditoria_mkt_velocity_raw',
          {
            p_date_from: dateFrom,
            p_date_to: dateTo,
          },
        )
        if (error) throw error
        result = {
          mqlToSql: {
            ...computeStats(raw.mqlToSqlDays),
            histogram: makeHistogram(raw.mqlToSqlDays),
          },
          sqlToOpp: computeStats(raw.sqlToOppDays),
          oppToWon: computeStats(raw.oppToWonDays),
          totalCycle: computeStats(raw.totalCycleDays),
        }
        break
      }
      default:
        return new Response(
          JSON.stringify({ error: `view inválida: ${view}` }),
          { status: 400, headers: corsHeaders },
        )
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})

// Porta direta de computeStats/makeHistogram do projeto original — estatística e
// histograma calculados aqui, não em SQL, pra não duplicar essa lógica em 2 lugares.
function computeStats(nums: (number | null)[]) {
  const v = (nums || []).filter(
    (n): n is number => n != null && n >= 0 && n <= 730,
  )
  if (!v.length) return { avgDays: null, medianDays: null, count: 0 }
  const avg = v.reduce((s, n) => s + n, 0) / v.length
  const sorted = [...v].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    avgDays: Math.round(avg * 10) / 10,
    medianDays: Math.round(median * 10) / 10,
    count: v.length,
  }
}

function makeHistogram(nums: (number | null)[]) {
  const v = (nums || []).filter(
    (n): n is number => n != null && n >= 0 && n <= 730,
  )
  const labels = ['0–7d', '8–14d', '15–30d', '31–60d', '61–90d', '91d+']
  const counts = [0, 0, 0, 0, 0, 0]
  v.forEach((n) => {
    if (n <= 7) counts[0]++
    else if (n <= 14) counts[1]++
    else if (n <= 30) counts[2]++
    else if (n <= 60) counts[3]++
    else if (n <= 90) counts[4]++
    else counts[5]++
  })
  return labels.map((label, i) => ({ label, count: counts[i] }))
}

async function computeFunnel(
  supabaseAdmin: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  rawLeadIds: unknown,
) {
  const leadIdList = Array.isArray(rawLeadIds)
    ? rawLeadIds.map(String)
    : String(rawLeadIds || '')
        .split(',')
        .filter(Boolean)
  if (!leadIdList.length) return []

  const { data: dealRows } = await supabaseAdmin
    .from('crm_deal_leads')
    .select('deal_id')
    .in('lead_id', leadIdList)
  const dealIds = [...new Set((dealRows || []).map((r: any) => r.deal_id))]
  if (!dealIds.length) return []
  const baseCount = dealIds.length

  const { data: stageRows } = await supabaseAdmin
    .from('crm_deal_stages')
    .select('id, name, sort, semantic')
    .order('sort')
  const isNeg = (s: any) =>
    s.semantic === 'F' ||
    /lose|lost|junk|perd/i.test(s.id) ||
    /perdid/i.test(s.name)
  const isNutr = (s: any) => /nutri/i.test(s.name) || /nutri/i.test(s.id)
  const isCat0 = (s: any) => !/^C\d+:/i.test(s.id)
  const isWon = (s: any) =>
    s.semantic === 'S' || s.id === 'WON' || /ganho/i.test(s.name)

  let stageList = (stageRows || []).filter(
    (s: any) => isCat0(s) && !isNeg(s) && !isNutr(s),
  )
  const wonIdx = stageList.findIndex(isWon)
  if (wonIdx >= 0) stageList = stageList.slice(0, wonIdx + 1)
  if (!stageList.length) return []

  const { data: syncedRows } = await supabaseAdmin
    .from('crm_deal_stage_history')
    .select('deal_id')
    .in('deal_id', dealIds)
  const syncedSet = new Set((syncedRows || []).map((r: any) => r.deal_id))
  const uncached = dealIds.filter((id) => !syncedSet.has(id))

  if (uncached.length) {
    const baseUrl = await getBitrixWebhookUrl(supabaseAdmin)
    const { callBitrixBatch } = createBitrixClient(
      supabaseUrl,
      serviceRoleKey,
      baseUrl,
    )

    // Via `batch` (até 49 negócios por requisição HTTP) em vez de 1 chamada por
    // negócio — mesmo princípio do sync-mkt-bitrix/sync-sprint-bitrix.
    const FUNNEL_BATCH_SIZE = 49
    for (let i = 0; i < uncached.length; i += FUNNEL_BATCH_SIZE) {
      const chunk = uncached.slice(i, i + FUNNEL_BATCH_SIZE)
      const cmds: Record<string, string> = {}
      chunk.forEach((dealId, idx) => {
        cmds[`f${idx}`] =
          `crm.stagehistory.list?entityTypeId=2&filter[OWNER_ID]=${dealId}&order[CREATED_TIME]=ASC`
      })

      try {
        const results = await callBitrixBatch(cmds)
        for (let idx = 0; idx < chunk.length; idx++) {
          const dealId = chunk[idx]
          const history = ((results as any)[`f${idx}`]?.items ??
            (results as any)[`f${idx}`] ??
            []) as any[]
          const visited = [
            ...new Set(
              (Array.isArray(history) ? history : [])
                .map((h) => String(h.STAGE_ID || ''))
                .filter(Boolean),
            ),
          ]
          const toInsert = visited.length ? visited : ['__NONE__']
          for (const sid of toInsert) {
            await supabaseAdmin
              .from('crm_deal_stage_history')
              .upsert(
                { deal_id: String(dealId), stage_id: sid },
                { onConflict: 'deal_id,stage_id' },
              )
          }
        }
      } catch (e) {
        console.warn(
          '[mkt-data] funnel history batch falhou num lote:',
          (e as Error).message,
        )
        for (const dealId of chunk) {
          await supabaseAdmin
            .from('crm_deal_stage_history')
            .upsert(
              { deal_id: String(dealId), stage_id: '__NONE__' },
              { onConflict: 'deal_id,stage_id' },
            )
        }
      }
    }
  }

  const { data: histRows } = await supabaseAdmin
    .from('crm_deal_stage_history')
    .select('deal_id, stage_id')
    .in('deal_id', dealIds)
    .neq('stage_id', '__NONE__')

  const visitedMap: Record<string, Set<string>> = {}
  for (const row of histRows || []) {
    if (!visitedMap[row.deal_id]) visitedMap[row.deal_id] = new Set()
    visitedMap[row.deal_id].add(row.stage_id)
  }

  return stageList.map((s: any, i: number) => {
    const count =
      i === 0
        ? baseCount
        : Object.values(visitedMap).filter((v) => v.has(s.id)).length
    const rate =
      baseCount > 0 ? Number(((count / baseCount) * 100).toFixed(1)) : 0
    return { id: s.id, name: s.name, sort: s.sort, count, rate }
  })
}
