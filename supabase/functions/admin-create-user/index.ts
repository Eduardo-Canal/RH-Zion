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

    // Client com Service Role Key para contornar RLS e permitir createUser com email_confirm auto
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

    // Verifica de fato se o chamador possui nível de permissão Administrador
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
    const {
      email,
      senha,
      nome,
      perfil_id,
      ativo,
      require_password_update,
      bitrix_user_id,
      celular_corporativo,
    } = body

    if (!email || !senha || !nome) {
      return new Response(
        JSON.stringify({
          error: 'Dados obrigatórios faltando (email, senha ou nome)',
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    // A criação por Admin bypassa o limite de rate-limit de email confirmation comum.
    const { data: newAuthUser, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      })

    if (createError) {
      let errMsg = createError.message
      if (
        errMsg.includes('already been registered') ||
        errMsg.includes('already registered')
      ) {
        errMsg = 'Já existe um usuário cadastrado com este e-mail.'
      }
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    if (!newAuthUser?.user) {
      return new Response(
        JSON.stringify({
          error: 'Falha ao criar o usuário de autenticação no provedor',
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        user_id: newAuthUser.user.id,
        email,
        nome,
        perfil_id: perfil_id || null,
        ativo: ativo ?? true,
        require_password_update: require_password_update ?? false,
        bitrix_user_id: bitrix_user_id || null,
        celular_corporativo: celular_corporativo || null,
      })

    if (profileError) {
      // Rollback na auth caso a inserção do profile dê ruim por qualquer motivo
      await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id)
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    return new Response(
      JSON.stringify({ success: true, user: newAuthUser.user }),
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
