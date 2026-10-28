import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface ReqBody {
  message_id: string // UUID de whatsapp_messages.id
}

const FALLBACK_PROMPT =
  'Você analisa imagens recebidas por uma empresa de softwarehouse B2B de logística (Zion Logtec), cujo seu produto principal é o WMS e tem foco em médio e grandes projetos em conversas comerciais. Descreva esta imagem em 1-2 frases curtas, focando em elementos relevantes pra contexto comercial: estabelecimento, produto, documento, situação. Seja objetivo, sem floreios.'

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
        'id, tipo, direcao, media_storage_path, media_mimetype, media_ai_description, conversation_id',
      )
      .eq('id', body.message_id)
      .maybeSingle()

    if (msgErr || !msg) {
      return jsonResp(404, { ok: false, error: 'MESSAGE_NOT_FOUND' })
    }

    if (msg.tipo !== 'imagem') {
      return jsonResp(400, { ok: false, error: 'NOT_AN_IMAGE', tipo: msg.tipo })
    }

    if (msg.direcao !== 'recebida') {
      return jsonResp(400, {
        ok: false,
        error: 'ONLY_RECEIVED_IMAGES_ANALYZED',
        direcao: msg.direcao,
      })
    }

    // ── 2. Cache hit: já analisada ──────────────────────────────────────────
    if (msg.media_ai_description?.trim()) {
      return jsonResp(200, {
        ok: true,
        description: msg.media_ai_description,
        cached: true,
      })
    }

    // ── 3. Garantir que mídia está cacheada no bucket (lazy) ─────────────────
    if (!msg.media_storage_path) {
      const dlResp = await supabase.functions.invoke(
        'whatsapp-download-media',
        {
          body: { message_id: msg.id },
        },
      )
      if (dlResp.error || !dlResp.data?.ok) {
        console.error(
          '[analyze-image-content] falha ao cachear mídia:',
          dlResp.error,
        )
        return jsonResp(502, { ok: false, error: 'MEDIA_DOWNLOAD_FAILED' })
      }
      const { data: updated } = await supabase
        .from('whatsapp_messages')
        .select('media_storage_path')
        .eq('id', msg.id)
        .maybeSingle()
      if (!updated?.media_storage_path) {
        return jsonResp(500, { ok: false, error: 'STORAGE_PATH_STILL_NULL' })
      }
      msg.media_storage_path = updated.media_storage_path
    }

    // ── 4. Baixar bytes do bucket ───────────────────────────────────────────
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('whatsapp-incoming-media')
      .download(msg.media_storage_path)

    if (dlErr || !fileData) {
      console.error('[analyze-image-content] download do bucket falhou:', dlErr)
      return jsonResp(500, { ok: false, error: 'BUCKET_DOWNLOAD_FAILED' })
    }

    // 4a. Converter Blob → base64
    const arrayBuffer = await fileData.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const base64 = btoa(binary)
    const mimetype = msg.media_mimetype || 'image/jpeg'

    // ── 5. Buscar prompt customizado + chave OpenAI ─────────────────────────
    const [promptRes, openaiRes] = await Promise.all([
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'ai_media_analysis_prompt')
        .maybeSingle(),
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'openai_config')
        .maybeSingle(),
    ])

    const promptText: string =
      (promptRes.data?.value as any)?.image_prompt?.trim() || FALLBACK_PROMPT

    const openaiKey: string =
      (openaiRes.data?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''

    if (!openaiKey) {
      return jsonResp(500, { ok: false, error: 'OPENAI_KEY_MISSING' })
    }

    // ── 6. Chamar OpenAI GPT-4o Vision ──────────────────────────────────────
    const openaiResp = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 200,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimetype};base64,${base64}` },
                },
              ],
            },
          ],
        }),
      },
    )

    if (!openaiResp.ok) {
      const errText = await openaiResp.text().catch(() => '')
      console.error(
        '[analyze-image-content] OpenAI falhou:',
        openaiResp.status,
        errText,
      )
      return jsonResp(502, {
        ok: false,
        error: 'OPENAI_FAILED',
        status: openaiResp.status,
      })
    }

    const openaiData = (await openaiResp.json().catch(() => null)) as any
    const description: string =
      openaiData?.choices?.[0]?.message?.content?.trim() || ''

    if (!description) {
      console.error(
        '[analyze-image-content] OpenAI retornou vazio:',
        openaiData,
      )
      return jsonResp(502, { ok: false, error: 'OPENAI_EMPTY' })
    }

    // ── 7. Persistir descrição ──────────────────────────────────────────────
    await supabase
      .from('whatsapp_messages')
      .update({ media_ai_description: description })
      .eq('id', msg.id)

    return jsonResp(200, {
      ok: true,
      description,
      cached: false,
    })
  } catch (err) {
    console.error('[analyze-image-content] erro inesperado:', err)
    return jsonResp(500, { ok: false, error: 'INTERNAL', message: String(err) })
  }
})
