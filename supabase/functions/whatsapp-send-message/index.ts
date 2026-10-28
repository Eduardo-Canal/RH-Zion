// Edge: whatsapp-send-message
// Envia mensagem (texto ou mídia) via uazapi e registra em whatsapp_messages
// Recebe:
//   - { conversation_id, type: 'texto', text: string }
//   - { conversation_id, type: 'imagem'|'documento', media_url: string, caption?: string, file_name?: string }

import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import {
  formatarComentarioTimeline,
  postarTimelineHibrido,
} from '../_shared/bitrix-timeline.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function normalizeMessageId(rawId: string): string {
  const colonIdx = rawId.lastIndexOf(':')
  if (colonIdx > 0 && rawId.length - colonIdx - 1 >= 16) {
    return rawId.slice(colonIdx + 1)
  }
  return rawId
}

const jsonResp = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

interface ReqBody {
  conversation_id?: string
  type?: 'texto' | 'imagem' | 'documento'
  text?: string
  media_url?: string
  media_base64?: string
  media_mime_type?: string
  caption?: string
  file_name?: string
}

// Baixa um arquivo de uma URL e retorna como base64 (sem prefixo data:image/...)
async function fetchFileAsBase64(
  url: string,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Falha ao baixar arquivo: HTTP ${res.status}`)
  }
  const mimeType = res.headers.get('content-type') || 'application/octet-stream'
  const buffer = await res.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return { base64, mimeType }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST')
    return jsonResp(405, { ok: false, error: 'METHOD_NOT_ALLOWED' })

  try {
    const body = (await req.json()) as ReqBody
    const { conversation_id, type } = body

    // ── Validação básica ─────────────────────────────────────────────────────
    if (!conversation_id || !/^[0-9a-f-]{36}$/i.test(conversation_id)) {
      return jsonResp(400, {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'conversation_id inválido',
      })
    }
    if (!type || !['texto', 'imagem', 'documento'].includes(type)) {
      return jsonResp(400, {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'type deve ser texto, imagem ou documento',
      })
    }
    if (type === 'texto' && !body.text?.trim()) {
      return jsonResp(400, {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'text é obrigatório para tipo texto',
      })
    }
    if (
      (type === 'imagem' || type === 'documento') &&
      !body.media_url?.trim()
    ) {
      return jsonResp(400, {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'media_url é obrigatório para mídia',
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Buscar conversa + config + instance em paralelo ──────────────────────
    const { data: conv, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('id, phone, instance_id, bitrix_entity_id, bitrix_entity_type')
      .eq('id', conversation_id)
      .maybeSingle()

    if (convErr || !conv) {
      return jsonResp(404, {
        ok: false,
        error: 'CONVERSATION_NOT_FOUND',
        message: 'Conversa não encontrada',
      })
    }

    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url, uazapi_global_token')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token, status')
        .eq('id', conv.instance_id)
        .maybeSingle(),
    ])

    const cfg = moduleRes.data
    const instance = instanceRes.data
    if (!cfg || !instance) {
      return jsonResp(500, {
        ok: false,
        error: 'CONFIG_MISSING',
        message: 'Configuração ou instância não encontrada',
      })
    }

    if (instance.status !== 'conectado') {
      return jsonResp(409, {
        ok: false,
        error: 'INSTANCE_DISCONNECTED',
        message: 'WhatsApp do executivo não está conectado',
      })
    }

    const baseUrl = (cfg.uazapi_base_url || 'https://free.uazapi.com').replace(
      /\/$/,
      '',
    )
    const globalToken: string = cfg.uazapi_global_token || ''
    const instanceKey: string = instance.instance_key || ''
    const instanceToken: string | null = instance.instance_token || null
    const token = instanceToken?.trim() || globalToken

    if (!token) {
      return jsonResp(500, {
        ok: false,
        error: 'NO_TOKEN',
        message: 'Nenhum token uazapi disponível',
      })
    }

    // ── Montar payload para uazapi ───────────────────────────────────────────
    let endpoint = ''
    const uazapiBody: Record<string, unknown> = { number: conv.phone }
    if (!instanceToken?.trim()) uazapiBody.instanceName = instanceKey

    if (type === 'texto') {
      endpoint = '/send/text'
      uazapiBody.text = body.text!.trim()
    } else {
      endpoint = '/send/media'

      let base64Content: string
      let mimeType: string

      // Caminho preferido: frontend já mandou base64 pronto
      if (body.media_base64?.trim()) {
        base64Content = body.media_base64.trim()
        mimeType =
          body.media_mime_type ||
          (type === 'imagem' ? 'image/jpeg' : 'application/pdf')
      } else {
        // Fallback: edge tenta baixar do media_url (só funciona se URL for externa, ex: produção)
        let fileData: { base64: string; mimeType: string }
        try {
          fileData = await fetchFileAsBase64(body.media_url!)
        } catch (err) {
          console.error('[send-message] failed to fetch media:', err)
          return jsonResp(502, {
            ok: false,
            error: 'MEDIA_FETCH_ERROR',
            message: `Não foi possível baixar o arquivo: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
          })
        }
        base64Content = fileData.base64
        mimeType = fileData.mimeType
      }

      // Montar dataURI: data:{mime};base64,{conteudo}
      uazapiBody.file = `data:${mimeType};base64,${base64Content}`
      uazapiBody.type = type === 'imagem' ? 'image' : 'document'
      uazapiBody.fileName =
        body.file_name || (type === 'imagem' ? 'imagem.jpg' : 'documento.pdf')
      if (body.caption?.trim()) uazapiBody.caption = body.caption.trim()
    }

    // ── Enviar via uazapi ────────────────────────────────────────────────────
    const uazapiRes = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify(uazapiBody),
    }).catch((e) => {
      console.error('[send-message] fetch error:', e)
      return null
    })

    if (!uazapiRes) {
      return jsonResp(502, {
        ok: false,
        error: 'UAZAPI_UNREACHABLE',
        message: 'Não foi possível alcançar a uazapi',
      })
    }

    if (!uazapiRes.ok) {
      const errText = await uazapiRes.text().catch(() => '')
      return jsonResp(502, {
        ok: false,
        error: 'UAZAPI_ERROR',
        message: `uazapi ${uazapiRes.status}: ${errText.slice(0, 200)}`,
      })
    }

    const uazapiData = await uazapiRes
      .json()
      .catch(() => ({}) as Record<string, unknown>)
    const uazapiMessageId =
      (uazapiData as { messageId?: string; id?: string })?.messageId ||
      (uazapiData as { id?: string })?.id ||
      `local_${Date.now()}`
    // ── Gravar no banco ──────────────────────────────────────────────────────
    const conteudoFinal =
      type === 'texto' ? body.text!.trim() : body.caption?.trim() || null
    const { data: insertedMsg, error: insertErr } = await supabase
      .from('whatsapp_messages')
      .insert({
        conversation_id,
        message_id: normalizeMessageId(String(uazapiMessageId)),
        direcao: 'enviada',
        tipo: type,
        conteudo: conteudoFinal,
        caption: type !== 'texto' ? body.caption?.trim() || null : null,
        media_url: type !== 'texto' ? body.media_url : null,
        processado: true,
      })
      .select('id')
      .maybeSingle()

    if (insertErr) {
      console.error('[send-message] insert error:', insertErr)
      // Mensagem foi enviada via uazapi mas falhou ao gravar — retornar parcial
      return jsonResp(207, {
        ok: true,
        warning: 'Mensagem enviada mas não foi registrada no histórico local',
        uazapi_message_id: uazapiMessageId,
      })
    }

    // ── Atualizar ultimo_contato da conversa ─────────────────────────────────
    await supabase
      .from('whatsapp_conversations')
      .update({ ultimo_contato: new Date().toISOString() })
      .eq('id', conversation_id)

    // ── Registrar mensagem enviada no timeline do Bitrix (fire-and-forget) ───
    if (conv.bitrix_entity_id && conv.bitrix_entity_type) {
      ;(async () => {
        try {
          const bitrixUrl = await getBitrixWebhookUrl(supabase)
          if (!bitrixUrl) return
          const comentario = formatarComentarioTimeline({
            text: conteudoFinal || '',
            msgType: type,
            direcao: 'enviada',
            contactName: conv.phone,
            executivoNome: 'Executivo',
          })
          await postarTimelineHibrido({
            supabase,
            bitrixUrl,
            conversationId: conversation_id,
            messageDbId: insertedMsg?.id || null,
            entityType: conv.bitrix_entity_type,
            entityId: conv.bitrix_entity_id,
            comentario,
          })
        } catch (e: any) {
          console.warn('[send-message] falha timeline Bitrix:', e?.message)
        }
      })()
    }

    return jsonResp(200, {
      ok: true,
      uazapi_message_id: uazapiMessageId,
    })
  } catch (err) {
    console.error('[send-message] error:', err)
    return jsonResp(500, {
      ok: false,
      error: 'INTERNAL',
      message: err instanceof Error ? err.message : 'erro interno',
    })
  }
})
