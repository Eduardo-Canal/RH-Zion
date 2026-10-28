// Edge: whatsapp-edit-message
// Edita texto de uma mensagem já enviada via uazapi /message/edit
// Recebe: { message_id, novo_texto }
// Restrições:
//   - mensagem precisa ser direcao='enviada'
//   - mensagem precisa ter no máx 15min (validação informativa; uazapi rejeita se passar)
//   - apenas tipo 'texto'

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
      novo_texto?: string
    }
    if (!body.message_id || !body.novo_texto?.trim()) {
      return jsonResp(400, {
        ok: false,
        error: 'BAD_REQUEST',
        message: 'message_id e novo_texto obrigatórios',
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Buscar mensagem + conversa + instance
    // Nota: `message_id` (TEXT) = ID do WhatsApp; `id` (UUID) = PK interna
    const { data: msg, error: msgErr } = await supabase
      .from('whatsapp_messages')
      .select(
        'id, message_id, direcao, tipo, conteudo, conversation_id, texto_original, criado_em',
      )
      .eq('id', body.message_id)
      .maybeSingle()

    if (msgErr || !msg) {
      return jsonResp(404, { ok: false, error: 'MESSAGE_NOT_FOUND' })
    }
    if (msg.direcao !== 'enviada') {
      return jsonResp(400, {
        ok: false,
        error: 'NOT_FROM_ME',
        message: 'Apenas mensagens enviadas podem ser editadas',
      })
    }
    if (msg.tipo !== 'texto') {
      return jsonResp(400, {
        ok: false,
        error: 'NOT_TEXT',
        message: 'uazapi só edita texto',
      })
    }
    if (!msg.message_id) {
      return jsonResp(400, {
        ok: false,
        error: 'NO_WA_ID',
        message: 'Mensagem sem ID WhatsApp; não pode ser editada',
      })
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

    // Chamar uazapi /message/edit
    const uazapiRes = await fetch(`${baseUrl}/message/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: instance.instance_token,
      },
      body: JSON.stringify({
        id: msg.message_id,
        text: body.novo_texto.trim(),
      }),
    }).catch((e) => {
      console.error('[edit-message] fetch error:', e)
      return null
    })

    if (!uazapiRes) {
      return jsonResp(502, { ok: false, error: 'UAZAPI_UNREACHABLE' })
    }
    if (!uazapiRes.ok) {
      const errText = await uazapiRes.text().catch(() => '')
      return jsonResp(502, {
        ok: false,
        error: 'UAZAPI_ERROR',
        message: `uazapi ${uazapiRes.status}: ${errText.slice(0, 200)}`,
      })
    }

    // Atualizar banco: preservar texto_original na primeira edição
    const updateData: Record<string, unknown> = {
      conteudo: body.novo_texto.trim(),
      editado_em: new Date().toISOString(),
    }
    if (!msg.texto_original) {
      updateData.texto_original = msg.conteudo
    }

    const { error: updErr } = await supabase
      .from('whatsapp_messages')
      .update(updateData)
      .eq('id', msg.id)

    if (updErr) {
      console.error('[edit-message] update error:', updErr)
      return jsonResp(500, {
        ok: false,
        error: 'DB_UPDATE_ERROR',
        message: 'uazapi editou mas banco falhou',
      })
    }

    return jsonResp(200, { ok: true })
  } catch (err) {
    console.error('[edit-message] unexpected:', err)
    return jsonResp(500, {
      ok: false,
      error: 'UNEXPECTED',
      message: String(err),
    })
  }
})
