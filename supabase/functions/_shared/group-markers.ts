// Fonte única da verdade do marcador. O sistema prefixa com ele TODA mensagem
// que envia em grupos; o roteador usa o mesmo prefixo para ignorá-las (anti-loop),
// sem descartar mensagens digitadas por humanos.
// IMPORTANTE: todo envio do sistema em grupo deve passar por sendGroupMessage
// (que aplica este prefixo). Não crie outros pontos de envio em grupo sem o marcador.
export const SYSTEM_GROUP_MARKER = '🤖 LeadFinder:'
