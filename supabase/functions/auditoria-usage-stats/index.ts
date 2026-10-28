import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Expõe auditoria_page_view_stats(periodo, usuario) pra aba "Auditoria"
// (uso/tempo por tela) do Admin Panel da Auditoria.
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

    const payload = await req.json().catch(() => ({}))
    const { period, userId } = payload

    const periodosValidos = ['day', 'week', 'month']
    if (!periodosValidos.includes(period)) {
      return new Response(
        JSON.stringify({ error: `period inválido: ${period}` }),
        { status: 400, headers: corsHeaders },
      )
    }

    const { data, error } = await supabaseAdmin.rpc(
      'auditoria_page_view_stats',
      {
        p_period: period,
        p_user_id: userId || null,
      },
    )
    if (error) throw error

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
