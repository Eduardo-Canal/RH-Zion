import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { createBitrixLead, LeadDados } from '../_shared/createBitrixLead.ts'
import { getFeiraBitrixConfig } from '../_shared/get-feira-bitrix-config.ts'
import { normalizeBRPhone } from '../_shared/normalize-phone.ts'

function jsonResp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResp(400, { ok: false, error: 'BAD_REQUEST' })
  }

  const { lead_pendente_id, dados_atualizados, vincular_a_existente } = body

  if (!lead_pendente_id)
    return jsonResp(400, { ok: false, error: 'MISSING_LEAD_ID' })

  try {
    // 1. Buscar lead com JOIN em automacao_config
    const { data: leadRow, error: leadErr } = await supabase
      .from('leads_automacao_pendentes')
      .select('*, automacao_config:automacao_config_id(nome)')
      .eq('id', lead_pendente_id)
      .maybeSingle()

    if (leadErr || !leadRow)
      return jsonResp(404, { ok: false, error: 'LEAD_NOT_FOUND' })

    // 2. Validar status
    if (leadRow.status !== 'rascunho_incompleto') {
      return jsonResp(400, {
        ok: false,
        error: 'NOT_A_RASCUNHO',
        status_atual: leadRow.status,
      })
    }

    // 3. Mesclar dados_completos atual + dados_atualizados
    const dadosAtuais: LeadDados = {
      nome: '',
      empresa: '',
      cargo: '',
      telefone: '',
      email: '',
      website: '',
      cnpj: '',
      observacoes: '',
      ...(leadRow.dados_completos || {}),
      ...(dados_atualizados || {}),
    }

    // 4. Atualizar row com dados mesclados
    const updatePayload: any = { dados_completos: dadosAtuais }
    if (dadosAtuais.telefone) updatePayload.telefone = dadosAtuais.telefone
    if (dadosAtuais.email) updatePayload.email = dadosAtuais.email
    if (dadosAtuais.empresa || dadosAtuais.nome) {
      updatePayload.razao_social = dadosAtuais.empresa || dadosAtuais.nome
    }

    await supabase
      .from('leads_automacao_pendentes')
      .update(updatePayload)
      .eq('id', lead_pendente_id)

    // 5. Validar telefone
    if (!dadosAtuais.telefone || !dadosAtuais.telefone.trim()) {
      return jsonResp(400, { ok: false, error: 'TELEFONE_REQUIRED' })
    }

    const bitrixUrl = await getBitrixWebhookUrl(supabase)

    // 6. Vincular a existente (2ª chamada do SDR após dedup)
    if (vincular_a_existente) {
      await fetch(`${bitrixUrl}crm.timeline.comment.add.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            ENTITY_ID: parseInt(vincular_a_existente),
            ENTITY_TYPE_ID: 1,
            COMMENT: [
              '[b]Lead de Feira complementado pela SDR[/b]',
              dadosAtuais.nome ? `Nome: ${dadosAtuais.nome}` : '',
              dadosAtuais.empresa ? `Empresa: ${dadosAtuais.empresa}` : '',
              dadosAtuais.telefone ? `Tel: ${dadosAtuais.telefone}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        }),
      }).catch(() => {})

      await supabase
        .from('leads_automacao_pendentes')
        .update({
          status: 'capturado',
          bitrix_lead_id: String(vincular_a_existente),
          bitrix_match_tipo: 'lead_existente',
        })
        .eq('id', lead_pendente_id)

      return jsonResp(200, {
        ok: true,
        bitrix_lead_id: String(vincular_a_existente),
        vinculado: true,
      })
    }

    // 7. Re-dedup via crm.duplicate.findByComm
    const checks: Array<{ type: string; value: string }> = []
    if (dadosAtuais.telefone)
      checks.push({
        type: 'PHONE',
        value: dadosAtuais.telefone.replace(/\D/g, ''),
      })
    if (dadosAtuais.email)
      checks.push({ type: 'EMAIL', value: dadosAtuais.email })

    const candidatosIds: Array<{ id: string; source: 'lead' | 'contact' }> = []
    for (const check of checks) {
      try {
        const res = await fetch(
          `${bitrixUrl}crm.duplicate.findByComm.json?type=${check.type}&values[]=${encodeURIComponent(check.value)}`,
        )
        const data = await res.json()
        const leads: number[] = data?.result?.LEAD || []
        const contacts: number[] = data?.result?.CONTACT || []
        for (const id of leads)
          candidatosIds.push({ id: String(id), source: 'lead' })
        for (const id of contacts)
          candidatosIds.push({ id: String(id), source: 'contact' })
      } catch {
        /* continua */
      }
    }

    // Deduplica por id+source
    const uniqCandidatos = candidatosIds.filter(
      (c, i) =>
        candidatosIds.findIndex(
          (x) => x.id === c.id && x.source === c.source,
        ) === i,
    )

    if (uniqCandidatos.length > 0) {
      // Buscar detalhes dos candidatos para exibição
      const candidatos: Array<{
        id: string
        nome: string
        empresa: string
        source: string
      }> = []
      for (const c of uniqCandidatos.slice(0, 5)) {
        try {
          const endpoint =
            c.source === 'lead' ? 'crm.lead.get.json' : 'crm.contact.get.json'
          const res = await fetch(`${bitrixUrl}${endpoint}?id=${c.id}`)
          const data = await res.json()
          const r = data?.result
          if (r) {
            candidatos.push({
              id: c.id,
              source: c.source,
              nome:
                `${r.NAME || ''} ${r.LAST_NAME || ''}`.trim() || '(sem nome)',
              empresa: r.COMPANY_TITLE || '',
            })
          }
        } catch {
          /* continua */
        }
      }

      // NÃO cria lead — aguarda 2ª chamada com vincular_a_existente
      return jsonResp(200, { ok: true, candidatos })
    }

    // 8. Criar lead novo no Bitrix
    const feiraNome = (leadRow.automacao_config as any)?.nome || 'Feira'
    const capturadorNome = leadRow.capturador_nome || 'Desconhecido'

    const feiraCfg = await getFeiraBitrixConfig(supabase)
    const bitrixLeadId = await createBitrixLead(
      bitrixUrl,
      dadosAtuais,
      dadosAtuais.observacoes || '',
      feiraNome,
      capturadorNome,
      feiraCfg.stageId || undefined,
    )

    await supabase
      .from('leads_automacao_pendentes')
      .update({
        status: 'capturado',
        bitrix_lead_id: bitrixLeadId,
        bitrix_match_tipo: 'novo',
      })
      .eq('id', lead_pendente_id)

    // 9. Propagar o vínculo para a conversa de WhatsApp correspondente, se houver.
    // Sem isto, o Copiloto mostra "Sem vínculo Bitrix" mesmo com o lead já criado
    // (whatsapp_conversations.bitrix_entity_id nunca era preenchido pela feira).
    // Best-effort: falha aqui NUNCA pode quebrar a criação do lead, que já
    // aconteceu com sucesso acima.
    try {
      const telefoneNorm = normalizeBRPhone(dadosAtuais.telefone)
      if (telefoneNorm.valid) {
        const { data: conversaExistente } = await supabase
          .from('whatsapp_conversations')
          .select('id, bitrix_entity_id')
          .eq('phone', telefoneNorm.number)
          .maybeSingle()

        if (conversaExistente && !conversaExistente.bitrix_entity_id) {
          await supabase
            .from('whatsapp_conversations')
            .update({
              bitrix_entity_id: bitrixLeadId,
              bitrix_entity_type: 'lead',
            })
            .eq('id', conversaExistente.id)
        }
      }
    } catch (linkErr: any) {
      console.error(
        '[feira-enviar-rascunho-bitrix] falha ao propagar vínculo para whatsapp_conversations:',
        linkErr.message,
      )
    }

    console.log(
      `[feira-enviar-rascunho-bitrix] lead criado ${bitrixLeadId} para ${lead_pendente_id}`,
    )
    return jsonResp(200, {
      ok: true,
      bitrix_lead_id: bitrixLeadId,
      candidatos: [],
    })
  } catch (err: any) {
    console.error('[feira-enviar-rascunho-bitrix] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
