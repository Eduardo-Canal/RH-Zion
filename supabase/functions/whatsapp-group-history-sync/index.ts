// Edge: whatsapp-group-history-sync
// Solicita histórico antigo de um grupo via uazapi /message/history-sync.
// As mensagens chegam via webhook e são salvas em whatsapp_group_messages automaticamente.
// Recebe: { group_id: string, count?: number }
// Retorna: { ok: true, solicitado: true }

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
    const body = (await req.json()) as { group_id?: string; count?: number }
    if (!body.group_id) {
      return jsonResp(400, {
        ok: false,
        error: 'BAD_REQUEST',
        message: 'group_id obrigatório',
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Buscar grupo → group_jid e instance_id
    const { data: group, error: grpErr } = await supabase
      .from('whatsapp_groups')
      .select('id, group_jid, instance_id')
      .eq('id', body.group_id)
      .maybeSingle()

    if (grpErr || !group) {
      return jsonResp(404, { ok: false, error: 'GROUP_NOT_FOUND' })
    }

    // 2. Buscar config uazapi + token da instância
    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('instance_token, status')
        .eq('id', group.instance_id)
        .maybeSingle(),
    ])

    const cfg = moduleRes.data
    const instance = instanceRes.data

    if (!instance?.instance_token) {
      return jsonResp(500, { ok: false, error: 'INSTANCE_TOKEN_MISSING' })
    }
    if (instance.status !== 'conectado') {
      return jsonResp(409, { ok: false, error: 'INSTANCE_DISCONNECTED' })
    }

    const baseUrl = (
      cfg?.uazapi_base_url || 'https://zionlogtec.uazapi.com'
    ).replace(/\/$/, '')
    const count = typeof body.count === 'number' ? body.count : 50

    // 3. Chamar uazapi /message/history-sync com o JID do grupo
    const uazResp = await fetch(`${baseUrl}/message/history-sync`, {
      method: 'POST',
      headers: {
        token: instance.instance_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number: group.group_jid, count }),
    })

    if (!uazResp.ok) {
      const errText = await uazResp.text().catch(() => '')
      console.error(
        '[group-history-sync] uazapi falhou:',
        uazResp.status,
        errText.slice(0, 200),
      )
      return jsonResp(502, {
        ok: false,
        error: 'UAZAPI_FETCH_FAILED',
        status: uazResp.status,
      })
    }

    console.log(
      `[group-history-sync] histórico solicitado para ${group.group_jid} (count=${count})`,
    )
    return jsonResp(200, { ok: true, solicitado: true })
  } catch (err) {
    console.error('[group-history-sync] erro:', err)
    return jsonResp(500, {
      ok: false,
      error: 'UNEXPECTED',
      message: String(err),
    })
  }
})
