import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

const gradeToBitrixId: Record<string, string> = {
  'A+': '7592',
  A: '7594',
  B: '7596',
  C: '7598',
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  return createClient(supabaseUrl, serviceRoleKey)
}

async function updateBitrixRecord(webhookUrl: string, payload: any) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(JSON.stringify(data))
  }
  return data
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (!rows.length) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Nenhuma linha para atualizar',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const supabaseAdmin = createSupabaseAdmin()
    const webhookUrl = await getBitrixWebhookUrl(supabaseAdmin)

    const results: any[] = []

    for (const row of rows) {
      if (!row.bitrix_id || !row.curva_abc_calculada) {
        results.push({
          id: row.id,
          success: false,
          message: 'Dados incompletos',
        })
        continue
      }

      const payload = {
        id: row.bitrix_id,
        fields: {
          UF_CRM_1738583536320:
            gradeToBitrixId[row.curva_abc_calculada] ?? row.curva_abc_calculada,
        },
      }

      try {
        const updateResult = await updateBitrixRecord(
          `${webhookUrl}crm.company.update.json`,
          payload,
        )
        await supabaseAdmin
          .from('bitrix_clients_zion')
          .update({
            curva_abc_anterior: row.curva_abc || null,
            curva_abc: row.curva_abc_calculada,
            ultima_atualizacao_abc: new Date().toISOString(),
          })
          .eq('id', row.id)

        await supabaseAdmin.from('abc_historico').insert({
          cliente_cnpj: row.cnpj,
          curva_anterior: row.curva_abc || null,
          curva_nova: row.curva_abc_calculada,
          mudanca: row.mudanca || 'manteve',
          confirmador_id: null,
          confirmador_nome: null,
        })

        results.push({ id: row.id, success: true, result: updateResult })
      } catch (error: any) {
        results.push({
          id: row.id,
          success: false,
          message: error.message || String(error),
        })
      }
    }

    return new Response(JSON.stringify({ success: true, data: results }), {
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
