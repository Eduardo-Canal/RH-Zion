import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Constantes ──────────────────────────────────────────────────────────────

const JANELA_HORAS = 6 // só reprocessa mensagens das últimas N horas
const MAX_RETRIES = 5 // limite de tentativas por mensagem
const BATCH_SIZE = 20 // máximo de mensagens por execução do cron
const HANDLER_TIMEOUT = 25000 // timeout ao invocar o executive-handler (ms)

// ─── Helper: invocar handler com timeout ──────────────────────────────────────

async function invokeExecutiveHandler(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), HANDLER_TIMEOUT)
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/whatsapp-executive-handler`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      },
    )
    clearTimeout(timeoutId)
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err: any) {
    clearTimeout(timeoutId)
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
    }
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // ── 1. Buscar mensagens elegíveis para retry ────────────────────────────────
  // Critérios:
  //   - processado = false
  //   - retry_count < MAX_RETRIES
  //   - criado_em nas últimas JANELA_HORAS
  //   - tipo = 'texto' (apenas texto gera sugestão)
  //   - direcao = 'recebida' (só processa entrada do cliente)
  //   - Conversa pertence a instância do tipo 'executivo'
  const cutoff = new Date(
    Date.now() - JANELA_HORAS * 60 * 60 * 1000,
  ).toISOString()

  const { data: messages, error: queryError } = await supabase
    .from('whatsapp_messages')
    .select(
      `
      id, message_id, conversation_id, conteudo, tipo, direcao, criado_em, retry_count,
      conversation:conversation_id (
        id, phone, contact_name, instance_id,
        instance:instance_id ( id, tipo )
      )
    `,
    )
    .eq('processado', false)
    .lt('retry_count', MAX_RETRIES)
    .gte('criado_em', cutoff)
    .eq('tipo', 'texto')
    .eq('direcao', 'recebida')
    .order('criado_em', { ascending: true })
    .limit(BATCH_SIZE)

  if (queryError) {
    console.error('[retry] erro ao buscar mensagens:', queryError.message)
    return json({ error: queryError.message }, 500)
  }

  if (!messages || messages.length === 0) {
    return json({
      success: true,
      total: 0,
      message: 'Nenhuma mensagem pendente.',
    })
  }

  let sucesso = 0
  let falha = 0
  let esgotado = 0
  let pulado = 0

  // ── 2. Para cada mensagem, reinvocar o executive-handler ───────────────────
  for (const msg of messages) {
    const conv = msg.conversation as any
    const inst = conv?.instance as any

    // Pular se conversa órfã ou instância não-executiva
    if (!conv || !inst || inst.tipo !== 'executivo') {
      // Marcar como processado para não tentar mais (não é caso de retry)
      await supabase
        .from('whatsapp_messages')
        .update({ processado: true, retry_count: MAX_RETRIES })
        .eq('id', msg.id)
      pulado++
      continue
    }

    const payload = {
      instance_id: inst.id,
      conversation_id: conv.id,
      message_db_id: msg.id,
      phone: conv.phone,
      contact_name: conv.contact_name || conv.phone,
      text: msg.conteudo || '',
      msg_type: msg.tipo,
      quoted_message_id: null,
      message: { key: { id: msg.message_id, fromMe: false } },
    }

    const result = await invokeExecutiveHandler(
      supabaseUrl,
      serviceRoleKey,
      payload,
    )
    const novoCount = (msg.retry_count || 0) + 1

    if (result.ok) {
      // O executive-handler já marca processado=true ao concluir.
      // Se ainda assim ficou false, atualizamos retry_count para refletir tentativa.
      await supabase
        .from('whatsapp_messages')
        .update({
          retry_count: novoCount,
          last_retry_at: new Date().toISOString(),
        })
        .eq('id', msg.id)
        .eq('processado', false)
      sucesso++
    } else {
      // Falha — incrementa retry_count
      const updates: Record<string, any> = {
        retry_count: novoCount,
        last_retry_at: new Date().toISOString(),
      }
      // Se atingiu o limite, marca como esgotado (processado=true para parar de tentar)
      if (novoCount >= MAX_RETRIES) {
        updates.processado = true
        esgotado++
      } else {
        falha++
      }
      await supabase.from('whatsapp_messages').update(updates).eq('id', msg.id)

      console.warn(
        `[retry] mensagem ${msg.id} falhou (tentativa ${novoCount}/${MAX_RETRIES}): ${result.error}`,
      )
    }
  }

  console.log(
    `[retry] processadas ${messages.length}: sucesso=${sucesso} falha=${falha} esgotado=${esgotado} pulado=${pulado}`,
  )

  return json({
    success: true,
    total: messages.length,
    sucesso,
    falha,
    esgotado,
    pulado,
  })
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
