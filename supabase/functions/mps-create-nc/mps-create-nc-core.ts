// Lógica pura (sem I/O) de montagem do conteúdo da tarefa de Não
// Conformidade — porte fiel de ProjetoAuditMPS/src/routes/sprints.js
// (createNcForAnswer). Fica separada de index.ts (que faz a chamada real ao
// Bitrix) pra ser testável via vitest, mesmo padrão de mps-automation-core.ts.

export type NcItem = { atividade: string; questao: string; localizacao: string }

export function buildNcContent(
  grupo: string,
  blockLabel: string,
  projetoSprint: string,
  item: NcItem,
  observacoes: string | undefined,
) {
  const grupoFormatado = grupo.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  const titleBase = `${grupoFormatado} - ${item.atividade || blockLabel} / Sprint ${projetoSprint} / ${blockLabel}`
  const description = `[QUOTE]${item.questao}[/QUOTE]\n\nObservação do auditor: ${observacoes || '-'}\n\nLocalização de referência: ${item.localizacao || '-'}`
  return { titleBase, description }
}

/** "[ NC #<id> ] <titleBase>" — o Bitrix só atribui o ID depois de criar a tarefa, então o prefixo final vem num rename em seguida (ver index.ts). */
export function buildNcFinalTitle(taskId: string | number, titleBase: string) {
  return `[ NC #${taskId} ] ${titleBase}`
}

/** Extrai o ID numérico do usuário responsável a partir da URL do webhook (".../rest/<userId>/<token>/") — Bitrix exige RESPONSIBLE_ID na criação, não cai pra um padrão do grupo. */
export function webhookUserId(webhookUrl: string): string | null {
  const match = String(webhookUrl || '').match(/\/rest\/(\d+)\//)
  return match ? match[1] : null
}
