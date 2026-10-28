/**
 * Busca a URL do webhook Bitrix24 exclusivo do MPS (auditoria de Sprint) da
 * tabela settings. Separado do bitrix24_webhook_sprint (usado só pelo sync
 * de Não Conformidades, que é leitura pura) — decisão do Everton
 * (2026-07-13): o MPS eventualmente CRIA tarefa no Bitrix (Fase 5, Não
 * Conformidade), e toda ação de um webhook de entrada aparece no Bitrix
 * como feita pelo usuário dono do webhook. Por isso este webhook deve ser
 * gerado a partir de um usuário "de sistema" dedicado no Bitrix (não a
 * conta pessoal de ninguém), e mantido isolado do webhook Sprint — que
 * continua ligado à conta usada quando foi criado. Escopo necessário:
 * tasks, sonet_group, disk, im, user (ver BACKLOG.md).
 */
export async function getBitrixMpsWebhookUrl(
  supabaseAdmin: any,
): Promise<string> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'bitrix24_webhook_mps')
    .maybeSingle()

  if (data?.value) {
    let url = typeof data.value === 'string' ? data.value : String(data.value)
    url = url.replace(/^"+|"+$/g, '')
    if (!url.endsWith('/')) url += '/'
    return url
  }

  throw new Error(
    'Webhook do Bitrix MPS não configurado em settings.bitrix24_webhook_mps',
  )
}
