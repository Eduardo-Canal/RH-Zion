// Lógica pura do resolve-bitrix-users (Prompt 169) — sem dependências Deno,
// testável via vitest. A parte com I/O (fetch ao Bitrix, leitura/escrita em
// b24_users) fica em resolve-bitrix-users.ts, que importa este arquivo.

/** String() + dedup + descarta vazio/null/undefined — nunca confia no tipo de origem (number da API, string do banco). */
export function normalizeIds(
  rawIds: Array<string | number | null | undefined>,
): string[] {
  const set = new Set<string>()
  for (const raw of rawIds) {
    if (raw === null || raw === undefined) continue
    const id = String(raw).trim()
    if (id) set.add(id)
  }
  return Array.from(set)
}

/** IDs de `ids` que ainda não estão em `cachedIds`. */
export function diffMissingIds(ids: string[], cachedIds: string[]): string[] {
  const cached = new Set(cachedIds)
  return ids.filter((id) => !cached.has(id))
}

/** Quebra em lotes de até `size` (default 50, teto do endpoint `batch` do Bitrix). */
export function chunkIds(ids: string[], size = 50): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
}

/**
 * Monta os comandos `user.get?ID=X` para o endpoint `batch`, junto com o mapa
 * chave→id pedido — o parse nunca deve confiar no `ID` da resposta do Bitrix
 * pra saber "de quem" é aquele resultado, só na chave do batch (Prompt 168,
 * achado 5c: evita mismatch de tipo/formatação number vs string).
 */
export function buildUserGetBatchCmds(ids: string[]): {
  cmds: Record<string, string>
  keyToId: Record<string, string>
} {
  const cmds: Record<string, string> = {}
  const keyToId: Record<string, string> = {}
  ids.forEach((id, i) => {
    const key = `u${i}`
    cmds[key] = `user.get?ID=${encodeURIComponent(id)}`
    keyToId[key] = id
  })
  return { cmds, keyToId }
}

/** Rótulo usado quando o Bitrix não devolve nome pro ID (deletado/robô/erro) — nunca deixa o ID cru voltar a aparecer nas telas. */
export function fallbackUserName(id: string): string {
  return `Usuário ${id}`
}

/** Extrai "NOME SOBRENOME" de uma entrada de user.get (array ou objeto); null se não der pra montar um nome. */
export function extractUserName(raw: unknown): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw
  if (!first || typeof first !== 'object') return null
  const f = first as Record<string, unknown>
  const name = [f.NAME, f.LAST_NAME].filter(Boolean).join(' ').trim()
  return name || null
}

/**
 * Decide o nome final de cada ID pedido a partir do resultado bruto do
 * `batch` — SEMPRE retorna uma entrada por ID (nunca pula), caindo no
 * fallback nomeado quando o Bitrix não devolveu nada de aproveitável
 * (Prompt 168, achado 5d — diverge do LeadFinder, que pula silenciosamente).
 */
export function parseUserGetBatchResults(
  keyToId: Record<string, string>,
  results: Record<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, id] of Object.entries(keyToId)) {
    const name = extractUserName(results[key]) ?? fallbackUserName(id)
    out.set(id, name)
  }
  return out
}

/**
 * Extrai WORK_POSITION (cargo, texto livre preenchido no perfil da pessoa no
 * Bitrix) de uma entrada de user.get; null se vazio ou não vier. Pedido do
 * Everton (27/08/2026) pra trazer o cargo automático como SUGESTÃO — ver
 * classifyCargoBitrix ausente de propósito: são valores livres, cadastrados
 * por cada gestor, nunca vistos em produção até agora, então o texto sai CRU
 * daqui pra um humano decidir, não pra um classificador adivinhar dev/qa.
 */
export function extractUserPosition(raw: unknown): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw
  if (!first || typeof first !== 'object') return null
  const f = first as Record<string, unknown>
  const pos = typeof f.WORK_POSITION === 'string' ? f.WORK_POSITION.trim() : ''
  return pos || null
}

/**
 * Mesmo formato de parseUserGetBatchResults, mas pro cargo (WORK_POSITION) —
 * função separada de propósito: cargo não tem fallback (diferente do nome,
 * "sem cargo" é um estado válido, não um erro a disfarçar), e nem todo
 * consumidor de user.get precisa dele.
 */
export function parseUserGetBatchPositions(
  keyToId: Record<string, string>,
  results: Record<string, unknown>,
): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const [key, id] of Object.entries(keyToId)) {
    out.set(id, extractUserPosition(results[key]))
  }
  return out
}
