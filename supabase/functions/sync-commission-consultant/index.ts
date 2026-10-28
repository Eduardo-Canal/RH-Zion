import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Acesso negado: Token ausente' }),
        {
          status: 401,
          headers: corsHeaders,
        },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    const supabaseAuth = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )

    const { data: userData, error: userError } =
      await supabaseAuth.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({
          error: 'Acesso negado: Token inválido',
          details: userError?.message,
        }),
        { status: 401, headers: corsHeaders },
      )
    }

    // Verificar que o chamador é Administrador (mesmo check da admin-create-user)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*, perfis_acesso(*)')
      .eq('user_id', userData.user.id)
      .maybeSingle()

    const pa: any = profile?.perfis_acesso
    const nomePerfil = Array.isArray(pa) ? pa[0]?.nome : pa?.nome
    const permissoesPerfil = Array.isArray(pa)
      ? pa[0]?.permissoes
      : pa?.permissoes

    const isAdmin =
      nomePerfil === 'Administrador' ||
      (Array.isArray(permissoesPerfil) &&
        permissoesPerfil.includes('Acessar Admin'))

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Acesso negado: Permissão insuficiente' }),
        { status: 403, headers: corsHeaders },
      )
    }

    const body = await req.json()
    const { user_id, role_ids } = body

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id é obrigatório' }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    const { data: consultantId, error: rpcError } = await supabaseAdmin.rpc(
      'sync_commission_consultant',
      {
        p_user_id: user_id,
        p_role_ids: Array.isArray(role_ids) ? role_ids : [],
      },
    )

    if (rpcError) {
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    return new Response(
      JSON.stringify({ success: true, consultant_id: consultantId }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
