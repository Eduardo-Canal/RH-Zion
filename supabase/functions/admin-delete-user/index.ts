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

    // Client com Service Role Key para contornar RLS e permitir admin.deleteUser
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    // Client padrão validado com o token recebido
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
          error: 'Acesso negado: Usuário solicitante inválido',
          details: userError?.message,
        }),
        { status: 401, headers: corsHeaders },
      )
    }

    // Verifica se o chamador possui permissão de Admin
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
        JSON.stringify({
          error: 'Acesso negado: Permissão insuficiente',
        }),
        { status: 403, headers: corsHeaders },
      )
    }

    const body = await req.json()
    const { user_id } = body

    if (!user_id) {
      return new Response(
        JSON.stringify({
          error: 'ID do usuário de autenticação não fornecido',
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    // A exclusão no auth.users vai apagar em cascata o registro correspondente em public.profiles
    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(user_id)

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
