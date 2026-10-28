// Helper centralizado para checar se um phone está silenciado em uma
// instância específica. Usado por whatsapp-webhook-router (descarte de
// mensagens em tempo real) e por whatsapp-manage-instance action
// 'sync_recent' (descarte de chats sincronizados em lote).
//
// Mantém a lógica de filtro em UM lugar só — se o esquema da tabela
// whatsapp_silenced_phones mudar (ou se for adicionado match por
// padrão, regex, etc.), basta atualizar aqui.

import { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3'

/**
 * Retorna true se o phone está silenciado para a instância.
 * Em caso de erro de rede/banco, registra log e retorna false
 * (fail-open: não silencia se não conseguiu checar — mais seguro
 * para evitar perda silenciosa de mensagens legítimas).
 */
export async function isPhoneSilenced(
  supabase: SupabaseClient,
  instanceId: string,
  phone: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('whatsapp_silenced_phones')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('phone', phone)
      .maybeSingle()

    if (error) {
      console.error('[silenceFilter] erro ao consultar:', error.message)
      return false
    }
    return !!data
  } catch (e: any) {
    console.error('[silenceFilter] excecao:', e.message)
    return false
  }
}
