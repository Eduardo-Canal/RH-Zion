import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Troca o código OAuth do Google (?code=... no redirect) por access/refresh
// token e guarda em tokens_google_ads. Chamada por GoogleAdsCallback.tsx
// depois que o usuário autoriza o acesso no consentimento do Google.
// Mesmo padrão de auth-contaazul (action getTokens).
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const {
      data: { user: userData },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !userData) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const body = await req.json().catch(() => ({}))
    const action = body.action || 'getTokens'

    if (action !== 'getTokens') {
      return new Response(
        JSON.stringify({ error: `action inválida: ${action}` }),
        { status: 400, headers: corsHeaders },
      )
    }

    const { code, redirectUri } = body
    if (!code) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Código OAuth é obrigatório',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const { data: settingsRow, error: settingsErr } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'google_ads_config')
      .maybeSingle()
    if (settingsErr) throw settingsErr

    const config = settingsRow?.value || {}
    if (!config.client_id || !config.client_secret) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            'Client ID/Secret do Google Ads não configurados em Integrações',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.client_id,
        client_secret: config.client_secret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(
        tokenData.error_description ||
          tokenData.error ||
          'Falha ao trocar código por token',
      )
    }

    // O Google só devolve refresh_token na primeira autorização (ou quando
    // prompt=consent força um novo). Se vier ausente aqui, deixamos de fora
    // do payload (undefined não entra no JSON) — assim o upsert não apaga
    // um refresh_token já salvo de uma autorização anterior.
    const upsertPayload: Record<string, unknown> = {
      id: '00000000-0000-0000-0000-000000000001',
      access_token: tokenData.access_token,
      expires_at: tokenData.expires_in
        ? new Date(
            Date.now() + Number(tokenData.expires_in) * 1000,
          ).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    }
    if (tokenData.refresh_token)
      upsertPayload.refresh_token = tokenData.refresh_token

    const { error: upsertErr } = await supabaseAdmin
      .from('tokens_google_ads')
      .upsert(upsertPayload, { onConflict: 'id' })
    if (upsertErr) throw upsertErr

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
})
