import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { isPhoneSilenced } from '../_shared/silenceFilter.ts'
import { checkPhoneExclusion } from '../_shared/bitrix-exclusion.ts'
import { SYSTEM_GROUP_MARKER } from '../_shared/group-markers.ts'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface WaMessage {
  key: {
    remoteJid: string
    fromMe: boolean
    id: string
  }
  messageType: string
  message?: {
    conversation?: string
    extendedTextMessage?: { text: string }
    imageMessage?: { caption?: string; mimetype: string }
    documentMessage?: { caption?: string; fileName?: string }
    audioMessage?: Record<string, unknown>
    videoMessage?: { caption?: string }
    stickerMessage?: Record<string, unknown>
    buttonsResponseMessage?: {
      selectedButtonId?: string
      selectedDisplayText?: string
      type?: number
    }
    listResponseMessage?: {
      singleSelectReply?: { selectedRowId?: string }
      title?: string
    }
    templateButtonReplyMessage?: {
      selectedId?: string
      selectedDisplayText?: string
    }
  }
  messageTimestamp?: number
  pushName?: string
  contextInfo?: {
    stanzaId?: string
    quotedText?: string
    quotedMessage?: Record<string, unknown>
    participant?: string
  }
  mediaUrl?: string
  mediaBase64?: string
}

interface WaWebhookPayload {
  event: string
  instance: string
  data: Record<string, unknown>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isGroup(jid: string): boolean {
  return jid.endsWith('@g.us')
}

function cleanPhone(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '')
}

function extractText(msg: WaMessage): string {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.documentMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    ''
  )
}

function extractButtonId(msg: WaMessage): string | null {
  return (
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.templateButtonReplyMessage?.selectedId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  )
}

function extractButtonText(msg: WaMessage): string | null {
  return (
    msg.message?.buttonsResponseMessage?.selectedDisplayText ||
    msg.message?.templateButtonReplyMessage?.selectedDisplayText ||
    msg.message?.listResponseMessage?.title ||
    null
  )
}

function extractMsgType(msg: WaMessage): string {
  if (msg.message?.buttonsResponseMessage) return 'button_response'
  if (msg.message?.templateButtonReplyMessage) return 'button_response'
  if (msg.message?.listResponseMessage) return 'list_response'
  if (msg.messageType) return msg.messageType
  if (msg.message?.conversation || msg.message?.extendedTextMessage)
    return 'texto'
  if (msg.message?.imageMessage) return 'imagem'
  if (msg.message?.documentMessage) return 'documento'
  if (msg.message?.audioMessage) return 'audio'
  if (msg.message?.videoMessage) return 'video'
  if (msg.message?.stickerMessage) return 'sticker'
  return 'texto'
}

// ─── Verificação de segurança ─────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get('WHATSAPP_WEBHOOK_SECRET') || ''
  if (!secret) return true
  const url = new URL(req.url)
  return url.searchParams.get('secret') === secret
}

// ─── Sub-handlers (invocados de forma assíncrona) ─────────────────────────────

async function invokeSubHandler(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.warn(`Sub-handler ${functionName} falhou:`, err)
  }
}

// ─── Buscar ou criar conversa ─────────────────────────────────────────────────

async function upsertConversation(
  supabase: ReturnType<typeof createClient>,
  instanceId: string,
  phone: string,
  contactName: string,
  automacaoConfigId: string | null,
): Promise<{ id: string; estado: string; bot_ativo: boolean; isNew: boolean }> {
  const { data: existing } = await supabase
    .from('whatsapp_conversations')
    .select('id, estado, bot_ativo')
    .eq('instance_id', instanceId)
    .eq('phone', phone)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('whatsapp_conversations')
      .update({
        contact_name: contactName,
        ultimo_contato: new Date().toISOString(),
      })
      .eq('id', existing.id)
    return { ...existing, isNew: false }
  }

  const { data: created, error } = await supabase
    .from('whatsapp_conversations')
    .insert({
      instance_id: instanceId,
      phone,
      contact_name: contactName,
      estado: 'INICIO',
      bot_ativo: true,
      automacao_config_id: automacaoConfigId,
      ultimo_contato: new Date().toISOString(),
    })
    .select('id, estado, bot_ativo')
    .single()

  if (error) throw error
  return { ...created, isNew: true }
}

// ─── Helper: normalizar message_id removendo prefixo do uazapi ──────────────
// O uazapi às vezes manda IDs no formato "<phone>:<id>" no echo de mensagens
// enviadas. Stripa o prefixo para que o onConflict('message_id') deduplique
// corretamente quando whatsapp-send-message já inseriu a mensagem.
function normalizeMessageId(rawId: string | null | undefined): string {
  if (!rawId) return ''
  const colonIdx = rawId.lastIndexOf(':')
  // Stripar só se o que vem depois do ':' parece um ID válido (>= 16 chars)
  if (colonIdx > 0 && rawId.length - colonIdx - 1 >= 16) {
    return rawId.slice(colonIdx + 1)
  }
  return rawId
}

// ─── Salvar mensagem ──────────────────────────────────────────────────────────

async function saveMessage(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  msg: WaMessage,
  direcao: 'recebida' | 'enviada',
): Promise<string> {
  const tipo = extractMsgType(msg)
  const conteudo = extractText(msg)
  const quotedId = normalizeMessageId(msg.contextInfo?.stanzaId || '') || null
  const mediaUrl = msg.mediaUrl || null
  const mediaMimetype =
    msg.message?.imageMessage?.mimetype ||
    msg.message?.audioMessage?.mimetype ||
    msg.message?.documentMessage?.mimetype ||
    msg.message?.videoMessage?.mimetype ||
    msg.message?.stickerMessage?.mimetype ||
    null

  // Normalizar tipo para os valores aceitos pelo banco
  const tipoNormalizado = [
    'texto',
    'imagem',
    'documento',
    'audio',
    'video',
    'sticker',
  ].includes(tipo)
    ? tipo
    : 'texto'

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .upsert(
      {
        conversation_id: conversationId,
        message_id: normalizeMessageId(msg.key.id),
        quoted_message_id: quotedId,
        direcao,
        tipo: tipoNormalizado,
        conteudo: conteudo || null,
        caption:
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          null,
        media_url: mediaUrl,
        media_mimetype: mediaMimetype,
        processado: false,
      },
      { onConflict: 'message_id' },
    )
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

// ─── Handler de connection event ──────────────────────────────────────────────

async function handleConnectionEvent(
  supabase: ReturnType<typeof createClient>,
  instanceKey: string,
  data: Record<string, unknown>,
): Promise<void> {
  const rawState =
    (data.state as string) ||
    (data.instance as any)?.status ||
    (data.status as any)?.state ||
    ''

  const connected = rawState === 'open' || rawState === 'connected'

  const jid = (data.status as any)?.jid || ''
  const phone =
    (data.phoneNumber as string) || (jid ? jid.split('@')[0] : '') || ''

  const updates: Record<string, unknown> = {
    status: connected ? 'conectado' : 'desconectado',
    ultimo_ping: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }
  if (connected && phone) updates.numero = phone

  await supabase
    .from('whatsapp_instances')
    .update(updates)
    .eq('instance_key', instanceKey)
}

// ─── Normalizar mensagens do payload ─────────────────────────────────────────

function extractMessages(data: Record<string, unknown>): WaMessage[] {
  if (Array.isArray(data.messages)) return data.messages as WaMessage[]
  if (data.key) return [data as unknown as WaMessage]
  return []
}

// ─── Detectar se messages_update é deleção ou edição ────────────────────────

function detectIsDelete(msg: WaMessage): boolean {
  // Cenário 1: uazapi marca status="Deleted" explicitamente
  if ((msg as any).status === 'Deleted') return true

  // Cenário 2: payload tem protocolMessage com type REVOKE
  const proto = (msg.message as any)?.protocolMessage
  if (proto?.type === 0 || proto?.type === 'REVOKE') return true

  // Cenário 3: payload de update sem conteúdo de texto E sem campo edited
  const hasEditedField =
    !!(msg.message as any)?.editedMessage || !!(msg as any).edited
  const hasText = !!extractText(msg)
  if (!hasEditedField && !hasText) return true

  return false
}

// ─── Adaptador uazapi v2 → WaMessage legacy ──────────────────────────────────
//
// A uazapi v2 manda payload com formato proprietário diferente do Baileys clássico:
//   - EventType (string) em vez de event
//   - instanceName em vez de instance
//   - message.chatid direto (não message.key.remoteJid)
//   - message.fromMe direto (não message.key.fromMe)
//   - message.messageid direto (não message.key.id)
//   - message.text/content direto (não message.message.conversation)
//   - messageTimestamp em MILISSEGUNDOS (não segundos)
//
// Esta função converte payload v2 → estrutura WaMessage legacy que o resto do
// código já entende. Retorna null se o payload não é v2.

function isV2Payload(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.EventType === 'string' &&
    raw.message !== undefined &&
    typeof (raw.message as any).chatid === 'string'
  )
}

function adaptarMensagemV2(raw: Record<string, unknown>): WaMessage | null {
  const m = raw.message as any
  if (!m || !m.chatid) return null

  // R7: uazapi v2 manda messageType em PascalCase ("ImageMessage", "AudioMessage",
  // "Conversation"). Normalizamos pra camelCase pra bater com os cases do switch
  // (que seguem padrão Baileys). Fallback pra m.type ou 'Conversation'.
  const v2TypeRaw: string = m.messageType || m.type || 'Conversation'
  const v2Type: string = v2TypeRaw.charAt(0).toLowerCase() + v2TypeRaw.slice(1)

  // R7: uazapi v2 manda m.content de 3 formas diferentes:
  //   - String pura: mensagem de texto (Conversation)
  //   - Objeto com {text, contextInfo}: extendedTextMessage
  //   - Objeto com {URL, mimetype, caption, fileSHA256, ...}: mídia (image/audio/doc/video)
  // Antes, o código procurava metadados em m.text (parse JSON). Agora lê de m.content direto.
  let contentObj: Record<string, any> | null = null
  let contentText: string = ''
  if (typeof m.content === 'string') {
    contentText = m.content
  } else if (m.content && typeof m.content === 'object') {
    contentObj = m.content as Record<string, any>
    contentText = contentObj.caption || contentObj.text || ''
  }
  // Compat: se vier no formato antigo (m.text com JSON), ainda aceita
  if (
    !contentObj &&
    m.text &&
    typeof m.text === 'string' &&
    m.text.trim().startsWith('{')
  ) {
    try {
      contentObj = JSON.parse(m.text)
    } catch {}
  }
  if (
    !contentText &&
    typeof m.text === 'string' &&
    !m.text.trim().startsWith('{')
  ) {
    contentText = m.text
  }

  const mediaUrl: string =
    contentObj?.URL || contentObj?.url || m.mediaUrl || ''
  const mediaMime: string = contentObj?.mimetype || m.mimetype || ''
  const mediaFileName: string =
    contentObj?.fileName || contentObj?.filename || m.fileName || ''
  const thumbnail: string = contentObj?.JPEGThumbnail || ''

  // Constrói message no formato Baileys conforme o tipo (camelCase normalizado)
  let messageNode: any = {}
  switch (v2Type) {
    case 'conversation':
      messageNode = { conversation: contentText }
      break
    case 'extendedTextMessage':
      messageNode = { extendedTextMessage: { text: contentText } }
      break
    case 'imageMessage':
      messageNode = {
        imageMessage: {
          caption: contentText || undefined,
          mimetype: mediaMime || 'image/jpeg',
          url: mediaUrl || undefined,
        },
      }
      break
    case 'documentMessage':
      messageNode = {
        documentMessage: {
          caption: contentText || undefined,
          fileName: mediaFileName,
          mimetype: mediaMime || 'application/octet-stream',
          url: mediaUrl || undefined,
        },
      }
      break
    case 'audioMessage':
      messageNode = {
        audioMessage: {
          mimetype: mediaMime || 'audio/ogg',
          url: mediaUrl || undefined,
        },
      }
      break
    case 'videoMessage':
      messageNode = {
        videoMessage: {
          caption: contentText || undefined,
          mimetype: mediaMime || 'video/mp4',
          url: mediaUrl || undefined,
        },
      }
      break
    case 'stickerMessage':
      messageNode = {
        stickerMessage: {
          mimetype: mediaMime || 'image/webp',
          url: mediaUrl || undefined,
        },
      }
      break
    default:
      // Fallback: se tem texto legível, trata como conversation
      messageNode = contentText ? { conversation: contentText } : {}
  }

  // Mapeia v2Type → string equivalente do messageType legacy (já normalizado pra camelCase)
  const messageTypeStr: string =
    v2Type === 'conversation'
      ? 'conversation'
      : v2Type === 'extendedTextMessage'
        ? 'extendedTextMessage'
        : v2Type === 'imageMessage'
          ? 'imageMessage'
          : v2Type === 'documentMessage'
            ? 'documentMessage'
            : v2Type === 'audioMessage'
              ? 'audioMessage'
              : v2Type === 'videoMessage'
                ? 'videoMessage'
                : v2Type === 'stickerMessage'
                  ? 'stickerMessage'
                  : 'conversation'

  // Timestamp v2 vem em ms; legacy espera segundos
  const tsMs: number =
    typeof m.messageTimestamp === 'number' ? m.messageTimestamp : Date.now()
  const tsSec: number = Math.floor(tsMs / 1000)

  return {
    key: {
      remoteJid: String(m.chatid),
      fromMe: m.fromMe === true,
      id: String(m.messageid || ''),
    },
    messageType: '',
    message: messageNode,
    messageTimestamp: tsSec,
    pushName: m.senderName || '',
    contextInfo: m.quoted
      ? {
          stanzaId: normalizeMessageId(String(m.quoted)),
          quotedText: String(
            (contentObj as any)?.contextInfo?.quotedMessage?.conversation ||
              (contentObj as any)?.contextInfo?.quotedMessage
                ?.extendedTextMessage?.text ||
              (contentObj as any)?.contextInfo?.quotedMessage?.imageMessage
                ?.caption ||
              '',
          ),
        }
      : undefined,
    mediaUrl: mediaUrl || undefined,
    mediaBase64: m.mediaBase64 || thumbnail || undefined,
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let payload: WaWebhookPayload & Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  // ─── Detectar formato (uazapi v2 vs legacy v1/Baileys) ──────────────
  const raw = payload as Record<string, unknown>
  const v2 = isV2Payload(raw)

  // Extrair event: v2 usa EventType (string); legacy usa event (string ou objeto)
  let event: string
  if (v2) {
    event = String(raw.EventType || '')
  } else {
    const rawEvent = raw.event
    event =
      typeof rawEvent === 'string'
        ? rawEvent
        : typeof raw.EventType === 'string'
          ? raw.EventType
          : ''
  }

  // Extrair instanceKey: v2 usa instanceName; legacy usa instance/instance_key/sender
  const instanceKey: string = String(
    (v2
      ? raw.instanceName
      : raw.instance || raw.instance_key || raw.instanceName || raw.sender) ||
      '',
  )

  // Construir data: v2 adapta message → WaMessage legacy; legacy usa data direto
  let data: Record<string, unknown>
  if (v2) {
    const adapted = adaptarMensagemV2(raw)
    if (adapted) {
      data = { messages: [adapted] } as unknown as Record<string, unknown>
    } else {
      // v2 mas sem message válida (provavelmente connection event)
      data = (raw.message as Record<string, unknown>) || raw
    }
  } else {
    data = (raw.data as Record<string, unknown>) || {}
  }

  console.log(
    `[webhook-router] formato=${v2 ? 'v2' : 'legacy'} evento=${event} instância=${instanceKey}`,
  )
  if (v2 && raw.message) {
    const m = raw.message as any
    console.log(
      `[webhook-router] v2 message: chatid=${m.chatid} fromMe=${m.fromMe} type=${m.messageType} text="${String(m.text || m.content || '').slice(0, 80)}"`,
    )
  }

  try {
    // ── 1. Buscar instância no banco (por key ou nome) ──────────────────────
    const keyTrimmed = instanceKey?.trim() || ''
    let { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id, tipo, ativo, instance_token')
      .eq('instance_key', keyTrimmed)
      .eq('ativo', true)
      .maybeSingle()

    if (!instance) {
      // Fallback: buscar pelo nome (uazapi pode enviar o nome da instância)
      const { data: byName } = await supabase
        .from('whatsapp_instances')
        .select('id, tipo, ativo, instance_token')
        .ilike('nome', keyTrimmed)
        .eq('ativo', true)
        .maybeSingle()
      instance = byName
    }

    if (!instance) {
      console.warn(`[webhook-router] instância desconhecida: ${instanceKey}`)
      return new Response('OK', { status: 200 })
    }

    // ── 2. Evento de conexão ────────────────────────────────────────────────
    if (event === 'connection' || event === 'connection.update') {
      // Em v2, o payload da conexão vem direto no raw (state, jid, owner)
      const connData = v2 ? raw : data
      await handleConnectionEvent(supabase, instanceKey, connData)
      return new Response('OK', { status: 200 })
    }

    // ── 3. Evento de histórico (via /message/history-sync) ─────────────────
    if (event === 'history' || event === 'history.sync') {
      const messages = extractMessages(data)
      const typeMap: Record<string, string> = {
        conversation: 'texto',
        extendedTextMessage: 'texto',
        imageMessage: 'imagem',
        documentMessage: 'documento',
        audioMessage: 'audio',
        videoMessage: 'video',
        stickerMessage: 'sticker',
      }

      for (const msg of messages) {
        const jid: string = msg.key?.remoteJid || ''
        if (!jid || jid === 'status@broadcast' || isGroup(jid)) continue

        const phone = cleanPhone(jid)
        const contactName = msg.pushName || phone

        const conversation = await upsertConversation(
          supabase,
          instance.id,
          phone,
          contactName,
          null,
        )

        const rawType = extractMsgType(msg)
        const tipo =
          typeMap[rawType] ||
          ([
            'texto',
            'imagem',
            'documento',
            'audio',
            'video',
            'sticker',
          ].includes(rawType)
            ? rawType
            : 'texto')

        await supabase.from('whatsapp_messages').upsert(
          {
            conversation_id: conversation.id,
            message_id: normalizeMessageId(msg.key.id),
            direcao: msg.key.fromMe ? 'enviada' : 'recebida',
            tipo,
            conteudo: extractText(msg) || null,
            processado: true,
            ...(msg.messageTimestamp
              ? {
                  criado_em: new Date(
                    msg.messageTimestamp * 1000,
                  ).toISOString(),
                }
              : {}),
          },
          { onConflict: 'message_id' },
        )
      }

      console.log(
        `[webhook-router] history sync: ${messages.length} mensagens processadas`,
      )
      return new Response('OK', { status: 200 })
    }

    // ── 4. Evento de mensagem ───────────────────────────────────────────────
    if (event === 'messages' || event === 'messages.upsert') {
      const messages = extractMessages(data)

      for (const msg of messages) {
        const jid: string = msg.key?.remoteJid || ''
        if (!jid || jid === 'status@broadcast') continue

        const fromMe: boolean = msg.key.fromMe === true
        const phone = cleanPhone(jid)
        const contactName = msg.pushName || phone
        const isGroupMsg = isGroup(jid)

        // ── R6.A: Filtro de silenciamento ────────────────────────────────────
        // 1:1 → silencia se phone individual está em whatsapp_silenced_phones
        // Grupos → silencia se jid completo (com @g.us) está silenciado
        // Por enquanto, silenciamento de grupo é redundante para mensagens que
        // iriam virar conversa (porque grupos não criam mais conversa), mas é
        // necessário para que o whatsapp-group-handler decida não processar
        // grupos configurados quando o usuário silenciar.
        if (!fromMe) {
          const silenceKey = isGroupMsg ? jid : phone
          const silenced = await isPhoneSilenced(
            supabase,
            instance.id,
            silenceKey,
          )
          if (silenced) {
            console.log(
              `[router] mensagem descartada: ${isGroupMsg ? 'grupo' : 'phone'} ${silenceKey} silenciado em instance ${instance.id}`,
            )
            continue
          }
        }

        // ── R6.A: Grupos NÃO criam conversa em whatsapp_conversations nem ────
        // mensagem em whatsapp_messages. O encaminhamento pro group-handler
        // continua acontecendo abaixo — ele decide se processa o grupo baseado
        // em whatsapp_group_config (grupos configurados pra Feiras, etc).
        let conversation: {
          id: string
          isNew: boolean
          estado: string
          bot_ativo: boolean
        } | null = null
        let messageDbId: string | null = null

        if (!isGroupMsg) {
          conversation = await upsertConversation(
            supabase,
            instance.id,
            phone,
            contactName,
            null,
          )

          // Fire-and-forget: busca Bitrix automática para conversas novas de
          // contatos individuais. Não usa await na chamada em si — não
          // bloqueia o webhook — mas a checagem de exclusão (N-20) abaixo é
          // aguardada, porque decide SE a chamada acontece.
          if (conversation.isNew && !fromMe) {
            // ── Telefone excluído do fluxo Bitrix (N-20) ────────────────────
            // Assimetria de erro declarada: se a consulta de exclusão falhar
            // (rede/DB), a busca de candidatos SEGUE normalmente (fail-open)
            // — mesmo padrão de isPhoneSilenced/silenceFilter.ts usado logo
            // acima neste arquivo. Só o telefone confirmadamente excluído
            // (status 'excluded') suprime a chamada; erro de consulta não é
            // tratado como exclusão.
            const exclusion = await checkPhoneExclusion(supabase, phone)
            if (exclusion.status === 'error') {
              console.warn(
                '[router] checagem de exclusão falhou, seguindo com busca bitrix (fail-open):',
                exclusion.message,
              )
            }
            if (exclusion.status !== 'excluded') {
              fetch(`${supabaseUrl}/functions/v1/bitrix-search-by-phone`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({
                  conversation_id: conversation.id,
                  phone,
                }),
              }).catch((err) =>
                console.error('[router] busca bitrix falhou:', err.message),
              )
            } else {
              console.log(
                `[router] busca bitrix suprimida: telefone excluído (EXCLUIDO_CRM)`,
              )
            }
          }

          messageDbId = await saveMessage(
            supabase,
            conversation.id,
            msg,
            fromMe ? 'enviada' : 'recebida',
          )

          // R12-A: disparar transcrição automática para todo áudio (recebido e enviado)
          if (messageDbId && extractMsgType(msg) === 'audio') {
            invokeSubHandler(supabaseUrl, serviceRoleKey, 'transcribe-audio', {
              message_id: messageDbId,
            }).catch((e) =>
              console.warn('[router] transcribe-audio falhou:', e?.message),
            )
          }

          // R12-B: adicionar mensagem ao batch do Bitrix (recebida E enviada).
          // add-message-to-batch checa internamente se conversa tem Bitrix vinculado.
          if (messageDbId && conversation?.id) {
            invokeSubHandler(
              supabaseUrl,
              serviceRoleKey,
              'add-message-to-batch',
              {
                conversation_id: conversation.id,
                message_db_id: messageDbId,
                msg_type: extractMsgType(msg),
              },
            ).catch((e) =>
              console.warn('[router] add-message-to-batch falhou:', e?.message),
            )
          }
        }

        // Eco do sistema em grupo: filtrar ANTES de gravar.
        // O check da ~750 só impede o sub-handler; a gravação (706/722) já teria acontecido.
        if (fromMe && isGroupMsg) {
          const _corpoEco = (extractText(msg) || '').trimStart()
          if (_corpoEco.startsWith(SYSTEM_GROUP_MARKER)) continue
        }

        // ── R-GRUPOS: Salvar mensagem de grupo em whatsapp_group_messages ────
        if (isGroupMsg) {
          const groupJid = jid
          const senderJid: string = (msg.key as any).participant || groupJid
          const senderName: string = msg.pushName || ''
          const msgText = extractText(msg)
          const rawType = extractMsgType(msg)
          const tipoNorm = [
            'texto',
            'imagem',
            'documento',
            'audio',
            'video',
            'sticker',
          ].includes(rawType)
            ? rawType
            : 'texto'
          const mediaUrl: string | null =
            msg.mediaUrl ||
            (msg.message as any)?.imageMessage?.url ||
            (msg.message as any)?.audioMessage?.url ||
            (msg.message as any)?.documentMessage?.url ||
            (msg.message as any)?.videoMessage?.url ||
            null
          const mediaMimetype: string | null =
            msg.message?.imageMessage?.mimetype ||
            (msg.message as any)?.audioMessage?.mimetype ||
            (msg.message as any)?.documentMessage?.mimetype ||
            (msg.message as any)?.videoMessage?.mimetype ||
            (msg.message as any)?.stickerMessage?.mimetype ||
            null

          // ── Verificar se grupo já existe pra decidir se busca nome ──────────
          const { data: grupoExistente } = await supabase
            .from('whatsapp_groups')
            .select('id, nome')
            .eq('instance_id', instance.id)
            .eq('group_jid', groupJid)
            .maybeSingle()

          const jidFallback = groupJid.split('@')[0]
          let nomeGrupo: string = grupoExistente?.nome || ''

          // Busca nome real se grupo é novo OU nome ainda é fallback/vazio
          if (
            !grupoExistente ||
            nomeGrupo === '' ||
            nomeGrupo === jidFallback
          ) {
            try {
              const cfgRes = await supabase
                .from('whatsapp_module_config')
                .select('uazapi_base_url')
                .eq('id', 1)
                .maybeSingle()
              const baseUrl = (
                cfgRes.data?.uazapi_base_url || 'https://zionlogtec.uazapi.com'
              ).replace(/\/$/, '')
              const instanceToken: string =
                (instance as any).instance_token || ''

              if (instanceToken) {
                const resp = await fetch(`${baseUrl}/group/info`, {
                  method: 'POST',
                  headers: {
                    token: instanceToken,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ groupjid: groupJid }),
                })
                if (resp.ok) {
                  const info = (await resp.json()) as {
                    Name?: string
                    subject?: string
                  }
                  const nomeBuscado = info.Name || info.subject || ''
                  if (nomeBuscado) {
                    nomeGrupo = nomeBuscado
                    console.log(
                      `[router/grupo] nome buscado na uazapi: ${nomeGrupo}`,
                    )
                  }
                } else {
                  console.warn(
                    '[router/grupo] /group/info falhou:',
                    resp.status,
                  )
                }
              }
            } catch (e) {
              console.warn('[router/grupo] erro buscando nome do grupo:', e)
            }
          }

          const { data: groupRow, error: grpErr } = await supabase
            .from('whatsapp_groups')
            .upsert(
              {
                instance_id: instance.id,
                group_jid: groupJid,
                nome: nomeGrupo || jidFallback,
                ultimo_contato: new Date().toISOString(),
                ultima_mensagem: (msgText || `[${tipoNorm}]`).slice(0, 80),
                atualizado_em: new Date().toISOString(),
              },
              { onConflict: 'instance_id,group_jid' },
            )
            .select('id, silenciado')
            .maybeSingle()

          if (!groupRow) {
            console.warn('[router/grupo] upsert grupo falhou:', grpErr?.message)
          } else if (!groupRow.silenciado) {
            supabase
              .from('whatsapp_group_messages')
              .insert({
                group_id: groupRow.id,
                message_id: normalizeMessageId(msg.key.id),
                sender_jid: senderJid,
                sender_name: senderName,
                direcao: fromMe ? 'enviada' : 'recebida',
                tipo: tipoNorm,
                conteudo: msgText || null,
                media_url: mediaUrl,
                media_mimetype: mediaMimetype,
              })
              .then(({ error }) => {
                if (error && !error.message?.includes('duplicate')) {
                  console.warn(
                    '[router/grupo] insert mensagem falhou:',
                    error.message,
                  )
                }
              })
          }
        }

        // 1-a-1: pula sempre que for do próprio número (anti-loop do bot).
        // Grupo: pula APENAS se foi o próprio sistema que enviou (prefixo marcador).
        // Mensagens fromMe digitadas por humanos no grupo (operador usando o número
        // do sistema na feira) passam normalmente para captura.
        if (fromMe) {
          if (!isGroupMsg) continue
          const corpoFromMe = (extractText(msg) || '').trimStart()
          if (corpoFromMe.startsWith(SYSTEM_GROUP_MARKER)) continue
        }

        const routePayload = {
          instance_id: instance.id,
          instance_tipo: instance.tipo,
          conversation_id: conversation?.id || '',
          conversation_estado: conversation?.estado || 'INICIO',
          bot_ativo: conversation?.bot_ativo ?? true,
          message_db_id: messageDbId || '',
          message: msg,
          phone,
          contact_name: contactName,
          is_group: isGroupMsg,
          group_id: isGroupMsg ? phone : null,
          text: extractText(msg),
          msg_type: extractMsgType(msg),
          button_id: extractButtonId(msg),
          button_text: extractButtonText(msg),
          quoted_message_id:
            normalizeMessageId(msg.contextInfo?.stanzaId || '') || null,
          quoted_text: msg.contextInfo?.quotedText || '',
        }

        // Sub-handlers são fire-and-forget: usam EdgeRuntime.waitUntil internamente
        // para processar em background. Router não espera para não estourar wall clock.
        const subHandlerName = isGroupMsg
          ? 'whatsapp-group-handler'
          : instance.tipo === 'executivo'
            ? 'whatsapp-executive-handler'
            : 'whatsapp-bot-handler'

        invokeSubHandler(
          supabaseUrl,
          serviceRoleKey,
          subHandlerName,
          routePayload,
        ).catch((e) =>
          console.warn(
            `[router] sub-handler ${subHandlerName} falhou:`,
            e?.message,
          ),
        )
      }
    }

    // ── 5. Evento de update de mensagem (edição ou deleção pelo cliente) ────
    if (event === 'messages_update' || event === 'messages.update') {
      // Log defensivo do payload bruto na primeira recepção
      console.log(
        '[webhook-router] messages_update payload bruto:',
        JSON.stringify(data).slice(0, 2000),
      )

      const updates = extractMessages(data)

      for (const upd of updates) {
        const messageIdWa: string = upd.key?.id || ''
        if (!messageIdWa) {
          console.warn('[router/update] sem key.id, ignorando')
          continue
        }

        // Buscar mensagem correspondente no banco pelo message_id (WhatsApp ID)
        const { data: msgRows, error: findErr } = await supabase
          .from('whatsapp_messages')
          .select(
            'id, conversation_id, conteudo, direcao, texto_original, apagado_em, tipo',
          )
          .eq('message_id', messageIdWa)
          .limit(1)

        if (findErr || !msgRows || msgRows.length === 0) {
          console.warn(
            `[router/update] mensagem ${messageIdWa} não encontrada localmente, ignorando`,
          )
          continue
        }

        const msgLocal = msgRows[0]

        // Se já está apagada, ignora (evita reprocessar update do mesmo delete)
        if (msgLocal.apagado_em) {
          console.log(
            `[router/update] mensagem ${messageIdWa} já apagada, ignorando update`,
          )
          continue
        }

        // Só processa updates de mensagens RECEBIDAS (cliente).
        // Updates de mensagens 'enviada' são echo dos nossos próprios edits via R9-A
        // (ou seriam, se uazapi não tivesse o filtro wasSentByApi — proteção dupla)
        if (msgLocal.direcao !== 'recebida') {
          console.log(
            `[router/update] mensagem ${messageIdWa} não é 'recebida', ignorando`,
          )
          continue
        }

        // ── Detectar se é edição ou deleção ──────────────────────────────
        const isDelete = detectIsDelete(upd)
        const novoTexto = isDelete ? null : extractText(upd)

        if (isDelete) {
          // ─── DELETE: marca apagado, NÃO reanalisa IA ────────────────
          const { error: updErr } = await supabase
            .from('whatsapp_messages')
            .update({
              apagado_em: new Date().toISOString(),
              apagado_modo: 'todos',
            })
            .eq('id', msgLocal.id)

          if (updErr) {
            console.error(
              `[router/update] erro ao marcar apagada ${messageIdWa}:`,
              updErr.message,
            )
            continue
          }
          console.log(
            `[router/update] mensagem ${messageIdWa} marcada como apagada pelo cliente`,
          )
          // NÃO invoca executive-handler — IA ignora deletes
          continue
        }

        // ─── EDIT: atualiza texto, preserva original, dispara reanálise ─
        if (!novoTexto || novoTexto === msgLocal.conteudo) {
          console.log(
            `[router/update] mensagem ${messageIdWa} sem mudança de texto, ignorando`,
          )
          continue
        }

        const { error: updErr } = await supabase
          .from('whatsapp_messages')
          .update({
            conteudo: novoTexto,
            texto_original: msgLocal.texto_original ?? msgLocal.conteudo,
            editado_em: new Date().toISOString(),
          })
          .eq('id', msgLocal.id)

        if (updErr) {
          console.error(
            `[router/update] erro ao atualizar texto ${messageIdWa}:`,
            updErr.message,
          )
          continue
        }
        console.log(
          `[router/update] mensagem ${messageIdWa} editada pelo cliente; texto novo aplicado`,
        )

        // ─── Reanalise IA (somente instâncias 'executivo', não grupo) ──
        if (instance.tipo !== 'executivo') continue
        if (msgLocal.tipo !== 'texto') continue // não reanalisa imagem/áudio editados

        // Buscar dados da conversa pra montar payload
        const { data: convData } = await supabase
          .from('whatsapp_conversations')
          .select('id, estado, bot_ativo, contact_phone, contact_name')
          .eq('id', msgLocal.conversation_id)
          .single()

        if (!convData) {
          console.warn(
            `[router/update] conversa ${msgLocal.conversation_id} não encontrada, sem reanalise`,
          )
          continue
        }

        // Monta payload idêntico ao do handler de mensagem normal
        const reanalisePayload = {
          instance_id: instance.id,
          instance_tipo: instance.tipo,
          conversation_id: convData.id,
          conversation_estado: convData.estado || 'INICIO',
          bot_ativo: convData.bot_ativo ?? true,
          message_db_id: msgLocal.id,
          message: upd,
          phone: convData.contact_phone,
          contact_name: convData.contact_name || convData.contact_phone,
          is_group: false,
          group_id: null,
          text: novoTexto,
          msg_type: 'texto',
          button_id: null,
          button_text: null,
          quoted_message_id: null,
          is_reanalysis: true,
        }

        invokeSubHandler(
          supabaseUrl,
          serviceRoleKey,
          'whatsapp-executive-handler',
          reanalisePayload,
        ).catch((e) =>
          console.warn(
            `[router/update] reanalise executive-handler falhou:`,
            e?.message,
          ),
        )
      }

      return new Response('OK', { status: 200 })
    }

    return new Response('OK', { status: 200 })
  } catch (err: any) {
    console.error('[webhook-router] erro:', err.message)
    return new Response('Internal Server Error', { status: 500 })
  }
})
