import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    // Guard de chamada interna — achado de auditoria de 22/07/2026: esta
    // function não tinha nenhuma checagem de auth e aceitava endpoint/method/
    // headers/body livres de qualquer chamador anônimo (risco de SSRF/relay).
    // É um proxy 100% interno (edge function → edge function) — só aceita
    // Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
    if (!serviceRoleKey) {
      console.error(
        '[bitrix-rate-limiter] SUPABASE_SERVICE_ROLE_KEY não configurado — recusando execução.',
      )
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Configuração interna ausente',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, message: 'Token ausente' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (authHeader !== `Bearer ${serviceRoleKey}`) {
      console.error(
        '[bitrix-rate-limiter] Authorization inválido — chamada recusada.',
      )
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Acesso restrito a chamadas internas',
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => ({}))
    const { endpoint, method = 'GET', headers = {}, body } = payload

    if (!endpoint) {
      return new Response(
        JSON.stringify({ success: false, message: 'Endpoint is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 1. Obter a configuração do rate limit
    const { data: config } = await supabaseAdmin
      .from('bitrix_rate_limit_config')
      .select('*')
      .limit(1)
      .maybeSingle()

    const maxReqs = config?.max_requests ?? 2
    const timeWindowMins = config?.time_window_minutes ?? 1

    // 2. Verificar a janela de tempo
    const windowStart = new Date(
      Date.now() - timeWindowMins * 60 * 1000,
    ).toISOString()
    const { data: recentLogs } = await supabaseAdmin
      .from('bitrix_api_logs')
      .select('timestamp')
      .gte('timestamp', windowStart)
      .order('timestamp', { ascending: true })

    if (recentLogs && recentLogs.length >= maxReqs) {
      const oldestInWindow = new Date(recentLogs[0].timestamp)
      const nextAvailable = new Date(
        oldestInWindow.getTime() + timeWindowMins * 60 * 1000,
      )
      const waitSeconds = Math.ceil(
        (nextAvailable.getTime() - Date.now()) / 1000,
      )

      return new Response(
        JSON.stringify({
          success: false,
          message: `Rate limit atingido. Próxima requisição permitida em ${waitSeconds > 0 ? waitSeconds : 1} segundos`,
          next_available_at: nextAvailable.toISOString(),
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 3. Executar a requisição para a API externa
    const start = performance.now()
    let fetchStatus = 500
    let fetchError = null
    let responseData = null
    let responseHeaders: Record<string, string> = {}

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
      }

      if (method !== 'GET' && method !== 'HEAD' && body) {
        fetchOptions.body =
          typeof body === 'string' ? body : JSON.stringify(body)
      }

      const res = await fetch(endpoint, fetchOptions)
      fetchStatus = res.status

      res.headers.forEach((val, key) => {
        responseHeaders[key] = val
      })

      const text = await res.text()
      try {
        responseData = JSON.parse(text)
      } catch {
        responseData = text
      }

      if (!res.ok) {
        fetchError =
          typeof responseData === 'object'
            ? JSON.stringify(responseData)
            : String(responseData)
      }
    } catch (err: any) {
      fetchError = err.message
      responseData = { error: err.message }
    }

    const timeTaken = Math.round(performance.now() - start)

    // 4. Registrar a requisição no banco
    await supabaseAdmin.from('bitrix_api_logs').insert({
      endpoint,
      method,
      status_code: fetchStatus,
      response_time_ms: timeTaken,
      error_message: fetchError,
      request_body:
        typeof body === 'object' ? body : body ? { raw: body } : null,
      response_body:
        typeof responseData === 'object'
          ? responseData
          : responseData
            ? { raw: responseData }
            : null,
    })

    // 5. Retornar resposta ao cliente
    return new Response(
      JSON.stringify({
        success: fetchStatus >= 200 && fetchStatus < 300,
        message: fetchError
          ? 'Erro na requisição externa'
          : 'Requisição realizada com sucesso',
        status_code: fetchStatus,
        data: responseData,
        response_headers: responseHeaders,
        time_ms: timeTaken,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
