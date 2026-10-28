import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => ({}))
    const {
      conversation_id,
      contact_name,
      contact_phone,
      contact_email,
      contact_position,
      cnpj,
      empresa_data,
      is_pessoa_fisica,
      kanban_id,
      stage_id,
      deal_value,
      deal_description,
      assigned_by_id,
      skip_summary,
    } = payload

    // ── 1. Validações ─────────────────────────────────────────────────────────
    if (
      !conversation_id ||
      !contact_name ||
      !contact_phone ||
      !kanban_id ||
      !stage_id
    ) {
      return jsonError(
        400,
        'Campos obrigatórios: conversation_id, contact_name, contact_phone, kanban_id, stage_id',
      )
    }

    // ── 2. Enriquecer via CNPJ (se houver e não for PF) ──────────────────────
    let enrichedData: any = null
    if (cnpj && !is_pessoa_fisica) {
      const enrichRes = await fetch(
        `${supabaseUrl}/functions/v1/enriquecer-lead`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cnpj }),
        },
      )
      const enrichBody = await enrichRes.json().catch(() => null)
      if (enrichRes.ok && enrichBody && !enrichBody.error) {
        enrichedData = enrichBody
      } else {
        // Enriquecimento falhou — continua com dados do form
        console.warn(
          '[create-from-copiloto] enriquecer-lead falhou:',
          enrichBody?.error,
        )
      }
    }

    // ── 3. Montar lead_data no formato que create-deal-bitrix espera ──────────
    // Nota: assigned_by_id não é lido por create-deal-bitrix v1 — deal vai pro
    // default do Bitrix. Backlog: adicionar suporte em create-deal-bitrix numa SPEC isolada.
    const leadData: Record<string, any> = {
      razao_social:
        enrichedData?.razao_social ||
        empresa_data?.razao_social ||
        contact_name,
      nome_fantasia:
        enrichedData?.nome_fantasia || empresa_data?.nome_fantasia || null,
      cnpj: enrichedData?.cnpj || cnpj || null,
      cnae_principal: enrichedData?.cnae_fiscal_principal || null,
      municipio: enrichedData?.municipio || empresa_data?.municipio || null,
      uf: enrichedData?.uf || empresa_data?.uf || null,
      porte: enrichedData?.porte || null,
      situacao: enrichedData?.situacao_cadastral || null,
      capital_social: enrichedData?.capital_social || null,
      data_abertura: enrichedData?.data_abertura || null,
      email: contact_email || enrichedData?.email || null,
      telefone: contact_phone,
      socios: enrichedData?.socios || null,
      telefones_detalhados: enrichedData?.telefones_detalhados || [
        { numero: contact_phone, tipo: 'celular' },
      ],
      emails_detalhados:
        enrichedData?.emails_detalhados ||
        (contact_email ? [{ email: contact_email, valido: true }] : []),
      // R5: contato vindo do Wizard/Co-Piloto (quando não há sócios na Casa dos Dados).
      // create-deal-bitrix usa isso como fallback se `socios` vier null/vazio.
      contato_principal: {
        nome: contact_name,
        telefone: contact_phone,
        email: contact_email || null,
        cargo: contact_position || null,
      },
    }

    // ── 4. Buscar duplicata no Bitrix (alerta, não bloqueia) ─────────────────
    // bitrix-search-by-phone retorna { success, total, candidatos[] }
    let bitrixMatchAlert: any = null
    try {
      const searchRes = await fetch(
        `${supabaseUrl}/functions/v1/bitrix-search-by-phone`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conversation_id, phone: contact_phone }),
        },
      )
      if (searchRes.ok) {
        const sb = await searchRes.json()
        if (Array.isArray(sb?.candidatos) && sb.candidatos.length > 0) {
          bitrixMatchAlert = sb.candidatos[0]
        }
      }
    } catch (e: any) {
      console.warn(
        '[create-from-copiloto] bitrix-search-by-phone falhou:',
        e.message,
      )
    }

    // ── 5. Chamar create-deal-bitrix com lead_data ────────────────────────────
    // create-deal-bitrix retorna HTTP 200 mesmo em erro ({ success: false, error })
    const createPayload: Record<string, any> = {
      lead_data: leadData,
      kanban_id,
      stage_id,
    }

    const createRes = await fetch(
      `${supabaseUrl}/functions/v1/create-deal-bitrix`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createPayload),
      },
    )

    const createBody = await createRes.json()

    if (!createRes.ok || !createBody.success) {
      return jsonError(
        500,
        createBody.error || 'Falha ao criar entidade no Bitrix',
        {
          details: createBody,
          bitrix_match_alert: bitrixMatchAlert,
        },
      )
    }

    const dealId: number | null = createBody.deal_id
    const companyId: number | null = createBody.company_id

    // ── 6. Vincular conversa ao Deal/Company recém-criado ─────────────────────
    // create-deal-bitrix não retorna contact_id — para PF usamos 'deal' como fallback
    const targetEntityType = is_pessoa_fisica ? 'deal' : 'company'
    const targetEntityId = is_pessoa_fisica ? dealId : companyId

    if (targetEntityId) {
      const { error: updateErr } = await supabaseAdmin
        .from('whatsapp_conversations')
        .update({
          bitrix_entity_id: String(targetEntityId),
          bitrix_entity_type: targetEntityType,
        })
        .eq('id', conversation_id)

      if (updateErr) {
        console.warn(
          '[create-from-copiloto] falha ao vincular conversa:',
          updateErr.message,
        )
      }
    }

    // ── 7. Disparar geração de summary (não-bloqueante) ───────────────────────
    if (!skip_summary && dealId) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/whatsapp-generate-deal-summary`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversation_id,
            deal_id: dealId,
            force: true,
          }),
        }).catch((e: any) =>
          console.warn(
            '[create-from-copiloto] generate-summary falhou:',
            e.message,
          ),
        ),
      )
    }

    // ── 8. Retornar sucesso ───────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        deal_id: dealId,
        company_id: companyId,
        bound_entity: targetEntityId
          ? { type: targetEntityType, id: targetEntityId }
          : null,
        bitrix_match_alert: bitrixMatchAlert,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    console.error('[create-from-copiloto] erro:', error)
    return jsonError(500, error.message || 'Erro interno')
  }
})

function jsonError(
  status: number,
  message: string,
  extra: Record<string, any> = {},
) {
  return new Response(
    JSON.stringify({ success: false, error: message, ...extra }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}
