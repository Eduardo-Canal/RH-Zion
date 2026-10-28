// Edge: whatsapp-group-download-media
// Baixa mídia de uma mensagem de grupo sob demanda.
// Espelha whatsapp-download-media mas usa whatsapp_group_messages em vez de whatsapp_messages.
// Recebe: { message_id: string }  (UUID de whatsapp_group_messages.id)
// Retorna: { ok: true, signed_url, mimetype, cached }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

// Ver comentário completo em whatsapp-download-media/index.ts (mesma função,
// achado 01/09/2026 testando T9 na OCI): "http://kong" acontece tanto em dev
// local quanto no self-hosted — PUBLIC_FUNCTIONS_URL (sempre definida no
// self-hosted, nunca em dev local) resolve os dois corretamente.
function externalizeUrl(signedUrl: string): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  if (!supabaseUrl.startsWith('http://kong')) return signedUrl
  const publicUrl = Deno.env.get('PUBLIC_FUNCTIONS_URL') || ''
  if (publicUrl) {
    const rewritten = signedUrl.replace(
      /^https?:\/\/[^/]+/,
      publicUrl.replace(/\/$/, ''),
    )
    // Self-hosted: Kong exige apikey (key-auth) até em link já assinado —
    // aceita por query string também. Ver comentário completo em
    // whatsapp-download-media/index.ts.
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    return anonKey
      ? `${rewritten}${rewritten.includes('?') ? '&' : '?'}apikey=${anonKey}`
      : rewritten
  }
  const port = Deno.env.get('SUPABASE_INTERNAL_HOST_PORT') || '54321'
  return signedUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`)
}

function extFromMime(mime: string | null, tipo: string): string {
  if (!mime) {
    if (tipo === 'imagem') return 'jpg'
    if (tipo === 'audio') return 'ogg'
    if (tipo === 'documento') return 'pdf'
    return 'bin'
  }
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
  }
  return map[mime.toLowerCase()] || 'bin'
}

const jsonResp = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })

  try {
    const body = (await req.json()) as { message_id?: string }
    if (!body.message_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_MESSAGE_ID' })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Buscar mensagem de grupo
    const { data: msg, error: msgErr } = await supabase
      .from('whatsapp_group_messages')
      .select(
        'id, message_id, tipo, media_url, media_mimetype, media_storage_path, group_id',
      )
      .eq('id', body.message_id)
      .maybeSingle()

    if (msgErr || !msg) {
      return jsonResp(404, { ok: false, error: 'MESSAGE_NOT_FOUND' })
    }

    if (!['imagem', 'audio', 'documento', 'video'].includes(msg.tipo)) {
      return jsonResp(400, {
        ok: false,
        error: 'NOT_A_MEDIA_MESSAGE',
        tipo: msg.tipo,
      })
    }

    // 2. Cache hit
    if (msg.media_storage_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from('whatsapp-incoming-media')
        .createSignedUrl(msg.media_storage_path, 3600)

      if (!signErr && signed) {
        return jsonResp(200, {
          ok: true,
          signed_url: externalizeUrl(signed.signedUrl),
          mimetype: msg.media_mimetype,
          cached: true,
        })
      }
    }

    // 3. Cache miss → chamar uazapi
    // Buscar instance_id via grupo
    const { data: group } = await supabase
      .from('whatsapp_groups')
      .select('instance_id')
      .eq('id', msg.group_id)
      .maybeSingle()

    if (!group?.instance_id) {
      return jsonResp(404, { ok: false, error: 'GROUP_NOT_FOUND' })
    }

    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('instance_token')
        .eq('id', group.instance_id)
        .maybeSingle(),
    ])

    const instance = instanceRes.data
    if (!instance?.instance_token) {
      return jsonResp(500, { ok: false, error: 'INSTANCE_TOKEN_MISSING' })
    }

    const baseUrl = (
      moduleRes.data?.uazapi_base_url || 'https://zionlogtec.uazapi.com'
    ).replace(/\/$/, '')

    const uazResp = await fetch(`${baseUrl}/message/download`, {
      method: 'POST',
      headers: {
        token: instance.instance_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: msg.message_id, return_link: true }),
    })

    if (!uazResp.ok) {
      console.error('[group-download-media] uazapi falhou:', uazResp.status)
      return jsonResp(502, {
        ok: false,
        error: 'UAZAPI_FETCH_FAILED',
        status: uazResp.status,
      })
    }

    const uazData = (await uazResp.json().catch(() => null)) as {
      fileURL?: string
      mimetype?: string
    } | null
    if (!uazData?.fileURL) {
      return jsonResp(502, { ok: false, error: 'UAZAPI_NO_FILE_URL' })
    }

    // 4. Baixar arquivo
    const fileResp = await fetch(uazData.fileURL)
    if (!fileResp.ok) {
      return jsonResp(502, { ok: false, error: 'FILE_DOWNLOAD_FAILED' })
    }

    const arrayBuffer = await fileResp.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const mimetype =
      uazData.mimetype ||
      msg.media_mimetype ||
      fileResp.headers.get('content-type') ||
      'application/octet-stream'
    const ext = extFromMime(mimetype, msg.tipo)
    const path = `grupos/${msg.id}.${ext}`

    // 5. Upload pro bucket
    const { error: uploadErr } = await supabase.storage
      .from('whatsapp-incoming-media')
      .upload(path, bytes, { contentType: mimetype, upsert: true })

    if (uploadErr) {
      console.error('[group-download-media] upload falhou:', uploadErr)
      return jsonResp(500, { ok: false, error: 'STORAGE_UPLOAD_FAILED' })
    }

    // 6. Persistir path
    await supabase
      .from('whatsapp_group_messages')
      .update({ media_storage_path: path, media_mimetype: mimetype })
      .eq('id', msg.id)

    // 7. URL assinada
    const { data: signed, error: signErr } = await supabase.storage
      .from('whatsapp-incoming-media')
      .createSignedUrl(path, 3600)

    if (signErr || !signed) {
      return jsonResp(500, { ok: false, error: 'SIGN_URL_FAILED' })
    }

    return jsonResp(200, {
      ok: true,
      signed_url: externalizeUrl(signed.signedUrl),
      mimetype,
      cached: false,
    })
  } catch (err) {
    console.error('[group-download-media] erro inesperado:', err)
    return jsonResp(500, { ok: false, error: 'INTERNAL', message: String(err) })
  }
})
