// Lógica pura do sync convergente do Google Ads (fatias conta×ano, orçamento
// por invocação, paginação). Sem dependências Deno — testável via vitest,
// mesmo padrão de _shared/normalize-phone.ts.
//
// Reformulação do Prompt 155, substituindo a abordagem "2020→hoje de tudo
// numa invocação só" do PR #9 (reprovada na auditoria do Prompt 154 — risco
// de 546/WORKER_RESOURCE_LIMIT sob volume real). Mesmo padrão convergente já
// validado no passo 6 do sync-mkt-bitrix (Prompt 149): unidade de trabalho
// pequena, orçamento por invocação, progresso persistido a cada unidade
// concluída (não só na response), convergência quando não sobra trabalho.

export interface GadsAccount {
  id: string
  name: string
}

export interface Slice {
  accountId: string
  accountName: string
  year: number
}

export function sliceKey(accountId: string, year: number): string {
  return `${accountId}:${year}`
}

// Anos cobertos: ano corrente → minYear (2020), descendente.
export function yearsDescending(currentYear: number, minYear = 2020): number[] {
  const years: number[] = []
  for (let y = currentYear; y >= minYear; y--) years.push(y)
  return years
}

// Range de datas de uma fatia. Ano corrente vai só até "hoje" (nunca data
// futura); anos passados cobrem o ano inteiro.
export function yearDateRange(
  year: number,
  currentYear: number,
  todayIso: string,
): { start: string; end: string } {
  const start = `${year}-01-01`
  const end = year === currentYear ? todayIso : `${year}-12-31`
  return { start, end }
}

// Fatias pendentes, em ordem: para cada ano (do corrente até minYear,
// descendente), passa por TODAS as contas antes de avançar pro ano anterior
// — prioriza dado recente pra todas as contas em vez de esgotar uma conta
// inteira (7 anos) antes de tocar a próxima. Pula qualquer fatia já em
// completedSlices. Corta em maxSlices (orçamento da invocação).
// CORREÇÃO 2026-08-18 (achado do Everton: "o total no período não tá
// atualizando"). O ano CORRENTE era tratado como qualquer outro: uma vez
// buscado, entrava em completedSlices e nunca mais era refeito. Ou seja, depois
// que o backfill convergia, clicar "Sincronizar" não trazia mais nada — o gasto
// desta semana ficava congelado no valor da última busca, e o painel de
// investimento parava no tempo sem nenhum erro aparecer.
//
// Agora o ano corrente é REFRESH PERMANENTE, em ciclos: enquanto houver conta
// cujo ano corrente não foi refeito neste ciclo, ela vem primeiro; quando todas
// tiverem sido refeitas, o ciclo REABRE e começa de novo. Isso mantém o
// orçamento por invocação (a proteção contra 546/WORKER_RESOURCE_LIMIT que
// motivou o desenho original) e não precisa de estado novo: usa a própria lista
// de fatias concluídas, limpando só as entradas do ano corrente quando o ciclo
// fecha.
//
// Anos FECHADOS continuam sendo backfill de uma vez só — não mudam mais, refazer
// seria desperdício de cota.
//
// Sem starvation nos dois sentidos: como o ano corrente vem primeiro mas o ciclo
// zera quando completa, sobra orçamento pras fatias antigas em parte das
// invocações (ex.: 5 contas com orçamento 3 → clique 1 refaz 3 do ano corrente,
// clique 2 refaz as outras 2 e ainda avança 1 do backfill, clique 3 reabre o
// ciclo).
export function computePendingSlices(
  accounts: GadsAccount[],
  completedSlices: string[],
  currentYear: number,
  maxSlices: number,
  minYear = 2020,
): Slice[] {
  const completed = new Set(completedSlices)

  // Ciclo de refresh fechado (todas as contas já refeitas no ano corrente) →
  // reabre, pra que o próximo clique volte a trazer o gasto mais novo.
  const chavesAnoCorrente = accounts.map((a) => sliceKey(a.id, currentYear))
  if (
    chavesAnoCorrente.length > 0 &&
    chavesAnoCorrente.every((k) => completed.has(k))
  ) {
    for (const k of chavesAnoCorrente) completed.delete(k)
  }

  const pending: Slice[] = []
  for (const year of yearsDescending(currentYear, minYear)) {
    for (const account of accounts) {
      if (pending.length >= maxSlices) return pending
      const key = sliceKey(account.id, year)
      if (!completed.has(key)) {
        pending.push({ accountId: account.id, accountName: account.name, year })
      }
    }
  }
  return pending
}

// Convergência = BACKFILL completo, ou seja, todas as contas cobriram todos os
// ANOS FECHADOS até minYear. O ano corrente não entra: ele é refresh permanente
// (ver computePendingSlices), então incluí-lo aqui faria a tela dizer "ainda há
// histórico pendente" pra sempre.
export function isFullyConverged(
  accounts: GadsAccount[],
  completedSlices: string[],
  currentYear: number,
  minYear = 2020,
): boolean {
  const completed = new Set(completedSlices)
  for (const year of yearsDescending(currentYear - 1, minYear)) {
    for (const account of accounts) {
      if (!completed.has(sliceKey(account.id, year))) return false
    }
  }
  return true
}

export interface PageResult {
  results: any[]
  nextPageToken?: string
}

export interface PagedFetchResult {
  results: any[]
  pages: number
  truncated: boolean
}

// Acumula todas as páginas de uma busca (segue nextPageToken) até a API não
// devolver mais nenhum token — com teto de segurança (maxPages): se atingido
// com token ainda pendente, marca truncated:true em vez de descartar o resto
// silenciosamente (diferença central vs. a versão anterior, que só lia a
// primeira página e nunca soube que havia mais dado).
export async function fetchAllPages(
  fetchPage: (pageToken: string | undefined) => Promise<PageResult>,
  maxPages = 50,
): Promise<PagedFetchResult> {
  let results: any[] = []
  let pageToken: string | undefined
  let pages = 0
  let truncated = false
  do {
    const page = await fetchPage(pageToken)
    results = results.concat(page.results || [])
    pageToken = page.nextPageToken
    pages++
    if (pageToken && pages >= maxPages) {
      truncated = true
      break
    }
  } while (pageToken)
  return { results, pages, truncated }
}
