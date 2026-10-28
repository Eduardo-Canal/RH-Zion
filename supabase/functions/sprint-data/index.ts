import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador único para a tela Sprint (módulo Auditoria). Views 'elapsed'/'timeman'
// retornam sempre vazio hoje — a sync ainda não popula essas tabelas (ver
// sync-sprint-bitrix e BACKLOG.md).
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
    const {
      view,
      groupId,
      groupIds,
      sprintId,
      taskIds,
      dateFrom,
      dateTo,
      excluirSemApontamento,
    } = payload

    let result: any

    switch (view) {
      case 'groups': {
        const { data, error } = await supabaseAdmin
          .from('sprint_groups')
          .select('id, name')
          .order('name')
        if (error) throw error
        result = data
        break
      }
      case 'stages': {
        if (!groupId)
          return new Response(
            JSON.stringify({ error: 'groupId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin
          .from('sprint_stages')
          .select('id, name, sort')
          .eq('scope', String(groupId))
          .order('sort')
        if (error) throw error
        result = data
        break
      }
      case 'sprints': {
        if (!groupId)
          return new Response(
            JSON.stringify({ error: 'groupId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_sprints',
          { p_group_id: String(groupId) },
        )
        if (error) throw error
        result = data
        break
      }
      case 'tasks': {
        if (!groupId)
          return new Response(
            JSON.stringify({ error: 'groupId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_tasks',
          {
            p_group_id: String(groupId),
            p_sprint_id: sprintId ? String(sprintId) : null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'chamados': {
        if (!groupId)
          return new Response(
            JSON.stringify({ error: 'groupId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_chamados',
          {
            p_group_id: String(groupId),
            p_date_from: dateFrom || null,
            p_date_to: dateTo || null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'paineis-dev-qa': {
        // Painéis operacionais do fim do Dashboard Scrum (Everton, 2026-08-12).
        // Sem groupId/sprintId de propósito: são MULTI-GRUPO, varrem todas as
        // sprints ativas + Kanban de uma vez. Toda a regra (o que é Dev, o que
        // é QA, o que conta como estourado) mora na função SQL.
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_paineis_dev_qa',
        )
        if (error) throw error
        result = data
        break
      }
      case 'elapsed': {
        if (!groupId)
          return new Response(
            JSON.stringify({ error: 'groupId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_elapsed',
          {
            p_group_id: String(groupId),
            p_sprint_id: sprintId ? String(sprintId) : null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'timeman': {
        if (!sprintId)
          return new Response(
            JSON.stringify({ error: 'sprintId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_timeman',
          { p_sprint_id: String(sprintId) },
        )
        if (error) throw error
        result = data
        break
      }
      // Ponto DIA A DIA (Everton, 2026-08-18). A aba Ociosidade por Pessoa
      // mostrava só o total por pessoa, então divergência com a grade do Bitrix
      // não tinha como ser conferida — só discutida. Aqui não entra regra nova
      // nenhuma: é a MESMA tabela que a view 'timeman' agrega, sem agregar,
      // pra dar pra comparar dia por dia com a tela do Bitrix. Select direto e
      // não função nova de propósito: leitura pura, sem migration.
      case 'timeman-dias': {
        if (!sprintId)
          return new Response(
            JSON.stringify({ error: 'sprintId obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin
          .from('timeman_entries')
          .select('user_id, date_entry, seconds')
          .eq('sprint_id', String(sprintId))
          .order('date_entry')
        if (error) throw error
        result = data
        break
      }
      case 'task-logs': {
        const ids = Array.isArray(taskIds)
          ? taskIds.map(String)
          : String(taskIds || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        if (!ids.length) {
          result = {}
          break
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_task_logs',
          { p_task_ids: ids },
        )
        if (error) throw error
        result = data
        break
      }
      // Voltas de QA pra Dev por tarefa (Everton, 2026-08-28). View separada da
      // 'tasks' de propósito: a tela carrega as duas em paralelo, então se o
      // histórico de etapa ainda não estiver sincronizado (ou a consulta falhar),
      // o backlog continua aparecendo normal — só a coluna de voltas fica vazia.
      case 'stage-voltas': {
        const ids = Array.isArray(taskIds)
          ? taskIds.map(String)
          : String(taskIds || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        if (!ids.length) {
          result = {}
          break
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_task_voltas',
          { p_task_ids: ids },
        )
        if (error) throw error
        result = data
        break
      }
      // Histórico de horas manuais, TODAS as sprints do grupo de uma vez
      // (Everton, 2026-08-29). Sem sprintId de propósito: a pergunta é
      // justamente comparar sprint com sprint, que hoje só dava pra fazer
      // abrindo uma por uma e clicando em "Sincronizar" em cada.
      //
      // A RPC devolve NULL no % das sprints ainda não atualizadas em vez de um
      // número — apontamento sem janela de relógio conta como "manual" na regra
      // do banco, então uma sprint não recarregada apareceria como 100% manual,
      // o que é falso. Ver migration 20260829100000.
      case 'horas-manuais': {
        const ids = Array.isArray(groupIds)
          ? groupIds.map(String).filter(Boolean)
          : String(groupIds || groupId || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        if (!ids.length) {
          return new Response(
            JSON.stringify({ error: 'groupId (ou groupIds) obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_horas_manuais',
          { p_group_ids: ids },
        )
        if (error) throw error
        result = data
        break
      }
      case 'horas-previstas': {
        // Módulo Horas Previstas (pedido do Everton, 2026-07-24) — cartões/
        // apontadas reaproveitam os mesmos dados já sincronizados pela tela
        // Sprint; a coluna Previstas fica bloqueada até o Oracle interno ser
        // alcançável (ver migration 20260724180000).
        if (!groupId || !sprintId)
          return new Response(
            JSON.stringify({ error: 'groupId e sprintId obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_horas_previstas_dados',
          {
            p_group_id: String(groupId),
            p_sprint_id: String(sprintId),
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'ociosidade': {
        // Aba Ociosidade do módulo Horas Previstas (pedido do Everton,
        // 2026-08-03) — estimadas x apontadas por sprint/time, com a hora
        // ociosa convertida pelo valor/hora do ano. Todo o cálculo está na
        // RPC (migration 20260803100000); aqui só valida a entrada.
        const ids = Array.isArray(groupIds)
          ? groupIds.map(String).filter(Boolean)
          : String(groupIds || groupId || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        if (!ids.length) {
          return new Response(
            JSON.stringify({ error: 'groupIds obrigatório.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_sprint_ociosidade',
          {
            p_group_ids: ids,
            // Default TRUE: só desliga quando a tela mandar false explicitamente.
            p_excluir_sem_apontamento: excluirSemApontamento !== false,
            p_ano: payload.ano ? Number(payload.ano) : null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      default:
        return new Response(
          JSON.stringify({ error: `view inválida: ${view}` }),
          { status: 400, headers: corsHeaders },
        )
    }

    return new Response(JSON.stringify(result), {
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
