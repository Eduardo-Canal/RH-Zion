import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface ReqBody {
  message_id: string // UUID de whatsapp_messages.id
}

// Reescreve a signed URL para usar o hostname público do Supabase.
// SUPABASE_URL = "http://kong:8000" (hostname interno Docker) tanto em local
// dev (supabase start) quanto no self-hosted (docker-compose.yml) — o SDK
// herda esse origin nas signed URLs, e "kong" não resolve fora da rede
// Docker, nem em dev nem em produção self-hosted. Em produção Cloud
// SUPABASE_URL já é o domínio real → no-op nos dois casos abaixo.
//
// Achado 01/09/2026, testando T9 na OCI: a versão antiga assumia que
// "http://kong" só existia em dev e sempre trocava por 127.0.0.1:54321 (porta
// padrão do supabase CLI) — no self-hosted isso gerava um link que não existe
// (a máquina de quem clica não tem nada rodando nessa porta). PUBLIC_FUNCTIONS_URL
// (deploy/docker-compose.yml) já existe pra isso — self-hosted sempre define,
// dev local (supabase start) nunca define, então o fallback pro 127.0.0.1:54321
// entra só onde fazia sentido antes.
function externalizeUrl(signedUrl: string): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  if (!supabaseUrl.startsWith('http://kong')) return signedUrl
  const publicUrl = Deno.env.get('PUBLIC_FUNCTIONS_URL') || ''
  if (publicUrl) {
    const rewritten = signedUrl.replace(
      /^https?:\/\/[^/]+/,
      publicUrl.replace(/\/$/, ''),
    )
    // Self-hosted: o Kong exige apikey (plugin key-auth) em toda rota
    // /storage/v1/, inclusive num link já assinado — abrir direto no browser
    // (nova aba, <img src>) não manda header nenhum. Kong aceita apikey por
    // query string também (mesmo key_names), então anexamos aqui. Achado
    // 01/09/2026 testando T9: sem isso, "Kong Error: No API key found".
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

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })

  try {
    const body: ReqBody = await req.json()
    if (!body.message_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_MESSAGE_ID' })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── 1. Buscar mensagem ──────────────────────────────────────────────────
    const { data: msg, error: msgErr } = await supabase
      .from('whatsapp_messages')
      .select(
        'id, message_id, tipo, media_url, media_mimetype, media_storage_path, conversation_id',
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

    // ── 2. Cache hit: já está no bucket ─────────────────────────────────────
    if (msg.media_storage_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from('whatsapp-incoming-media')
        .createSignedUrl(msg.media_storage_path, 3600)

      if (signErr || !signed) {
        // Cache pode estar quebrado (arquivo deletado do bucket). Forçar re-download.
        console.warn(
          '[whatsapp-download-media] cache miss apesar de storage_path:',
          signErr,
        )
      } else {
        return jsonResp(200, {
          ok: true,
          signed_url: externalizeUrl(signed.signedUrl),
          mimetype: msg.media_mimetype,
          cached: true,
        })
      }
    }

    // ── 3. Cache miss: chamar uazapi POST /message/download ──────────────────
    // Doc: https://docs.uazapi.com → /message/download
    // Endpoint na raiz (sem /instance/{key}), auth via instance_token.
    // A uazapi decripta a mídia do lado dela e expõe via fileURL.

    // 3a. Conversa → instance_id
    const { data: conv, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('instance_id')
      .eq('id', msg.conversation_id)
      .maybeSingle()

    if (convErr || !conv?.instance_id) {
      return jsonResp(404, { ok: false, error: 'CONVERSATION_NOT_FOUND' })
    }

    // 3b. Config + instance — precisamos do instance_token, não do global
    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('instance_token')
        .eq('id', conv.instance_id)
        .maybeSingle(),
    ])

    const cfg = moduleRes.data
    const instance = instanceRes.data
    if (!instance?.instance_token) {
      return jsonResp(500, { ok: false, error: 'INSTANCE_TOKEN_MISSING' })
    }

    const baseUrl = (
      cfg?.uazapi_base_url || 'https://zionlogtec.uazapi.com'
    ).replace(/\/$/, '')

    // 3c. Chamar uazapi → pega fileURL decriptada
    const uazResp = await fetch(`${baseUrl}/message/download`, {
      method: 'POST',
      headers: {
        token: instance.instance_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: msg.message_id,
        return_link: true,
      }),
    })

    if (!uazResp.ok) {
      const errText = await uazResp.text().catch(() => '')
      console.error(
        '[whatsapp-download-media] uazapi falhou:',
        uazResp.status,
        errText,
      )
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
      console.error(
        '[whatsapp-download-media] resposta uazapi sem fileURL:',
        uazData,
      )
      return jsonResp(502, { ok: false, error: 'UAZAPI_NO_FILE_URL' })
    }

    // 3d. Baixar arquivo decriptado da fileURL
    const fileResp = await fetch(uazData.fileURL)
    if (!fileResp.ok) {
      console.error(
        '[whatsapp-download-media] download fileURL falhou:',
        fileResp.status,
      )
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
    const path = `${msg.id}.${ext}`

    // ── 4. Upload pro bucket ────────────────────────────────────────────────
    const { error: uploadErr } = await supabase.storage
      .from('whatsapp-incoming-media')
      .upload(path, bytes, {
        contentType: mimetype,
        upsert: true,
      })

    if (uploadErr) {
      console.error('[whatsapp-download-media] upload falhou:', uploadErr)
      return jsonResp(500, { ok: false, error: 'STORAGE_UPLOAD_FAILED' })
    }

    // ── 5. Persistir path + mimetype ────────────────────────────────────────
    await supabase
      .from('whatsapp_messages')
      .update({
        media_storage_path: path,
        media_mimetype: mimetype,
      })
      .eq('id', msg.id)

    // ── 6. URL assinada ─────────────────────────────────────────────────────
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
    console.error('[whatsapp-download-media] erro inesperado:', err)
    return jsonResp(500, { ok: false, error: 'INTERNAL', message: String(err) })
  }
})
