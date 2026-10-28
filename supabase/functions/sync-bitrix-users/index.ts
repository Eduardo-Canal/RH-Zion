import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { resolveAndCacheUsers } from '../_shared/resolve-bitrix-users.ts'

// Backfill sob demanda de public.b24_users (Prompt 169, Parte A) — acionável
// manualmente (ex.: botão futuro "sincronizar usuários"). Cobre de uma vez os
// IDs que hoje aparecem sem nome no MKT (crm_leads.assigned_by_id), no
// apontamento do Sprint (sprint_elapsed.user_id) e no ponto batido
// (timeman_entries.user_id), além dos responsáveis de tarefa
// (sprint_tasks.responsible_id) — mesma lógica de resolve-bitrix-users.ts que
// os syncs usam pra manutenção contínua (Parte B), sem duplicar.
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

    // União de IDs de todas as fontes que hoje dependem de b24_users pra
    // exibir nome (ver Prompts 166/167). Cada `select` é a mesma coluna já
    // usada pelas views existentes (mkt-data 'users', auditoria_sprint_*).
    const [leadsRes, respRes, elapsedRes, timemanRes] = await Promise.all([
      supabaseAdmin
        .from('crm_leads')
        .select('assigned_by_id')
        .not('assigned_by_id', 'is', null)
        .neq('assigned_by_id', ''),
      supabaseAdmin
        .from('sprint_tasks')
        .select('responsible_id')
        .not('responsible_id', 'is', null)
        .neq('responsible_id', ''),
      supabaseAdmin
        .from('sprint_elapsed')
        .select('user_id')
        .not('user_id', 'is', null),
      supabaseAdmin.from('timeman_entries').select('user_id'),
    ])

    for (const [nome, res] of [
      ['crm_leads', leadsRes],
      ['sprint_tasks', respRes],
      ['sprint_elapsed', elapsedRes],
      ['timeman_entries', timemanRes],
    ] as const) {
      if (res.error)
        throw new Error(`Falha ao ler ${nome}: ${res.error.message}`)
    }

    const allIds = [
      ...(leadsRes.data ?? []).map((r: any) => r.assigned_by_id),
      ...(respRes.data ?? []).map((r: any) => r.responsible_id),
      ...(elapsedRes.data ?? []).map((r: any) => r.user_id),
      ...(timemanRes.data ?? []).map((r: any) => r.user_id),
    ]

    const idsUnicos = Array.from(
      new Set(allIds.map((id: any) => String(id)).filter(Boolean)),
    )

    const { data: cachedRows } = await supabaseAdmin
      .from('b24_users')
      .select('id')
      .in('id', idsUnicos.length ? idsUnicos : ['__none__'])
    const jaExistentes = new Set((cachedRows ?? []).map((r: any) => r.id))

    const resolved = await resolveAndCacheUsers(supabaseAdmin, idsUnicos)

    const semNomeNoBitrix = idsUnicos.filter((id) =>
      resolved.get(id)?.startsWith('Usuário '),
    ).length

    return new Response(
      JSON.stringify({
        success: true,
        total_ids: idsUnicos.length,
        ja_existentes: jaExistentes.size,
        resolvidos: idsUnicos.length - jaExistentes.size,
        sem_nome_no_bitrix: semNomeNoBitrix,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
})
