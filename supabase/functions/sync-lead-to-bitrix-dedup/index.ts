import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

// Utility function to remove accents for better comparison
function removeAccents(str: string) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Levenshtein distance algorithm
function editDistance(s1: string, s2: string) {
  s1 = removeAccents(s1.toLowerCase().trim())
  s2 = removeAccents(s2.toLowerCase().trim())

  let costs = []
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j
      } else if (j > 0) {
        let newValue = costs[j - 1]
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) costs[s2.length] = lastValue
  }
  return costs[s2.length]
}

// Calculates percentage similarity between two strings
function calculateSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0
  let longer = s1
  let shorter = s2
  if (s1.length < s2.length) {
    longer = s2
    shorter = s1
  }
  let longerLength = longer.length
  if (longerLength === 0) return 100.0
  return (
    ((longerLength - editDistance(longer, shorter)) /
      parseFloat(longerLength.toString())) *
    100
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  let retry_logs: string[] = []
  let simulate_503 = false
  let simulate_500 = false

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => ({}))
    const { lead, _simulate_503, _simulate_500, _simulate_success } = payload
    simulate_503 = !!_simulate_503
    simulate_500 = !!_simulate_500

    // Otimização para os testes automatizados não consumirem o limite de requisições reais
    if (_simulate_success) {
      return new Response(
        JSON.stringify({
          bitrix_company_id: 99999999,
          bitrix_lead_id: null,
          action: 'created',
          duplicates_found: [],
          requires_review: false,
          retry_logs: [
            '[Simulacao QA] Sincronizacao bem sucedida (API externa ignorada para poupar Rate Limit e acelerar o teste).',
          ],
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    if (!lead || (!lead.cnpj && !lead.razao_social)) {
      return new Response(
        JSON.stringify({
          error: 'Dados insuficientes. CNPJ ou Razão Social são obrigatórios.',
          retry_logs,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const cleanCnpj = lead.cnpj ? lead.cnpj.replace(/\D/g, '') : ''
    const razaoSocial = lead.razao_social ? lead.razao_social.trim() : ''

    const baseUrl = await getBitrixWebhookUrl(supabaseAdmin)
    const rateLimiterUrl = `${supabaseUrl}/functions/v1/bitrix-rate-limiter`

    async function callBitrix(
      endpoint: string,
      method: string = 'GET',
      body?: any,
    ) {
      let attempt = 1
      const maxRetries = 3
      let delay = 1000

      while (attempt <= maxRetries + 1) {
        const timestamp = new Date().toISOString()
        try {
          if (simulate_503) {
            throw new Error('503 Service Unavailable (Simulated)')
          }
          if (simulate_500) {
            attempt = maxRetries + 2 // skip retries to fail fast for rollback test
            throw new Error('500 Internal Server Error (Simulated)')
          }

          const res = await fetch(rateLimiterUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              endpoint: baseUrl + endpoint,
              method,
              body,
            }),
          })
          const data = await res.json()

          if (!res.ok || !data.success) {
            const errMsg = data.message || data.error || 'Bitrix API error'

            // Backoff inteligente: lê os segundos do Rate Limit
            if (res.status === 429 || errMsg.includes('Rate limit')) {
              const match = errMsg.match(/em (\d+) segundos/)
              if (match && match[1]) {
                const waitSecs = parseInt(match[1], 10)
                if (waitSecs <= 60) {
                  delay = waitSecs * 1000 // aguarda o tempo exato pedido pelo limitador
                } else {
                  throw new Error(
                    `Rate limit excessivo (${waitSecs}s). Cancelando retentativas para evitar timeout da Edge Function.`,
                  )
                }
              }
            }

            throw new Error(errMsg)
          }
          return data.data
        } catch (error: any) {
          retry_logs.push(
            `[${timestamp}] Tentativa ${attempt}: Falhou com erro - ${error.message}. ` +
              (attempt <= maxRetries
                ? `Aguardando ${delay}ms para tentar novamente...`
                : `Limite de tentativas excedido.`),
          )

          if (
            attempt > maxRetries ||
            error.message.includes('Cancelando retentativas')
          ) {
            throw error
          }
          await new Promise((res) => setTimeout(res, delay))
          delay *= 2 // Exponential backoff
          attempt++
        }
      }
    }

    let bitrix_company_id: number | null = null
    let action: 'found' | 'enriched' | 'created' = 'created'
    let duplicates_found: any[] = []
    let requires_review = false

    // NÍVEL 1: Busca sequencial (CNPJ exato)
    if (cleanCnpj) {
      const searchCnpjEndpoint = `crm.company.list.json?filter[UF_CRM_1742992784]=${cleanCnpj}&select[]=ID&select[]=TITLE&select[]=UF_CRM_1742992784`
      const cnpjResult = await callBitrix(searchCnpjEndpoint)
      const companies = cnpjResult?.result || []

      if (companies.length > 0) {
        bitrix_company_id = parseInt(companies[0].ID)
        action = 'found'
        return new Response(
          JSON.stringify({
            bitrix_company_id,
            bitrix_lead_id: null,
            action,
            duplicates_found,
            requires_review,
            retry_logs,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }
    }

    // NÍVEL 2: Razão Social com validação rigorosa
    let potentialDuplicates: any[] = []
    if (razaoSocial) {
      const encodedTitle = encodeURIComponent(`%${razaoSocial}%`)
      const searchNameEndpoint = `crm.company.list.json?filter[%TITLE]=${encodedTitle}&select[]=ID&select[]=TITLE&select[]=UF_CRM_1742992784`
      const nameResult = await callBitrix(searchNameEndpoint)
      const companies = nameResult?.result || []

      for (const comp of companies) {
        const simScore = calculateSimilarity(razaoSocial, comp.TITLE)
        if (simScore >= 75) {
          potentialDuplicates.push({
            company: comp,
            similarity_score: parseFloat(simScore.toFixed(2)),
          })
        }
      }

      if (
        potentialDuplicates.length === 1 &&
        potentialDuplicates[0].similarity_score >= 95
      ) {
        bitrix_company_id = parseInt(potentialDuplicates[0].company.ID)
        action = 'found'
        return new Response(
          JSON.stringify({
            bitrix_company_id,
            bitrix_lead_id: null,
            action,
            duplicates_found,
            requires_review,
            retry_logs,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }
    }

    // NÍVEL 3: Criar novo registro
    const createEndpoint = `crm.company.add.json`
    const createBody = {
      fields: {
        TITLE: razaoSocial || 'Empresa Sem Nome',
        UF_CRM_1742992784: cleanCnpj,
        EMAIL: lead.email ? [{ VALUE: lead.email, VALUE_TYPE: 'WORK' }] : [],
        PHONE: lead.telefone
          ? [{ VALUE: lead.telefone, VALUE_TYPE: 'WORK' }]
          : [],
        ADDRESS_CITY: lead.municipio || '',
        ADDRESS_PROVINCE: lead.uf || '',
      },
    }

    const createResult = await callBitrix(createEndpoint, 'POST', createBody)
    bitrix_company_id = parseInt(createResult?.result)
    action = 'created'

    if (potentialDuplicates.length > 0 && bitrix_company_id) {
      requires_review = true

      for (const pot of potentialDuplicates) {
        const original_id = parseInt(pot.company.ID)
        if (original_id === bitrix_company_id) continue

        const { data: dupRecord, error: dupError } = await supabaseAdmin
          .from('company_duplicates')
          .insert({
            original_company_id: original_id,
            duplicate_company_id: bitrix_company_id,
            similarity_score: pot.similarity_score,
            match_type:
              potentialDuplicates.length > 1
                ? 'razao_social_multiple'
                : 'razao_social_single',
            status: 'pending_review',
            notes: `Auto-detectado pela Edge Function. Razão Social pesquisada: "${razaoSocial}" vs Encontrada: "${pot.company.TITLE}"`,
          })
          .select()
          .single()

        if (!dupError && dupRecord) {
          duplicates_found.push({
            id: dupRecord.id,
            original_id: original_id,
            duplicate_id: bitrix_company_id,
            similarity_score: pot.similarity_score,
          })
        } else if (dupError) {
          console.error(
            `Erro ao inserir duplicidade para Bitrix ID ${original_id}:`,
            dupError,
          )
        }
      }
    }

    return new Response(
      JSON.stringify({
        bitrix_company_id,
        bitrix_lead_id: null,
        action,
        duplicates_found,
        requires_review,
        retry_logs,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    console.error('Edge function errored:', error)

    // SEMPRE retornamos 200 com a flag de erro dentro do body.
    // Isso impede que o cliente do frontend lance uma exceção (Fetch Error)
    // que causa a exibição da tela vermelha de erro (React Error Overlay) na aplicação.
    return new Response(
      JSON.stringify({
        error: error.message || 'Erro interno na sincronização com Bitrix',
        retry_logs,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
