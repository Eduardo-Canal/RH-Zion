import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supabaseUrl, supabaseKey)

    // Lê config do banco
    const { data: cfg, error: cfgErr } = await db
      .from('whatsapp_module_config')
      .select('id, uazapi_base_url, uazapi_global_token')
      .limit(1)
      .maybeSingle()

    if (cfgErr) return json({ success: false, error: cfgErr.message }, 500)

    if (!cfg)
      return json(
        { success: false, error: 'Configuração uazapi não encontrada.' },
        404,
      )

    const baseUrl = (cfg.uazapi_base_url || 'https://api.uazapi.dev').replace(
      /\/$/,
      '',
    )
    const token = cfg.uazapi_global_token || ''

    if (!token) {
      await db
        .from('whatsapp_module_config')
        .update({
          is_connected: false,
          last_check_at: new Date().toISOString(),
          last_check_error: 'Token global não configurado.',
        })
        .eq('id', cfg.id)

      return json({ success: false, error: 'Token global não configurado.' })
    }

    // Chama GET /instance/all com admintoken
    let apiRes: Response
    try {
      apiRes = await fetch(`${baseUrl}/instance/all`, {
        method: 'GET',
        headers: { admintoken: token },
      })
    } catch (fetchErr: any) {
      const errMsg = `Falha de rede ao conectar em ${baseUrl}: ${fetchErr.message}`
      await db
        .from('whatsapp_module_config')
        .update({
          is_connected: false,
          last_check_at: new Date().toISOString(),
          last_check_error: errMsg,
        })
        .eq('id', cfg.id)

      return json({ success: false, error: errMsg })
    }

    if (!apiRes.ok) {
      const errMsg = `uazapi retornou HTTP ${apiRes.status}: ${apiRes.statusText}`
      await db
        .from('whatsapp_module_config')
        .update({
          is_connected: false,
          last_check_at: new Date().toISOString(),
          last_check_error: errMsg,
        })
        .eq('id', cfg.id)

      return json({ success: false, error: errMsg })
    }

    const body = await apiRes.json().catch(() => null)
    const instances = Array.isArray(body)
      ? body
      : (body?.instances ?? body?.data ?? [])
    const count = instances.length

    await db
      .from('whatsapp_module_config')
      .update({
        is_connected: true,
        last_check_at: new Date().toISOString(),
        last_check_error: null,
      })
      .eq('id', cfg.id)

    return json({ success: true, instances_count: count })
  } catch (err: any) {
    return json({ success: false, error: err.message }, 500)
  }
})
