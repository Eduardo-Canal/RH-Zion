import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Apenas requisições GET ou POST são permitidas.',
      }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Adicionado ADDRESS aos campos selecionados
    const selectFields = [
      'ID',
      'TITLE',
      'UF_CRM_6241B0B267ED3',
      'UF_CRM_1742992784',
      'UF_CRM_1771423651',
      'UF_CRM_F56E1FF4',
      'UF_CRM_1738583536320',
      'EMAIL',
      'PHONE',
      'ADDRESS',
      'ADDRESS_CITY',
      'ADDRESS_PROVINCE',
    ]
    const selectQuery = selectFields.map((f) => `select[]=${f}`).join('&')
    const webhookBase = await getBitrixWebhookUrl(supabaseAdmin)
    const baseUrl = `${webhookBase}crm.company.list.json?filter[UF_CRM_1B70E8F8]=675&${selectQuery}`

    const rateLimiterUrl = `${supabaseUrl}/functions/v1/bitrix-rate-limiter`

    let allCompanies: any[] = []
    let nextStart = 0
    let hasMore = true

    while (hasMore) {
      const endpoint = nextStart > 0 ? `${baseUrl}&start=${nextStart}` : baseUrl

      const rateLimiterRes = await fetch(rateLimiterUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          endpoint,
          method: 'GET',
        }),
      })

      const rateLimiterData = await rateLimiterRes.json()

      if (!rateLimiterRes.ok || !rateLimiterData.success) {
        if (allCompanies.length > 0) {
          console.warn(
            'Rate limit ou erro atingido durante a paginação. Interrompendo e salvando parciais.',
          )
          break
        }
        return new Response(
          JSON.stringify({
            success: false,
            error:
              rateLimiterData.message ||
              rateLimiterData.error ||
              'Erro ao comunicar com a API do Bitrix via Rate Limiter',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const bitrixData = rateLimiterData.data
      const companies = bitrixData?.result || []

      if (Array.isArray(companies)) {
        allCompanies = allCompanies.concat(companies)
      }

      if (bitrixData?.next) {
        nextStart = bitrixData.next
      } else {
        hasMore = false
      }
    }

    const getPrimaryValue = (field: any) => {
      if (Array.isArray(field) && field.length > 0) {
        return field[0].VALUE || field[0] || ''
      }
      if (typeof field === 'string') return field
      return ''
    }

    // Função auxiliar para extrair Cidade e UF de endereços formatados como "Rua - Bairro, Cidade - UF, País"
    const parseAddress = (addressStr: any) => {
      if (typeof addressStr !== 'string') return { city: '', state: '' }

      let city = ''
      let state = ''

      const parts = addressStr.split(',')
      if (parts.length >= 2) {
        const targetIndex = parts.length >= 3 ? parts.length - 2 : 1
        const targetPart = parts[targetIndex]?.trim() || ''

        if (targetPart.includes('-')) {
          const csParts = targetPart.split('-')
          city = csParts[0].trim()
          state = csParts[csParts.length - 1].trim()
        } else {
          city = targetPart
        }
      }

      return { city, state }
    }

    // Função auxiliar para normalizar códigos de estado numéricos para siglas
    const normalizeState = (rawState: any) => {
      if (!rawState) return ''
      const s = String(rawState).trim().toUpperCase()
      const map: Record<string, string> = {
        '150': 'SP',
        '010': 'SP',
        '070': 'SP',
        '530': 'SC',
        ES: 'ES',
        SP: 'SP',
      }
      return map[s] || s
    }

    const extractedClients = allCompanies
      .map((c: any) => {
        let city = c.ADDRESS_CITY || ''
        let state = normalizeState(c.ADDRESS_PROVINCE)

        // Fallback para extrair do ADDRESS completo se os campos nativos estiverem vazios
        if ((!city || !state) && c.ADDRESS) {
          const parsed = parseAddress(c.ADDRESS)
          if (!city) city = parsed.city
          if (!state) state = normalizeState(parsed.state)
        }

        // Default se não encontrar nada de forma alguma
        city = city || 'Não informado'
        state = state || 'Não informado'

        return {
          ID: parseInt(c.ID, 10) || 0,
          TITLE: c.TITLE || '',
          UF_CRM_1742992784:
            getPrimaryValue(c.UF_CRM_6241B0B267ED3) ||
            getPrimaryValue(c.UF_CRM_1742992784) ||
            '',
          UF_CRM_1771423651:
            getPrimaryValue(c.UF_CRM_1771423651) || 'Não informado',
          UF_CRM_F56E1FF4:
            getPrimaryValue(c.UF_CRM_F56E1FF4) || 'Não informado',
          UF_CRM_1738583536320:
            getPrimaryValue(c.UF_CRM_1738583536320) || 'Não classificado',
          EMAIL: getPrimaryValue(c.EMAIL),
          TELEFONE: getPrimaryValue(c.PHONE || c.TELEFONE),
          ADDRESS_CITY: city,
          ADDRESS_PROVINCE: state,
        }
      })
      .filter((c: any) => c.ID > 0)

    const dbClients = extractedClients.map((c: any) => ({
      bitrix_id: c.ID,
      company_name: c.TITLE,
      cnpj: c.UF_CRM_1742992784,
      cnae_principal: c.UF_CRM_1771423651,
      segmento: c.UF_CRM_F56E1FF4,
      curva_abc: c.UF_CRM_1738583536320,
      email: c.EMAIL,
      phone: c.TELEFONE,
      city: c.ADDRESS_CITY,
      state: c.ADDRESS_PROVINCE,
      synced_at: new Date().toISOString(),
    }))

    if (dbClients.length > 0) {
      const chunkSize = 500
      for (let i = 0; i < dbClients.length; i += chunkSize) {
        const chunk = dbClients.slice(i, i + chunkSize)

        const { error: upsertError } = await supabaseAdmin
          .from('bitrix_clients_zion')
          .upsert(chunk, { onConflict: 'bitrix_id' })

        if (upsertError) {
          console.error('Erro ao salvar no banco:', upsertError)
          return new Response(
            JSON.stringify({
              success: false,
              error:
                'Erro ao salvar clientes no banco de dados local: ' +
                upsertError.message,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_clients: extractedClients.length,
        clients: extractedClients,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro interno na Edge Function',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
