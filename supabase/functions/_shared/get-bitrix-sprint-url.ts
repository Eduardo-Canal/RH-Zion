/**
 * Busca a URL do webhook Bitrix24 do quadro "Sprint" (módulo Auditoria) da tabela settings.
 * Webhook separado do bitrix24_webhook_url (CRM) — escopo de permissão diferente
 * (tasks/sonet_group em vez de crm.*). Lança erro explícito se não configurado.
 */
export async function getBitrixSprintWebhookUrl(
  supabaseAdmin: any,
): Promise<string> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'bitrix24_webhook_sprint')
    .maybeSingle()

  if (data?.value) {
    let url = typeof data.value === 'string' ? data.value : String(data.value)
    url = url.replace(/^"+|"+$/g, '')
    if (!url.endsWith('/')) url += '/'
    return url
  }

  throw new Error(
    'Webhook do Bitrix Sprint não configurado em settings.bitrix24_webhook_sprint',
  )
}
