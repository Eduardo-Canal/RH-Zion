import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import { getBitrixMpsWebhookUrl } from '../_shared/get-bitrix-mps-webhook-url.ts'
import {
  parseSprintDateRange,
  webhookUserId,
  computeBlockDisplayLabels,
  buildAuditTaskTitle,
  buildAuditTaskFinalTitle,
  buildAuditTaskDescription,
  computeAuditTaskDeadline,
} from './mps-create-audit-task-core.ts'

// Fase 6 do MPS (parte "tarefa de acompanhamento no Bitrix" + "arquivo da
// auditoria"), pedida pelo Everton em seguida ao e-mail de resultado. Porte
// fiel de sprints.js (rota POST /sprints) + bitrix.js (createAuditTask):
// ao criar uma auditoria, cria uma tarefa "guarda-chuva" no grupo de
// Auditorias do Bitrix com 1 item de checklist por bloco, e copia o
// template escolhido pra um arquivo próprio da auditoria (bucket
// mps-audit-files) — esse arquivo é o que depois recebe as respostas e
// vai anexado no e-mail de resultado (ver mps-send-audit-email).
//
// Best-effort, igual ao original: se audit_group_id não estiver
// configurado, não faz nada (a auditoria já foi criada sem isso, e nunca
// pediu essa config) — só falha "de verdade" (e devolve erro pro front
// mostrar um aviso) se o Bitrix em si der erro depois de configurado.
const SETTINGS_KEY = 'mps_sprint_config'
const TEMPLATES_BUCKET = 'mps-templates'
const AUDIT_FILES_BUCKET = 'mps-audit-files'

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
    const { auditId } = payload
    if (!auditId)
      return new Response(JSON.stringify({ error: 'auditId obrigatório.' }), {
        status: 400,
        headers: corsHeaders,
      })

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

    const { data: settingsRow } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle()
    const mpsConfig = settingsRow?.value || {}

    // Cópia do template pro arquivo próprio da auditoria — não depende de
    // audit_group_id, faz sempre que houver um template escolhido.
    let audit_file_path: string | null = null
    if (audit.template_name) {
      const { data: templateFile, error: downloadErr } =
        await supabaseAdmin.storage
          .from(TEMPLATES_BUCKET)
          .download(audit.template_name)
      if (downloadErr)
        throw new Error(
          `Falha ao baixar o template original: ${downloadErr.message}`,
        )
      audit_file_path = `${auditId}.xlsx`
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(AUDIT_FILES_BUCKET)
        .upload(audit_file_path, templateFile, { upsert: true })
      if (uploadErr)
        throw new Error(
          `Falha ao copiar o arquivo da auditoria: ${uploadErr.message}`,
        )
    }

    if (!mpsConfig.audit_group_id) {
      const { error: updateErr } = await supabaseAdmin
        .from('mps_audits')
        .update({ audit_file_path })
        .eq('id', auditId)
      if (updateErr) throw updateErr
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'audit_group_id não configurado',
          audit_file_path,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const bitrixWebhookUrl = await getBitrixMpsWebhookUrl(supabaseAdmin)
    const bitrix = createBitrixClient(
      supabaseUrl,
      serviceRoleKey,
      bitrixWebhookUrl,
    )
    const responsibleId = webhookUserId(bitrixWebhookUrl)
    if (!responsibleId)
      throw new Error(
        'Não foi possível identificar o usuário responsável a partir da URL do Webhook.',
      )

    const blocks: { key: string; label: string }[] = audit.estrutura || []
    const displayLabels = computeBlockDisplayLabels(blocks)
    const { dateStart, dateEnd } = parseSprintDateRange(audit.projeto_sprint)

    const titleBase = buildAuditTaskTitle({
      grupo: audit.grupo,
      projetoSprint: audit.projeto_sprint,
    })
    const description = buildAuditTaskDescription({
      dateStart,
      dateEnd,
      blockLabels: Object.values(displayLabels),
    })

    const fields: Record<string, any> = {
      TITLE: titleBase,
      DESCRIPTION: description,
      GROUP_ID: mpsConfig.audit_group_id,
      RESPONSIBLE_ID: responsibleId,
    }
    if (dateEnd) fields.DEADLINE = computeAuditTaskDeadline(dateEnd)

    const created: any = await bitrix.callBitrix('tasks.task.add', { fields })
    const taskId = created.task.id
    await bitrix.callBitrix('tasks.task.update', {
      taskId,
      fields: { TITLE: buildAuditTaskFinalTitle(taskId, titleBase) },
    })

    const checklistItemIds: Record<string, any> = {}
    for (const block of blocks) {
      const itemResult: any = await bitrix.callBitrix(
        'task.checklistitem.add',
        { TASKID: taskId, FIELDS: { TITLE: displayLabels[block.key] } },
      )
      checklistItemIds[block.key] = itemResult
    }

    // O 1º item criado acima não tem PARENT_ID, então o Bitrix cria um
    // grupo-raiz implícito ("BX_CHECKLIST_1") acima dele — renomeia pra
    // algo com sentido pro auditor.
    const items: any[] =
      (await bitrix.callBitrix('task.checklistitem.getlist', {
        TASKID: taskId,
      })) || []
    const rootId = items.find((i) => Number(i.PARENT_ID) === 0)?.ID
    if (rootId)
      await bitrix.callBitrix('task.checklistitem.update', {
        TASKID: taskId,
        ITEMID: rootId,
        FIELDS: { TITLE: 'Etapas' },
      })

    const { error: updateErr } = await supabaseAdmin
      .from('mps_audits')
      .update({
        bitrix_task_id: String(taskId),
        bitrix_checklist_item_ids: checklistItemIds,
        audit_file_path,
      })
      .eq('id', auditId)
    if (updateErr) throw updateErr

    return new Response(
      JSON.stringify({ taskId, checklistItemIds, audit_file_path }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
