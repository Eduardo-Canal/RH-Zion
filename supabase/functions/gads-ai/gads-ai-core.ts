// Lógica pura do gads-ai (sanitização do histórico de chat). Sem dependências
// Deno — testável via vitest com execução real, mesmo padrão de
// sync-google-ads/gads-sync-core.ts.
//
// Ressalva da auditoria do PR #8 (Prompt 159): o histórico de mensagens do
// chat ("Fábio") vinha cru do cliente, com `role` incluído, direto pro array
// da OpenAI — a única function do projeto que confiava em `role` vindo do
// cliente (o whatsapp-bot-handler, por comparação, sempre monta `role` no
// servidor a partir do banco). Um usuário chamando a function fora da UI
// podia injetar um `role: 'system'` extra no meio da conversa. Corrigido
// forçando toda mensagem do cliente pra `user`/`assistant` aqui, antes de
// montar o payload — o único `system` do payload passa a ser sempre o
// prompt montado no servidor (buildChatSystemPrompt).

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function sanitizeClientMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(
      (m): m is { role?: unknown; content: string } =>
        !!m && typeof (m as any).content === 'string',
    )
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }))
}
