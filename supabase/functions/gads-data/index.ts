import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador pra aba Google Ads (dentro de MktAnalyticsPage.jsx). Cobre
// campaigns-list, summary, campaign-leads (leads por formulário — cruza
// gasto por anúncio com leads do Bitrix) e ads-list (seletor de anúncios
// individuais, ver migration 20260713090000). gads-alert-config, ai-chat e
// insight seguem fora daqui (config direta via Supabase / Edge Function
// própria gads-ai) — ver BACKLOG.md, seção "Google Ads". "sync" já é
// coberto pela função própria sync-google-ads, não por aqui.
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

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
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

    const payload = await req.json().catch(() => ({}))
    const {
      view,
      status,
      dateFrom,
      dateTo,
      campaignIds,
      campaignStatus,
      adIds,
    } = payload

    let result: any

    switch (view) {
      case 'campaigns-list': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_gads_campaigns_list',
          {
            p_status: status ?? 'all',
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'summary': {
        if (!dateFrom || !dateTo) {
          return new Response(
            JSON.stringify({ error: 'dateFrom e dateTo obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const ids =
          Array.isArray(campaignIds) && campaignIds.length
            ? campaignIds.map(String)
            : null
        const ads =
          Array.isArray(adIds) && adIds.length ? adIds.map(String) : null
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_gads_summary',
          {
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_campaign_ids: ids,
            p_campaign_status: campaignStatus ?? 'all',
            p_ad_ids: ads,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'ads-list': {
        const ids =
          Array.isArray(campaignIds) && campaignIds.length
            ? campaignIds.map(String)
            : null
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_gads_ads_list',
          {
            p_campaign_ids: ids,
            p_campaign_status: campaignStatus ?? 'all',
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'campaign-leads': {
        if (!dateFrom || !dateTo) {
          return new Response(
            JSON.stringify({ error: 'dateFrom e dateTo obrigatórios.' }),
            { status: 400, headers: corsHeaders },
          )
        }
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_gads_campaign_leads',
          {
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_campaign_status: campaignStatus ?? 'all',
          },
        )
        if (error) throw error
        result = data
        break
      }
      default:
        return new Response(
          JSON.stringify({ error: `view inválida: ${view}` }),
          { status: 400, headers: corsHeaders },
        )
    }

    return new Response(JSON.stringify(result), {
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
