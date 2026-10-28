import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import { getBitrixMpsWebhookUrl } from '../_shared/get-bitrix-mps-webhook-url.ts'
import {
  buildNcContent,
  buildNcFinalTitle,
  webhookUserId,
} from './mps-create-nc-core.ts'

// Fase 5 do MPS — cria Não Conformidade DE VERDADE no Bitrix (ação de
// escrita, mais delicada que tudo que veio antes — Fases 1-4 só liam).
// Porte fiel de ProjetoAuditMPS/src/routes/sprints.js (createNcForAnswer +
// as rotas /questions/:key/create-nc e /create-ncs-all).
//
// Uma única função cobre os 2 modos do original: `questionKey` presente =
// cria só aquele item (individual); ausente = cria todos os itens NOK do
// bloco sem NC ainda (em lote) — cada item tenta independente, uma falha
// não derruba as outras (mesmo padrão do original).
//
// Idempotente: item que já tem `nc_task_id` em respostas não cria de novo,
// só devolve o que já existe — evita NC duplicada se clicar 2x ou se o
// finalizar (que também aciona isso) rodar mais de uma vez.
//
// Usa o webhook EXCLUSIVO do MPS (bitrix24_webhook_mps) — é exatamente o
// cenário pra que ele foi criado: toda tarefa nasce com o usuário desse
// webhook como responsável.
const SETTINGS_KEY = 'mps_sprint_config'

async function createNcTask(
  bitrix: ReturnType<typeof createBitrixClient>,
  webhookUrl: string,
  ncGroupId: string,
  titleBase: string,
  description: string,
) {
  const responsibleId = webhookUserId(webhookUrl)
  if (!responsibleId)
    throw new Error(
      'Não foi possível identificar o usuário responsável a partir da URL do Webhook.',
    )

  const created: any = await bitrix.callBitrix('tasks.task.add', {
    fields: {
      TITLE: titleBase,
      DESCRIPTION: description,
      GROUP_ID: ncGroupId,
      RESPONSIBLE_ID: responsibleId,
    },
  })
  const taskId = created.task.id
  const finalTitle = buildNcFinalTitle(taskId, titleBase)
  await bitrix.callBitrix('tasks.task.update', {
    taskId,
    fields: { TITLE: finalTitle },
  })
  return { taskId, title: finalTitle }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader)
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const {
      data: { user: userData },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !userData)
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: corsHeaders,
      })

    const payload = await req.json().catch(() => ({}))
    const { auditId, blockKey, questionKey } = payload
    if (!auditId || !blockKey) {
      return new Response(
        JSON.stringify({ error: 'auditId e blockKey obrigatórios.' }),
        { status: 400, headers: corsHeaders },
      )
    }

    const { data: audit, error: auditErr } = await supabaseAdmin
      .from('mps_audits')
      .select('*')
      .eq('id', auditId)
      .single()
    if (auditErr || !audit)
      return new Response(
        JSON.stringify({ error: 'Auditoria não encontrada.' }),
        { status: 404, headers: corsHeaders },
      )

    const { data: bloco, error: blocoErr } = await supabaseAdmin
      .from('mps_audit_blocos')
      .select('*')
      .eq('audit_id', auditId)
      .eq('block_key', blockKey)
      .single()
    if (blocoErr || !bloco)
      return new Response(JSON.stringify({ error: 'Bloco não encontrado.' }), {
        status: 404,
        headers: corsHeaders,
      })
    if (bloco.status === 'concluido') {
      return new Response(
        JSON.stringify({ error: 'Este bloco já foi finalizado.' }),
        { status: 400, headers: corsHeaders },
      )
    }

    const { data: settingsRow } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle()
    const settings = settingsRow?.value || {}
    const ncGroupId = settings.nc_group_id
    if (!ncGroupId) {
      return new Response(
        JSON.stringify({
          error:
            'ID do grupo de Não Conformidades não configurado em Configurações.',
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    const blockDef = (audit.estrutura || []).find(
      (b: any) => b.key === blockKey,
    )
    if (!blockDef)
      return new Response(
        JSON.stringify({
          error: 'Bloco não encontrado na estrutura da auditoria.',
        }),
        { status: 404, headers: corsHeaders },
      )
    const blockLabel = String(blockKey).split('::')[0]

    const itens = questionKey
      ? blockDef.itens.filter((it: any) => it.key === questionKey)
      : blockDef.itens
    if (questionKey && itens.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Pergunta não encontrada neste bloco.' }),
        { status: 404, headers: corsHeaders },
      )
    }

    const bitrixWebhookUrl = await getBitrixMpsWebhookUrl(supabaseAdmin)
    const bitrix = createBitrixClient(
      supabaseUrl,
      serviceRoleKey,
      bitrixWebhookUrl,
    )

    const respostas = { ...(bloco.respostas || {}) }
    const results: Record<string, any> = {}
    let mudou = false

    for (const item of itens) {
      const resp = respostas[item.key]
      if (!resp || resp.verificacao !== 'NOK') {
        if (questionKey) {
          return new Response(
            JSON.stringify({ error: 'Este item não está marcado como NOK.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        continue // em lote: ignora silenciosamente itens que não são NOK
      }
      if (resp.nc_task_id) {
        results[item.key] = { taskId: resp.nc_task_id, alreadyExisted: true }
        continue
      }
      try {
        const { titleBase, description } = buildNcContent(
          audit.grupo,
          blockLabel,
          audit.projeto_sprint,
          item,
          resp.observacoes,
        )
        const created = await createNcTask(
          bitrix,
          bitrixWebhookUrl,
          ncGroupId,
          titleBase,
          description,
        )
        respostas[item.key] = { ...resp, nc_task_id: created.taskId }
        results[item.key] = { taskId: created.taskId, alreadyExisted: false }
        mudou = true
      } catch (err: any) {
        results[item.key] = { error: err.message }
      }
    }

    if (mudou) {
      const { error: updateErr } = await supabaseAdmin
        .from('mps_audit_blocos')
        .update({ respostas, updated_at: new Date().toISOString() })
        .eq('audit_id', auditId)
        .eq('block_key', blockKey)
      if (updateErr) throw updateErr
    }

    return new Response(JSON.stringify({ results }), {
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
