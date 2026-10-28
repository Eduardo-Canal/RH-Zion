import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

Deno.serve(async (req: Request) => {
  // Lida com CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Always fetch fresh data from Bitrix API to ensure ENTITY_TYPE is populated
    console.log('Fetching fresh data from Bitrix API')

    const webhookBase = await getBitrixWebhookUrl(supabaseAdmin)
    const baseUrl = `${webhookBase}crm.status.list.json`

    const rateLimiterUrl = `${supabaseUrl}/functions/v1/bitrix-rate-limiter`

    // Buscar TODOS os status (sem filtro)
    const rateLimiterRes = await fetch(rateLimiterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        endpoint: baseUrl,
        method: 'POST',
        body: {},
      }),
    })

    const rateLimiterData = await rateLimiterRes.json()

    if (!rateLimiterRes.ok || !rateLimiterData.success) {
      throw new Error(
        rateLimiterData.message ||
          rateLimiterData.error ||
          'Erro ao buscar status do Bitrix24',
      )
    }

    // Bitrix24 returns errors with HTTP 200 + an "error" field in the body
    if (rateLimiterData.data?.error) {
      throw new Error(
        `Bitrix24: ${rateLimiterData.data.error_description || rateLimiterData.data.error}`,
      )
    }

    const allStatuses = rateLimiterData.data?.result || []

    if (allStatuses.length === 0) {
      console.warn(
        'Bitrix24 returned empty status list. Raw response:',
        JSON.stringify(rateLimiterData.data),
      )
    }

    // Processar os dados
    const processStatuses = (statuses: any[], entityType: string) => {
      return statuses.map((s: any) => {
        let categoryId = '0' // Pipeline padrão
        if (entityType === 'DEAL' && s.ENTITY_ID !== 'DEAL_STAGE') {
          categoryId = s.ENTITY_ID.replace('DEAL_STAGE_', '')
        } else if (entityType === 'LEAD') {
          categoryId = 'LEAD' // Identificador especial para leads
        }

        return {
          ID: s.ID,
          NAME: s.NAME,
          CATEGORY_ID: categoryId,
          STATUS_ID: s.STATUS_ID || s.ID,
          SORT: s.SORT,
          ENTITY_TYPE: entityType, // DEAL ou LEAD
        }
      })
    }

    // Log de diagnóstico: quais ENTITY_IDs existem na resposta do Bitrix
    const uniqueEntityIds = [
      ...new Set(allStatuses.map((s: any) => s.ENTITY_ID).filter(Boolean)),
    ]
    console.log('Bitrix ENTITY_IDs encontrados:', uniqueEntityIds)
    console.log('Total statuses:', allStatuses.length)

    // Separar status de deals e leads
    const rawStatusesDeals = allStatuses.filter(
      (s: any) => s.ENTITY_ID && s.ENTITY_ID.includes('DEAL_STAGE'),
    )
    const rawStatusesLeads = allStatuses.filter(
      (s: any) => s.ENTITY_ID === 'STATUS',
    )

    console.log(
      `Filtro: DEAL=${rawStatusesDeals.length}, LEAD=${rawStatusesLeads.length}`,
    )

    const kanbansDeals = processStatuses(rawStatusesDeals, 'DEAL')
    const kanbansLeads = processStatuses(rawStatusesLeads, 'LEAD')
    const kanbans = [...kanbansDeals, ...kanbansLeads].sort(
      (a: any, b: any) => {
        // Primeiro leads, depois deals
        if (a.ENTITY_TYPE !== b.ENTITY_TYPE) {
          return a.ENTITY_TYPE === 'LEAD' ? -1 : 1
        }
        // Depois por categoria
        if (a.CATEGORY_ID !== b.CATEGORY_ID) {
          if (a.CATEGORY_ID === 'LEAD') return -1
          if (b.CATEGORY_ID === 'LEAD') return 1
          return parseInt(a.CATEGORY_ID) - parseInt(b.CATEGORY_ID)
        }
        // Por último por ordem do estágio
        return parseInt(a.SORT) - parseInt(b.SORT)
      },
    )

    console.log('Processed kanbans:', {
      count: kanbans.length,
      sample: kanbans.slice(0, 3),
    })

    // Save to dedicated bitrix_kanbans table
    const kanbanInserts = kanbans.map((item) => ({
      entity_type: item.ENTITY_TYPE,
      category_id: item.CATEGORY_ID,
      status_id: item.STATUS_ID,
      name: item.NAME,
      sort: parseInt(item.SORT) || 0,
      bitrix_id: item.ID,
      last_synced_at: new Date().toISOString(),
    }))

    // Clear existing data and insert new data
    const { error: deleteError } = await supabaseAdmin
      .from('bitrix_kanbans')
      .delete()
      .neq('id', 0) // Delete all records

    if (deleteError) {
      console.error('Error deleting old kanban data:', deleteError)
    }

    const { error: insertError } = await supabaseAdmin
      .from('bitrix_kanbans')
      .insert(kanbanInserts)

    if (insertError) {
      console.error('Error inserting kanban data:', insertError)
    } else {
      console.log('Successfully inserted kanban data:', {
        count: kanbanInserts.length,
      })
    }

    // Salva no Cache para evitar repetidas chamadas nas próximas 24h
    const expira_em = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin.from('cache_pesquisas').upsert(
      {
        chave_cache: 'bitrix_kanbans_lead_deal_stages_v4',
        resultados: kanbans,
        total_registros: kanbans.length,
        expira_em: expira_em,
        parametros: { source: 'bitrix_api_crm_status_list' },
      },
      { onConflict: 'chave_cache' },
    )

    // Retorna o JSON estruturado para o frontend
    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        data: kanbans,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    console.error('Edge function errored:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro interno na sincronização com Bitrix24',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
