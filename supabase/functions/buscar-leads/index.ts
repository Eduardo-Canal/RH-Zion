import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const start = performance.now()

  try {
    const payload = await req.json().catch(() => ({}))
    const {
      cnae_fiscal_principal,
      uf,
      municipio,
      situacao_cadastral,
      porte,
      limit = 10,
      page = 1,
      bypass_cache = false,
    } = payload

    // Strictly sanitize CNAEs to be numeric only as required by Casa dos Dados
    const cnaes = Array.isArray(cnae_fiscal_principal)
      ? cnae_fiscal_principal
          .map((c) =>
            typeof c === 'string'
              ? c.replace(/\D/g, '')
              : String(c).replace(/\D/g, ''),
          )
          .filter(Boolean)
      : []

    if (!cnaes || cnaes.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'O filtro de CNAE é obrigatório.',
          cnpjs: [],
          page,
          count: 0,
          pages: 0,
          cached: false,
          status_http: 400,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const authHeader = req.headers.get('Authorization')

    // Auth de login — achado de 15/07/2026: esta function nunca teve essa
    // checagem (ao contrário de sync-cnae-market-data-potencial e das demais
    // ~20 functions do projeto), o que virou exploração real depois do
    // aperto de RLS em configuracoes_sistema (leitura do token passou a usar
    // supabaseAdmin, sem depender mais da RLS pra barrar chamada anônima).
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || '' } },
    })

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

    // service_role: RLS restringe configuracoes_sistema a 'Acessar Admin'
    // (aperto de 15/07/2026) — usuário comum precisa continuar buscando leads.
    const { data: config } = await supabaseAdmin
      .from('configuracoes_sistema')
      .select('casadosdados_api_token')
      .eq('id', 1)
      .maybeSingle()

    const apiKey = config?.casadosdados_api_token?.trim() || ''

    const payloadToHash = {
      cnaes,
      uf: uf || null,
      municipio: municipio || null,
      situacao_cadastral: situacao_cadastral || null,
      porte: porte || null,
      limit,
      page,
    }
    const msgBuffer = new TextEncoder().encode(JSON.stringify(payloadToHash))
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const chave_cache = hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    if (!bypass_cache) {
      const { data: cachedData } = await supabase
        .from('cache_pesquisas')
        .select('resultados, total_registros, expira_em')
        .eq('chave_cache', chave_cache)
        .maybeSingle()

      if (cachedData && new Date(cachedData.expira_em) > new Date()) {
        const timeTaken = Math.round(performance.now() - start)

        await supabaseAdmin.from('api_debug_logs').insert({
          cnae: cnaes.join(', ') || null,
          uf: Array.isArray(uf) ? uf.join(', ') : uf || null,
          municipio: Array.isArray(municipio)
            ? municipio.join(', ')
            : municipio || null,
          limite: limit,
          status_http: 200,
          sucesso: true,
          tempo_resposta_ms: timeTaken,
          total_resultados: cachedData.total_registros,
          resposta_json: { cached: true, count: cachedData.total_registros },
        })

        return new Response(
          JSON.stringify({
            cnpjs: cachedData.resultados,
            page: page,
            count: cachedData.total_registros,
            pages: Math.ceil(cachedData.total_registros / limit) || 1,
            cached: true,
            status_http: 200,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }
    }

    const casadosDadosPayload: any = {
      limite: limit || 10,
      pagina: page || 1,
    }

    casadosDadosPayload.codigo_atividade_principal = cnaes

    if (uf && uf !== 'Todos') {
      casadosDadosPayload.uf = Array.isArray(uf) ? uf : [uf]
    }
    if (municipio && municipio !== 'Todos') {
      casadosDadosPayload.municipio = Array.isArray(municipio)
        ? municipio
        : [municipio]
    }
    if (porte && porte.length > 0) {
      casadosDadosPayload.porte = Array.isArray(porte)
        ? porte.map((p: any) => String(p).toUpperCase())
        : [String(porte).toUpperCase()]
    }

    // Inclusion of status filtering in the search request
    casadosDadosPayload.situacao_cadastral = situacao_cadastral
      ? Array.isArray(situacao_cadastral)
        ? situacao_cadastral
        : [situacao_cadastral]
      : ['ATIVA']

    let data
    let externalStatus = 200
    const fetchStart = performance.now()
    let timeTakenApi = 0

    if (apiKey) {
      try {
        let tokenRaw = apiKey.replace(/^Bearer\s+/i, '').trim()

        // Include the query string parameter tipo_resultado=completo in the request URL
        const response = await fetch(
          'https://api.casadosdados.com.br/v5/cnpj/pesquisa?tipo_resultado=completo',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'api-key': tokenRaw,
            },
            body: JSON.stringify(casadosDadosPayload),
          },
        )

        timeTakenApi = Math.round(performance.now() - fetchStart)
        externalStatus = response.status

        if (!response.ok) {
          let errorMsg = `Erro na API da Casa dos Dados (${response.status})`
          if (response.status === 401 || response.status === 403) {
            errorMsg =
              'Erro ao buscar leads: Verifique sua chave de API nas Configurações Avançadas.'
          } else if (response.status === 429) {
            errorMsg = 'Erro ao buscar leads: Limite de Requisições Excedido.'
          } else if (response.status === 404) {
            errorMsg = 'Erro ao buscar leads: Endpoint não encontrado.'
          } else if (response.status === 400) {
            errorMsg =
              'Erro ao buscar leads: Verifique o formato do CNAE e os demais filtros aplicados.'
          }

          let errorData = null
          try {
            // Tentar ler a resposta como texto primeiro para evitar erro de JSON malformado
            const responseText = await response.text()
            if (responseText && responseText.trim()) {
              errorData = JSON.parse(responseText)
            } else {
              errorData = { message: 'Resposta vazia da API' }
            }
          } catch (parseError) {
            // Se não conseguir fazer parse do JSON, usar o texto bruto
            errorData = {
              message: 'Resposta não-JSON da API',
              raw: await response.text(),
            }
          }

          const finalError = { error: errorMsg, details: errorData }

          await supabaseAdmin.from('api_debug_logs').insert({
            cnae: cnaes.join(', ') || null,
            uf: Array.isArray(uf) ? uf.join(', ') : uf || null,
            municipio: Array.isArray(municipio)
              ? municipio.join(', ')
              : municipio || null,
            limite: limit,
            status_http: response.status,
            sucesso: false,
            tempo_resposta_ms: timeTakenApi,
            total_resultados: 0,
            resposta_json: errorData || finalError,
          })

          return new Response(
            JSON.stringify({
              error: errorMsg,
              cnpjs: [],
              page,
              count: 0,
              pages: 0,
              cached: false,
              status_http: response.status,
              raw_response: errorData,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            },
          )
        }

        // Tentar fazer parse da resposta JSON com tratamento de erro
        try {
          data = await response.json()
        } catch (jsonError) {
          console.error('Erro ao fazer parse da resposta JSON:', jsonError)
          const responseText = await response.text()
          return new Response(
            JSON.stringify({
              error:
                'Erro ao processar resposta da API Casa dos Dados: resposta JSON malformada',
              cnpjs: [],
              page,
              count: 0,
              pages: 0,
              cached: false,
              status_http: response.status,
              raw_response: responseText,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            },
          )
        }
      } catch (e: any) {
        timeTakenApi = Math.round(performance.now() - fetchStart)
        console.error('Fetch API error:', e)
        const errObj = {
          error: 'Erro de conexão com a API Casa dos Dados.',
          details: e.message,
        }

        await supabaseAdmin.from('api_debug_logs').insert({
          cnae: cnaes.join(', ') || null,
          uf: Array.isArray(uf) ? uf.join(', ') : uf || null,
          municipio: Array.isArray(municipio)
            ? municipio.join(', ')
            : municipio || null,
          limite: limit,
          status_http: 500,
          sucesso: false,
          tempo_resposta_ms: timeTakenApi,
          total_resultados: 0,
          resposta_json: errObj,
        })

        return new Response(
          JSON.stringify({
            error: 'Erro de conexão com a API Casa dos Dados.',
            cnpjs: [],
            page,
            count: 0,
            pages: 0,
            cached: false,
            status_http: 500,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }
    } else {
      const errObj = { error: 'Token da API Casa dos Dados não configurado.' }
      await supabaseAdmin.from('api_debug_logs').insert({
        cnae: cnaes.join(', ') || null,
        uf: Array.isArray(uf) ? uf.join(', ') : uf || null,
        municipio: Array.isArray(municipio)
          ? municipio.join(', ')
          : municipio || null,
        limite: limit,
        status_http: 401,
        sucesso: false,
        tempo_resposta_ms: 0,
        total_resultados: 0,
        resposta_json: errObj,
      })

      return new Response(
        JSON.stringify({
          error:
            'Erro ao buscar leads: Token da API não configurado. Adicione nas Configurações Avançadas.',
          cnpjs: [],
          page,
          count: 0,
          pages: 0,
          cached: false,
          status_http: 401,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    if (!data || data.error || data.success === false) {
      const finalError =
        data?.error || data?.message || 'Formato de resposta inesperado da API.'
      await supabaseAdmin.from('api_debug_logs').insert({
        cnae: cnaes.join(', ') || null,
        uf: Array.isArray(uf) ? uf.join(', ') : uf || null,
        municipio: Array.isArray(municipio)
          ? municipio.join(', ')
          : municipio || null,
        limite: limit,
        status_http: externalStatus || 500,
        sucesso: false,
        tempo_resposta_ms: timeTakenApi,
        total_resultados: 0,
        resposta_json: data || { error: finalError },
      })

      return new Response(
        JSON.stringify({
          error: finalError,
          cnpjs: [],
          page,
          count: 0,
          pages: 0,
          cached: false,
          status_http: externalStatus || 500,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    let rawResults = data?.cnpjs
    if (!Array.isArray(rawResults)) {
      rawResults = []
    }

    let totalCount = data?.count || rawResults.length
    let totalPages = data?.pages || 1
    let currentPage = data?.page || page

    // Map the returned data, ensuring situacao_cadastral resolves to the proper string
    // and correctly extracting data from nested objects (e.g. endereco, contatos) for API v5
    const results = rawResults.slice(0, limit).map((empresa: any) => {
      let situacao = empresa.situacao_cadastral
      if (
        typeof situacao === 'object' &&
        situacao !== null &&
        situacao.situacao_atual
      ) {
        situacao = situacao.situacao_atual
      } else if (typeof situacao === 'string') {
        situacao = situacao
      }

      // Handle nested Endereco
      const endereco = empresa.endereco || {}
      let municipioRaw = empresa.municipio || endereco.municipio || ''
      let ufRaw = empresa.uf || endereco.uf || ''

      if (typeof municipioRaw === 'object' && municipioRaw !== null) {
        municipioRaw =
          municipioRaw.nome ||
          municipioRaw.descricao ||
          municipioRaw.codigo ||
          ''
      }
      if (typeof ufRaw === 'object' && ufRaw !== null) {
        ufRaw = ufRaw.sigla || ufRaw.nome || ''
      }

      // Handle Telefone — API v5 usa contato_telefonico (array com {ddd, numero, tipo})
      let telefoneFormatado = ''
      const rawTel =
        empresa.contato_telefonico || empresa.telefone || empresa.telefones
      if (Array.isArray(rawTel)) {
        telefoneFormatado = rawTel
          .map((t: any) => {
            if (typeof t === 'string') return t
            if (t && typeof t === 'object') {
              if (t.ddd && t.numero) {
                const num = `(${t.ddd}) ${t.numero}`
                return t.tipo === 'celular' ? `${num} [cel]` : num
              }
              if (t.completo) return t.completo
              if (t.telefone) return String(t.telefone)
            }
            return ''
          })
          .filter(Boolean)
          .join(' / ')
      } else if (typeof rawTel === 'object' && rawTel !== null) {
        if (rawTel.ddd && rawTel.numero)
          telefoneFormatado = `(${rawTel.ddd}) ${rawTel.numero}`
        else if (rawTel.telefone) telefoneFormatado = String(rawTel.telefone)
      } else if (typeof rawTel === 'string') {
        telefoneFormatado = rawTel
      } else if (empresa.ddd_telefone_1 || empresa.telefone_1) {
        const ddd = empresa.ddd_telefone_1 ? `(${empresa.ddd_telefone_1}) ` : ''
        const num = empresa.telefone_1 || ''
        telefoneFormatado = `${ddd}${num}`.trim()
      }

      // Handle Email (could be array, object, string)
      let emailFormatado = ''
      const rawEmail = empresa.email || empresa.emails || empresa.contato_email
      if (Array.isArray(rawEmail)) {
        emailFormatado = rawEmail
          .map((e: any) => {
            if (typeof e === 'string') return e
            if (e && typeof e === 'object' && e.email) return e.email
            return ''
          })
          .filter(Boolean)
          .join(' / ')
      } else if (typeof rawEmail === 'object' && rawEmail !== null) {
        emailFormatado = rawEmail.email || ''
      } else if (typeof rawEmail === 'string') {
        emailFormatado = rawEmail
      }

      // cnae e porte: API v5 pode retornar objeto {"codigo":"...","descricao":"..."}
      const rawCnae =
        empresa.cnae_fiscal_principal || empresa.atividade_principal
      let cnaePrincipal = ''
      if (rawCnae) {
        if (typeof rawCnae === 'string') {
          cnaePrincipal = rawCnae
        } else if (typeof rawCnae === 'object') {
          const cod = rawCnae.codigo || rawCnae.code || ''
          const desc = rawCnae.descricao || rawCnae.description || ''
          cnaePrincipal = cod && desc ? `${cod} - ${desc}` : desc || cod || ''
        }
      }

      const rawPorte = empresa.porte_empresa || empresa.porte
      let porteStr = ''
      if (rawPorte) {
        if (typeof rawPorte === 'string') {
          porteStr = rawPorte
        } else if (typeof rawPorte === 'object') {
          porteStr =
            rawPorte.descricao || rawPorte.description || rawPorte.codigo || ''
        }
      }

      return {
        cnpj: empresa.cnpj,
        razao_social: empresa.razao_social || empresa.nome_fantasia || '',
        cnae_fiscal_principal: cnaePrincipal,
        municipio: String(municipioRaw || ''),
        uf: String(ufRaw || ''),
        porte: porteStr,
        situacao_cadastral: situacao,
        capital_social: empresa.capital_social || 0,
        email: emailFormatado,
        telefone: telefoneFormatado,
        data_inicio_atividade:
          empresa.data_inicio_atividade || empresa.data_abertura || '',
      }
    })

    if (results && results.length > 0) {
      try {
        const expira_em = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString()
        await supabase.from('cache_pesquisas').upsert(
          {
            chave_cache,
            resultados: results,
            total_registros: totalCount,
            expira_em,
            parametros: payloadToHash,
          },
          { onConflict: 'chave_cache' },
        )
      } catch (err) {
        console.error('Error saving cache:', err)
      }
    }

    await supabaseAdmin.from('api_debug_logs').insert({
      cnae: cnaes.join(', ') || null,
      uf: Array.isArray(uf) ? uf.join(', ') : uf || null,
      municipio: Array.isArray(municipio)
        ? municipio.join(', ')
        : municipio || null,
      limite: limit,
      status_http: externalStatus || 200,
      sucesso: true,
      tempo_resposta_ms: timeTakenApi,
      total_resultados: totalCount,
      resposta_json: data,
    })

    return new Response(
      JSON.stringify({
        cnpjs: results,
        page: currentPage,
        count: totalCount,
        pages: totalPages,
        cached: false,
        status_http: externalStatus || 200,
        raw_response: data,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message, cnpjs: [], status_http: 500 }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  }
})
