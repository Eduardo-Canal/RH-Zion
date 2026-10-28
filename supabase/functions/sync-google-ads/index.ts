import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import {
  computePendingSlices,
  fetchAllPages,
  isFullyConverged,
  sliceKey,
  yearDateRange,
  type GadsAccount,
} from './gads-sync-core.ts'
import { obterAccessTokenGoogleAds } from '../_shared/google-ads-token.ts'

// Porte de api/routes/googleAds.js (rota POST /sync, a que o botão
// "Sincronizar" da tela realmente chamava no original) — Edge Function
// acionada pelo mesmo botão, igual ao padrão de
// sync-cs-bitrix/sync-mkt-bitrix. Suporta conta Gerenciadora (MCC): lista
// contas filhas e sincroniza cada uma.
//
// REFORMULAÇÃO 2026-07-11 (Prompt 155): o PR #9 do Everton (fix "histórico
// completo desde 2020") foi reprovado na auditoria (Prompt 154) — trocava
// LAST_30_DAYS por um range fixo 2020→hoje, mas continuava puxando TODAS as
// contas × todo o histórico numa invocação só, sem orçamento, sem progresso
// persistido, sem paginação. Sob volume real (múltiplas contas × ~6 anos de
// métricas diárias por campanha E por anúncio individual) isso morreria em
// 546 (WORKER_RESOURCE_LIMIT) antes de completar — mesma doença que o passo
// 6 do sync-mkt-bitrix tinha antes do Prompt 149.
//
// Esta versão aplica o mesmo padrão convergente do passo 6 (ver
// gads-sync-core.ts pra lógica pura/testável):
//   - Unidade de trabalho = (conta filha × ano), não "tudo de uma vez".
//   - Orçamento por invocação: no máximo GADS_SYNC_MAX_SLICES fatias por
//     clique em "Sincronizar" — clica de novo até convergir.
//   - Progresso em settings.gads_sync_progress, persistido a CADA fatia
//     concluída (não só na response) — uma morte no meio preserva o que já
//     foi processado, igual ao diagnóstico do passo 6.
//   - Paginação: fetchAllPages segue nextPageToken até esgotar, com teto de
//     segurança (GADS_SYNC_MAX_PAGES) que vira warning no diagnóstico em vez
//     de descartar dado antigo silenciosamente (limitação que o PR #9 e o
//     original sempre tiveram).
//   - Convergência: refere-se ao BACKFILL (anos fechados). Quando todos estão
//     completos, grava converged:true — mas o ANO CORRENTE continua sendo
//     refeito a cada invocação, em ciclos (ver computePendingSlices).
//
// CORREÇÃO 2026-08-18 (achado do Everton: "o total no período não tá
// atualizando"): antes, o ano corrente entrava em completedSlices como qualquer
// outro e nunca mais era refeito. Depois que o backfill convergia, clicar
// "Sincronizar" não trazia mais nada e o gasto da semana ficava congelado — sem
// erro nenhum aparecer, o que é pior. Agora só ano FECHADO é definitivo.
//
// VALIDAÇÃO PENDENTE: sem OAuth do Google Ads configurado neste ambiente,
// esta reformulação foi validada só estruturalmente (suíte de testes sobre
// gads-sync-core.ts, que é lógica pura sem chamada de rede real). O
// comportamento contra a API real (volume, paginação de verdade, risco de
// 546) só se confirma quando o Everton autorizar e clicar "Sincronizar"
// algumas vezes acompanhando settings.gads_sync_progress — ver BACKLOG.md.
const API_VERSIONS = ['v21', 'v22', 'v23', 'v24', 'v25']
const GADS_SYNC_MAX_SLICES = 3
const GADS_SYNC_MAX_PAGES = 50
const GADS_SYNC_MIN_YEAR = 2020
const GADS_SYNC_PROGRESS_KEY = 'gads_sync_progress'

async function detectApiVersion(
  accessToken: string,
  developerToken: string,
  mccId: string,
) {
  for (const v of API_VERSIONS) {
    const url = `https://googleads.googleapis.com/${v}/customers/${mccId}/googleAds:search`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'login-customer-id': mccId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'SELECT customer_client.id FROM customer_client LIMIT 1',
      }),
    })
    if (res.status === 200 || res.status === 400) {
      const data = await res.json().catch(() => ({}))
      if (
        data.error?.details?.[0]?.errors?.[0]?.errorCode?.requestError ===
        'UNSUPPORTED_VERSION'
      )
        continue
      return v
    }
  }
  throw new Error(
    'Nenhuma versão suportada da Google Ads API encontrada (v21-v25)',
  )
}

// Uma página de uma busca GAQL. pageToken opcional avança pra próxima página
// (Google Ads API devolve nextPageToken quando há mais resultados do que
// cabe numa página).
async function gadsQueryPage(
  accessToken: string,
  developerToken: string,
  mccId: string,
  apiVersion: string,
  accountId: string,
  gaql: string,
  pageToken: string | undefined,
) {
  const url = `https://googleads.googleapis.com/${apiVersion}/customers/${accountId}/googleAds:search`
  const body: Record<string, string> = { query: gaql }
  if (pageToken) body.pageToken = pageToken
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'login-customer-id': mccId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (data.error) throw new Error(JSON.stringify(data.error))
  return { results: data.results || [], nextPageToken: data.nextPageToken }
}

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

    // Bypass de auth SÓ pro secret da automação (settings.
    // gads_sync_automation_config.secret_key) — pg_cron não tem JWT de usuário
    // pra passar. Mesmo padrão já usado em sync-sprint-bitrix e
    // integrations-health-check: sem secret configurado a comparação nunca bate
    // (string vazia não autentica string vazia) e cai no fluxo de usuário normal
    // logo abaixo, ou seja, configurar errado FECHA o acesso, não abre.
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const { data: automationCfg } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'gads_sync_automation_config')
      .maybeSingle()
    const automationSecret: string =
      (automationCfg?.value as any)?.secret_key || ''
    const isAutomationCall =
      Boolean(automationSecret) && token === automationSecret

    if (!isAutomationCall) {
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
    }

    const { data: settingsRow, error: settingsErr } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'google_ads_config')
      .maybeSingle()
    if (settingsErr) throw settingsErr
    const config = settingsRow?.value || {}
    const {
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
      mcc_customer_id: mccIdRaw,
    } = config
    if (!clientId || !clientSecret || !developerToken || !mccIdRaw) {
      return new Response(
        JSON.stringify({
          error:
            'Google Ads não configurado — preencha Client ID/Secret, Developer Token e ID da conta gerenciadora em Integrações',
        }),
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }
    const mccId = String(mccIdRaw).replace(/-/g, '')

    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from('tokens_google_ads')
      .select('refresh_token')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .maybeSingle()
    if (tokenErr) throw tokenErr
    if (!tokenRow?.refresh_token) {
      return new Response(
        JSON.stringify({
          error:
            'Google Ads ainda não foi autorizado — clique em "Autorizar via Google" em Integrações',
        }),
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    const accessToken = await obterAccessTokenGoogleAds(
      clientId,
      clientSecret,
      tokenRow.refresh_token,
    )
    const apiVersion = await detectApiVersion(
      accessToken,
      developerToken,
      mccId,
    )

    // Lista de contas filhas do MCC — leve, refeita a cada invocação (mesmo
    // quando convergido) pra detectar conta nova. Paginada por segurança,
    // ainda que MCCs raramente tenham contas filhas suficientes pra precisar
    // de mais de 1 página.
    const childPaged = await fetchAllPages(
      (pageToken) =>
        gadsQueryPage(
          accessToken,
          developerToken,
          mccId,
          apiVersion,
          mccId,
          `
            SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level
            FROM customer_client
            WHERE customer_client.level = 1 AND customer_client.manager = false
          `,
          pageToken,
        ),
      GADS_SYNC_MAX_PAGES,
    )
    const accounts: GadsAccount[] = childPaged.results.map((r: any) => ({
      id: String(r.customerClient.id),
      name: r.customerClient.descriptiveName || `Conta ${r.customerClient.id}`,
    }))

    const today = new Date().toISOString().slice(0, 10)
    const currentYear = new Date().getUTCFullYear()

    const { data: progressRow, error: progressErr } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', GADS_SYNC_PROGRESS_KEY)
      .maybeSingle()
    if (progressErr) throw progressErr
    const prevProgress = (progressRow?.value as any) || {}
    const completedSlices: string[] = Array.isArray(
      prevProgress.completedSlices,
    )
      ? prevProgress.completedSlices
      : []
    const totals = {
      campaigns: prevProgress.totals?.campaigns ?? 0,
      metrics: prevProgress.totals?.metrics ?? 0,
      adMetrics: prevProgress.totals?.adMetrics ?? 0,
    }
    const startedAt = prevProgress.startedAt || new Date().toISOString()

    const warnings: string[] = []
    const errors: string[] = []
    const slicesProcessed: string[] = []

    const salvarProgresso = async (extra: Record<string, unknown> = {}) => {
      await supabaseAdmin.from('settings').upsert(
        {
          key: GADS_SYNC_PROGRESS_KEY,
          value: {
            startedAt,
            lastRunAt: new Date().toISOString(),
            accounts,
            completedSlices,
            totals,
            lastRun: { slicesProcessed, warnings, errors },
            ...extra,
          },
        },
        { onConflict: 'key' },
      )
    }

    const pendingSlices = computePendingSlices(
      accounts,
      completedSlices,
      currentYear,
      GADS_SYNC_MAX_SLICES,
      GADS_SYNC_MIN_YEAR,
    )

    if (!pendingSlices.length) {
      // Só cai aqui quando o MCC não tem NENHUMA conta filha: com pelo menos uma
      // conta, o ano corrente é sempre refresh pendente (ver
      // computePendingSlices), então não existe mais "nada a fazer" por
      // convergência — era isso que congelava o gasto do período atual.
      await salvarProgresso({ converged: true })
      return new Response(
        JSON.stringify({ converged: true, accounts: accounts.length, totals }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Campanhas (metadata da conta, não é fatiado por ano — refresh no
    // máximo 1x por conta por invocação, na primeira fatia dessa conta que
    // aparecer no lote desta rodada).
    const accountsCampaignsRefreshed = new Set<string>()

    for (const slice of pendingSlices) {
      const { start, end } = yearDateRange(slice.year, currentYear, today)

      if (!accountsCampaignsRefreshed.has(slice.accountId)) {
        accountsCampaignsRefreshed.add(slice.accountId)
        try {
          const paged = await fetchAllPages(
            (pageToken) =>
              gadsQueryPage(
                accessToken,
                developerToken,
                mccId,
                apiVersion,
                slice.accountId,
                `
                  SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date
                  FROM campaign
                  ORDER BY campaign.id
                `,
                pageToken,
              ),
            GADS_SYNC_MAX_PAGES,
          )
          if (paged.truncated)
            warnings.push(
              `campanhas da conta ${slice.accountId}: atingiu o teto de ${GADS_SYNC_MAX_PAGES} páginas, pode haver campanha faltando`,
            )
          if (paged.results.length) {
            const rows = paged.results.map((row: any) => ({
              id: String(row.campaign.id),
              account_id: slice.accountId,
              account_name: slice.accountName,
              name: row.campaign.name || '',
              status: row.campaign.status || '',
              channel_type: row.campaign.advertisingChannelType || '',
              start_date: row.campaign.startDate || null,
              end_date: row.campaign.endDate || null,
              synced_at: new Date().toISOString(),
            }))
            const { error } = await supabaseAdmin
              .from('gads_campaigns')
              .upsert(rows, { onConflict: 'id,account_id' })
            if (error) throw error
            totals.campaigns += rows.length
          }
        } catch (e) {
          warnings.push(
            `campanhas da conta ${slice.accountId}: ${(e as Error).message}`,
          )
        }
      }

      try {
        const paged = await fetchAllPages(
          (pageToken) =>
            gadsQueryPage(
              accessToken,
              developerToken,
              mccId,
              apiVersion,
              slice.accountId,
              `
                SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc
                FROM campaign
                WHERE segments.date >= '${start}' AND segments.date <= '${end}'
                ORDER BY segments.date DESC
              `,
              pageToken,
            ),
          GADS_SYNC_MAX_PAGES,
        )
        if (paged.truncated)
          warnings.push(
            `métricas de campanha ${slice.accountId}/${slice.year}: atingiu o teto de ${GADS_SYNC_MAX_PAGES} páginas, pode haver dado faltando`,
          )
        if (paged.results.length) {
          const rows = paged.results.map((row: any) => ({
            account_id: slice.accountId,
            campaign_id: String(row.campaign?.id),
            campaign_name: row.campaign?.name || '',
            report_date: row.segments?.date || null,
            impressions: parseInt(row.metrics?.impressions || '0', 10),
            clicks: parseInt(row.metrics?.clicks || '0', 10),
            cost_brl: (Number(row.metrics?.costMicros) || 0) / 1_000_000,
            conversions: parseFloat(row.metrics?.conversions || '0'),
            ctr: parseFloat(row.metrics?.ctr || '0'),
            avg_cpc: (Number(row.metrics?.averageCpc) || 0) / 1_000_000,
            synced_at: new Date().toISOString(),
          }))
          const { error } = await supabaseAdmin
            .from('gads_campaign_metrics')
            .upsert(rows, { onConflict: 'account_id,campaign_id,report_date' })
          if (error) throw error
          totals.metrics += rows.length
        }
      } catch (e) {
        warnings.push(
          `métricas de campanha ${slice.accountId}/${slice.year}: ${(e as Error).message}`,
        )
      }

      // Nível de anúncio individual — alimenta o cruzamento "Leads por
      // Formulário" (auditoria_gads_campaign_leads).
      try {
        const paged = await fetchAllPages(
          (pageToken) =>
            gadsQueryPage(
              accessToken,
              developerToken,
              mccId,
              apiVersion,
              slice.accountId,
              `
                SELECT ad_group_ad.ad.id, ad_group_ad.ad.name,
                       ad_group.id, ad_group.name,
                       campaign.id, campaign.name, segments.date,
                       metrics.impressions, metrics.clicks, metrics.cost_micros,
                       metrics.conversions, metrics.ctr, metrics.average_cpc
                FROM ad_group_ad
                WHERE segments.date >= '${start}' AND segments.date <= '${end}'
                  AND ad_group_ad.status != 'REMOVED'
                ORDER BY segments.date DESC
              `,
              pageToken,
            ),
          GADS_SYNC_MAX_PAGES,
        )
        if (paged.truncated)
          warnings.push(
            `métricas de anúncio ${slice.accountId}/${slice.year}: atingiu o teto de ${GADS_SYNC_MAX_PAGES} páginas, pode haver dado faltando`,
          )
        if (paged.results.length) {
          const rows = paged.results.map((row: any) => ({
            account_id: slice.accountId,
            campaign_id: String(row.campaign?.id),
            campaign_name: row.campaign?.name || '',
            ad_group_id: String(row.adGroup?.id),
            ad_group_name: row.adGroup?.name || '',
            ad_id: String(row.adGroupAd?.ad?.id),
            ad_name: row.adGroupAd?.ad?.name || '',
            report_date: row.segments?.date || null,
            impressions: parseInt(row.metrics?.impressions || '0', 10),
            clicks: parseInt(row.metrics?.clicks || '0', 10),
            cost_brl: (Number(row.metrics?.costMicros) || 0) / 1_000_000,
            conversions: parseFloat(row.metrics?.conversions || '0'),
            ctr: parseFloat(row.metrics?.ctr || '0'),
            avg_cpc: (Number(row.metrics?.averageCpc) || 0) / 1_000_000,
            synced_at: new Date().toISOString(),
          }))
          const { error } = await supabaseAdmin
            .from('gads_ad_metrics')
            .upsert(rows, { onConflict: 'account_id,ad_id,report_date' })
          if (error) throw error
          totals.adMetrics += rows.length
        }
      } catch (e) {
        warnings.push(
          `métricas de anúncio ${slice.accountId}/${slice.year}: ${(e as Error).message}`,
        )
      }

      // Fatia concluída (mesmo que com warnings pontuais) — sai da fila de
      // pendentes. Erro FATAL (fora dos try/catch acima, ex.: token expirou
      // no meio) cai no catch externo do handler sem marcar esta fatia,
      // então ela é retentada na próxima invocação.
      completedSlices.push(sliceKey(slice.accountId, slice.year))
      slicesProcessed.push(sliceKey(slice.accountId, slice.year))

      // Progresso persistido a CADA fatia concluída, não só no final —
      // mesmo padrão do passo 6 do sync-mkt-bitrix: uma morte no meio (546
      // ou qualquer outro erro) preserva o que as fatias anteriores desta
      // rodada já gravaram.
      await salvarProgresso()
    }

    const converged = isFullyConverged(
      accounts,
      completedSlices,
      currentYear,
      GADS_SYNC_MIN_YEAR,
    )
    await salvarProgresso({ converged })

    return new Response(
      JSON.stringify({
        converged,
        accounts: accounts.length,
        slicesProcessed,
        totals,
        warnings,
        errors,
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
