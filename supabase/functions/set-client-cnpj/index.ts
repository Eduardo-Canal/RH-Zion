import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

function createSupabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { bitrix_id, cnpj, user_id, user_name } = body

    if (!bitrix_id || !cnpj) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'bitrix_id e cnpj são obrigatórios',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const cnpjLimpo = String(cnpj).replace(/\D/g, '')
    if (cnpjLimpo.length !== 14) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'CNPJ inválido — deve conter 14 dígitos',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const cnpjFormatado = `${cnpjLimpo.slice(0, 2)}.${cnpjLimpo.slice(2, 5)}.${cnpjLimpo.slice(5, 8)}/${cnpjLimpo.slice(8, 12)}-${cnpjLimpo.slice(12)}`

    const supabase = createSupabaseAdmin()

    // Verifica se o cliente existe e não tem CNPJ
    const { data: cliente, error: clienteErr } = await supabase
      .from('bitrix_clients_zion')
      .select('bitrix_id, company_name, cnpj')
      .eq('bitrix_id', bitrix_id)
      .maybeSingle()

    if (clienteErr || !cliente) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cliente não encontrado' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 1. Atualiza CNPJ na tabela local
    const { error: updateErr } = await supabase
      .from('bitrix_clients_zion')
      .update({ cnpj: cnpjFormatado })
      .eq('bitrix_id', bitrix_id)

    if (updateErr) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Erro ao atualizar CNPJ: ' + updateErr.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 2. Busca CNAE do novo CNPJ na API pública
    let cnaeUpdate: { novo: string | null; alterado: boolean } = {
      novo: null,
      alterado: false,
    }
    try {
      const rfbRes = await fetch(`https://publica.cnpj.ws/cnpj/${cnpjLimpo}`)
      if (rfbRes.ok) {
        const rfbData = await rfbRes.json().catch(() => ({}))
        const atv = rfbData?.estabelecimento?.atividade_principal
        const cnaeNovo = atv ? `${atv.id} - ${atv.descricao}` : null

        if (cnaeNovo) {
          const { data: clienteAtual } = await supabase
            .from('bitrix_clients_zion')
            .select('cnae_principal')
            .eq('bitrix_id', bitrix_id)
            .maybeSingle()

          if (cnaeNovo !== (clienteAtual?.cnae_principal ?? null)) {
            cnaeUpdate = { novo: cnaeNovo, alterado: true }
            await supabase
              .from('bitrix_clients_zion')
              .update({ cnae_principal: cnaeNovo })
              .eq('bitrix_id', bitrix_id)
          }
        }
      }
    } catch {
      /* não bloqueia */
    }

    // 3. Atualiza Bitrix CRM (apenas CNPJ — nome não é alterado)
    let bitrixResult: any = null
    try {
      const webhookUrl = await getBitrixWebhookUrl(supabase)
      const fields: Record<string, string> = {
        UF_CRM_6241B0B267ED3: cnpjFormatado,
        UF_CRM_1742992784: cnpjFormatado,
      }
      if (cnaeUpdate.alterado && cnaeUpdate.novo) {
        fields['UF_CRM_1771423651'] = cnaeUpdate.novo
      }
      const res = await fetch(`${webhookUrl}crm.company.update.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bitrix_id, fields }),
      })
      bitrixResult = await res.json().catch(() => ({}))
    } catch (err: any) {
      bitrixResult = { error: (err as Error).message }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `CNPJ ${cnpjFormatado} definido para ${cliente.company_name}`,
        cnae_update: cnaeUpdate,
        bitrix_update: bitrixResult,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
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
