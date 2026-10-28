// Fase 6 do MPS (parte "tarefa de acompanhamento no Bitrix") — pedida pelo
// Everton em seguida ao e-mail de resultado. Porte fiel de
// ProjetoAuditMPS/src/services/bitrix.js (createAuditTask) +
// src/routes/sprints.js (parseSprintDateRange).

export function parseSprintDateRange(projetoSprint: string): {
  dateStart: string | null
  dateEnd: string | null
} {
  const matches = String(projetoSprint || '').match(/\d{2}\/\d{2}\/\d{4}/g)
  if (!matches || matches.length < 2) return { dateStart: null, dateEnd: null }
  const toIso = (br: string) => {
    const [dd, mm, yyyy] = br.split('/')
    return `${yyyy}-${mm}-${dd}`
  }
  return { dateStart: toIso(matches[0]), dateEnd: toIso(matches[1]) }
}

export function formatDateBr(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-')
  return `${dd}/${mm}/${yyyy}`
}

export function webhookUserId(webhookUrl: string): string | null {
  const match = String(webhookUrl || '').match(/\/rest\/(\d+)\//)
  return match ? match[1] : null
}

/**
 * Desambigua rótulos de blocos que compartilham a mesma aba (ex.: duas
 * seções de resumo dentro de "Monitoramento") — vira "Monitoramento 1" /
 * "Monitoramento 2" só quando há mais de um bloco na mesma aba, igual ao
 * blockLabelOf do original. Mapeia por blockKey (único), não por label —
 * evita colisão no mapa de itens de checklist quando 2 blocos têm o mesmo
 * rótulo bruto.
 */
export function computeBlockDisplayLabels(
  blocks: { key: string; label: string }[],
): Record<string, string> {
  const countBySheet: Record<string, number> = {}
  blocks.forEach((b) => {
    const sheet = b.key.split('::')[0]
    countBySheet[sheet] = (countBySheet[sheet] || 0) + 1
  })

  const seenIndexBySheet: Record<string, number> = {}
  const result: Record<string, string> = {}
  blocks.forEach((b) => {
    const sheet = b.key.split('::')[0]
    if (countBySheet[sheet] > 1) {
      seenIndexBySheet[sheet] = (seenIndexBySheet[sheet] || 0) + 1
      result[b.key] = `${b.label} ${seenIndexBySheet[sheet]}`
    } else {
      result[b.key] = b.label
    }
  })
  return result
}

export function buildAuditTaskTitle({
  grupo,
  projetoSprint,
}: {
  grupo: string
  projetoSprint: string
}): string {
  const grupoFormatado = grupo.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  return `[ Auditoria Zion Logtec] PROJETOS - ${grupoFormatado} - Sprint ${projetoSprint}`
}

export function buildAuditTaskFinalTitle(
  taskId: string | number,
  titleBase: string,
): string {
  return `${titleBase} [ID: ${taskId}]`
}

export function buildAuditTaskDescription({
  dateStart,
  dateEnd,
  blockLabels,
}: {
  dateStart: string | null
  dateEnd: string | null
  blockLabels: string[]
}): string {
  const periodoTxt =
    dateStart && dateEnd
      ? `${formatDateBr(dateStart)} - ${formatDateBr(dateEnd)}`
      : '?'
  return `Período da Sprint:\n (${periodoTxt})\n\nAuditorias a serem realizadas:\n${blockLabels.map((l) => `• ${l}`).join('\n')}`
}

/** Prazo da tarefa: fim da Sprint + N semanas (cobre a janela de Entrega, que acontece depois do fim da Sprint em si). */
export function computeAuditTaskDeadline(
  dateEnd: string,
  deadlineWeeks = 3,
): string {
  const deadline = new Date(`${dateEnd}T00:00:00Z`)
  deadline.setUTCDate(deadline.getUTCDate() + 7 * deadlineWeeks)
  return deadline.toISOString().slice(0, 19).replace('T', ' ')
}
