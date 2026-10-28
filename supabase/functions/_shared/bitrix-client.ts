/**
 * Cliente Bitrix compartilhado pelas Edge Functions de sync do módulo Auditoria
 * (sync-sprint-bitrix, sync-cs-bitrix, sync-mkt-bitrix, mkt-data).
 *
 * Cota controlada por token bucket direto no banco (RPC `bitrix_try_acquire`,
 * migration `bitrix_try_acquire.sql`, Prompt 142) — NÃO passa mais pela Edge
 * Function `bitrix-rate-limiter`. Motivo: o gateway de Edge Functions da
 * Supabase throttla a INVOCAÇÃO da function em si (~10s de espera por
 * chamada, "Rate limit exceeded for trace ... Retry after Xms"), independente
 * de `bitrix_rate_limit_config` — diagnóstico dos Prompts 139/141. Uma RPC via
 * PostgREST não passa por esse gateway (milissegundos, não segundos), então
 * tirar a function do caminho elimina o problema pela raiz. A
 * `bitrix-rate-limiter` continua no ar pros 6 callers legados fora deste
 * cliente (bot WhatsApp e outros — ver BACKLOG); zero mudança pra eles.
 *
 * NUNCA ajustar `bitrix_rate_limit_config` por aqui — é decisão do Eduardo.
 * Trata os dois limites reais da conta Bitrix (confirmados pelo Eduardo em
 * 2026-07-02):
 *   1. Frequência: 2 req/s (~120/min) — conta inteira, um token não cria cota nova.
 *      → usar sempre o endpoint `batch` (até 50 comandos = 1 requisição) em vez
 *        de 1 chamada por item, e exponential backoff em QUERY_LIMIT_EXCEEDED/429.
 *   2. Tempo de execução: máx. 480s somados a cada janela de 10min.
 *      → soma o `time.operating` (ou `time.duration`) de cada resposta; ao chegar
 *        perto do teto, pausa a execução por um tempo antes de continuar.
 */

const OPERATING_SAFETY_CAP_SECONDS = 400 // margem sob o teto real de 480s/10min
const OPERATING_PAUSE_SECONDS = 70 // > 1min pra dar tempo da janela de 10min "esvaziar" um pouco

// Throttle de invocação do gateway de Edge Functions da Supabase (Prompt 141):
// mensagem "Rate limit exceeded for trace <id>. Retry after <ms>ms." — NÃO é o
// nosso bitrix-rate-limiter (esse tem mensagem própria em português, "Rate
// limit atingido...") nem um erro do Bitrix. Acontece antes do handler do
// bitrix-rate-limiter rodar, então bitrix_rate_limit_config nunca chega a ser
// lido — por isso subir max_requests não tinha efeito nenhum (Prompt 139).
// Ao contrário do retry genérico (backoff fixo, não sabe quanto esperar),
// aqui o próprio gateway informa o X exato — respeitamos esse valor em vez de
// adivinhar.
const GATEWAY_RETRY_MAX_ATTEMPTS = 3
const GATEWAY_RETRY_MAX_TOTAL_WAIT_MS = 45000
const GATEWAY_RETRY_MARGIN_MS = 500

export function parseGatewayRetryAfterMs(message: unknown): number | null {
  const match = /retry after (\d+)\s*ms/i.exec(String(message ?? ''))
  return match ? Number(match[1]) : null
}

/** Decide se ainda cabe esperar o gateway (teto de tentativas e de espera acumulada); retorna o tempo a esperar (ms) ou null se propagar a exceção. Exportada pura (sem I/O) pra ser testada em isolamento — ver bitrix-client-contracts.test.ts. */
export function nextGatewayRetryWaitMs(
  retryAfterMs: number,
  state: { attempts: number; waitedMs: number },
): number | null {
  if (state.attempts >= GATEWAY_RETRY_MAX_ATTEMPTS) return null
  const wait = retryAfterMs + GATEWAY_RETRY_MARGIN_MS
  if (state.waitedMs + wait > GATEWAY_RETRY_MAX_TOTAL_WAIT_MS) return null
  state.attempts++
  state.waitedMs += wait
  return wait
}

// Token bucket via RPC (Prompt 142) — margem sobre o wait_ms sugerido pela
// RPC e teto de espera acumulada; acima disso, propaga erro claro em vez de
// ficar esperando uma invocação que não teria tempo útil sobrando.
const ACQUIRE_MARGIN_MS = 200
const ACQUIRE_MAX_TOTAL_WAIT_MS = 90000

/**
 * Cliente REST mínimo pra Postgres via PostgREST — de propósito ZERO imports
 * (nem `npm:@supabase/supabase-js`, nem bare `@supabase/supabase-js`): este
 * arquivo precisa continuar importável como módulo puro tanto no Deno das
 * Edge Functions quanto no Node do vitest (é assim que os testes de
 * `parseGatewayRetryAfterMs`/`nextGatewayRetryWaitMs` importam de verdade a
 * função real, em vez de só regex no código-fonte) — mesmo padrão de
 * `_shared/supabase-admin.ts`, só que recebendo url/key explícitos em vez de
 * ler de Deno.env (createBitrixClient já recebe os dois como parâmetro).
 */
function createRestClient(supabaseUrl: string, serviceRoleKey: string) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
  return {
    async rpc(fn: string, params: Record<string, unknown> = {}) {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok)
        return { data: null, error: data ?? { message: `HTTP ${res.status}` } }
      return { data, error: null }
    },
    async insert(table: string, row: Record<string, unknown>) {
      return fetch(`${supabaseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      })
    },
  }
}

export function createBitrixClient(
  supabaseUrl: string,
  serviceRoleKey: string,
  baseUrl: string,
) {
  const supabaseAdmin = createRestClient(supabaseUrl, serviceRoleKey)
  let operatingSeconds = 0

  function trackOperating(raw: any) {
    const t = raw?.time?.operating ?? raw?.time?.duration
    if (typeof t === 'number' && t > 0) operatingSeconds += t
  }

  async function pauseIfNearOperatingLimit() {
    if (operatingSeconds >= OPERATING_SAFETY_CAP_SECONDS) {
      console.warn(
        `[bitrix-client] tempo de execução acumulado ~${operatingSeconds.toFixed(1)}s nesta sync — ` +
          `pausando ${OPERATING_PAUSE_SECONDS}s pra respeitar o limite de 480s/10min da conta Bitrix.`,
      )
      await new Promise((r) => setTimeout(r, OPERATING_PAUSE_SECONDS * 1000))
      operatingSeconds = 0
    }
  }

  /** Loop de acquire via RPC (token bucket no banco) — roda ANTES de qualquer fetch ao Bitrix. */
  async function acquireSlot() {
    let waitedMs = 0
    while (true) {
      const { data, error } = await supabaseAdmin.rpc('bitrix_try_acquire')
      if (error) {
        throw new Error(
          `Falha ao consultar bitrix_try_acquire: ${error.message ?? JSON.stringify(error)}`,
        )
      }
      if (data?.ok) return

      const wait = (data?.wait_ms ?? 0) + ACQUIRE_MARGIN_MS
      if (waitedMs + wait > ACQUIRE_MAX_TOTAL_WAIT_MS) {
        throw new Error(
          `bitrix_try_acquire: espera acumulada ultrapassaria o teto de ${ACQUIRE_MAX_TOTAL_WAIT_MS}ms — propagando em vez de continuar esperando`,
        )
      }
      waitedMs += wait
      console.warn(
        `[bitrix-client] cota Bitrix ocupada (token bucket), aguardando ${wait}ms (acumulado ${waitedMs}ms)`,
      )
      await new Promise((r) => setTimeout(r, wait))
    }
  }

  /** Espelha o log que a bitrix-rate-limiter gravava — mesma tabela, mesmo shape. Nunca derruba a chamada: falha de log fica isolada num .catch. */
  async function logBitrixApiCall(entry: {
    endpoint: string
    method: string
    status_code: number
    response_time_ms: number
    error_message: string | null
    request_body: unknown
    response_body: unknown
  }) {
    await supabaseAdmin.insert('bitrix_api_logs', entry).catch((err: any) => {
      console.warn(
        `[bitrix-client] falha ao gravar log em bitrix_api_logs: ${err?.message ?? err}`,
      )
    })
  }

  /** Adquire cota (RPC) e então chama o Bitrix direto via fetch — sem passar pela Edge Function proxy. */
  async function callRateLimiter(endpoint: string, body: unknown) {
    await acquireSlot()

    const start = performance.now()
    let fetchStatus = 500
    let fetchError: string | null = null
    let responseData: any = null
    let res: { ok: boolean; status: number }

    try {
      const fetchRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      res = fetchRes
      fetchStatus = fetchRes.status
      const text = await fetchRes.text()
      try {
        responseData = JSON.parse(text)
      } catch {
        responseData = text
      }
      if (!fetchRes.ok) {
        fetchError =
          typeof responseData === 'object'
            ? JSON.stringify(responseData)
            : String(responseData)
      }
    } catch (err: any) {
      res = { ok: false, status: 0 }
      fetchError = err.message
      responseData = { error: err.message }
    }

    const timeTaken = Math.round(performance.now() - start)

    await logBitrixApiCall({
      endpoint,
      method: 'POST',
      status_code: fetchStatus,
      response_time_ms: timeTaken,
      error_message: fetchError,
      request_body: body,
      response_body: responseData,
    })

    const data = {
      success: fetchStatus >= 200 && fetchStatus < 300,
      message: fetchError
        ? 'Erro na requisição externa'
        : 'Requisição realizada com sucesso',
      status_code: fetchStatus,
      data: responseData,
      time_ms: timeTaken,
    }

    return { res: res as Response, data }
  }

  function isRateLimited(res: Response, data: any, bitrixError: unknown) {
    return (
      res.status === 429 ||
      String(data.message || '').includes('Rate limit') ||
      bitrixError === 'QUERY_LIMIT_EXCEEDED' ||
      String(bitrixError || '').includes('QUERY_LIMIT')
    )
  }

  /**
   * Uma chamada de método Bitrix, retornando a resposta BRUTA (result + next +
   * total) — com retry exponencial. Uso interno: callBitrixAllPages precisa de
   * `next`/`total` pra paginar, que ficam fora de `result` na resposta do Bitrix.
   */
  async function callBitrixRaw(
    method: string,
    body: Record<string, unknown> = {},
  ) {
    await pauseIfNearOperatingLimit()
    let attempt = 1
    const maxRetries = 5
    let delay = 1000
    const gatewayRetryState = { attempts: 0, waitedMs: 0 }

    while (true) {
      const { res, data } = await callRateLimiter(
        `${baseUrl}${method}.json`,
        body,
      )
      const bitrixError = data.data?.error

      if (res.ok && data.success && !bitrixError) {
        trackOperating(data.data)
        return (data.data ?? {}) as {
          result?: unknown
          next?: number
          total?: number
        }
      }

      const gatewayRetryAfterMs = parseGatewayRetryAfterMs(data.message)
      if (gatewayRetryAfterMs !== null) {
        const wait = nextGatewayRetryWaitMs(
          gatewayRetryAfterMs,
          gatewayRetryState,
        )
        if (wait !== null) {
          console.warn(
            `[bitrix-client] gateway negou ${method} (Retry after ${gatewayRetryAfterMs}ms), tentativa ${gatewayRetryState.attempts}/${GATEWAY_RETRY_MAX_ATTEMPTS}, aguardando ${wait}ms`,
          )
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
      } else if (
        isRateLimited(res, data, bitrixError) &&
        attempt <= maxRetries
      ) {
        console.warn(
          `[bitrix-client] rate limit em ${method}, tentativa ${attempt}/${maxRetries}, aguardando ${delay}ms`,
        )
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 30000)
        attempt++
        continue
      }

      throw new Error(
        data.data?.error_description ||
          bitrixError ||
          data.message ||
          `Erro no Bitrix (${method})`,
      )
    }
  }

  /** Uma chamada de método Bitrix (ex.: crm.deal.list) — com retry exponencial. */
  async function callBitrix(
    method: string,
    body: Record<string, unknown> = {},
  ) {
    const raw = await callBitrixRaw(method, body)
    return raw.result ?? null
  }

  /** Até 50 comandos numa única requisição HTTP (conta como 1 pro limite de frequência). */
  async function callBitrixBatch(cmds: Record<string, string>) {
    await pauseIfNearOperatingLimit()
    let attempt = 1
    const maxRetries = 5
    let delay = 1000
    const gatewayRetryState = { attempts: 0, waitedMs: 0 }

    while (true) {
      const { res, data } = await callRateLimiter(`${baseUrl}batch`, {
        halt: 0,
        cmd: cmds,
      })
      const batchError = data.data?.error

      if (res.ok && data.success && !batchError) {
        trackOperating(data.data)
        return (data.data?.result?.result ?? data.data?.result ?? {}) as Record<
          string,
          unknown
        >
      }

      const gatewayRetryAfterMs = parseGatewayRetryAfterMs(data.message)
      if (gatewayRetryAfterMs !== null) {
        const wait = nextGatewayRetryWaitMs(
          gatewayRetryAfterMs,
          gatewayRetryState,
        )
        if (wait !== null) {
          console.warn(
            `[bitrix-client] gateway negou batch (Retry after ${gatewayRetryAfterMs}ms), tentativa ${gatewayRetryState.attempts}/${GATEWAY_RETRY_MAX_ATTEMPTS}, aguardando ${wait}ms`,
          )
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
      } else if (
        isRateLimited(res, data, batchError) &&
        attempt <= maxRetries
      ) {
        console.warn(
          `[bitrix-client] rate limit em batch, tentativa ${attempt}/${maxRetries}, aguardando ${delay}ms`,
        )
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 30000)
        attempt++
        continue
      }

      throw new Error(data.message || 'Erro no Bitrix (batch)')
    }
  }

  // Teto de segurança: nunca mais que 100 páginas (50 itens/página no Bitrix
  // = ~5000 itens) numa única chamada — evita loop infinito se o Bitrix devolver
  // `next` de forma inconsistente.
  const MAX_PAGES = 100
  const OFFSET_PAGE_SIZE = 50

  /** Extrai o array de itens do `result` bruto — alguns métodos embrulham a lista (tasks.task.list em `.tasks`, scrum.sprint.list às vezes em `.items`/`.sprints`), a maioria devolve o array direto ou um objeto indexado por ID. */
  function unwrapListChunk(method: string, result: unknown): any[] {
    if (method === 'tasks.task.list' && (result as any)?.tasks)
      return (result as any).tasks
    if (method === 'tasks.api.scrum.sprint.list')
      return Array.isArray(result)
        ? result
        : ((result as any)?.items ?? (result as any)?.sprints ?? [])
    if (Array.isArray(result)) return result
    if (result && typeof result === 'object') return Object.values(result)
    return []
  }

  /**
   * Pagina um método de listagem (via `start`/`next` da resposta BRUTA),
   * invocando `onPage(chunk, meta)` a cada página — permite gravar
   * incrementalmente em vez de acumular tudo em memória. Crítico pra grupos
   * grandes: um grupo com 2001 tarefas (41 páginas) que só grava no final
   * perde TUDO se a invocação estourar o tempo limite no meio da paginação
   * (ver sync-sprint-bitrix, diagnóstico do grupo 384).
   *
   * `opts.startAt` (opcional): retoma a paginação a partir desse `start` em
   * vez de 0 — usado pelo cursor de retomada do sync-cs-bitrix/sync-mkt-bitrix
   * (Prompt 122). `meta.next` (2º argumento do onPage, opcional pro caller):
   * o `start` da PRÓXIMA página, ou `null` se essa foi a última — permite ao
   * caller persistir "de onde continuar" depois de cada página.
   * RETROCOMPATÍVEL: onPage com 1 parâmetro só (como no Sprint, que nunca usa
   * o 2º argumento) continua funcionando idêntico — JS ignora argumentos
   * extras não declarados. `opts` é opcional; sem ele, comportamento igual.
   *
   * Retorna `{ total, truncated }` — nenhum dos callers existentes (Sprint,
   * callBitrixAllPages) capturava o retorno antigo (só `number`), então trocar
   * pra objeto não muda comportamento de ninguém que já existia; CS/MKT
   * (Prompt 122.1) passam a checar `truncated` pra não tratar o teto de
   * MAX_PAGES como sync completo — sem isso, um backfill de 189 páginas
   * "terminava com sucesso" na página 100 e rodava o DELETE de fantasmas
   * achando que tinha visto tudo.
   */
  async function callBitrixPagedEach(
    method: string,
    body: Record<string, unknown>,
    onPage: (
      chunk: any[],
      meta: { next: number | null },
    ) => Promise<void> | void,
    opts: { startAt?: number } = {},
  ): Promise<{ total: number; truncated: boolean }> {
    let start = opts.startAt ?? 0
    let page = 0
    let total = 0
    while (page < MAX_PAGES) {
      const raw = await callBitrixRaw(method, { ...body, start })
      const chunk = unwrapListChunk(method, raw.result)
      const next = raw.next === undefined ? null : raw.next
      await onPage(chunk, { next })
      total += chunk.length
      page++
      if (next === null) return { total, truncated: false }
      start = next
    }
    console.warn(
      `[bitrix-client] callBitrixPagedEach(${method}) atingiu o teto de ${MAX_PAGES} páginas — parando por segurança, pode haver mais dados no Bitrix.`,
    )
    return { total, truncated: true }
  }

  /** Pagina um método de listagem e acumula tudo em memória — wrapper de callBitrixPagedEach, use só quando o volume é pequeno (ex.: grupos/sprints). */
  async function callBitrixAllPages(
    method: string,
    body: Record<string, unknown> = {},
  ) {
    const all: any[] = []
    await callBitrixPagedEach(method, body, (chunk) => {
      all.push(...chunk)
    })
    return all
  }

  /**
   * Pagina um método de listagem QUE NÃO DEVOLVE `next`/`total` na resposta —
   * confirmado na documentação oficial do Bitrix pra tasks.api.scrum.sprint.list:
   * "returns a single page (max 50 records)", sem nenhum campo de continuação.
   * callBitrixAllPages/callBitrixPagedEach dependem de `raw.next`; nesses
   * métodos ele vem sempre `undefined`, então a "correção" de trocar
   * callBitrix por callBitrixAllPages (achado do grupo 384/EVOLUÇÃO-MLW,
   * 2026-07-14) não mudava nada na prática — parava sempre na 1ª página.
   * Em vez de `next`, avança `start` pelo tamanho real da página recebida e
   * para quando ela vier menor que OFFSET_PAGE_SIZE (última página) ou vazia.
   */
  async function callBitrixAllPagesByOffset(
    method: string,
    body: Record<string, unknown> = {},
  ) {
    const all: any[] = []
    let start = 0
    let page = 0
    while (page < MAX_PAGES) {
      const raw = await callBitrixRaw(method, { ...body, start })
      const chunk = unwrapListChunk(method, raw.result)
      all.push(...chunk)
      page++
      if (chunk.length < OFFSET_PAGE_SIZE) return all
      start += chunk.length
    }
    console.warn(
      `[bitrix-client] callBitrixAllPagesByOffset(${method}) atingiu o teto de ${MAX_PAGES} páginas — parando por segurança, pode haver mais dados no Bitrix.`,
    )
    return all
  }

  return {
    callBitrix,
    callBitrixBatch,
    callBitrixAllPages,
    callBitrixAllPagesByOffset,
    callBitrixPagedEach,
    getOperatingSeconds: () => operatingSeconds,
  }
}
