import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  return createClient(supabaseUrl, serviceRoleKey)
}

function classifyMargin(margin: number, config: any) {
  if (margin >= Number(config.a_plus_min || 0)) return 'A+'
  if (margin >= Number(config.a_min || 0)) return 'A'
  if (margin >= Number(config.b_min || 0)) return 'B'
  return 'C'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createSupabaseAdmin()

    const [
      { data: curveConfig },
      { data: oracleTiers },
      { data: cacheRows },
      { data: clients },
      { data: overrides },
    ] = await Promise.all([
      supabaseAdmin
        .from('abc_curve_config')
        .select('*')
        .eq('type', 'thresholds')
        .limit(1)
        .maybeSingle(),
      supabaseAdmin.from('oracle_cost_config').select('*'),
      supabaseAdmin.from('contaazul_cache').select('*'),
      supabaseAdmin.from('bitrix_clients_zion').select('*'),
      supabaseAdmin
        .from('cliente_custo_override')
        .select('cnpj, is_on_premise, custo_manual'),
    ])

    const tierMap = new Map<string, number>()
    ;(oracleTiers ?? []).forEach((row: any) => {
      if (row.porte)
        tierMap.set(String(row.porte), Number(row.custo_mensal ?? 0))
    })

    const cacheMap = new Map<string, any>()
    ;(cacheRows ?? []).forEach((row: any) => {
      if (row.cnpj) cacheMap.set(String(row.cnpj).replace(/\D/g, ''), row)
    })

    const overrideMap = new Map<string, any>()
    ;(overrides ?? []).forEach((row: any) => {
      if (row.cnpj) overrideMap.set(String(row.cnpj).replace(/\D/g, ''), row)
    })

    const config = curveConfig ?? {
      mode: 'fixo',
      a_plus_min: 4000,
      a_min: 2500,
      b_min: 1000,
      c_min: 0,
    }

    const results: any[] = []
    for (const client of clients ?? []) {
      const cnpjKey = String(client.cnpj ?? '').replace(/\D/g, '')
      const cached = cacheMap.get(cnpjKey)
      const mrr = Number(client.mrr ?? cached?.mrr ?? 0)

      // Precedência de custo: on_premise(0) > manual > tier automático
      const override = overrideMap.get(cnpjKey)
      let custo: number
      let fonte_custo: string
      if (override?.is_on_premise) {
        custo = 0
        fonte_custo = 'on_premise'
      } else if (override?.custo_manual != null) {
        custo = Number(override.custo_manual)
        fonte_custo = 'manual'
      } else {
        const porte = String(client.porte || 'pequeno').toLowerCase()
        custo = Number(tierMap.get(porte) ?? tierMap.get('pequeno') ?? 0)
        fonte_custo = 'oracle_tier'
      }

      const margem = Number((mrr - custo).toFixed(2))
      const novaCurva = classifyMargin(margem, config)

      const bitrixToGrade: Record<string, string> = {
        '7592': 'A+',
        '7594': 'A',
        '7596': 'B',
        '7598': 'C',
      }
      const rawCurva = client.curva_abc || null
      const antigaCurva = rawCurva
        ? (bitrixToGrade[rawCurva] ?? rawCurva)
        : null
      const rank: Record<string, number> = { 'A+': 4, A: 3, B: 2, C: 1 }
      const antigaRank = antigaCurva ? (rank[antigaCurva] ?? 0) : 0
      const novaRank = rank[novaCurva] ?? 0
      const mudanca = antigaCurva
        ? novaRank === antigaRank
          ? 'manteve'
          : novaRank > antigaRank
            ? 'subiu'
            : 'desceu'
        : 'subiu'

      await supabaseAdmin
        .from('bitrix_clients_zion')
        .update({
          curva_abc_calculada: novaCurva,
          curva_abc_anterior: antigaCurva,
          custo_infra: custo,
          margem_liquida: margem,
          ultima_atualizacao_abc: new Date().toISOString(),
        })
        .eq('id', client.id)

      results.push({
        id: client.id,
        bitrix_id: client.bitrix_id,
        company_name: client.company_name,
        cnpj: client.cnpj,
        mrr,
        custo_infra: custo,
        fonte_custo,
        margem_liquida: margem,
        curva_abc: antigaCurva,
        curva_abc_calculada: novaCurva,
        curva_abc_anterior: antigaCurva,
        mudanca,
      })
    }

    return new Response(JSON.stringify({ success: true, rows: results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
