import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface ReqBody {
  message_id: string // UUID de whatsapp_messages.id
}

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Propagar conclusão (sucesso ou falha) da transcrição ao buffer ─────────
// add-message-to-batch marca audio_pendente=true quando inclui um áudio sem
// media_transcription/transcription_failed_at (mesmo critério replicado
// abaixo). Sem isso, o batch fica represado pra sempre: o cron
// flush_batches_inativos() exclui explicitamente audio_pendente=true da
// varredura. Recalcula (não apenas zera) porque pode haver outro áudio da
// mesma conversa ainda pendente no batch. Acessório — não pode derrubar a
// transcrição em si.
async function recalcularAudioPendenteDoBatch(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
): Promise<void> {
  try {
    const { data: batch } = await supabase
      .from('whatsapp_bitrix_batch')
      .select('message_ids, audio_pendente')
      .eq('conversation_id', conversationId)
      .maybeSingle()

    if (!batch?.audio_pendente || !batch.message_ids?.length) return

    const { data: aindaPendentes } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .in('id', batch.message_ids)
      .eq('tipo', 'audio')
      .is('media_transcription', null)
      .is('transcription_failed_at', null)
      .limit(1)

    if (aindaPendentes && aindaPendentes.length > 0) return

    await supabase
      .from('whatsapp_bitrix_batch')
      .update({ audio_pendente: false })
      .eq('conversation_id', conversationId)
      .eq('audio_pendente', true)
  } catch (err) {
    console.error(
      '[transcribe-audio] falha ao recalcular audio_pendente do batch:',
      err,
    )
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })

  // Guard de chamada interna — achado de auditoria de 23/07/2026 (N-19):
  // deployada com --no-verify-jwt e sem nenhuma checagem própria, esta
  // function ficava aberta a qualquer chamada anônima (custo de
  // OpenAI/uazapi). Mesmo padrão do whatsapp-executive-handler. Único
  // chamador real é o whatsapp-webhook-router, que já manda
  // Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (invokeSubHandler).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) {
    console.error(
      '[transcribe-audio] SUPABASE_SERVICE_ROLE_KEY não configurado — recusando execução.',
    )
    return jsonResp(500, { ok: false, error: 'INTERNAL_CONFIG_MISSING' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) {
    return jsonResp(401, { ok: false, error: 'TOKEN_AUSENTE' })
  }

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    console.error(
      '[transcribe-audio] Authorization inválido — chamada recusada.',
    )
    return jsonResp(403, { ok: false, error: 'ACESSO_RESTRITO' })
  }

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
      .select('id, message_id, tipo, media_transcription, conversation_id')
      .eq('id', body.message_id)
      .maybeSingle()

    if (msgErr || !msg) {
      return jsonResp(404, { ok: false, error: 'MESSAGE_NOT_FOUND' })
    }

    if (msg.tipo !== 'audio') {
      return jsonResp(400, { ok: false, error: 'NOT_AN_AUDIO', tipo: msg.tipo })
    }

    // ── 2. Cache hit: já transcrita ─────────────────────────────────────────
    if (msg.media_transcription?.trim()) {
      return jsonResp(200, {
        ok: true,
        transcription: msg.media_transcription,
        cached: true,
      })
    }

    // ── 3. Buscar instance_token + uazapi_base_url + openai_api_key ─────────
    const { data: conv } = await supabase
      .from('whatsapp_conversations')
      .select('instance_id')
      .eq('id', msg.conversation_id)
      .maybeSingle()

    if (!conv?.instance_id) {
      return jsonResp(404, { ok: false, error: 'CONVERSATION_NOT_FOUND' })
    }

    const [moduleRes, instanceRes, openaiRes] = await Promise.all([
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
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'openai_config')
        .maybeSingle(),
    ])

    const baseUrl = (
      moduleRes.data?.uazapi_base_url || 'https://zionlogtec.uazapi.com'
    ).replace(/\/$/, '')
    const instanceToken = instanceRes.data?.instance_token
    const openaiKey =
      (openaiRes.data?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''

    if (!instanceToken) {
      return jsonResp(500, { ok: false, error: 'INSTANCE_TOKEN_MISSING' })
    }
    if (!openaiKey) {
      return jsonResp(500, { ok: false, error: 'OPENAI_KEY_MISSING' })
    }

    // ── 4. Chamar uazapi com transcribe=true ────────────────────────────────
    // Áudios novos podem não estar cacheados ainda na uazapi. Estratégia:
    // 1. Tentar transcribe direto.
    // 2. Se não vier transcription, warm-up (download sem transcribe) + 3s + retry.
    async function chamarUazapiTranscribe(): Promise<any> {
      const r = await fetch(`${baseUrl}/message/download`, {
        method: 'POST',
        headers: { token: instanceToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: msg.message_id,
          transcribe: true,
          openai_apikey: openaiKey,
          return_link: false,
        }),
      })
      if (!r.ok) throw new Error(`uazapi ${r.status}`)
      return r.json().catch(() => null)
    }

    let data = await chamarUazapiTranscribe()
    let transcription: string = data?.transcription?.trim() || ''

    if (!transcription) {
      // Warm-up: baixar sem transcribe pra garantir cache na uazapi
      await fetch(`${baseUrl}/message/download`, {
        method: 'POST',
        headers: { token: instanceToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msg.message_id, return_link: true }),
      }).catch(() => {})
      // Aguardar uazapi processar e cachear
      await new Promise((r) => setTimeout(r, 4000))
      // Retry
      data = await chamarUazapiTranscribe().catch(() => null)
      transcription = data?.transcription?.trim() || ''
    }

    if (!transcription) {
      console.warn(
        '[transcribe-audio] uazapi não retornou transcription após retry:',
        data,
      )
      await supabase
        .from('whatsapp_messages')
        .update({ transcription_failed_at: new Date().toISOString() })
        .eq('id', msg.id)
      await recalcularAudioPendenteDoBatch(supabase, msg.conversation_id)
      return jsonResp(502, { ok: false, error: 'NO_TRANSCRIPTION_RETURNED' })
    }

    // ── 5. Persistir transcrição ────────────────────────────────────────────
    const updates: Record<string, any> = { media_transcription: transcription }
    if (typeof data?.duration_seconds === 'number') {
      updates.audio_duration_seconds = Math.round(data.duration_seconds)
    } else if (typeof data?.usage?.seconds === 'number') {
      updates.audio_duration_seconds = Math.round(data.usage.seconds)
    }

    await supabase.from('whatsapp_messages').update(updates).eq('id', msg.id)

    await recalcularAudioPendenteDoBatch(supabase, msg.conversation_id)

    return jsonResp(200, {
      ok: true,
      transcription,
      duration_seconds: updates.audio_duration_seconds ?? null,
      cached: false,
    })
  } catch (err) {
    console.error('[transcribe-audio] erro inesperado:', err)
    return jsonResp(500, { ok: false, error: 'INTERNAL', message: String(err) })
  }
})
