import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador único para a tela Funil Inteligence (módulo Auditoria).
// 100% leitura — nenhuma sincronização própria, reaproveita as tabelas de
// CRM que MKT/CS COM já sincronizam. Formatação de exibição (datas, moeda)
// fica aqui, igual à divisão de responsabilidade de mkt-data.

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function fmtCurrency(v: number | string | null): string {
  const n = parseFloat(String(v ?? 0)) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function rowsFromDetail(
  type: string,
  items: any[],
): { cols: string[]; rows: any[][] } {
  if (type === 'mql') {
    return {
      cols: ['ID', 'Nome', 'Empresa', 'Status', 'Fonte', 'Criado'],
      rows: items.map((it) => [
        it.id,
        it.nome,
        it.empresa || '—',
        it.status,
        it.fonte,
        fmtDate(it.criado),
      ]),
    }
  }
  if (type === 'sql') {
    return {
      cols: ['ID', 'Nome', 'Empresa', 'Fonte', 'Criado', 'Convertido'],
      rows: items.map((it) => [
        it.id,
        it.nome,
        it.empresa || '—',
        it.fonte,
        fmtDate(it.criado),
        fmtDate(it.convertido),
      ]),
    }
  }
  if (type === 'vel-mql-sql') {
    return {
      cols: ['ID', 'Nome', 'Empresa', 'Fonte', 'Criado', 'Convertido', 'Dias'],
      rows: items.map((it) => [
        it.id,
        it.nome,
        it.empresa || '—',
        it.fonte,
        fmtDate(it.criado),
        fmtDate(it.convertido),
        `${it.dias} dias`,
      ]),
    }
  }
  if (type === 'vel-sql-opp') {
    return {
      cols: ['Deal', 'Etapa', 'Valor', 'SQL em', 'OPP em', 'Dias'],
      rows: items.map((it) => [
        it.deal,
        it.etapa,
        fmtCurrency(it.valor),
        fmtDate(it.sql_em),
        fmtDate(it.opp_em),
        `${it.dias} dias`,
      ]),
    }
  }
  if (type === 'opp-active') {
    return {
      cols: ['Deal', 'Etapa atual', 'Valor', 'Última mov.'],
      rows: items.map((it) => [
        it.deal,
        it.etapa,
        fmtCurrency(it.valor),
        fmtDate(it.ultima_mov),
      ]),
    }
  }
  if (type === 'opp-stuck') {
    return {
      cols: ['Deal', 'Etapa', 'Valor', 'Última mov.', 'Parado há'],
      rows: items.map((it) => [
        it.deal,
        it.etapa,
        fmtCurrency(it.valor),
        fmtDate(it.ultima_mov),
        it.dias_parado ? `${it.dias_parado} dias` : '—',
      ]),
    }
  }
  if (type === 'opp') {
    return {
      cols: ['Deal', 'Etapa atual', 'Fonte', 'Valor'],
      rows: items.map((it) => [
        it.deal,
        it.etapa,
        it.fonte,
        fmtCurrency(it.valor),
      ]),
    }
  }
  if (type === 'won') {
    return {
      cols: ['Deal', 'Etapa', 'Valor'],
      rows: items.map((it) => [it.deal, it.etapa, fmtCurrency(it.valor)]),
    }
  }
  if (type.startsWith('source:')) {
    return {
      cols: ['Tipo', 'ID', 'Nome / Deal', 'Status / Etapa', 'Valor'],
      rows: items.map((it) => [
        it.tipo,
        it.id,
        it.nome_ou_deal,
        it.status_ou_etapa,
        it.valor != null ? fmtCurrency(it.valor) : '—',
      ]),
    }
  }
  return { cols: [], rows: [] }
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
    const { view, startDate, endDate, type } = payload

    if (view === 'data') {
      if (!startDate || !endDate) {
        return new Response(
          JSON.stringify({ error: 'startDate e endDate obrigatórios' }),
          { status: 400, headers: corsHeaders },
        )
      }
      const start = `${startDate}T00:00:00`
      const end = `${endDate}T23:59:59`

      const { data: allLeads, error: leadsErr } = await supabaseAdmin.rpc(
        'auditoria_funil_leads_periodo',
        { p_start: start, p_end: end },
      )
      if (leadsErr) throw leadsErr

      const sqlLeads = (allLeads ?? []).filter(
        (l: any) => l.status_id === 'CONVERTED',
      )
      const sqlIds = sqlLeads.map((l: any) => l.id)

      const { data: velocity, error: velErr } = await supabaseAdmin.rpc(
        'auditoria_funil_velocity',
        { p_start: start, p_end: end },
      )
      if (velErr) throw velErr
      const { data: oppActive, error: oppActiveErr } = await supabaseAdmin.rpc(
        'auditoria_funil_opp_active',
      )
      if (oppActiveErr) throw oppActiveErr
      const { data: oppStuck, error: oppStuckErr } = await supabaseAdmin.rpc(
        'auditoria_funil_opp_stuck',
      )
      if (oppStuckErr) throw oppStuckErr

      let oppDealIds = new Set<string>()
      let oppLeadSet = new Set<string>()
      let wonDealIds = new Set<string>()
      let alertDeals: any[] = []

      if (sqlIds.length > 0) {
        const { data: oppRows, error: oppRowsErr } = await supabaseAdmin.rpc(
          'auditoria_funil_opp_deals',
          { p_lead_ids: sqlIds },
        )
        if (oppRowsErr) throw oppRowsErr
        ;(oppRows ?? []).forEach((r: any) => {
          oppDealIds.add(String(r.deal_id))
          oppLeadSet.add(String(r.lead_id))
        })

        const { data: wonRows, error: wonRowsErr } = await supabaseAdmin.rpc(
          'auditoria_funil_won_deals',
          { p_lead_ids: sqlIds },
        )
        if (wonRowsErr) throw wonRowsErr
        ;(wonRows ?? []).forEach((id: any) => wonDealIds.add(String(id)))

        const { data: alerts, error: alertsErr } = await supabaseAdmin.rpc(
          'auditoria_funil_alert_deals',
          { p_lead_ids: sqlIds },
        )
        if (alertsErr) throw alertsErr
        alertDeals = alerts ?? []
      }

      const sourceMap: Record<
        string,
        { mql: number; sql: number; opp: number }
      > = {}
      const leadSrcMap: Record<string, string> = {}
      ;(allLeads ?? []).forEach((l: any) => {
        const src = l.source_name
        leadSrcMap[String(l.id)] = src
        if (!sourceMap[src]) sourceMap[src] = { mql: 0, sql: 0, opp: 0 }
        sourceMap[src].mql++
        if (l.status_id === 'CONVERTED') sourceMap[src].sql++
      })
      oppLeadSet.forEach((lid) => {
        const src = leadSrcMap[lid]
        if (src && sourceMap[src]) sourceMap[src].opp++
      })

      const sourceQuality = Object.entries(sourceMap)
        .map(([name, d]) => ({
          name,
          mql: d.mql,
          sql: d.sql,
          opp: d.opp,
          convMqlSql: d.mql ? Math.round((d.sql / d.mql) * 100) : 0,
          convSqlOpp: d.sql ? Math.round((d.opp / d.sql) * 100) : 0,
          convMqlOpp: d.mql ? Math.round((d.opp / d.mql) * 100) : 0,
        }))
        .filter((d) => d.mql >= 1)
        .sort((a, b) => b.mql - a.mql)

      const result = {
        velocity: {
          mqlToSql: {
            avgDays: parseFloat(velocity?.mqlToSql?.avgDays) || 0,
            count: parseInt(velocity?.mqlToSql?.count) || 0,
          },
          sqlToOpp: {
            avgDays: parseFloat(velocity?.sqlToOpp?.avgDays) || 0,
            count: parseInt(velocity?.sqlToOpp?.count) || 0,
          },
          oppActive: {
            count: parseInt(oppActive?.count) || 0,
            totalValue: parseFloat(oppActive?.totalValue) || 0,
          },
          oppStuck: { count: parseInt(oppStuck?.count) || 0 },
        },
        funnel: {
          mql: (allLeads ?? []).length,
          sql: sqlIds.length,
          opp: oppDealIds.size,
          won: wonDealIds.size,
        },
        sourceQuality,
        alertDeals: alertDeals.map((r: any) => ({
          id: String(r.deal_id),
          title: r.title || '—',
          stageName: r.stage_name || '—',
          opportunity: parseFloat(r.opportunity) || 0,
          daysStuck: r.days_stuck ?? null,
          lastChange: r.last_change,
        })),
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (view === 'detail') {
      if (!type) {
        return new Response(JSON.stringify({ error: 'type obrigatório' }), {
          status: 400,
          headers: corsHeaders,
        })
      }
      const start = startDate ? `${startDate}T00:00:00` : '2000-01-01T00:00:00'
      const end = endDate ? `${endDate}T23:59:59` : '2099-12-31T23:59:59'

      const { data, error } = await supabaseAdmin.rpc(
        'auditoria_funil_detail',
        { p_type: type, p_start: start, p_end: end },
      )
      if (error) throw error
      if (data?.error) {
        return new Response(JSON.stringify({ error: data.error }), {
          status: 400,
          headers: corsHeaders,
        })
      }

      const { cols, rows } = rowsFromDetail(type, data?.items ?? [])
      return new Response(JSON.stringify({ title: data?.title, cols, rows }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `view inválida: ${view}` }), {
      status: 400,
      headers: corsHeaders,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
