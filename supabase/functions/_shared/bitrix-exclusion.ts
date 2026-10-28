// Checagem centralizada de exclusão de telefone do fluxo Bitrix (N-20).
// Usado pelos 4 pontos de guard: add-message-to-batch, whatsapp-executive-handler,
// whatsapp-webhook-router (busca de candidatos) e flush-bitrix-batch.
//
// A canonicalização (phoneKey) mora em bitrix-exclusion-logic.ts, sem
// dependências Deno, pra ser testável via vitest — ver esse arquivo para a
// regra completa e o porquê de ela ser única e compartilhada.
//
// checkPhoneExclusion() NUNCA lança e NUNCA decide sozinha o que fazer com
// erro de consulta — ela só reporta o status ('excluded' | 'not_excluded' |
// 'error'). A decisão de tratar 'error' como fail-open (segue) ou
// fail-closed (aborta) é DECLARADA explicitamente em cada um dos 4 guards,
// porque a assimetria de erro é diferente ponto a ponto (ver migration
// 20260726100000_whatsapp_bitrix_excluded_phones.sql).
//
// LIMITAÇÃO CONHECIDA (RLS admin-only): a RLS de whatsapp_bitrix_excluded_phones
// só libera SELECT pra admin. Postgres filtra linha por RLS SEM gerar erro —
// então um `supabase` cliente que não seja service_role (anon/authenticated
// não-admin) recebe 0 linhas pra um telefone REALMENTE excluído, e esta
// função devolve { status: 'not_excluded' } (falso negativo), não 'error'.
// Isso só é seguro porque os 4 guards chamam sempre com o cliente
// service_role (confirmado em auditoria — grep por `createClient` nos 4
// arquivos). Se algum caller futuro passar um cliente sem service_role,
// essa checagem vira um no-op silencioso. Não há como este helper detectar
// essa condição sozinho (RLS e "não encontrado" são indistinguíveis do lado
// do cliente) — a garantia depende de quem chama, não de quem é chamado.

import { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3'
import { phoneKey } from './bitrix-exclusion-logic.ts'

export type ExclusionCheckResult =
  | { status: 'excluded' }
  | { status: 'not_excluded' }
  | { status: 'error'; message: string }

export async function checkPhoneExclusion(
  supabase: SupabaseClient,
  rawPhone: string,
): Promise<ExclusionCheckResult> {
  const key = phoneKey(rawPhone)

  if (key === null) {
    // Fail-open declarado: telefone que não normaliza (JID de grupo vazado
    // pra cá, pseudo-número, formato nunca visto) nunca é o contato
    // excluído de verdade — bloquear por padrão bloquearia tráfego legítimo
    // por um motivo que não existe. Vale para todos os 4 guards.
    console.warn(
      `[bitrix-exclusion] telefone não normalizável (${rawPhone.replace(/\D/g, '').length} dígitos), tratando como NÃO excluído`,
    )
    return { status: 'not_excluded' }
  }

  try {
    const { data, error } = await supabase
      .from('whatsapp_bitrix_excluded_phones')
      .select('id')
      .eq('phone_key', key)
      .maybeSingle()

    if (error) {
      console.error(
        '[bitrix-exclusion] erro ao consultar exclusão:',
        error.message,
      )
      return { status: 'error', message: error.message }
    }
    return data ? { status: 'excluded' } : { status: 'not_excluded' }
  } catch (e: any) {
    console.error(
      '[bitrix-exclusion] exceção ao consultar exclusão:',
      e.message,
    )
    return { status: 'error', message: e.message }
  }
}

export { phoneKey }
