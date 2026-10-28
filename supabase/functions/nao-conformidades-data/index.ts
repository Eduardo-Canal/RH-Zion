import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador único para as 10 consultas da tela Não Conformidades (módulo Auditoria).
// Cada `view` chama a função SQL equivalente (public.auditoria_nc_*), criada em
// 20260702091500_auditoria_nc_query_functions.sql — mesmo padrão de RPC usado em
// current_user_has_permission. Evita duplicar boilerplate de auth/CORS em 10 functions.
const VIEW_TO_RPC: Record<string, string> = {
  data: 'auditoria_nc_data',
  tasks: 'auditoria_nc_tasks',
  responsaveis: 'auditoria_nc_responsaveis',
  tendencia: 'auditoria_nc_tendencia',
  'por-grupo': 'auditoria_nc_por_grupo',
  aging: 'auditoria_nc_aging',
  velocidade: 'auditoria_nc_velocidade',
  'escalonamento-por-grupo': 'auditoria_nc_escalonamento_por_grupo',
  'status-abertos': 'auditoria_nc_status_abertos',
  'escalonamento-por-responsavel': 'auditoria_nc_escalonamento_por_responsavel',
}

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
    const { view, dateStart, dateEnd, group, stageId, responsible, openOnly } =
      payload

    const rpcName = VIEW_TO_RPC[view]
    if (!rpcName) {
      return new Response(JSON.stringify({ error: `view inválida: ${view}` }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    const rpcParams: Record<string, unknown> = {}
    if (view !== 'por-grupo' && view !== 'escalonamento-por-grupo')
      rpcParams.p_group = group ?? null
    rpcParams.p_date_from = dateStart ?? null
    rpcParams.p_date_to = dateEnd ?? null
    if (view === 'tasks') {
      rpcParams.p_stage_id = stageId ?? null
      rpcParams.p_responsible = responsible ?? null
      rpcParams.p_open_only = openOnly === true || openOnly === 'true'
    }

    const { data, error } = await supabaseAdmin.rpc(rpcName, rpcParams)
    if (error) {
      console.error(`nao-conformidades-data (${view}):`, error.message)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
