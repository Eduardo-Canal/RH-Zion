/**
 * Busca a URL do webhook Bitrix24 da tabela settings.
 * Lança erro explícito se não estiver configurada — não há fallback hardcoded.
 */
export async function getBitrixWebhookUrl(supabaseAdmin: any): Promise<string> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'bitrix24_webhook_url')
    .maybeSingle()

  if (data?.value) {
    let url = typeof data.value === 'string' ? data.value : String(data.value)
    // Remover aspas extras se vier como JSON string
    url = url.replace(/^"+|"+$/g, '')
    if (!url.endsWith('/')) url += '/'
    return url
  }

  throw new Error(
    'Bitrix webhook não configurado em settings.bitrix24_webhook_url',
  )
}
