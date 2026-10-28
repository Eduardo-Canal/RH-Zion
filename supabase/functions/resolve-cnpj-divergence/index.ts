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
    const { divergencia_id, action, user_id, user_name } = body

    if (!divergencia_id || !action) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'divergencia_id e action são obrigatórios',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!['aprovar', 'rejeitar'].includes(action)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'action deve ser "aprovar" ou "rejeitar"',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const supabase = createSupabaseAdmin()

    const { data: div, error: divErr } = await supabase
      .from('cnpj_divergencias')
      .select('*')
      .eq('id', divergencia_id)
      .eq('status', 'pendente')
      .maybeSingle()

    if (divErr || !div) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Divergência não encontrada ou já resolvida',
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const agora = new Date().toISOString()

    if (action === 'rejeitar') {
      await supabase
        .from('cnpj_divergencias')
        .update({
          status: 'rejeitado',
          resolvido_em: agora,
          resolvido_por: user_name || user_id || 'sistema',
        })
        .eq('id', divergencia_id)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Divergência rejeitada. CNPJ não será alterado.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // action === 'aprovar'
    const novoCnpj = div.cnpj_contaazul
    const novoCnpjFormatado =
      novoCnpj.length === 14
        ? `${novoCnpj.slice(0, 2)}.${novoCnpj.slice(2, 5)}.${novoCnpj.slice(5, 8)}/${novoCnpj.slice(8, 12)}-${novoCnpj.slice(12)}`
        : novoCnpj

    // 1. Atualiza bitrix_clients_zion
    const { error: updateLocalErr } = await supabase
      .from('bitrix_clients_zion')
      .update({ cnpj: novoCnpjFormatado })
      .eq('bitrix_id', div.bitrix_id)

    if (updateLocalErr) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Erro ao atualizar CNPJ local: ' + updateLocalErr.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 2. Verifica CNAE do novo CNPJ e atualiza localmente se mudou
    let cnaeUpdate: {
      anterior: string | null
      novo: string | null
      alterado: boolean
    } = {
      anterior: null,
      novo: null,
      alterado: false,
    }
    try {
      const cnpjLimpo = novoCnpj.replace(/\D/g, '')
      const rfbRes = await fetch(`https://publica.cnpj.ws/cnpj/${cnpjLimpo}`)
      if (rfbRes.ok) {
        const rfbData = await rfbRes.json().catch(() => ({}))
        const atv = rfbData?.estabelecimento?.atividade_principal
        const cnaeNovo = atv ? `${atv.id} - ${atv.descricao}` : null

        if (cnaeNovo) {
          const { data: clienteAtual } = await supabase
            .from('bitrix_clients_zion')
            .select('cnae_principal')
            .eq('bitrix_id', div.bitrix_id)
            .maybeSingle()

          cnaeUpdate.anterior = clienteAtual?.cnae_principal ?? null
          cnaeUpdate.novo = cnaeNovo

          if (cnaeNovo !== cnaeUpdate.anterior) {
            cnaeUpdate.alterado = true
            await supabase
              .from('bitrix_clients_zion')
              .update({ cnae_principal: cnaeNovo })
              .eq('bitrix_id', div.bitrix_id)
          }
        }
      }
    } catch {
      /* não bloqueia aprovação */
    }

    // 3. Atualiza o Bitrix CRM (CNPJ + CNAE se alterado, em uma única chamada)
    let bitrixUpdateResult: any = null
    try {
      const webhookUrl = await getBitrixWebhookUrl(supabase)
      const fields: Record<string, string> = {
        UF_CRM_6241B0B267ED3: novoCnpjFormatado,
        UF_CRM_1742992784: novoCnpjFormatado,
      }
      if (cnaeUpdate.alterado && cnaeUpdate.novo) {
        fields['UF_CRM_1771423651'] = cnaeUpdate.novo
      }
      const res = await fetch(`${webhookUrl}crm.company.update.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: div.bitrix_id, fields }),
      })
      bitrixUpdateResult = await res.json().catch(() => ({}))
    } catch (bitrixErr: any) {
      // Não bloqueia — atualizações locais já foram salvas
      bitrixUpdateResult = { error: (bitrixErr as Error).message }
    }

    // 4. Move os dados de contaazul_cache do CNPJ antigo para o novo
    const cnpjAntigo = div.cnpj_bitrix
    if (cnpjAntigo && cnpjAntigo !== novoCnpj) {
      const { data: cacheAntigo } = await supabase
        .from('contaazul_cache')
        .select('id')
        .eq('cnpj', cnpjAntigo)
        .maybeSingle()

      if (cacheAntigo?.id) {
        await supabase
          .from('contaazul_cache')
          .update({ cnpj: novoCnpj })
          .eq('id', cacheAntigo.id)
      }
    }

    // 5. Salva cache com o novo CNPJ caso ainda não exista
    const { data: cacheNovo } = await supabase
      .from('contaazul_cache')
      .select('id')
      .eq('cnpj', novoCnpj)
      .maybeSingle()

    if (!cacheNovo?.id) {
      await supabase.from('contaazul_cache').insert({
        cnpj: novoCnpj,
        nome_cliente: div.nome_contaazul,
        mrr: div.mrr,
        contratos: div.contratos,
        atualizado_em: agora,
        sincronizado_por: user_id || null,
        sincronizado_por_nome: user_name || null,
      })
    } else {
      await supabase
        .from('contaazul_cache')
        .update({
          nome_cliente: div.nome_contaazul,
          mrr: div.mrr,
          contratos: div.contratos,
          atualizado_em: agora,
          sincronizado_por: user_id || null,
          sincronizado_por_nome: user_name || null,
        })
        .eq('id', cacheNovo.id)
    }

    // 6. Atualiza MRR na bitrix_clients_zion
    await supabase
      .from('bitrix_clients_zion')
      .update({ mrr: div.mrr, cnpj: novoCnpjFormatado })
      .eq('bitrix_id', div.bitrix_id)

    // 7. Marca divergência como aprovada
    await supabase
      .from('cnpj_divergencias')
      .update({
        status: 'aprovado',
        resolvido_em: agora,
        resolvido_por: user_name || user_id || 'sistema',
      })
      .eq('id', divergencia_id)

    return new Response(
      JSON.stringify({
        success: true,
        message: `CNPJ atualizado de ${div.cnpj_bitrix} para ${novoCnpj}`,
        cnae_update: cnaeUpdate,
        bitrix_update: bitrixUpdateResult,
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
