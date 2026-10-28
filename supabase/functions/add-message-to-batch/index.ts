import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { checkPhoneExclusion } from '../_shared/bitrix-exclusion.ts'

interface ReqBody {
  conversation_id: string
  message_db_id: string
  msg_type: string
}

const BATCH_THRESHOLD = 10

// Janela de retry para o auto-vínculo Bitrix de conversas executivas novas:
// whatsapp-executive-handler grava conv.bitrix_entity_id de forma síncrona,
// mas é uma chamada HTTP separada e concorrente (fire-and-forget a partir do
// webhook-router) — não há garantia de ordem entre ela e esta function. Sem
// isso, as primeiras mensagens de uma conversa nova eram descartadas do
// buffer (NO_BITRIX_LINK) mesmo quando o vínculo era criado poucos ms depois.
const CONVERSA_RECENTE_MS = 60_000
const RETRY_DELAYS_MS = [3000, 7000]

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Upsert no batch (1 por conversa) + flush imediato se aplicável ─────────
// Extraído do handler principal para ser reaproveitado pelo retry em
// background (conversa recente sem bitrix_entity_id ainda).
async function processarBatch(
  supabase: ReturnType<typeof createClient>,
  body: ReqBody,
): Promise<{
  batchId: string
  contador: number
  audioPendente: boolean
  willFlush: boolean
}> {
  let audioPendente = false
  if (body.msg_type === 'audio') {
    const { data: msg } = await supabase
      .from('whatsapp_messages')
      .select('media_transcription, transcription_failed_at')
      .eq('id', body.message_db_id)
      .maybeSingle()
    audioPendente = !msg?.media_transcription && !msg?.transcription_failed_at
  }

  const { data: existing } = await supabase
    .from('whatsapp_bitrix_batch')
    .select('id, message_ids, contador, audio_pendente')
    .eq('conversation_id', body.conversation_id)
    .maybeSingle()

  let batchId: string
  let novoContador: number
  let novoAudioPendente: boolean

  if (existing) {
    const novosIds = [...(existing.message_ids || []), body.message_db_id]
    novoContador = novosIds.length
    novoAudioPendente = existing.audio_pendente || audioPendente

    const { error: upErr } = await supabase
      .from('whatsapp_bitrix_batch')
      .update({
        message_ids: novosIds,
        contador: novoContador,
        ultimo_evento_em: new Date().toISOString(),
        audio_pendente: novoAudioPendente,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (upErr) {
      console.error('[add-to-batch] update falhou:', upErr.message)
      throw new Error('UPDATE_FAILED')
    }
    batchId = existing.id
  } else {
    const { data: novo, error: insErr } = await supabase
      .from('whatsapp_bitrix_batch')
      .insert({
        conversation_id: body.conversation_id,
        message_ids: [body.message_db_id],
        contador: 1,
        audio_pendente: audioPendente,
      })
      .select('id')
      .single()

    if (insErr || !novo) {
      console.error('[add-to-batch] insert falhou:', insErr?.message)
      throw new Error('INSERT_FAILED')
    }
    batchId = novo.id
    novoContador = 1
    novoAudioPendente = audioPendente
  }

  // ── Flush imediato se threshold atingido e sem áudio pendente ────────
  const willFlush = novoContador >= BATCH_THRESHOLD && !novoAudioPendente
  if (willFlush) {
    console.log(
      `[add-to-batch] threshold atingido (${novoContador}), disparando flush batch=${batchId}`,
    )
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    fetch(`${supabaseUrl}/functions/v1/flush-bitrix-batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch_id: batchId }),
    }).catch((e) =>
      console.warn('[add-to-batch] flush dispatch falhou:', e?.message),
    )
  }

  return {
    batchId,
    contador: novoContador,
    audioPendente: novoAudioPendente,
    willFlush,
  }
}

// ── Retry em background: conversa nova ainda sem bitrix_entity_id ──────────
// Reconsulta o vínculo algumas vezes antes de desistir. Roda após a resposta
// HTTP já ter sido enviada (EdgeRuntime.waitUntil) — não afeta a latência do
// webhook nem a orquestração do whatsapp-webhook-router.
async function retryVinculoEProcessar(
  supabase: ReturnType<typeof createClient>,
  body: ReqBody,
): Promise<void> {
  for (const delayMs of RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    const { data: convRetry } = await supabase
      .from('whatsapp_conversations')
      .select('bitrix_entity_id')
      .eq('id', body.conversation_id)
      .maybeSingle()

    if (convRetry?.bitrix_entity_id) {
      try {
        await processarBatch(supabase, body)
      } catch (err) {
        console.error(
          '[add-to-batch] retry: processarBatch falhou após vínculo confirmado:',
          err,
        )
      }
      return
    }
  }
  console.warn(
    `[add-to-batch] retry NO_BITRIX_LINK esgotado para conversa ${body.conversation_id} (mensagem ${body.message_db_id})`,
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })

  // Guard de chamada interna — achado de auditoria de 23/07/2026 (N-19):
  // deployada com --no-verify-jwt e sem nenhuma checagem própria, esta
  // function ficava aberta a qualquer chamada anônima (manipulação do
  // buffer whatsapp_bitrix_batch). Mesmo padrão do whatsapp-executive-handler.
  // Único chamador real é o whatsapp-webhook-router, que já manda
  // Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (invokeSubHandler).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) {
    console.error(
      '[add-to-batch] SUPABASE_SERVICE_ROLE_KEY não configurado — recusando execução.',
    )
    return jsonResp(500, { ok: false, error: 'INTERNAL_CONFIG_MISSING' })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) {
    return jsonResp(401, { ok: false, error: 'TOKEN_AUSENTE' })
  }

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    console.error('[add-to-batch] Authorization inválido — chamada recusada.')
    return jsonResp(403, { ok: false, error: 'ACESSO_RESTRITO' })
  }

  try {
    const body: ReqBody = await req.json()
    if (!body.conversation_id || !body.message_db_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_REQUIRED_FIELDS' })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── 1. Verificar se conversa tem Bitrix vinculado ───────────────────────
    const { data: conv } = await supabase
      .from('whatsapp_conversations')
      .select('id, phone, bitrix_entity_id, bitrix_entity_type, criado_em')
      .eq('id', body.conversation_id)
      .maybeSingle()

    // ── 1.a Telefone excluído do fluxo Bitrix (N-20) ────────────────────────
    // Assimetria de erro declarada: se a consulta de exclusão falhar
    // (rede/DB), o fluxo de mensagens SEGUE (fail-open) — este ponto só
    // decide se o batch acumula pro Bitrix, não descarta a mensagem em si.
    // Fail-open é mais seguro aqui do que travar o buffer por um erro
    // transitório de consulta.
    if (conv?.phone) {
      const exclusion = await checkPhoneExclusion(supabase, conv.phone)
      if (exclusion.status === 'excluded') {
        return jsonResp(200, { ok: true, skipped: 'EXCLUIDO_CRM' })
      }
      if (exclusion.status === 'error') {
        console.warn(
          '[add-to-batch] checagem de exclusão falhou, seguindo (fail-open):',
          exclusion.message,
        )
      }
    } else {
      console.warn(
        '[add-to-batch] conversa sem phone — checagem de exclusão pulada, seguindo (fail-open)',
      )
    }

    if (!conv?.bitrix_entity_id) {
      const criadoEmMs = conv?.criado_em
        ? new Date(conv.criado_em).getTime()
        : 0
      const conversaRecente =
        criadoEmMs > 0 && Date.now() - criadoEmMs < CONVERSA_RECENTE_MS

      if (!conversaRecente) {
        return jsonResp(200, { ok: true, skipped: 'NO_BITRIX_LINK' })
      }

      // Conversa nova: o whatsapp-executive-handler pode estar gravando o
      // auto-vínculo agora mesmo. Agenda retry em background e responde já.
      const retryTask = retryVinculoEProcessar(supabase, body)

      // @ts-ignore - EdgeRuntime é global do supabase-edge-runtime
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(retryTask)
      } else {
        retryTask.catch((e) =>
          console.error('[add-to-batch] retry sem waitUntil:', e?.message),
        )
      }

      return jsonResp(200, {
        ok: true,
        skipped: 'NO_BITRIX_LINK_RETRY_SCHEDULED',
      })
    }

    // ── 2-4. Áudio pendente + upsert no batch + flush imediato ──────────────
    const resultado = await processarBatch(supabase, body)

    return jsonResp(200, {
      ok: true,
      batch_id: resultado.batchId,
      contador: resultado.contador,
      audio_pendente: resultado.audioPendente,
      will_flush: resultado.willFlush,
    })
  } catch (err) {
    console.error('[add-to-batch] erro inesperado:', err)
    return jsonResp(500, { ok: false, error: 'INTERNAL', message: String(err) })
  }
})
