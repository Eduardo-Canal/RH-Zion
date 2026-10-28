import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Busca dados reais sincronizados do Bitrix24
    const { data: clientes, error: errClientes } = await supabase
      .from('bitrix_clients_zion')
      .select(
        'id, company_name, cnae_principal, curva_abc, curva_abc_calculada, state, segmento',
      )

    if (errClientes) throw errClientes

    // Busca detalhes agregados e descrições dos CNAEs
    const { data: summaries, error: errSummaries } = await supabase
      .from('analise_cnae')
      .select('cnae, nome_cnae')

    if (errSummaries) throw errSummaries

    const cnaeCount: Record<string, number> = {}
    const groupedClientes: Record<string, any[]> = {}
    const totalClientes = clientes?.length || 0

    clientes?.forEach((c) => {
      const cnae = c.cnae_principal || 'Não classificado'
      cnaeCount[cnae] = (cnaeCount[cnae] || 0) + 1
      if (!groupedClientes[cnae]) groupedClientes[cnae] = []

      groupedClientes[cnae].push({
        id: c.id,
        nome: c.company_name || 'Sem Nome',
        cnae: c.cnae_principal || 'Não classificado',
        curva_abc: c.curva_abc_calculada || c.curva_abc || 'N/D',
        uf: c.state || 'N/D',
        segmento: c.segmento || 'Não classificado',
        porte: 'N/D', // Porte não é trazido diretamente pelo Bitrix na consulta padrão
      })
    })

    const result = Object.entries(cnaeCount).map(([cnae, count]) => {
      const summary = summaries?.find((s) => s.cnae === cnae)
      return {
        cnae,
        count,
        descricao: summary?.nome_cnae || 'Setor não detalhado',
        percentual:
          totalClientes > 0
            ? Number(((count / totalClientes) * 100).toFixed(2))
            : 0,
        clientes: groupedClientes[cnae] || [],
      }
    })

    result.sort((a, b) => b.count - a.count)

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})
