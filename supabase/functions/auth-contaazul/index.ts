import { createSupabaseAdmin } from '../_shared/supabase-admin.ts'
import { corsHeaders } from '../_shared/cors.ts'

const TOKEN_URL = 'https://auth.contaazul.com/oauth2/token'

async function fetchContaAzulToken(payload: URLSearchParams) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(JSON.stringify(data))
  }
  return data
}

async function getStoredToken(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from('tokens_contaazul')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle()
  return data
}

async function loadContaAzulCredentials(supabaseAdmin: any) {
  let clientId = Deno.env.get('CLIENT_ID') || ''
  let clientSecret = Deno.env.get('CLIENT_SECRET') || ''
  let redirectUri = Deno.env.get('REDIRECT_URI') || ''

  try {
    const { data } = await supabaseAdmin
      .from('abc_curve_config')
      .select('config')
      .eq('type', 'conta_azul')
      .maybeSingle()

    if (data?.config) {
      clientId = String(data.config.client_id || clientId)
      clientSecret = String(data.config.client_secret || clientSecret)
      redirectUri = String(data.config.redirect_uri || redirectUri)
    }
  } catch {
    // fallback to env only
  }

  return { clientId, clientSecret, redirectUri }
}

async function storeTokens(supabaseAdmin: any, tokenInfo: any) {
  const payload = {
    id: '00000000-0000-0000-0000-000000000001',
    access_token: tokenInfo.access_token,
    refresh_token: tokenInfo.refresh_token,
    expires_at: tokenInfo.expires_in
      ? new Date(Date.now() + Number(tokenInfo.expires_in) * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabaseAdmin
    .from('tokens_contaazul')
    .upsert(payload, {
      onConflict: 'id',
    })
  if (error) throw error
  return data
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const supabaseAdmin = createSupabaseAdmin()
    const action = body.action || 'validate'

    if (action === 'getTokens') {
      const code = body.code
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

      const credentials = await loadContaAzulCredentials(supabaseAdmin)
      const clientId = body.clientId || credentials.clientId
      const clientSecret = body.clientSecret || credentials.clientSecret
      const redirectUri = body.redirectUri || credentials.redirectUri

      const payload = new URLSearchParams()
      payload.set('grant_type', 'authorization_code')
      payload.set('code', code)
      payload.set('client_id', clientId)
      payload.set('client_secret', clientSecret)
      payload.set('redirect_uri', redirectUri)

      const tokenInfo = await fetchContaAzulToken(payload)
      await storeTokens(supabaseAdmin, tokenInfo)

      return new Response(JSON.stringify({ success: true, data: tokenInfo }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'refreshToken') {
      const stored = await getStoredToken(supabaseAdmin)
      const refreshToken = body.refreshToken || stored?.refresh_token
      if (!refreshToken) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Refresh token não encontrado',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const credentials = await loadContaAzulCredentials(supabaseAdmin)
      const clientId = body.clientId || credentials.clientId
      const clientSecret = body.clientSecret || credentials.clientSecret
      const payload = new URLSearchParams()
      payload.set('grant_type', 'refresh_token')
      payload.set('refresh_token', refreshToken)
      payload.set('client_id', clientId)
      payload.set('client_secret', clientSecret)

      const tokenInfo = await fetchContaAzulToken(payload)
      await storeTokens(supabaseAdmin, tokenInfo)

      return new Response(JSON.stringify({ success: true, data: tokenInfo }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'validate') {
      const stored = await getStoredToken(supabaseAdmin)
      if (stored?.refresh_token) {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Refresh token disponível',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
      const credentials = await loadContaAzulCredentials(supabaseAdmin)
      if (
        !credentials.clientId ||
        !credentials.clientSecret ||
        !credentials.redirectUri
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Credenciais Conta Azul não configuradas',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Credenciais Conta Azul configuradas',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (action === 'test_connection') {
      const clientId = body.client_id || ''
      const clientSecret = body.client_secret || ''

      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Client ID e Client Secret são obrigatórios',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const idOk = clientId.length >= 10
      const secretOk = clientSecret.length >= 20

      if (!idOk || !secretOk) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              'Credenciais com formato inválido. Verifique Client ID e Client Secret.',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Credenciais salvas. Conecte via OAuth para ativar o sync.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(
      JSON.stringify({ success: false, message: 'Ação desconhecida' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
