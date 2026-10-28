import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders() })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(supabaseUrl, serviceKey)

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: profileRow } = await adminClient
    .from('profiles')
    .select('perfil_id, perfis_acesso(nome)')
    .eq('user_id', user.id)
    .maybeSingle()

  const userRole: string =
    (profileRow as any)?.perfis_acesso?.nome || 'Visualizador'
  const isAdmin = userRole === 'Administrador'
  const isAdminOrSupervisor = isAdmin || userRole === 'Supervisor'

  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  const resourceId =
    ['PATCH', 'DELETE'].includes(req.method) &&
    lastSegment !== 'feature-requests'
      ? lastSegment
      : null

  if (req.method === 'GET') {
    if (isAdminOrSupervisor) {
      const { data, error } = await adminClient
        .from('feature_requests')
        .select('*')
        .order('criado_em', { ascending: false })
      if (error) return json({ error: error.message }, 500)
      return json(data)
    } else {
      const { data, error } = await userClient
        .from('feature_requests')
        .select('*')
        .order('criado_em', { ascending: false })
      if (error) return json({ error: error.message }, 500)
      return json(data)
    }
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const { titulo, descricao, prioridade = 'media' } = body
    if (!titulo || !descricao) {
      return json({ error: 'titulo e descricao são obrigatórios' }, 400)
    }
    const { data, error } = await userClient
      .from('feature_requests')
      .insert({ titulo, descricao, prioridade, user_id: user.id })
      .select()
      .single()
    if (error) return json({ error: error.message }, 500)
    return json(data, 201)
  }

  if (req.method === 'PATCH') {
    if (!isAdmin)
      return json({ error: 'Forbidden — apenas Administrador' }, 403)
    if (!resourceId) return json({ error: 'ID obrigatório na URL' }, 400)
    const body = await req.json()
    const updates: Record<string, unknown> = {}
    if (body.status) updates.status = body.status
    if (body.admin_notas !== undefined) updates.admin_notas = body.admin_notas
    if (body.version_implementada)
      updates.version_implementada = body.version_implementada
    if (body.status && body.status !== 'implementado')
      updates.revisado_em = new Date().toISOString()
    if (body.status === 'implementado')
      updates.implementado_em = new Date().toISOString()
    const { data, error } = await adminClient
      .from('feature_requests')
      .update(updates)
      .eq('id', resourceId)
      .select()
      .single()
    if (error) return json({ error: error.message }, 500)
    return json(data)
  }

  if (req.method === 'DELETE') {
    if (!isAdmin)
      return json({ error: 'Forbidden — apenas Administrador' }, 403)
    if (!resourceId) return json({ error: 'ID obrigatório na URL' }, 400)
    const { error } = await adminClient
      .from('feature_requests')
      .delete()
      .eq('id', resourceId)
    if (error) return json({ error: error.message }, 500)
    return json({ success: true })
  }

  return json({ error: 'Method not allowed' }, 405)
})
