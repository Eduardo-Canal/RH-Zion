// Edge: whatsapp-group-toggle-silence
// Recebe: { group_id: string, silenciado: boolean }
// UPDATE em whatsapp_groups.silenciado

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
      group_id?: string
      silenciado?: boolean
      apagar_historico?: boolean
    }
    if (!body.group_id || typeof body.silenciado !== 'boolean') {
      return jsonResp(400, {
        ok: false,
        error: 'BAD_REQUEST',
        message: 'group_id e silenciado (boolean) obrigatórios',
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase
      .from('whatsapp_groups')
      .update({
        silenciado: body.silenciado,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', body.group_id)
      .select('id, silenciado')
      .maybeSingle()

    if (error)
      return jsonResp(500, {
        ok: false,
        error: 'DB_ERROR',
        message: error.message,
      })
    if (!data) return jsonResp(404, { ok: false, error: 'GROUP_NOT_FOUND' })

    if (body.silenciado === true && body.apagar_historico === true) {
      const { error: delErr } = await supabase
        .from('whatsapp_group_messages')
        .delete()
        .eq('group_id', body.group_id)
      if (delErr) {
        console.warn(
          '[group-toggle-silence] erro apagando msgs:',
          delErr.message,
        )
        // Não bloqueia: já silenciou com sucesso. Só loga.
      }
    }

    return jsonResp(200, { ok: true, silenciado: data.silenciado })
  } catch (err) {
    console.error('[group-toggle-silence] erro:', err)
    return jsonResp(500, {
      ok: false,
      error: 'UNEXPECTED',
      message: String(err),
    })
  }
})
