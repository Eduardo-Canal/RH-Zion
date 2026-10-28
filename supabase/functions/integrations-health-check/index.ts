import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { obterAccessTokenGoogleAds } from '../_shared/google-ads-token.ts'

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIMEOUT_MS = 15_000
const COOLDOWN_MS = 4 * 60 * 60 * 1000

// ─── Checagem OpenAI ──────────────────────────────────────────────────────────

async function verificarOpenAI(
  apiKey: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    })
    clearTimeout(tid)
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}` }
    return { ok: true }
  } catch (err: any) {
    clearTimeout(tid)
    return {
      ok: false,
      motivo: err.name === 'AbortError' ? 'timeout' : err.message,
    }
  }
}

// ─── Checagem Bitrix ──────────────────────────────────────────────────────────

async function verificarBitrix(
  supabase: any,
): Promise<{ ok: boolean; motivo?: string }> {
  let webhookUrl: string
  try {
    webhookUrl = await getBitrixWebhookUrl(supabase)
  } catch (err: any) {
    return { ok: false, motivo: err.message }
  }

  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${webhookUrl}profile.json`, {
      signal: ctrl.signal,
    })
    clearTimeout(tid)
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}` }
    const data = await res.json()
    if (data?.error) return { ok: false, motivo: String(data.error) }
    return { ok: true }
  } catch (err: any) {
    clearTimeout(tid)
    return {
      ok: false,
      motivo: err.name === 'AbortError' ? 'timeout' : err.message,
    }
  }
}

// ─── Checagem Google Ads ──────────────────────────────────────────────────────
//
// Por que entrou (Everton, 18/08/2026): a autorização do Google Ads quebra
// sozinha — refresh token expira quando o app OAuth está em modo "Testing"
// (7 dias), ou é revogado. Como só a tela de sincronização tocava nesse token,
// a falha só aparecia quando alguém clicava "Sincronizar" e via o erro. Aqui o
// health-check (que já roda sozinho e notifica os admins) passa a descobrir
// primeiro, com a instrução do que fazer dentro do próprio aviso.
//
// A checagem é a MESMA operação que a sync faz no primeiro passo: trocar o
// refresh token por um access token. Não gasta cota da Google Ads API — é só o
// endpoint de OAuth — e não escreve nada.
async function verificarGoogleAds(
  supabase: any,
): Promise<{ ok: boolean; motivo?: string }> {
  const { data: cfgRow } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'google_ads_config')
    .maybeSingle()
  const cfg = cfgRow?.value || {}
  const { client_id: clientId, client_secret: clientSecret } = cfg
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      motivo: 'não configurado — preencha Client ID/Secret em Integrações',
    }
  }

  const { data: tokenRow } = await supabase
    .from('tokens_google_ads')
    .select('refresh_token')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle()
  if (!tokenRow?.refresh_token) {
    return {
      ok: false,
      motivo:
        'não autorizado — clique em "Autorizar via Google" em Integrações',
    }
  }

  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    await obterAccessTokenGoogleAds(
      clientId,
      clientSecret,
      tokenRow.refresh_token,
    )
    clearTimeout(tid)
    return { ok: true }
  } catch (err: any) {
    clearTimeout(tid)
    // A mensagem já vem pronta e acionável do helper compartilhado (código do
    // Google + descrição + o que fazer) — repassa como está.
    return {
      ok: false,
      motivo: err.name === 'AbortError' ? 'timeout' : err.message,
    }
  }
}

// Nome de exibição da integração no aviso. Sem isso, 'google_ads' virava
// "Google_ads" no título da notificação (o capitalize genérico de antes).
const NOMES_INTEGRACAO: Record<string, string> = {
  openai: 'OpenAI',
  bitrix: 'Bitrix24',
  google_ads: 'Google Ads',
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // ── 0. Validar secret do header Authorization ───────────────────────────────
  const { data: healthCfg } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'integrations_health_config')
    .maybeSingle()
  const expectedSecret: string = healthCfg?.value?.secret_key || ''

  if (expectedSecret) {
    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.error(
        '[integrations-health-check] Authorization ausente ou inválido',
      )
      return json({ error: 'unauthorized' }, 401)
    }
  } else {
    console.warn(
      '[integrations-health-check] health-check sem secret configurado — executando sem validação',
    )
  }

  // ── 1. Ler chave OpenAI: settings.openai_config → fallback env ─────────────
  const { data: openaiCfg } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'openai_config')
    .maybeSingle()
  const apiKey: string =
    openaiCfg?.value?.api_key || Deno.env.get('OPENAI_API_KEY') || ''

  // ── 2. Executar checagens ─────────────────────────────────────────────────
  const openaiResult = apiKey
    ? await verificarOpenAI(apiKey)
    : { ok: false, motivo: 'chave não configurada' }

  const bitrixResult = await verificarBitrix(supabase)
  const googleAdsResult = await verificarGoogleAds(supabase)

  const itens: Array<{
    integracao: string
    result: { ok: boolean; motivo?: string }
  }> = [
    { integracao: 'openai', result: openaiResult },
    { integracao: 'bitrix', result: bitrixResult },
    { integracao: 'google_ads', result: googleAdsResult },
  ]

  const agora = new Date().toISOString()

  for (const { integracao, result } of itens) {
    const status = result.ok ? 'OK' : 'FALHA'
    const motivo = result.ok ? null : (result.motivo ?? null)

    // ── 3. Ler ultima_notificacao antes de sobrescrever ───────────────────────
    const { data: registroAtual } = await supabase
      .from('integration_health')
      .select('ultima_notificacao')
      .eq('integracao', integracao)
      .maybeSingle()

    // ── 4. Upsert do resultado ─────────────────────────────────────────────────
    await supabase
      .from('integration_health')
      .upsert(
        { integracao, status, motivo, verificado_em: agora },
        { onConflict: 'integracao' },
      )

    // ── 5. Notificar admins se FALHA e cooldown expirado ──────────────────────
    if (status === 'FALHA') {
      const ultimaNotificacao = registroAtual?.ultima_notificacao
        ? new Date(registroAtual.ultima_notificacao).getTime()
        : 0
      const diffMs = Date.now() - ultimaNotificacao

      if (diffMs >= COOLDOWN_MS) {
        const { data: perfilAdmin } = await supabase
          .from('perfis_acesso')
          .select('id')
          .eq('nome', 'Administrador')
          .maybeSingle()

        const { data: adminsRaw } = perfilAdmin
          ? await supabase
              .from('profiles')
              .select('user_id')
              .eq('perfil_id', perfilAdmin.id)
              .eq('ativo', true)
          : { data: null }

        const admins = (adminsRaw ?? []).filter((a: any) => a.user_id)

        if (admins && admins.length > 0) {
          const nomeIntegracao =
            NOMES_INTEGRACAO[integracao] ??
            integracao.charAt(0).toUpperCase() + integracao.slice(1)
          await supabase.from('notifications').insert(
            admins.map((a: any) => ({
              user_id: a.user_id,
              title: `⚠️ Integração ${nomeIntegracao} com falha`,
              message: `${motivo ?? 'Falha detectada'}. Verifique em Configurações → Integrações.`,
              read: false,
            })),
          )
          await supabase
            .from('integration_health')
            .update({ ultima_notificacao: agora })
            .eq('integracao', integracao)
        }
      }
    }
  }

  return json({
    openai: openaiResult.ok ? 'OK' : 'FALHA',
    bitrix: bitrixResult.ok ? 'OK' : 'FALHA',
    google_ads: googleAdsResult.ok ? 'OK' : 'FALHA',
    // O motivo vai no corpo também: quem chama o health-check na mão (ou olha o
    // log do cron) vê a causa sem precisar consultar integration_health.
    motivos: {
      openai: openaiResult.motivo ?? null,
      bitrix: bitrixResult.motivo ?? null,
      google_ads: googleAdsResult.motivo ?? null,
    },
  })
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
