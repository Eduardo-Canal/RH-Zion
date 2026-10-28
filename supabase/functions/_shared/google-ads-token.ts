/**
 * Troca o refresh token do Google Ads por um access token.
 *
 * Vive aqui, e não dentro de sync-google-ads, porque duas funções precisam
 * exatamente disso: a própria sync e o integrations-health-check (que passou a
 * monitorar a autorização do Google Ads). Duplicar significaria duas mensagens
 * de erro diferentes pro mesmo problema.
 *
 * A MENSAGEM É O PONTO. O Google manda o código do erro em `error`
 * (invalid_grant, invalid_client, unauthorized_client…) e um texto em
 * `error_description` que muitas vezes é só "Bad Request". A versão anterior
 * preferia a descrição, então a tela do Everton mostrou literalmente
 * "OAuth error: Bad Request" (18/08/2026) — sem distinguir autorização expirada
 * (reautorizar) de credencial trocada (corrigir Integrações), que são causas com
 * soluções diferentes. Aqui vão o código, a descrição, o status HTTP e, quando o
 * código é conhecido, o que fazer.
 */
export async function obterAccessTokenGoogleAds(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })

  const data = await res.json().catch(() => ({}) as any)

  // Sem access_token o resto da sync quebraria mais adiante com "undefined",
  // longe da causa — falha aqui, onde o motivo ainda é conhecido.
  if (data.error || !data.access_token) {
    const codigo = data.error || `HTTP ${res.status}`
    const detalhe = data.error_description ? ` (${data.error_description})` : ''
    const dica =
      data.error === 'invalid_grant'
        ? ' — a autorização do Google expirou ou foi revogada: clique em "Autorizar via Google" em Integrações'
        : data.error === 'invalid_client' ||
            data.error === 'unauthorized_client'
          ? ' — Client ID/Secret em Integrações não conferem com o app do Google que gerou a autorização'
          : ''
    throw new Error(`OAuth error: ${codigo}${detalhe}${dica}`)
  }

  return data.access_token as string
}
