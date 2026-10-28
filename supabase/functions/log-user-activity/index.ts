import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => ({}))
    const { event_type, user_id, session_token, device_info, action_details } =
      payload

    // Extract IP safely (inet type requires valid IP or null)
    const forwardedFor = req.headers.get('x-forwarded-for')
    let ip_address = null
    if (forwardedFor) {
      ip_address = forwardedFor.split(',')[0].trim()
      // If it's not a valid IPv4 or IPv6, set it to null to avoid database errors
      if (
        !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip_address) &&
        !/^[a-fA-F0-9:]+$/.test(ip_address)
      ) {
        ip_address = null
      }
    }

    const user_agent = req.headers.get('user-agent') || 'unknown'

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    const now = new Date()
    const timestamp = now.toISOString()

    if (event_type === 'login') {
      // Check for multiple simultaneous logins
      const { data: activeSessions } = await supabaseAdmin
        .from('user_sessions')
        .select('id')
        .eq('user_id', user_id)
        .is('logout_time', null)
        .neq('session_token', session_token || '')

      if (activeSessions && activeSessions.length > 0) {
        await supabaseAdmin.from('suspicious_activity').insert({
          user_id,
          tipo_atividade: 'MULTIPLE_LOGINS',
          descricao: `Usuário iniciou uma nova sessão enquanto possuía ${activeSessions.length} sessão(ões) ativa(s).`,
          severidade: 'Média',
          timestamp,
        })
      }

      await supabaseAdmin.from('user_sessions').insert({
        user_id,
        session_token,
        ip_address,
        device_info,
        login_time: timestamp,
      })

      await supabaseAdmin.from('audit_logs').insert({
        user_id,
        action: 'LOGIN',
        entity_type: 'auth',
        changes: { device_info },
        ip_address,
        user_agent,
      })
    } else if (event_type === 'logout') {
      await supabaseAdmin
        .from('user_sessions')
        .update({ logout_time: timestamp })
        .eq('session_token', session_token)
        .is('logout_time', null)

      await supabaseAdmin.from('audit_logs').insert({
        user_id,
        action: 'LOGOUT',
        entity_type: 'auth',
        changes: null,
        ip_address,
        user_agent,
      })
    } else if (event_type === 'action') {
      const { acao, tabela_acessada, dados_acessados } = action_details || {}

      await supabaseAdmin.from('audit_logs').insert({
        user_id,
        action: acao || 'VIEW',
        entity_type: tabela_acessada || 'page',
        changes: dados_acessados ?? null,
        ip_address,
        user_agent,
      })

      // Sensitive access out of hours check
      const hour = now.getUTCHours()
      // 23 UTC to 09 UTC = 20 BRT to 06 BRT
      const isOutOfHours = hour >= 23 || hour < 9
      const sensitiveTables = [
        'profiles',
        'carteira_clientes',
        'leads_salvos',
        'export',
      ]

      if (isOutOfHours && sensitiveTables.includes(tabela_acessada)) {
        await supabaseAdmin.from('suspicious_activity').insert({
          user_id,
          tipo_atividade: 'OUT_OF_HOURS_ACCESS',
          descricao: `Acesso a dados sensíveis (${tabela_acessada}) fora do horário comercial.`,
          severidade: 'Alta',
          timestamp,
        })
      }

      if (acao === 'export') {
        const isLargeExport = dados_acessados?.count > 1000
        if (isLargeExport || isOutOfHours) {
          await supabaseAdmin.from('suspicious_activity').insert({
            user_id,
            tipo_atividade: 'SENSITIVE_EXPORT',
            descricao: `Exportação de dados (${tabela_acessada}) ${isOutOfHours ? 'fora do horário' : 'em grande volume'}.`,
            severidade: 'Alta',
            timestamp,
          })
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
