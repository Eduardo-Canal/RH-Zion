import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import XlsxPopulate from 'npm:xlsx-populate@1.21.0'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import { getBitrixMpsWebhookUrl } from '../_shared/get-bitrix-mps-webhook-url.ts'
import {
  computeBlockStats,
  splitEmails,
  resolveRecipients,
  buildEmailSubject,
  buildEmailHtml,
  buildGraphTokenRequestBody,
  buildSendMailPayload,
  htmlToPlainText,
} from './mps-send-audit-email-core.ts'
import {
  computeMetaFieldWrites,
  computeAnswerWrites,
} from './mps-write-audit-xlsx-core.ts'

// Fase 6 do MPS — envio do e-mail de resultado ao finalizar um bloco.
// Chamada pelo front ANTES de marcar o bloco como concluído (mesma ordem do
// original: sprints.js só grava o bloco como finalizado DEPOIS do
// email.sendAuditResultEmail resolver) — se o e-mail falhar, o finalizar
// inteiro para e nada é gravado, igual ao que já fazemos com a criação de NC.
//
// Diferente do original (SMTP/nodemailer): usa a API do Microsoft Graph com
// autenticação de aplicativo (client credentials) — decisão tomada 2026-07-13
// depois de confirmar que a Microsoft está desligando SMTP AUTH básico em
// todos os tenants (prazo dez/2026). Credenciais (tenant/client id, client
// secret) ficam em Integrações > E-mail (Office 365), settings key
// 'office365_email_config' — não é config específica do MPS, por isso não
// fica em mps_sprint_config.
//
// Anexo do arquivo: pesquisado 2026-07-13 antes de escolher biblioteca —
// nem SheetJS (community) nem ExcelJS preservam formatação condicional ao
// reabrir/regravar um arquivo existente (confirmado por comparação
// independente + issues das próprias bibliotecas). Usa xlsx-populate, que
// edita o XML original em vez de reconstruir do zero — testado rodando de
// verdade sob Deno antes de trocar (round-trip básico ok).
//
// Notificação na tarefa Bitrix (completar item de checklist + postar
// comentário): best-effort, IGUAL ao original (notifyBitrixAuditTask) — se
// falhar, não derruba o envio do e-mail nem o finalizar, só fica registrado
// no retorno da função pro front decidir se avisa alguma coisa.
const SETTINGS_KEY = 'mps_sprint_config'
const EMAIL_SETTINGS_KEY = 'office365_email_config'
const AUDIT_FILES_BUCKET = 'mps-audit-files'
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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
    const { auditId, blockKey, to, cc } = payload
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

    const { data: settingsRows } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', [SETTINGS_KEY, EMAIL_SETTINGS_KEY])
    const mpsConfig =
      (settingsRows || []).find((r: any) => r.key === SETTINGS_KEY)?.value || {}
    const emailConfig =
      (settingsRows || []).find((r: any) => r.key === EMAIL_SETTINGS_KEY)
        ?.value || {}

    const {
      tenant_id: tenantId,
      client_id: clientId,
      client_secret: clientSecret,
      sender_email: senderEmail,
    } = emailConfig
    if (!tenantId || !clientId || !clientSecret || !senderEmail) {
      return new Response(
        JSON.stringify({
          error: 'E-mail (Office 365) não configurado em Integrações.',
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    const { to: finalTo, cc: finalCc } = resolveRecipients(
      splitEmails(to),
      splitEmails(cc),
      splitEmails(mpsConfig.email_default_to),
      splitEmails(mpsConfig.email_default_cc),
    )
    if (finalTo.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Nenhum destinatário informado nem configurado como padrão.',
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    const stats = computeBlockStats(blockDef.itens, bloco.respostas || {})
    const subject = buildEmailSubject({
      grupo: audit.grupo,
      blockLabel,
      projetoSprint: audit.projeto_sprint,
    })
    const html = buildEmailHtml({
      dataAuditoria: bloco.data_auditoria,
      blockLabel,
      grupo: audit.grupo,
      projetoSprint: audit.projeto_sprint,
      stats,
      auditGroupUrl: mpsConfig.audit_group_url,
      ncGroupUrl: mpsConfig.nc_group_url,
      observacoesGerais: bloco.observacoes_gerais || '',
    })

    // Anexo: escreve as respostas deste bloco no arquivo próprio da
    // auditoria (criado na hora que a auditoria foi criada, ver
    // mps-create-audit-task) e sobe a versão atualizada de volta —
    // best-effort: sem audit_file_path (ex.: tarefa de criação falhou, ou
    // audit_group_id nunca foi configurado), o e-mail sai sem anexo.
    let attachment: {
      name: string
      contentType: string
      contentBytesBase64: string
    } | null = null
    if (audit.audit_file_path) {
      const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage
        .from(AUDIT_FILES_BUCKET)
        .download(audit.audit_file_path)
      if (downloadErr)
        throw new Error(
          `Falha ao abrir o arquivo da auditoria: ${downloadErr.message}`,
        )

      const workbook = await XlsxPopulate.fromDataAsync(
        await fileBlob.arrayBuffer(),
      )
      const sheet = workbook.sheet(blockLabel)
      if (!sheet)
        throw new Error(
          `Aba "${blockLabel}" não encontrada no arquivo da auditoria.`,
        )

      const writes = [
        ...computeMetaFieldWrites(blockDef.metaFields || [], {
          dataAuditoria: bloco.data_auditoria,
          auditor: audit.auditor,
          projetoSprint: audit.projeto_sprint,
        }),
        ...computeAnswerWrites(
          blockDef.columns || { verificacao: -1, observacoes: -1, nc: -1 },
          blockDef.itens,
          bloco.respostas || {},
        ),
      ]
      writes.forEach((w) => sheet.cell(w.row, w.col).value(w.value))

      const outBuf = await workbook.outputAsync()
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(AUDIT_FILES_BUCKET)
        .upload(audit.audit_file_path, outBuf, {
          upsert: true,
          contentType: XLSX_CONTENT_TYPE,
        })
      if (uploadErr)
        throw new Error(
          `Falha ao salvar o arquivo atualizado da auditoria: ${uploadErr.message}`,
        )

      const fileName =
        `${audit.grupo} - ${audit.projeto_sprint} - ${blockLabel}.xlsx`.replace(
          /[/\\]/g,
          '-',
        )
      attachment = {
        name: fileName,
        contentType: XLSX_CONTENT_TYPE,
        contentBytesBase64: base64FromBytes(new Uint8Array(outBuf)),
      }
    }

    const tokenResp = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildGraphTokenRequestBody(clientId, clientSecret),
      },
    )
    if (!tokenResp.ok) {
      const errText = await tokenResp.text()
      throw new Error(`Falha ao autenticar no Microsoft Graph: ${errText}`)
    }
    const { access_token: accessToken } = await tokenResp.json()

    const sendResp = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          buildSendMailPayload({
            subject,
            html,
            to: finalTo,
            cc: finalCc,
            attachment,
          }),
        ),
      },
    )
    if (!sendResp.ok) {
      const errText = await sendResp.text()
      throw new Error(`Falha ao enviar e-mail pelo Microsoft Graph: ${errText}`)
    }

    // Notifica a tarefa de acompanhamento no Bitrix — best-effort, igual ao
    // original: uma falha aqui não desfaz o e-mail (já enviado) nem impede
    // o finalizar de continuar.
    let bitrixNotifyWarning: string | null = null
    const checklistItemId = audit.bitrix_checklist_item_ids?.[blockKey]
    if (audit.bitrix_task_id && checklistItemId) {
      try {
        const bitrixWebhookUrl = await getBitrixMpsWebhookUrl(supabaseAdmin)
        const bitrix = createBitrixClient(
          supabaseUrl,
          serviceRoleKey,
          bitrixWebhookUrl,
        )
        try {
          await bitrix.callBitrix('task.checklistitem.update', {
            TASKID: audit.bitrix_task_id,
            ITEMID: checklistItemId,
            FIELDS: { IS_COMPLETE: 'Y' },
          })
        } catch (err: any) {
          console.error(
            `Falha ao marcar checklist da tarefa Bitrix ${audit.bitrix_task_id} (${blockKey}):`,
            err.message,
          )
        }
        try {
          const taskResult: any = await bitrix.callBitrix('tasks.task.get', {
            taskId: audit.bitrix_task_id,
            select: ['*'],
          })
          const chatId = taskResult?.task?.chatId
          if (!chatId)
            throw new Error(
              `Tarefa ${audit.bitrix_task_id} não tem chat associado (chatId ausente).`,
            )
          await bitrix.callBitrix('im.message.add', {
            DIALOG_ID: `chat${chatId}`,
            MESSAGE: `${subject}\n\n${htmlToPlainText(html)}`,
          })
        } catch (err: any) {
          console.error(
            `Falha ao postar comentário na tarefa Bitrix ${audit.bitrix_task_id}:`,
            err.message,
          )
          bitrixNotifyWarning = err.message
        }
      } catch (err: any) {
        bitrixNotifyWarning = err.message
      }
    }

    return new Response(
      JSON.stringify({
        sent: true,
        to: finalTo,
        cc: finalCc,
        subject,
        attached: !!attachment,
        bitrixNotifyWarning,
      }),
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

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
