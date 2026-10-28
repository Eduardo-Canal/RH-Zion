// Helper compartilhado (Prompt 169): resolve nomes de usuário Bitrix por ID e
// mantém public.b24_users como cache local. Usado tanto pelo backfill sob
// demanda (sync-bitrix-users) quanto pela manutenção contínua embutida em
// sync-mkt-bitrix e sync-sprint-bitrix — mesma lógica, sem duplicar.
//
// SEMPRE grava uma linha em b24_users pra todo ID pedido, mesmo quando
// user.get não retorna nada (usuário deletado/robô no Bitrix). Diverge de
// propósito do padrão do LeadFinder (bitrix-get-entity-details/
// resolveUserLabels), que pula silenciosamente nesse caso: aqui isso
// re-consultaria o Bitrix pra sempre pelo mesmo ID morto e voltaria a exibir
// ID cru nas telas que dependem de b24_users (Prompt 168, achado 5d). O
// fallback 'Usuário ' + id (ver resolve-bitrix-users-logic.ts) fecha esse
// buraco: sempre há uma linha, sempre há um rótulo legível.
//
// SEMPRE resolve via o webhook CRM (getBitrixWebhookUrl) — mesmo para IDs que
// vieram do universo Sprint (responsible_id/sprint_elapsed/timeman_entries).
// É o único webhook com escopo `user` comprovado (bitrix-get-entity-details já
// chama user.get por ele com sucesso); o webhook Sprint
// (bitrix24_webhook_sprint) tem escopo tasks/sonet_group, sem garantia de
// escopo user (Prompt 168, achado 5b) — usá-lo aqui arriscaria falhar por
// permissão pros IDs que só apareceram no universo Sprint.

import { createBitrixClient } from './bitrix-client.ts'
import { getBitrixWebhookUrl } from './get-bitrix-url.ts'
import {
  normalizeIds,
  diffMissingIds,
  chunkIds,
  buildUserGetBatchCmds,
  parseUserGetBatchResults,
  parseUserGetBatchPositions,
  fallbackUserName,
} from './resolve-bitrix-users-logic.ts'

const BATCH_SIZE = 50

/**
 * Resolve os nomes dos IDs pedidos, priorizando o cache (b24_users) e
 * completando os que faltam via user.get (webhook CRM, em lotes de até 50
 * pelo endpoint `batch`, passando pela cota de bitrix_try_acquire). Devolve
 * um Map id→nome com TODOS os IDs pedidos (cache + recém-resolvidos).
 */
export async function resolveAndCacheUsers(
  supabaseAdmin: any,
  rawIds: Array<string | number | null | undefined>,
): Promise<Map<string, string>> {
  const ids = normalizeIds(rawIds)
  const result = new Map<string, string>()
  if (ids.length === 0) return result

  const { data: cached } = await supabaseAdmin
    .from('b24_users')
    .select('id, name')
    .in('id', ids)
  for (const row of cached ?? []) result.set(row.id, row.name)

  const missing = diffMissingIds(ids, Array.from(result.keys()))
  if (missing.length === 0) return result

  const baseUrl = await getBitrixWebhookUrl(supabaseAdmin) // sempre CRM — ver nota no topo do arquivo
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const { callBitrixBatch } = createBitrixClient(
    supabaseUrl,
    serviceRoleKey,
    baseUrl,
  )

  for (const chunk of chunkIds(missing, BATCH_SIZE)) {
    const { cmds, keyToId } = buildUserGetBatchCmds(chunk)
    let batchResults: Record<string, unknown> = {}
    try {
      batchResults = await callBitrixBatch(cmds)
    } catch (e: any) {
      // Mesmo se o batch inteiro falhar (rate limit esgotado, webhook fora do
      // ar), ainda gravamos o fallback nomeado pra todo mundo do lote — nunca
      // deixamos um ID sem linha em b24_users por causa de uma falha de rede.
      console.warn(
        `[resolve-bitrix-users] batch user.get falhou (${chunk.length} IDs) — gravando fallback: ${e?.message ?? e}`,
      )
    }

    const parsed = parseUserGetBatchResults(keyToId, batchResults)
    const rows = chunk.map((id) => ({
      id,
      name: parsed.get(id) ?? fallbackUserName(id),
      synced_at: new Date().toISOString(),
    }))
    await supabaseAdmin.from('b24_users').upsert(rows, { onConflict: 'id' })
    for (const row of rows) result.set(row.id, row.name)
  }

  return result
}

/**
 * Preenche work_position (cargo do Bitrix, texto livre) pra IDs que já estão
 * em b24_users mas ainda sem cargo — gente cadastrada antes da coluna
 * existir, ou nome resolvido por um caminho que não passa por cargo.
 *
 * Função SEPARADA de propósito, não embutida no cache-hit de
 * resolveAndCacheUsers: aquele caminho também é usado pelo MKT, que resolve
 * milhares de assigned_by_id de lead — se "sem cargo" contasse como "não
 * resolvido" ali, todo lead sem cargo apurado seria re-perguntado ao Bitrix
 * em TODA sincronização, estourando a cota de taxa por uma necessidade que só
 * o módulo Sprint tem hoje (mostrar o cargo como sugestão ao lado do nome).
 * Aqui o universo é pequeno de propósito (time interno que aponta hora em
 * sprint), então chamar isso a cada sync é seguro.
 *
 * NÃO classifica em dev/qa — devolve o texto cru do Bitrix pra um humano
 * decidir (ver comentário em extractUserPosition). "Sem cargo no Bitrix" não
 * é erro: fica null e tenta de novo no próximo sync, custo baixo.
 */
export async function backfillWorkPositions(
  supabaseAdmin: any,
  rawIds: Array<string | number | null | undefined>,
): Promise<void> {
  const ids = normalizeIds(rawIds)
  if (ids.length === 0) return

  const { data: semCargo } = await supabaseAdmin
    .from('b24_users')
    .select('id')
    .in('id', ids)
    .is('work_position', null)
  const pendentes = (semCargo ?? []).map((r: any) => r.id)
  if (pendentes.length === 0) return

  const baseUrl = await getBitrixWebhookUrl(supabaseAdmin) // sempre CRM — mesmo motivo de resolveAndCacheUsers
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const { callBitrixBatch } = createBitrixClient(
    supabaseUrl,
    serviceRoleKey,
    baseUrl,
  )

  for (const chunk of chunkIds(pendentes, BATCH_SIZE)) {
    const { cmds, keyToId } = buildUserGetBatchCmds(chunk)
    let batchResults: Record<string, unknown> = {}
    try {
      batchResults = await callBitrixBatch(cmds)
    } catch (e: any) {
      console.warn(
        `[resolve-bitrix-users] backfillWorkPositions falhou num lote (${chunk.length} IDs): ${e?.message ?? e}`,
      )
      continue
    }
    const positions = parseUserGetBatchPositions(keyToId, batchResults)
    for (const id of chunk) {
      const work_position = positions.get(id)
      if (!work_position) continue
      await supabaseAdmin
        .from('b24_users')
        .update({ work_position })
        .eq('id', id)
    }
  }
}
