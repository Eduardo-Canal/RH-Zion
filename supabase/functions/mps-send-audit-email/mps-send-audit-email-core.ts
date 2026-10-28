// Fase 6 do MPS — envio do e-mail de resultado (a parte que ficou bloqueada
// até o Everton confirmar o provedor: Office 365, 2026-07-13).
// Porte fiel de ProjetoAuditMPS/src/services/email.js (buildSubject/buildHtml)
// e da lógica de destinatários de sprints.js (rota de finalize).
//
// Divergência deliberada (documentada em BACKLOG.md): o original usava SMTP
// (nodemailer) — hoje a Microsoft está desativando SMTP AUTH básico em todos
// os tenants (prazo dez/2026), então aqui usamos a API do Microsoft Graph
// (sendMail) com autenticação de aplicativo (client credentials), sem SMTP.

export type BlockStats = {
  total: number
  conformidade: number
  ncCount: number
}

export function computeBlockStats(
  itens: { key: string }[],
  respostas: Record<string, { verificacao?: string } | undefined>,
): BlockStats {
  const conformidade = itens.filter(
    (it) => respostas[it.key]?.verificacao === 'OK',
  ).length
  const ncCount = itens.filter(
    (it) => respostas[it.key]?.verificacao === 'NOK',
  ).length
  // NA é neutro (decisão do Everton, 2026-07-16 — reverte a regra anterior
  // "NA conta contra"): total considerado pra % de aderência é só OK + NOK,
  // item marcado NA (ou ainda sem resposta) não entra na conta.
  const total = conformidade + ncCount
  return { total, conformidade, ncCount }
}

export function splitEmails(
  value: string | string[] | undefined | null,
): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map((s) => s.trim()).filter(Boolean)
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function resolveRecipients(
  to: string[],
  cc: string[],
  defaultTo: string[],
  defaultCc: string[],
): { to: string[]; cc: string[] } {
  return {
    to: to.length ? to : defaultTo,
    cc: cc.length ? cc : defaultCc,
  }
}

export function buildEmailSubject({
  grupo,
  blockLabel,
  projetoSprint,
}: {
  grupo: string
  blockLabel: string
  projetoSprint: string
}): string {
  const grupoFormatado = grupo
    .toUpperCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sprintNome = projetoSprint.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return `[ Auditoria Zion Logtec ] Projetos / ${grupoFormatado} / ${blockLabel.toUpperCase()} / Sprint ${sprintNome}`
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(2).replace('.', ',')}%`
}

function greetingForHour(hour: number): string {
  if (hour < 12) return 'bom dia'
  if (hour < 18) return 'boa tarde'
  return 'boa noite'
}

export function buildEmailHtml({
  dataAuditoria,
  blockLabel,
  grupo,
  projetoSprint,
  stats,
  auditGroupUrl,
  ncGroupUrl,
  observacoesGerais,
  now,
}: {
  dataAuditoria: string
  blockLabel: string
  grupo: string
  projetoSprint: string
  stats: BlockStats
  auditGroupUrl?: string
  ncGroupUrl?: string
  observacoesGerais?: string
  now?: Date
}): string {
  const pctBg = stats.conformidade >= stats.total ? '#2e7d32' : '#c00000'
  const auditGroupLink = auditGroupUrl || '#'
  const ncGroupLink = ncGroupUrl || '#'
  const saudacao = greetingForHour((now || new Date()).getHours())
  const ncCount = stats.ncCount

  return `
  <div style="font-family: Calibri, Arial, sans-serif; font-size: 14px; color: #000;">
    <p>Prezados Senhores, ${saudacao} a todos!</p>
    <p>Venho formalizar que hoje, ${dataAuditoria}, foi realizada auditoria de <b>${blockLabel.toUpperCase()}</b> no grupo <b>${grupo}</b>.<br/>
    Foi auditada a Sprint ${projetoSprint}</p>
    <p>Segue abaixo a conclusão da auditoria:</p>
    <table style="border-collapse: collapse; border: 1px solid #999;" cellpadding="6">
      <tr>
        <td style="background:#808080; color:#fff; font-weight:bold; border:1px solid #999;">Total de itens avaliados (OK + NOK)</td>
        <td style="border:1px solid #999;">${stats.total}</td>
      </tr>
      <tr>
        <td style="font-weight:bold; border:1px solid #999;">Itens em conformidade</td>
        <td style="border:1px solid #999;">${stats.conformidade}</td>
      </tr>
      <tr>
        <td style="font-weight:bold; border:1px solid #999;">% de Aderência</td>
        <td style="background:${pctBg}; color:#fff; font-weight:bold; border:1px solid #999;">${formatPercent(stats.total ? stats.conformidade / stats.total : 0)}</td>
      </tr>
    </table>
    <p>${ncCount > 0 ? `<b style="color:#c00000;">Resultando em ${ncCount} NC${ncCount > 1 ? 's' : ''} aberta${ncCount > 1 ? 's' : ''}.</b>` : 'Sem NCs abertas.'}</p>
    <p>Na ferramenta Bitrix24, o checklist da auditoria preenchido pode ser visualizado no Grupo de Trabalho:
      <a href="${auditGroupLink}">[ Auditorias Zion Logtec ]</a>.<br/>
      E as NCs, quando houver, estarão no grupo de Trabalho <a href="${ncGroupLink}">[ NC ] Não Conformidades</a></p>
    ${observacoesGerais ? `<p><b style="color:#1a3d7c;">OBS.: ${observacoesGerais}</b></p>` : ''}
    <p>Atenciosamente,</p>
  </div>`
}

export function buildGraphTokenRequestBody(
  clientId: string,
  clientSecret: string,
): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
}

export type EmailAttachment = {
  name: string
  contentType: string
  contentBytesBase64: string
}

export function buildSendMailPayload({
  subject,
  html,
  to,
  cc,
  attachment,
}: {
  subject: string
  html: string
  to: string[]
  cc: string[]
  attachment?: EmailAttachment | null
}) {
  return {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: cc.map((address) => ({ emailAddress: { address } })),
      ...(attachment
        ? {
            attachments: [
              {
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: attachment.name,
                contentType: attachment.contentType,
                contentBytes: attachment.contentBytesBase64,
              },
            ],
          }
        : {}),
    },
    saveToSentItems: true,
  }
}

/** Porte fiel de htmlToPlainText (sprints.js) — usado pra postar o conteúdo do e-mail como comentário na tarefa de acompanhamento do Bitrix. */
export function htmlToPlainText(html: string): string {
  return String(html || '')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}
