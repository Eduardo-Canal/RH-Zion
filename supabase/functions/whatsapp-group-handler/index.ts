import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { createBitrixLead, LeadDados } from '../_shared/createBitrixLead.ts'
import { SYSTEM_GROUP_MARKER } from '../_shared/group-markers.ts'
import { getFeiraBitrixConfig } from '../_shared/get-feira-bitrix-config.ts'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RoutePayload {
  instance_id: string
  conversation_id: string
  message_db_id: string
  message: any
  phone: string // group_id (sem @g.us)
  contact_name: string
  is_group: boolean
  group_id: string
  text: string
  msg_type: string
  quoted_message_id: string | null
  quoted_text: string
}

// ─── OCR via GPT-4o Vision ────────────────────────────────────────────────────

async function extractBusinessCard(
  imageBase64: string,
  caption: string,
  openaiKey: string,
): Promise<LeadDados> {
  const promptText = [
    'Extraia as informações do crachá ou cartão de visita nesta imagem.',
    'Retorne APENAS um JSON válido com os campos:',
    '{ "nome": "", "empresa": "", "cargo": "", "telefone": "", "email": "", "website": "", "cnpj": "", "observacoes": "" }',
    'Campos não encontrados devem ficar como string vazia.',
    'Não inclua explicações, apenas o JSON.',
    caption ? `\nAnotação do executivo sobre este contato: "${caption}"` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: {
                url: imageBase64.startsWith('data:')
                  ? imageBase64
                  : `data:image/jpeg;base64,${imageBase64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) throw new Error(`OpenAI respondeu ${res.status}`)
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content?.trim() || '{}'

  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/```$/, '')
      .trim()
    return JSON.parse(cleaned) as LeadDados
  } catch {
    return {
      nome: '',
      empresa: '',
      cargo: '',
      telefone: '',
      email: '',
      website: '',
      cnpj: '',
      observacoes: caption,
    }
  }
}

// ─── Extração a partir de texto ou transcrição de áudio ──────────────────────

async function extractFromText(
  text: string,
  openaiKey: string,
): Promise<LeadDados> {
  const prompt = [
    'Extraia informações de contato comercial do texto abaixo.',
    'Retorne APENAS um JSON válido com os campos:',
    '{ "nome": "", "empresa": "", "cargo": "", "telefone": "", "email": "", "website": "", "cnpj": "", "observacoes": "" }',
    'Campos não encontrados devem ficar como string vazia.',
    'Se o texto for apenas uma observação sem dados claros, coloque tudo em "observacoes".',
    'Não inclua explicações, apenas o JSON.',
    '',
    `Texto:\n${text}`,
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`OpenAI respondeu ${res.status}`)
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content?.trim() || '{}'

  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/```$/, '')
      .trim()
    return JSON.parse(cleaned) as LeadDados
  } catch {
    return {
      nome: '',
      empresa: '',
      cargo: '',
      telefone: '',
      email: '',
      website: '',
      cnpj: '',
      observacoes: text,
    }
  }
}

// ─── Download de mídia via uazapi.dev ─────────────────────────────────────────

async function downloadMedia(
  baseUrl: string,
  token: string,
  messageId: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/message/download`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({
      id: messageId,
      return_base64: true,
      return_link: false,
    }),
  })
  const contentType = res.headers.get('content-type') || ''
  if (!res.ok) throw new Error(`Falha ao baixar mídia: ${res.status}`)
  const data = await res.json()
  const b64: string = data?.base64Data || data?.base64 || ''
  if (!b64) throw new Error('Download sem base64Data')
  return b64
}

// Transcreve áudio direto na uazapi (transcribe=true). Mensagens de grupo não
// existem em whatsapp_messages, então não dá pra usar a edge transcribe-audio.
async function transcreverAudioUazapi(
  baseUrl: string,
  token: string,
  waMessageId: string,
  openaiKey: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/message/download`
  const chamar = async (): Promise<string> => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: waMessageId,
        transcribe: true,
        openai_apikey: openaiKey,
        return_link: false,
      }),
    })
    if (!r.ok) throw new Error(`uazapi ${r.status}`)
    const data = await r.json().catch(() => null)
    return (data?.transcription || '').trim()
  }

  let transcription = await chamar().catch(() => '')
  if (!transcription) {
    // Warm-up: força a uazapi a baixar/cachear o áudio, espera e tenta de novo
    await fetch(url, {
      method: 'POST',
      headers: { token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: waMessageId, return_link: true }),
    }).catch(() => {})
    await new Promise((r) => setTimeout(r, 4000))
    transcription = await chamar().catch(() => '')
  }
  return transcription
}

// B.1: sobe a imagem original da feira ao bucket privado. Retorna o path ou null (nunca lança).
async function uploadFeiraImagem(
  supabase: ReturnType<typeof createClient>,
  imageBase64: string,
): Promise<string | null> {
  try {
    const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const path = `feira/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from('whatsapp-incoming-media')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
    if (error) {
      console.warn('[group-handler] upload imagem feira falhou:', error.message)
      return null
    }
    return path
  } catch (e: any) {
    console.warn('[group-handler] exceção no upload imagem feira:', e?.message)
    return null
  }
}

// ─── Deduplicação Bitrix24 ────────────────────────────────────────────────────

async function findDuplicateLead(
  bitrixUrl: string,
  telefone: string,
  email: string,
): Promise<string | null> {
  const checks: Array<{ type: string; value: string }> = []
  if (telefone)
    checks.push({ type: 'PHONE', value: telefone.replace(/\D/g, '') })
  if (email) checks.push({ type: 'EMAIL', value: email })

  for (const check of checks) {
    try {
      const res = await fetch(
        `${bitrixUrl}crm.duplicate.findByComm.json?type=${check.type}&values[]=${encodeURIComponent(check.value)}`,
      )
      const data = await res.json()
      const leads: number[] = data?.result?.LEAD || []
      if (leads.length > 0) return String(leads[0])
    } catch {
      // continua para próxima verificação
    }
  }
  return null
}

// ─── Marcar grupo como inativo (não responde) ─────────────────────────────────

async function markGroupDead(supabase: any, groupId: string): Promise<void> {
  await supabase
    .from('whatsapp_group_config')
    .update({ ativo: false })
    .eq('group_id', groupId)
  console.warn(
    `[group-handler] grupo ${groupId} marcado como inativo (404 na uazapi)`,
  )
}

// ─── Enviar mensagem no grupo ──────────────────────────────────────────────────

async function sendGroupMessage(
  baseUrl: string,
  globalToken: string,
  instanceKey: string,
  groupJid: string,
  text: string,
): Promise<{ groupDead: boolean }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: globalToken,
      },
      body: JSON.stringify({
        instanceName: instanceKey,
        number: groupJid,
        text: `${SYSTEM_GROUP_MARKER} ${text}`,
      }),
    })
    if (res.status === 404) return { groupDead: true }

    // 403 = sem permissão neste grupo específico (bot removido) → definitivo
    if (res.status === 403) {
      console.error(
        `[group-handler] 403 no grupo ${groupJid} (bot removido?) — marcando inativo`,
      )
      return { groupDead: true }
    }

    // 401 = problema de token global → NÃO marcar grupo individualmente
    // (marcaria todos os grupos em massa quando token rotar)
    if (res.status === 401) {
      console.error(
        `[group-handler] 401 (token inválido/expirado) no grupo ${groupJid} — NÃO marcando inativo: provável problema global de auth, requer intervenção da infra`,
      )
      return { groupDead: false }
    }

    if (!res.ok)
      console.warn(`[group-handler] sendGroupMessage status ${res.status}`)
  } catch (e) {
    console.warn('[group-handler] falha ao enviar mensagem no grupo:', e)
  }
  return { groupDead: false }
}

// ─── Inserir tracking em leads_automacao_pendentes ────────────────────────────

async function upsertLeadTracking(
  supabase: ReturnType<typeof createClient>,
  automacaoConfigId: string | null,
  dados: LeadDados,
  tipoCapturaVal: string,
  capturadorPhone: string,
  capturadorNome: string,
  capturadorUserId: string | null,
  groupId: string,
  status: string = 'capturado',
  imagemPath: string | null = null,
): Promise<{ id: string | null; ref: string | null }> {
  if (!automacaoConfigId) return { id: null, ref: null }

  // Gera a referência curta #feira.lead (ex.: "2.1") de forma atômica
  let refNumero: string | null = null
  try {
    const { data: refData } = await supabase.rpc('proximo_ref_lead', {
      p_feira_id: automacaoConfigId,
    })
    refNumero = (refData as any) || null
  } catch (e: any) {
    console.warn('[group-handler] falha ao gerar ref_numero:', e.message)
  }

  try {
    const { data, error } = await supabase
      .from('leads_automacao_pendentes')
      .insert({
        automacao_config_id: automacaoConfigId,
        cnpj: dados.cnpj || null,
        razao_social: dados.empresa || dados.nome || null,
        telefone: dados.telefone || null,
        email: dados.email || null,
        dados_completos: dados as any,
        tipo_captura: tipoCapturaVal,
        capturador_phone: capturadorPhone,
        capturador_nome: capturadorNome,
        capturador_user_id: capturadorUserId,
        whatsapp_group_id: groupId,
        status,
        imagem_path: imagemPath,
        ref_numero: refNumero,
        encontrado_em: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      console.warn('[group-handler] falha ao inserir tracking:', error.message)
      return { id: null, ref: null }
    }
    return { id: data?.id || null, ref: refNumero }
  } catch (e: any) {
    console.warn('[group-handler] exceção ao inserir tracking:', e.message)
    return { id: null, ref: null }
  }
}

// ─── Vincular observação ao lead via #X.Y ────────────────────────────────────

async function tentarObservacaoPorRef(
  supabase: ReturnType<typeof createClient>,
  textoDigitado: string,
  textoCitado: string,
  capturadorNome: string,
  bitrixUrl: string,
  groupNome: string,
): Promise<boolean> {
  // Procura #X.Y primeiro no que o operador digitou, depois no texto citado
  const regex = /#?\b(\d+\.\d+)\b/
  const alvo =
    textoDigitado.match(regex)?.[1] || textoCitado.match(regex)?.[1] || null
  if (!alvo) return false

  const { data: lead } = await supabase
    .from('leads_automacao_pendentes')
    .select('id, dados_completos, bitrix_lead_id')
    .eq('ref_numero', alvo)
    .maybeSingle()
  if (!lead) return false

  const obsTexto = (textoDigitado || '').trim()
  if (!obsTexto) return false

  const dc = (lead.dados_completos as any) || {}
  const obsAnterior = (dc.observacoes || '').trim()
  dc.observacoes =
    (obsAnterior ? obsAnterior + '\n\n' : '') +
    `[Observação via grupo — ${capturadorNome}]: ${obsTexto}`
  await supabase
    .from('leads_automacao_pendentes')
    .update({ dados_completos: dc })
    .eq('id', (lead as any).id)
  console.log(`[group-handler] observação gravada no lead ref #${alvo}`)

  const bitrixLeadId = (lead as any).bitrix_lead_id
  if (bitrixLeadId) {
    await fetch(`${bitrixUrl}crm.timeline.comment.add.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          ENTITY_ID: parseInt(String(bitrixLeadId)),
          ENTITY_TYPE_ID: 1,
          COMMENT: `[b]Observação do executivo (via grupo ${groupNome}):[/b]\n${obsTexto}`,
        },
      }),
    }).catch((e) => console.warn('Falha ao adicionar comment Bitrix:', e))
    console.log(
      `[group-handler] observação adicionada ao Bitrix ${bitrixLeadId}`,
    )
  }
  return true
}

// ─── Atualizar tracking com resultado do Bitrix ───────────────────────────────

async function updateLeadTracking(
  supabase: ReturnType<typeof createClient>,
  leadPendenteId: string,
  bitrixLeadId: string,
  matchTipo: string,
): Promise<void> {
  await supabase
    .from('leads_automacao_pendentes')
    .update({
      bitrix_lead_id: bitrixLeadId,
      bitrix_match_tipo: matchTipo,
      status: 'capturado',
    })
    .eq('id', leadPendenteId)
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })

  // Guard de chamada interna — achado de auditoria de 22/07/2026: esta
  // function não tinha nenhuma checagem de auth e, se chamada anonimamente,
  // enviava mensagem real no WhatsApp / consumia OpenAI / criava lead no
  // Bitrix. Único chamador real é o whatsapp-webhook-router (edge function →
  // edge function) — só aceita Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) {
    console.error(
      '[group-handler] SUPABASE_SERVICE_ROLE_KEY não configurado — recusando execução.',
    )
    return new Response('Configuração interna ausente', { status: 500 })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) {
    return new Response('Token ausente', { status: 401 })
  }

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    console.error('[group-handler] Authorization inválido — chamada recusada.')
    return new Response('Acesso restrito a chamadas internas', { status: 403 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let payload: RoutePayload
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const {
    instance_id,
    conversation_id,
    message_db_id,
    message,
    group_id,
    contact_name,
    text,
    msg_type,
    quoted_message_id,
    quoted_text,
  } = payload

  try {
    // ── 1. Verificar se grupo está configurado ──────────────────────────────
    // Tolerante ao sufixo @g.us: o roteador entrega o id sem sufixo, mas
    // registros antigos podem ter sido gravados com "@g.us".
    const groupIdNoSuffix = (group_id || '').replace(/@g\.us$/, '')
    const { data: groupConfig } = await supabase
      .from('whatsapp_group_config')
      .select('id, nome, automacao_config_id, instance_id')
      .in('group_id', [groupIdNoSuffix, `${groupIdNoSuffix}@g.us`])
      .eq('ativo', true)
      .or(`instance_id.eq.${instance_id},instance_id.is.null`)
      .maybeSingle()

    if (!groupConfig) {
      console.log(
        `[group-handler] grupo ${group_id} não configurado — ignorado`,
      )
      return new Response('OK', { status: 200 })
    }

    // ── 2. Carregar dependências ────────────────────────────────────────────
    const [moduleConfigRes, instanceRes, openaiRes, bitrixUrl] =
      await Promise.all([
        supabase
          .from('whatsapp_module_config')
          .select('uazapi_base_url, uazapi_global_token')
          .eq('id', 1)
          .maybeSingle(),
        supabase
          .from('whatsapp_instances')
          .select('instance_key, instance_token')
          .eq('id', instance_id)
          .maybeSingle(),
        supabase
          .from('settings')
          .select('value')
          .eq('key', 'openai_config')
          .maybeSingle(),
        getBitrixWebhookUrl(supabase),
      ])

    const baseUrl =
      moduleConfigRes.data?.uazapi_base_url || 'https://api.uazapi.dev'
    const globalToken = moduleConfigRes.data?.uazapi_global_token || ''
    const instanceKey = instanceRes.data?.instance_key || ''
    const groupSendToken =
      (instanceRes.data as any)?.instance_token?.trim() || globalToken
    const openaiKey: string =
      (openaiRes.data?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    const groupJid = `${group_id}@g.us`

    // ── 3. Identificar capturador ───────────────────────────────────────────
    // Em grupos, o remetente está em message.key.participant (formato: 5527...@s.whatsapp.net)
    const rawSender: string =
      message?.key?.participant || message?.participant || ''
    const capturadorPhone = rawSender
      .replace('@s.whatsapp.net', '')
      .replace(/\D/g, '')
    const capturadorNome = contact_name || capturadorPhone || 'Desconhecido'

    // Lookup do user_id via celular_corporativo (best-effort)
    let capturadorUserId: string | null = null
    if (capturadorPhone) {
      const normalizedPhone = capturadorPhone
        .replace(/\D/g, '')
        .replace(/^55/, '')
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .ilike('celular_corporativo', `%${normalizedPhone.slice(-8)}%`)
        .maybeSingle()
      capturadorUserId = profile?.user_id || null
    }

    // ── 3b. Mídia que a uazapi não conseguiu descriptografar ───────────────
    // Chega como TEXTO começando com "[Undecryptable]". Não vira lead;
    // avisa o grupo para reenviar.
    if (msg_type === 'texto' && text.trim().startsWith('[Undecryptable]')) {
      console.warn(
        `[group-handler] mídia indecifrável de ${capturadorNome} — pedindo reenvio`,
      )
      if (globalToken && instanceKey) {
        const rU = await sendGroupMessage(
          baseUrl,
          groupSendToken,
          instanceKey,
          groupJid,
          `⚠️ Não consegui receber a mídia de *${capturadorNome}*. Por favor, tire uma foto nova e envie de novo (não encaminhe a anterior).`,
        )
        if (rU.groupDead) await markGroupDead(supabase, group_id)
      }
      return new Response('OK', { status: 200 })
    }

    // ── 3c. Texto sem letras nem números (emoji/reação) → ignorar ──────────
    if (msg_type === 'texto' && !/[\p{L}\p{N}]/u.test(text)) {
      return new Response('OK', { status: 200 })
    }

    // ── 4. Texto com referência #X.Y → observação no lead (digitado OU citado) ──
    if (msg_type === 'texto' && text.trim()) {
      const virouObservacao = await tentarObservacaoPorRef(
        supabase,
        text,
        quoted_text || '',
        capturadorNome,
        bitrixUrl,
        groupConfig.nome,
      )
      if (virouObservacao) {
        return new Response('OK', { status: 200 })
      }
      // se não achou ref, segue o fluxo normal (texto vira lead novo na seção 5c)
    }

    if (!openaiKey) {
      console.warn('[group-handler] OpenAI key não configurada')
      return new Response('OK', { status: 200 })
    }

    // ── 5. Determinar tipo de captura e extrair dados ──────────────────────
    let dados: LeadDados | null = null
    let tipoCapturaVal = 'texto'
    let imagemPathVal: string | null = null

    // ── 5a. IMAGEM: OCR via GPT-4o Vision ─────────────────────────────────
    if (msg_type === 'imagem' || message?.message?.imageMessage) {
      tipoCapturaVal = 'foto'
      // mediaBase64 do webhook é apenas thumbnail (~1KB); sempre baixa a imagem completa
      let imageBase64 = ''
      if (groupSendToken) {
        try {
          imageBase64 = await downloadMedia(
            baseUrl,
            groupSendToken,
            message.key.id,
          )
        } catch (e) {
          console.warn('[group-handler] falha ao baixar mídia:', e)
        }
      }
      if (!imageBase64) imageBase64 = message?.mediaBase64 || ''

      if (!imageBase64) {
        console.warn('[group-handler] sem base64 disponível para OCR')
        return new Response('OK', { status: 200 })
      }

      const caption =
        message?.message?.imageMessage?.caption || message?.caption || ''
      try {
        dados = await extractBusinessCard(imageBase64, caption, openaiKey)
        // B.1: guardar a imagem original (só foto; não derruba a captura se falhar)
        imagemPathVal = await uploadFeiraImagem(supabase, imageBase64)
      } catch (e: any) {
        console.error('[group-handler] OCR falhou:', e.message)
        if (globalToken && instanceKey) {
          const r1 = await sendGroupMessage(
            baseUrl,
            groupSendToken,
            instanceKey,
            groupJid,
            '⚠️ Não consegui ler o crachá. Tente uma foto mais nítida.',
          )
          if (r1.groupDead) await markGroupDead(supabase, group_id)
        }
        return new Response('OK', { status: 200 })
      }
    }

    // ── 5b. ÁUDIO: transcrever direto na uazapi (mensagens de grupo não têm
    //        registro em whatsapp_messages, então a edge transcribe-audio não serve) ──
    else if (msg_type === 'audio') {
      tipoCapturaVal = 'audio'
      try {
        const waMessageId: string = message?.key?.id || ''
        let transcription = ''
        if (waMessageId && groupSendToken) {
          transcription = await transcreverAudioUazapi(
            baseUrl,
            groupSendToken,
            waMessageId,
            openaiKey,
          )
        }

        if (!transcription) {
          console.warn(
            '[group-handler] transcrição falhou (uazapi sem retorno) msg=',
            waMessageId,
          )
          if (globalToken && instanceKey) {
            const r2 = await sendGroupMessage(
              baseUrl,
              groupSendToken,
              instanceKey,
              groupJid,
              '⚠️ Não consegui transcrever o áudio. Tente enviar como texto ou foto.',
            )
            if (r2.groupDead) await markGroupDead(supabase, group_id)
          }
          return new Response('OK', { status: 200 })
        }

        dados = await extractFromText(transcription, openaiKey)
        if (!dados.observacoes) dados.observacoes = transcription
      } catch (e: any) {
        console.error('[group-handler] erro no fluxo de áudio:', e.message)
        return new Response('OK', { status: 200 })
      }
    }

    // ── 5c. TEXTO sem ref conhecida → tenta virar lead novo ────────────────
    else if (msg_type === 'texto' && text.trim()) {
      tipoCapturaVal = 'texto'
      try {
        dados = await extractFromText(text, openaiKey)
      } catch (e: any) {
        console.error('[group-handler] erro na extração de texto:', e.message)
        return new Response('OK', { status: 200 })
      }
    }

    // Tipo de mensagem sem tratamento (sticker, documento, etc.)
    if (!dados) {
      return new Response('OK', { status: 200 })
    }

    // ── 6. Verificar completude — sem telefone vira rascunho_incompleto ────
    const temTelefone = !!(dados.telefone && dados.telefone.trim())

    if (!temTelefone) {
      const { id: leadPendenteId, ref: refLead } = await upsertLeadTracking(
        supabase,
        groupConfig.automacao_config_id,
        dados,
        tipoCapturaVal,
        capturadorPhone,
        capturadorNome,
        capturadorUserId,
        group_id,
        'rascunho_incompleto',
        imagemPathVal,
      )

      await supabase
        .from('whatsapp_messages')
        .update({
          processado: true,
          metadata: {
            lead_pendente_id: leadPendenteId,
            lead_dados: dados,
            tipo_captura: tipoCapturaVal,
            status: 'rascunho_incompleto',
          },
        })
        .eq('id', message_db_id)

      if (globalToken && instanceKey) {
        const tipoEmoji =
          tipoCapturaVal === 'foto'
            ? '📸'
            : tipoCapturaVal === 'audio'
              ? '🎙️'
              : '💬'
        const linhas = [
          `⚠️ Lead capturado mas INCOMPLETO ${tipoEmoji}`,
          '',
          dados.nome ? `👤 *${dados.nome}*` : '',
          dados.empresa ? `🏢 ${dados.empresa}` : '',
          dados.cargo ? `💼 ${dados.cargo}` : '',
          '',
          '_Sem telefone — Será necessário completar manualmente no LEADFINDER._',
          '',
          refLead
            ? `📌 Ref. #${refLead} — para anotar algo sobre este lead, responda esta mensagem ou cite #${refLead}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
        const r3 = await sendGroupMessage(
          baseUrl,
          groupSendToken,
          instanceKey,
          groupJid,
          linhas,
        )
        if (r3.groupDead) await markGroupDead(supabase, group_id)
      }

      console.log(
        `[group-handler] rascunho_incompleto criado: ${leadPendenteId} | capturador: ${capturadorNome}`,
      )
      return new Response('OK', { status: 200 })
    }

    // ── 7. Inserir tracking em leads_automacao_pendentes ───────────────────
    const { id: leadPendenteId, ref: refLead } = await upsertLeadTracking(
      supabase,
      groupConfig.automacao_config_id,
      dados,
      tipoCapturaVal,
      capturadorPhone,
      capturadorNome,
      capturadorUserId,
      group_id,
      undefined,
      imagemPathVal,
    )

    // ── 9. Deduplicação no Bitrix ──────────────────────────────────────────
    const existingLeadId = await findDuplicateLead(
      bitrixUrl,
      dados.telefone,
      dados.email,
    )
    let bitrixLeadId: string
    const matchTipo = existingLeadId ? 'lead_existente' : 'novo'

    if (existingLeadId) {
      bitrixLeadId = existingLeadId
      const captionObs =
        tipoCapturaVal === 'foto'
          ? message?.message?.imageMessage?.caption || ''
          : tipoCapturaVal === 'audio'
            ? '[via áudio]'
            : text
      await fetch(`${bitrixUrl}crm.timeline.comment.add.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            ENTITY_ID: parseInt(existingLeadId),
            ENTITY_TYPE_ID: 1,
            COMMENT: `[b]Contato reencontrado na ${groupConfig.nome}[/b] (via ${tipoCapturaVal})\n${captionObs ? `Obs: ${captionObs}` : ''}`,
          },
        }),
      }).catch(() => {})
    } else {
      // ── 10. Criar lead no Bitrix ───────────────────────────────────────
      const feiraCfg = await getFeiraBitrixConfig(supabase)
      bitrixLeadId = await createBitrixLead(
        bitrixUrl,
        dados,
        tipoCapturaVal === 'foto'
          ? message?.message?.imageMessage?.caption || message?.caption || ''
          : text,
        groupConfig.nome,
        capturadorNome,
        feiraCfg.stageId || undefined,
      )
    }

    // ── 11. Atualizar tracking com resultado do Bitrix ─────────────────────
    if (leadPendenteId) {
      await updateLeadTracking(
        supabase,
        leadPendenteId,
        bitrixLeadId,
        matchTipo,
      )
    }

    // ── 12. Vincular message_db_id ao lead ─────────────────────────────────
    await supabase
      .from('whatsapp_messages')
      .update({
        processado: true,
        metadata: {
          bitrix_lead_id: bitrixLeadId,
          lead_pendente_id: leadPendenteId,
          lead_duplicado: !!existingLeadId,
          lead_dados: dados,
          tipo_captura: tipoCapturaVal,
        },
      })
      .eq('id', message_db_id)

    // ── 13. Confirmação no grupo ───────────────────────────────────────────
    if (globalToken && instanceKey) {
      const tipoEmoji =
        tipoCapturaVal === 'foto'
          ? '📸'
          : tipoCapturaVal === 'audio'
            ? '🎙️'
            : '💬'
      const linhas = [
        existingLeadId
          ? `♻️ Lead já existia no Bitrix (ID ${bitrixLeadId}) — observação adicionada.`
          : `✅ Lead cadastrado no Bitrix (ID ${bitrixLeadId}) ${tipoEmoji}`,
        '',
        dados.nome ? `👤 *${dados.nome}*` : '',
        dados.empresa ? `🏢 ${dados.empresa}` : '',
        dados.cargo ? `💼 ${dados.cargo}` : '',
        dados.telefone ? `📱 ${dados.telefone}` : '',
        dados.email ? `📧 ${dados.email}` : '',
        '',
        '_Responda esta mensagem para adicionar observações ao lead._',
        '',
        refLead
          ? `📌 Ref. #${refLead} — para anotar algo sobre este lead, responda esta mensagem ou cite #${refLead}`
          : '',
      ]
        .filter((l) => l !== undefined)
        .join('\n')

      const r4 = await sendGroupMessage(
        baseUrl,
        groupSendToken,
        instanceKey,
        groupJid,
        linhas,
      )
      if (r4.groupDead) await markGroupDead(supabase, group_id)
    }

    console.log(
      `[group-handler] lead ${bitrixLeadId} (${matchTipo}) via ${tipoCapturaVal} — ${dados.nome || 'sem nome'} | capturador: ${capturadorNome}`,
    )
    return new Response('OK', { status: 200 })
  } catch (err: any) {
    console.error('[group-handler] erro:', err.message)
    return new Response('OK', { status: 200 })
  }
})
