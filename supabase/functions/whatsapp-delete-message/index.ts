// Edge: whatsapp-delete-message
// Apaga uma mensagem em 2 modos:
//   - "todos": chama uazapi /message/delete (apaga no WhatsApp do cliente + do executivo)
//   - "apenas_eu": só marca apagado_em no banco (Co-Piloto esconde, WhatsApp do cliente continua intacto)
// Recebe: { message_id, modo: 'todos' | 'apenas_eu' }

import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResp = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response(null, { headers: corsHeaders })

  try {
    const body = (await req.json()) as {
      message_id?: string
      modo?: 'todos' | 'apenas_eu'
    }
    if (
      !body.message_id ||
      !body.modo ||
      !['todos', 'apenas_eu'].includes(body.modo)
    ) {
      return jsonResp(400, {
        ok: false,
        error: 'BAD_REQUEST',
        message: 'message_id e modo (todos|apenas_eu) obrigatórios',
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Nota: `message_id` (TEXT) = ID do WhatsApp; `id` (UUID) = PK interna
    const { data: msg } = await supabase
      .from('whatsapp_messages')
      .select('id, message_id, direcao, conversation_id, apagado_em')
      .eq('id', body.message_id)
      .maybeSingle()

    if (!msg) return jsonResp(404, { ok: false, error: 'MESSAGE_NOT_FOUND' })
    if (msg.apagado_em)
      return jsonResp(400, { ok: false, error: 'ALREADY_DELETED' })

    // Modo "apenas_eu": só banco, sem uazapi
    if (body.modo === 'apenas_eu') {
      const { error: updErr } = await supabase
        .from('whatsapp_messages')
        .update({
          apagado_em: new Date().toISOString(),
          apagado_modo: 'apenas_eu',
        })
        .eq('id', msg.id)
      if (updErr) return jsonResp(500, { ok: false, error: 'DB_UPDATE_ERROR' })
      return jsonResp(200, { ok: true, modo: 'apenas_eu' })
    }

    // Modo "todos": precisa chamar uazapi
    if (msg.direcao !== 'enviada') {
      return jsonResp(400, {
        ok: false,
        error: 'NOT_FROM_ME',
        message:
          'Apagar pra todos só funciona em mensagens enviadas. Use "apenas pra mim".',
      })
    }
    if (!msg.message_id) {
      return jsonResp(400, { ok: false, error: 'NO_WA_ID' })
    }

    const { data: conv } = await supabase
      .from('whatsapp_conversations')
      .select('instance_id')
      .eq('id', msg.conversation_id)
      .maybeSingle()
    if (!conv)
      return jsonResp(404, { ok: false, error: 'CONVERSATION_NOT_FOUND' })

    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('instance_token, status')
        .eq('id', conv.instance_id)
        .maybeSingle(),
    ])
    const cfg = moduleRes.data
    const instance = instanceRes.data
    if (!cfg || !instance)
      return jsonResp(500, { ok: false, error: 'CONFIG_MISSING' })
    if (instance.status !== 'conectado')
      return jsonResp(409, { ok: false, error: 'INSTANCE_DISCONNECTED' })
    if (!instance.instance_token)
      return jsonResp(500, { ok: false, error: 'NO_TOKEN' })

    const baseUrl = (cfg.uazapi_base_url || 'https://free.uazapi.com').replace(
      /\/$/,
      '',
    )

    const uazapiRes = await fetch(`${baseUrl}/message/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: instance.instance_token,
      },
      body: JSON.stringify({ id: msg.message_id }),
    }).catch(() => null)

    if (!uazapiRes)
      return jsonResp(502, { ok: false, error: 'UAZAPI_UNREACHABLE' })
    if (!uazapiRes.ok) {
      const errText = await uazapiRes.text().catch(() => '')
      return jsonResp(502, {
        ok: false,
        error: 'UAZAPI_ERROR',
        message: `uazapi ${uazapiRes.status}: ${errText.slice(0, 200)}`,
      })
    }

    const { error: updErr } = await supabase
      .from('whatsapp_messages')
      .update({ apagado_em: new Date().toISOString(), apagado_modo: 'todos' })
      .eq('id', msg.id)
    if (updErr) {
      console.error('[delete-message] update error:', updErr)
      return jsonResp(500, {
        ok: false,
        error: 'DB_UPDATE_ERROR',
        message: 'uazapi apagou mas banco falhou',
      })
    }

    return jsonResp(200, { ok: true, modo: 'todos' })
  } catch (err) {
    console.error('[delete-message] unexpected:', err)
    return jsonResp(500, {
      ok: false,
      error: 'UNEXPECTED',
      message: String(err),
    })
  }
})
