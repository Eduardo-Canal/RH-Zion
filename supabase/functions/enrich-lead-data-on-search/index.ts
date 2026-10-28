import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const leads = payload.leads || []

    if (!Array.isArray(leads) || leads.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // API Key fallback logic
    let apiKey =
      Deno.env.get('CASA_DOS_DADOS_API_KEY') ||
      Deno.env.get('CASADOSDADOS_API_KEY')
    if (!apiKey) {
      const { data: config } = await supabaseAdmin
        .from('configuracoes_sistema')
        .select('casadosdados_api_token')
        .eq('id', 1)
        .maybeSingle()
      apiKey = config?.casadosdados_api_token?.trim() || ''
    }

    const cleanCnpjs = leads
      .map((l: any) => (l.cnpj || '').replace(/\D/g, ''))
      .filter((c: string) => c.length === 14)

    if (cleanCnpjs.length === 0) {
      return new Response(JSON.stringify({ results: leads }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 1. Check Cache
    const now = new Date().toISOString()
    const { data: cached } = await supabaseAdmin
      .from('company_enriched_cache')
      .select('*')
      .in('cnpj', cleanCnpjs)
      .gt('expires_at', now)

    const cachedMap = new Map((cached || []).map((c: any) => [c.cnpj, c.data]))
    const missingCnpjs = cleanCnpjs.filter((c: string) => !cachedMap.has(c))

    // Remove duplicates from missingCnpjs to avoid redundant API calls
    const uniqueMissingCnpjs = [...new Set(missingCnpjs)]

    // 2. Fetch missing (max 10 concurrent)
    const fetchEnrichedData = async (cnpj: string) => {
      try {
        if (!apiKey) throw new Error('API Key missing')
        let tokenRaw = apiKey.replace(/^Bearer\s+/i, '').trim()

        const res = await fetch(
          `https://api.casadosdados.com.br/v5/cnpj/${cnpj}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'api-key': tokenRaw,
            },
          },
        )

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`)
        }

        const rawData = await res.json()
        // API v5 usa quadro_societario (não socios), sem email/telefone por sócio
        const rawSocios = rawData.quadro_societario || rawData.socios || []
        const contatosPrincipais = rawSocios
          .filter(
            (s: any) =>
              s.identificador_socio === 'Pessoa Física' ||
              !s.identificador_socio,
          )
          .map((s: any) => ({
            nome: s.nome || s.razao_social || '',
            cargo:
              (typeof s.qualificacao_socio === 'string'
                ? s.qualificacao_socio
                : s.qualificacao_socio?.descricao) || 'Sócio',
            faixa_etaria: s.faixa_etaria_descricao || s.faixa_etaria || '',
            email: null,
            telefone: null,
          }))
        return {
          cnpj,
          faturamento_anual:
            rawData.faturamento_estimado || rawData.capital_social || null,
          numero_funcionarios:
            rawData.quantidade_funcionarios ||
            rawData.faixa_funcionarios ||
            null,
          contatos_principais: contatosPrincipais,
          score_credito: rawData.score_credito || rawData.score || null,
          dados_incompletos: false,
        }
      } catch (error) {
        return {
          cnpj,
          faturamento_anual: null,
          numero_funcionarios: null,
          contatos_principais: [],
          score_credito: null,
          dados_incompletos: true,
        }
      }
    }

    const newEnrichedData = []
    const batchSize = 10

    for (let i = 0; i < uniqueMissingCnpjs.length; i += batchSize) {
      const batch = uniqueMissingCnpjs.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map((c: string) => fetchEnrichedData(c)),
      )
      newEnrichedData.push(...results)
    }

    // 3. Store in cache
    if (newEnrichedData.length > 0) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const upserts = newEnrichedData.map((d) => ({
        cnpj: d.cnpj,
        data: d,
        expires_at: expiresAt,
      }))

      await supabaseAdmin
        .from('company_enriched_cache')
        .upsert(upserts, { onConflict: 'cnpj' })
    }

    const newMap = new Map(newEnrichedData.map((d) => [d.cnpj, d]))

    // 4. Merge results
    const finalResults = leads.map((lead: any) => {
      const clean = (lead.cnpj || '').replace(/\D/g, '')
      let enriched = cachedMap.get(clean) ||
        newMap.get(clean) || { dados_incompletos: true }
      return {
        ...lead,
        enriquecimento: enriched,
      }
    })

    return new Response(JSON.stringify({ results: finalResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
