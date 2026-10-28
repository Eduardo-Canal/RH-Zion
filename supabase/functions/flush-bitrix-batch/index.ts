import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import {
  formatarBatchTimeline,
  postarTimelineHibrido,
} from '../_shared/bitrix-timeline.ts'
import { checkPhoneExclusion } from '../_shared/bitrix-exclusion.ts'

interface ReqBody {
  batch_id: string
}

const TRANSCRIPTION_WAIT_MAX_MS = 10_000
const TRANSCRIPTION_POLL_INTERVAL_MS = 1500

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })

  const body: ReqBody = await req.json()
  if (!body.batch_id) {
    return jsonResp(400, { ok: false, error: 'MISSING_BATCH_ID' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const backgroundTask = (async () => {
    try {
      // ── 1. Buscar batch ───────────────────────────────────────────────────
      const { data: batch, error: batchErr } = await supabase
        .from('whatsapp_bitrix_batch')
        .select('id, conversation_id, message_ids, audio_pendente')
        .eq('id', body.batch_id)
        .maybeSingle()

      if (batchErr || !batch) {
        console.warn('[flush-batch] batch não encontrado:', body.batch_id)
        return
      }

      if (!batch.message_ids?.length) {
        console.warn(
          '[flush-batch] batch sem mensagens, deletando:',
          body.batch_id,
        )
        await supabase.from('whatsapp_bitrix_batch').delete().eq('id', batch.id)
        return
      }

      // ── 2. Idempotência: já foi flushed? ─────────────────────────────────
      const { data: existingLog } = await supabase
        .from('whatsapp_bitrix_timeline_log')
        .select('id')
        .eq('batch_id', batch.id)
        .eq('status', 'success')
        .limit(1)

      if (existingLog && existingLog.length > 0) {
        console.log('[flush-batch] batch já flushed, deletando:', batch.id)
        await supabase.from('whatsapp_bitrix_batch').delete().eq('id', batch.id)
        return
      }

      // ── 3. Se ainda há áudio pendente, esperar mais um pouco ─────────────
      if (batch.audio_pendente) {
        const start = Date.now()
        while (Date.now() - start < TRANSCRIPTION_WAIT_MAX_MS) {
          const { data: pendentes } = await supabase
            .from('whatsapp_messages')
            .select('id')
            .in('id', batch.message_ids)
            .eq('tipo', 'audio')
            .is('media_transcription', null)
            .is('transcription_failed_at', null)

          if (!pendentes || pendentes.length === 0) break
          await new Promise((r) =>
            setTimeout(r, TRANSCRIPTION_POLL_INTERVAL_MS),
          )
        }
      }

      // ── 4. Buscar entidade Bitrix e dados da conversa ─────────────────────
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select(
          'phone, bitrix_entity_id, bitrix_entity_type, contact_name, instance_id',
        )
        .eq('id', batch.conversation_id)
        .maybeSingle()

      // ── 4.a Telefone excluído do fluxo Bitrix (N-20) — defesa em profundidade ──
      // Este é o último ponto antes do post no timeline: se os guards
      // anteriores (add-message-to-batch, executive-handler) falharem por
      // qualquer motivo e um batch de telefone excluído chegar até aqui, o
      // batch é apagado sem postar. Assimetria de erro declarada: se a
      // consulta de exclusão falhar (rede/DB), ABORTA (fail-closed) — postar
      // no timeline do Bitrix não é reversível, diferente de tentar de novo
      // depois.
      if (conv?.phone) {
        const exclusion = await checkPhoneExclusion(supabase, conv.phone)
        if (exclusion.status === 'error') {
          console.warn(
            '[flush-batch] checagem de exclusão falhou, abortando post (fail-closed):',
            exclusion.message,
          )
          return
        }
        if (exclusion.status === 'excluded') {
          console.warn(
            `[flush-batch] telefone excluído (EXCLUIDO_CRM), apagando batch sem postar: ${batch.id}`,
          )
          await supabase
            .from('whatsapp_bitrix_batch')
            .delete()
            .eq('id', batch.id)
          return
        }
      } else {
        console.warn(
          `[flush-batch] conversa sem phone (batch=${batch.id}) — checagem de exclusão pulada, seguindo (fail-open)`,
        )
      }

      if (!conv?.bitrix_entity_id || !conv?.bitrix_entity_type) {
        console.warn('[flush-batch] conversa sem entidade Bitrix, abortando')
        return
      }

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('bitrix_user_nome')
        .eq('id', conv.instance_id)
        .maybeSingle()

      const executivoNome = instance?.bitrix_user_nome || 'Executivo'

      // ── 5. Buscar todas as mensagens do batch ─────────────────────────────
      const { data: msgs } = await supabase
        .from('whatsapp_messages')
        .select(
          'id, direcao, tipo, conteudo, caption, criado_em, media_transcription, audio_duration_seconds, media_ai_description',
        )
        .in('id', batch.message_ids)
        .order('criado_em', { ascending: true })

      if (!msgs || msgs.length === 0) {
        console.warn('[flush-batch] mensagens não encontradas, abortando')
        return
      }

      // ── 6. Montar comentário consolidado ──────────────────────────────────
      const comentario = formatarBatchTimeline({
        mensagens: msgs.map((m) => ({
          direcao: m.direcao as 'recebida' | 'enviada',
          tipo: m.tipo,
          conteudo: m.conteudo || '',
          caption: m.caption || null,
          criadoEm: new Date(m.criado_em),
          mediaTranscription: m.media_transcription || null,
          audioDurationSeconds: m.audio_duration_seconds || null,
          mediaAiDescription: m.media_ai_description || null,
        })),
        contactName: conv.contact_name || 'Contato',
        executivoNome,
      })

      // ── 7. Postar no Bitrix ───────────────────────────────────────────────
      const bitrixUrl = await getBitrixWebhookUrl(supabase)
      if (!bitrixUrl) {
        console.error('[flush-batch] bitrixUrl ausente, abortando')
        return
      }

      await postarTimelineHibrido({
        supabase,
        bitrixUrl,
        conversationId: batch.conversation_id,
        messageDbId: null,
        entityType: conv.bitrix_entity_type,
        entityId: conv.bitrix_entity_id,
        comentario,
      })

      // Anotar batch_id nos logs recém-criados (idempotência futura)
      await supabase
        .from('whatsapp_bitrix_timeline_log')
        .update({ batch_id: batch.id })
        .eq('conversation_id', batch.conversation_id)
        .gte('created_at', new Date(Date.now() - 60_000).toISOString())
        .is('batch_id', null)

      // ── 8. Deletar batch ──────────────────────────────────────────────────
      await supabase.from('whatsapp_bitrix_batch').delete().eq('id', batch.id)

      console.log(
        `[flush-batch] batch=${batch.id} flushed: ${msgs.length} mensagens postadas`,
      )
    } catch (e: any) {
      console.error('[flush-batch] erro:', e?.message, e?.stack)
    }
  })()

  // @ts-ignore - EdgeRuntime global do supabase-edge-runtime
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(backgroundTask)
  } else {
    backgroundTask.catch((e: any) =>
      console.error('[flush-batch] bg sem waitUntil:', e?.message),
    )
  }

  return new Response('OK', { status: 200 })
})
