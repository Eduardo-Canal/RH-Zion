import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador único para o TV Overlay (módulo Auditoria).
// View 'kpis' chama auditoria_tv_kpis(periodo) — Comercial/Sprint/NPS/NCs (Etapa 1).
// View 'mkt-summary' chama auditoria_tv_mkt_summary() — aba Marketing (Etapa 2),
// enriquecida aqui com ranking de fontes, Inbound/Outbound/Indicação e funil
// por etapa (Etapa 4) — auditoria_tv_mkt_fontes()/auditoria_tv_mkt_sql_stages()
// só devolvem dados brutos; a classificação por nome de fonte e o agrupamento
// por etapa acontecem aqui em TypeScript, espelhando _classifyFonte/_sumTypes/
// groupByStage do insightService.js original (que também fazia isso em JS).
// View 'sparklines' chama auditoria_tv_sparklines(periodo) — Etapa 3.

const PERIODS_MKT = [
  'hoje',
  'semana',
  'semana_atual',
  'mes_passado',
  'mes',
  'trimestre',
] as const

function normText(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

function classifyFonte(nome: unknown): 'indicacao' | 'inbound' | 'outbound' {
  const text = normText(nome)
  const indicacao = [
    'indicacao',
    'recomendacao',
    'cliente existente',
    'vendas recorrentes',
    'repeat_sale',
    'partner',
  ]
  const inbound = [
    'site',
    'lp',
    'landing',
    'google',
    'ads',
    'formulario',
    'webform',
    'web',
    'email',
    'e-mail',
    'chat',
    'bate-papo',
    'facebook',
    'instagram',
    'loja',
    'store',
    'agendamento',
    'booking',
    'openline',
    'contato geral',
    'industria',
    'operador logistico',
    'e-commerce',
    'distribuidor',
  ]
  if (indicacao.some((k) => text.includes(normText(k)))) return 'indicacao'
  if (text.includes('feira')) return 'outbound'
  if (inbound.some((k) => text.includes(normText(k)))) return 'inbound'
  return 'outbound'
}

function sumTypes(rows: any[], period: string) {
  const r = { inbound: 0, outbound: 0, indicacao: 0 }
  for (const row of rows) {
    r[classifyFonte(row.fonte)] += Number(row[period] || 0)
  }
  return r
}

function sumTypesPfx(rows: any[], prefix: string, period: string) {
  const r = { inbound: 0, outbound: 0, indicacao: 0 }
  for (const row of rows) {
    r[classifyFonte(row.fonte)] += Number(row[`${prefix}_${period}`] || 0)
  }
  return r
}

function topFontesFor(rows: any[]) {
  return (period: string) =>
    [...rows]
      .sort((a, b) => (b[period] || 0) - (a[period] || 0))
      .filter((r) => (r[period] || 0) > 0)
      .slice(0, 10)
      .map((r, i) => ({ pos: i + 1, nome: r.fonte, total: r[period] }))
}

// Agrupa negócios por etapa, preenchendo etapas sem negócio nenhum — porte
// de groupByStage do insightService.js original.
function groupByStage(rows: any[], stageDefs: any[]) {
  const byId = new Map<string, any>()
  for (const r of rows) {
    const key = r.current_stage_id || r.stage_name
    if (!byId.has(key)) {
      byId.set(key, {
        stage_id: r.current_stage_id,
        stage_name: r.stage_name,
        stage_sort: +r.stage_sort,
        stage_semantic: r.stage_semantic,
        deals: [],
      })
    }
    byId
      .get(key)
      .deals.push({ deal_id: r.deal_id, title: r.deal_title || 'Sem título' })
  }
  if (stageDefs.length > 0) {
    const result = stageDefs.map(
      (s) =>
        byId.get(s.id) || {
          stage_id: s.id,
          stage_name: s.name,
          stage_sort: s.sort,
          stage_semantic: s.semantic,
          deals: [],
        },
    )
    for (const [id, data] of byId) {
      if (!stageDefs.find((s) => s.id === id)) result.push(data)
    }
    return result.sort((a, b) => a.stage_sort - b.stage_sort)
  }
  return [...byId.values()].sort((a, b) => a.stage_sort - b.stage_sort)
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
    const { view, period } = payload

    let result: any

    switch (view) {
      case 'kpis': {
        const periodosValidos = [
          'hoje',
          'semana',
          'semana_atual',
          'mes',
          'trimestre',
        ]
        if (!periodosValidos.includes(period)) {
          return new Response(
            JSON.stringify({ error: `period inválido: ${period}` }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc('auditoria_tv_kpis', {
          p_period: period,
        })
        if (error) throw error
        result = data
        break
      }
      case 'mkt-summary': {
        const [summaryRes, fontesRes, stagesRes] = await Promise.all([
          supabaseAdmin.rpc('auditoria_tv_mkt_summary'),
          supabaseAdmin.rpc('auditoria_tv_mkt_fontes'),
          supabaseAdmin.rpc('auditoria_tv_mkt_sql_stages'),
        ])
        if (summaryRes.error) throw summaryRes.error
        if (fontesRes.error) throw fontesRes.error
        if (stagesRes.error) throw stagesRes.error

        const summary = summaryRes.data
        const fontes = fontesRes.data || {
          criados: [],
          sql: [],
          opp: [],
          detail: [],
        }
        const { deals, stage_defs } = stagesRes.data || {
          deals: [],
          stage_defs: [],
        }

        const seenIds = new Set<string>()
        const dealsUnique = (deals as any[]).filter((d) => {
          if (seenIds.has(d.deal_id)) return false
          seenIds.add(d.deal_id)
          return true
        })
        const hojeStages = groupByStage(
          dealsUnique.filter((d) => d.in_hoje),
          stage_defs,
        )
        const semanaStages = groupByStage(
          dealsUnique.filter((d) => d.periodo_semana === 'semana'),
          stage_defs,
        )
        const semanaAtualStages = groupByStage(
          dealsUnique.filter((d) => d.periodo_semana === 'semana_atual'),
          stage_defs,
        )
        const mesPassadoStages = groupByStage(
          dealsUnique.filter((d) => d.in_mes_passado),
          stage_defs,
        )
        const mesStages = groupByStage(
          dealsUnique.filter((d) => d.in_mes),
          stage_defs,
        )
        const trimestreStages = groupByStage(dealsUnique, stage_defs)
        const stagesByPeriod: Record<string, any[]> = {
          hoje: hojeStages,
          semana: semanaStages,
          semana_atual: semanaAtualStages,
          mes_passado: mesPassadoStages,
          mes: mesStages,
          trimestre: trimestreStages,
        }

        const topFontesCriados = topFontesFor(fontes.criados)
        const topFontesSql = topFontesFor(fontes.sql)
        const topFontesOpp = topFontesFor(fontes.opp)
        const mkSrc = (period: string) => ({
          criados: sumTypes(fontes.criados, period),
          mql: sumTypesPfx(fontes.detail, 'mql', period),
          descartados: sumTypesPfx(fontes.detail, 'junk', period),
          sql: sumTypes(fontes.sql, period),
          opp: sumTypes(fontes.opp, period),
        })

        for (const p of PERIODS_MKT) {
          if (!summary[p]) continue
          summary[p].sql_stages = stagesByPeriod[p]
          summary[p].top_fontes = topFontesCriados(p)
          summary[p].top_fontes_sql = topFontesSql(p)
          summary[p].top_fontes_opp = topFontesOpp(p)
          summary[p].src = mkSrc(p)
        }

        result = summary
        break
      }
      case 'sparklines': {
        const periodosValidos = [
          'hoje',
          'semana',
          'semana_atual',
          'mes',
          'trimestre',
        ]
        if (!periodosValidos.includes(period)) {
          return new Response(
            JSON.stringify({ error: `period inválido: ${period}` }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_tv_sparklines',
          { p_period: period },
        )
        if (error) throw error
        result = data
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
