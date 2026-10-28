// Lógica pura (sem I/O, sem import Deno) da automação via Bitrix do MPS —
// porte funcional de ProjetoAuditMPS/src/services/auditAutomation.js. Fica
// separada de index.ts (que faz as chamadas HTTP ao Bitrix e o parse do
// .xlsx) pra ser testável via vitest com execução real, mesmo padrão de
// gads-sync-core.ts.
//
// Cobre só as 10 regras 'api'/'partial' (Bitrix puro, sem IA) — as 7 regras
// que leem ATA/GM via OpenAI ficam pra Fase 4 (Automação via IA), decisão
// registrada em BACKLOG.md pra não misturar as duas fases.

export function normalize(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function formatHours(seconds: number): string {
  const total = Number(seconds) || 0
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export function formatDateBr(isoDate: unknown): string {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function addDays(isoDate: string, delta: number): string {
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export const WEEKDAY_LABELS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
]

/** Lista datas ISO (yyyy-mm-dd) de toda segunda-sexta entre duas datas (inclusive). */
export function listWeekdays(startIso: string, endIso: string): string[] {
  const start = new Date(`${String(startIso).slice(0, 10)}T00:00:00Z`)
  const end = new Date(`${String(endIso).slice(0, 10)}T00:00:00Z`)
  const days: string[] = []
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow >= 1 && dow <= 5) days.push(d.toISOString().slice(0, 10))
  }
  return days
}

export type BitrixTask = {
  id: string
  title: string
  timeEstimate: number
  stageId?: string
  status?: string
}
export type ScrumFields = { storyPoints?: number }
export type TimeLogEntry = { date: string; seconds: number; userId: string }
export type Stage = { id: string; title: string; sort: number }
export type BitrixUser = { id: string; name: string; workPosition: string }
export type Sprint = {
  id: string
  status: string
  statusLabel: string
  dateStart: string
  dateEnd: string
  label: string
}

// ── Regra: "O Tech Lead analisou as demandas cadastradas em backlog..." ──
export function evalBacklogAnalisado(
  tasks: BitrixTask[],
  scrumFields: ScrumFields[],
) {
  const missing = tasks.filter(
    (t, i) => !Number(scrumFields[i]?.storyPoints) || !Number(t.timeEstimate),
  )
  if (tasks.length === 0) {
    return {
      verificacao: null,
      observacoes:
        'Backlog está vazio no Bitrix — confirme manualmente se é esperado.',
    }
  }
  if (missing.length === 0) {
    return {
      verificacao: 'OK',
      observacoes: `Todas as ${tasks.length} tarefas do Backlog contêm horas e pontos definidos.`,
    }
  }
  return {
    verificacao: 'NOK',
    observacoes: `Nem toda tarefa contém horas ou pontos definidos: ${missing.map((t) => `#${t.id} (${t.title})`).join(', ')}.`,
  }
}

// ── Regra (tier 'partial', nunca decide): "Scrum Poker..." ──
export function evalScrumPokerParcial(card: BitrixTask | undefined) {
  if (!card)
    return {
      verificacao: null,
      observacoes:
        'Cartão "Planejamento da Sprint" não encontrado na Sprint ativa — confirme manualmente.',
    }
  const hasHours = Number(card.timeEstimate) > 0
  const hoursNote = hasHours
    ? `Cartão "Planejamento da Sprint" (#${card.id}) teve ${formatHours(card.timeEstimate)} apontadas.`
    : `Cartão "Planejamento da Sprint" (#${card.id}) está sem horas apontadas.`
  return {
    verificacao: null,
    observacoes: `${hoursNote} Confirme com entrevista ao time se a técnica de Scrum Poker foi de fato usada.`,
  }
}

// ── Regra: "O Tech Lead criou uma nova Sprint na ferramenta Bitrix..." ──
export function evalSprintCriada(sprint: Sprint) {
  const ok = /\d{2}\/\d{2}\/\d{4}/.test(sprint.label)
  return {
    verificacao: ok ? 'OK' : 'NOK',
    observacoes: ok
      ? `Sprint "${sprint.label}" encontrada no Bitrix com data de início e fim definidas.`
      : `Sprint encontrada no Bitrix, mas sem datas de início/fim identificáveis no nome ("${sprint.label}").`,
  }
}

// ── Regra: "Houve a reunião em que o Tech Lead explicou para a equipe de DEV Team..." ──
export function evalReuniaoExplicacaoTime(card: BitrixTask | undefined) {
  if (!card)
    return {
      verificacao: 'NOK',
      observacoes:
        'Cartão "Planejamento da Sprint" não encontrado na Sprint ativa.',
    }
  const ok = Number(card.timeEstimate) > 0
  return {
    verificacao: ok ? 'OK' : 'NOK',
    observacoes: ok
      ? `Cartão "Planejamento da Sprint" (#${card.id}) teve ${formatHours(card.timeEstimate)} apontadas.`
      : `Cartão "Planejamento da Sprint" (#${card.id}) está sem horas apontadas.`,
  }
}

// ── Regra: "O Tech Lead iniciou efetivamente a Sprint na ferramenta Bitrix?" ──
export function evalSprintIniciada(sprint: Sprint) {
  const ok = sprint.status === 'active'
  return {
    verificacao: ok ? 'OK' : 'NOK',
    observacoes: ok
      ? `Sprint "${sprint.label}" está com status ativo no Bitrix.`
      : `Sprint "${sprint.label}" está com status "${sprint.statusLabel}" (não ativa) no Bitrix.`,
  }
}

export type MonitoringWindow = {
  windowStart: string
  windowEndExclusive: string
}

/** Comentário de justificativa já filtrado (sem notificação automática do Bitrix, que começa com "[USER=id]"). */
export type Comment = { date: string; text: string; author: string }

// ── Regra: "O Tech Lead está realizando reuniões diárias (dailys)..." ──
export function evalDailyRealizada(
  card: BitrixTask | undefined,
  sprint: Sprint,
  timeLog: TimeLogEntry[],
  comments: Comment[],
  window: MonitoringWindow | undefined,
) {
  if (!card)
    return {
      verificacao: 'NOK',
      observacoes: 'Cartão "Daily" não encontrado na Sprint atual.',
    }
  if (!sprint.dateStart || !sprint.dateEnd) {
    return {
      verificacao: null,
      observacoes: `Cartão "Daily" (#${card.id}) encontrado, mas não foi possível obter o período (datas) da Sprint para checar dia a dia — confirme manualmente.`,
    }
  }

  const secondsByDate: Record<string, number> = {}
  for (const entry of timeLog) {
    if (!entry.date) continue
    secondsByDate[entry.date] = (secondsByDate[entry.date] || 0) + entry.seconds
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const allWeekdays = listWeekdays(sprint.dateStart, sprint.dateEnd)
  const lastDay = allWeekdays[allWeekdays.length - 1]

  const windowStart = window?.windowStart || sprint.dateStart
  const windowEndExclusive = window?.windowEndExclusive || todayIso
  const windowEndInclusive = addDays(windowEndExclusive, -1)

  if (windowStart > windowEndInclusive) {
    return {
      verificacao: null,
      observacoes: `Não deu para calcular o período deste Monitoramento: a "Data da auditoria" deste bloco (${formatDateBr(windowEndExclusive)}) está igual ou antes da data do Monitoramento anterior (${formatDateBr(windowStart)}). Confira/ajuste a "Data da auditoria" no topo de cada bloco de Monitoramento, na ordem em que foram feitos, e rode de novo.`,
    }
  }

  const dayDetails = allWeekdays
    .filter(
      (iso) =>
        iso >= windowStart && iso <= windowEndInclusive && iso <= todayIso,
    )
    .map((iso) => ({
      iso,
      seconds: secondsByDate[iso] || 0,
      isLastDay: iso === lastDay,
    }))

  if (dayDetails.length === 0) {
    return {
      verificacao: null,
      observacoes: `Cartão "Daily" (#${card.id}) encontrado, mas não há dias úteis no período deste Monitoramento (${formatDateBr(windowStart)} a ${formatDateBr(windowEndInclusive)}) para checar ainda — confirme manualmente.`,
    }
  }

  const missingCandidates = dayDetails.filter(
    (d) => d.seconds === 0 && !d.isLastDay,
  )

  const commentsByDate: Record<string, Comment[]> = {}
  const addComment = (dateIso: string, c: Comment) => {
    ;(commentsByDate[dateIso] = commentsByDate[dateIso] || []).push(c)
  }
  if (missingCandidates.length > 0) {
    const missingByDdMm = new Map(
      missingCandidates.map((d) => [
        d.iso.slice(5).split('-').reverse().join('/'),
        d.iso,
      ]),
    )
    for (const c of comments) {
      if (c.date) addComment(c.date, c)
      const found = c.text.match(/\b(\d{2}\/\d{2})(?:\/\d{2,4})?\b/g) || []
      for (const m of found) {
        const ddmm = m.slice(0, 5)
        const iso = missingByDdMm.get(ddmm)
        if (iso) addComment(iso, c)
      }
    }
  }

  const missing: typeof dayDetails = []
  const justified: ((typeof dayDetails)[number] & { comments: Comment[] })[] =
    []
  missingCandidates.forEach((d) => {
    const dayComments = commentsByDate[d.iso]
    if (dayComments && dayComments.length)
      justified.push({ ...d, comments: dayComments })
    else missing.push(d)
  })

  const totalSeconds = dayDetails.reduce((sum, d) => sum + d.seconds, 0)
  const perDayLines = dayDetails
    .map((d) => {
      if (d.seconds > 0)
        return `- ${WEEKDAY_LABELS[new Date(d.iso).getUTCDay()]} ${formatDateBr(d.iso)}: ${formatHours(d.seconds)}`
      const j = justified.find((j2) => j2.iso === d.iso)
      if (j)
        return `- ${WEEKDAY_LABELS[new Date(d.iso).getUTCDay()]} ${formatDateBr(d.iso)}: sem horas, mas justificado no comentário — "${j.comments[0].text}" (${j.comments[0].author})`
      return `- ${WEEKDAY_LABELS[new Date(d.iso).getUTCDay()]} ${formatDateBr(d.iso)}: sem horas${d.isLastDay ? ' (último dia, tolerado)' : ''}`
    })
    .join('\n')
  const pendingNote =
    windowEndInclusive > todayIso
      ? `\n\nSprint ainda em andamento (dias após ${formatDateBr(todayIso)} ainda não avaliados).`
      : ''

  if (missing.length === 0) {
    return {
      verificacao: 'OK',
      observacoes: `Cartão "Daily" (#${card.id}) teve horas apontadas (ou justificativa em comentário) em todos os dias úteis deste Monitoramento (${formatDateBr(windowStart)} a ${formatDateBr(windowEndInclusive)}).\n\n${perDayLines}\n\nTotal: ${formatHours(totalSeconds)}.${pendingNote}`,
    }
  }
  return {
    verificacao: 'NOK',
    observacoes: `Cartão "Daily" (#${card.id}) sem horas apontadas nem justificativa em comentário em: ${missing.map((d) => `${WEEKDAY_LABELS[new Date(d.iso).getUTCDay()]} ${formatDateBr(d.iso)}`).join(', ')}.\n\n${perDayLines}\n\nTotal: ${formatHours(totalSeconds)}.${pendingNote}`,
  }
}

export type HourProblem = {
  task: BitrixTask
  missing: string[]
  stageTitle: string
}

/** Compartilhado por 2 regras de Monitoramento — acha tarefas sem hora de Dev/QA esperada dada a etapa atual. */
export function computeDevQaHourProblems(
  tasks: BitrixTask[],
  stages: Stage[],
  logsByTask: TimeLogEntry[][],
  users: BitrixUser[],
): { problems: HourProblem[]; rolesNote: string } {
  if (tasks.length === 0) return { problems: [], rolesNote: '' }

  const stageById = new Map(stages.map((s) => [s.id, s]))
  const devSorts = stages
    .filter((s) => /desenvolv/.test(normalize(s.title)))
    .map((s) => s.sort)
  const qaSorts = stages
    .filter((s) => /em teste|qualid|homolog/.test(normalize(s.title)))
    .map((s) => s.sort)
  const devStageSort = devSorts.length ? Math.min(...devSorts) : Infinity
  const qaStageSort = qaSorts.length ? Math.min(...qaSorts) : Infinity

  const roleById = new Map(
    users.map((u) => {
      const pos = normalize(u.workPosition)
      const role = /qualid|\bqa\b/.test(pos)
        ? 'qa'
        : /desenvolv|\bdev\b/.test(pos)
          ? 'dev'
          : 'outro'
      return [u.id, { role, name: u.name || `#${u.id}` }]
    }),
  )

  const problems: HourProblem[] = []
  tasks.forEach((task, i) => {
    const stage = stageById.get(String(task.stageId))
    if (stage && /fixo/.test(normalize(stage.title))) return
    const stageSort = stage ? stage.sort : Infinity
    if (stageSort < devStageSort) return

    const log = logsByTask[i] || []
    const roles = new Set(
      log.map((e) => (roleById.get(e.userId) || { role: 'outro' }).role),
    )
    const needsQa = stageSort >= qaStageSort

    const missing: string[] = []
    if (!roles.has('dev')) missing.push('Desenvolvimento')
    if (needsQa && !roles.has('qa')) missing.push('Qualidade')
    if (missing.length)
      problems.push({ task, missing, stageTitle: stage ? stage.title : '' })
  })

  const devNames = [...roleById.values()]
    .filter((u) => u.role === 'dev')
    .map((u) => u.name)
  const qaNames = [...roleById.values()]
    .filter((u) => u.role === 'qa')
    .map((u) => u.name)
  const rolesNote = `Considerados Desenvolvimento (pelo Cargo no Bitrix): ${devNames.length ? devNames.join(', ') : 'ninguém'}. Considerados Qualidade: ${qaNames.length ? qaNames.join(', ') : 'ninguém'}.`

  return { problems, rolesNote }
}

// ── Regra: "Os desenvolvedores e analistas de qualidade registraram os horários..." ──
export function evalDevQaHorasRegistradas(
  tasksLength: number,
  problems: HourProblem[],
  rolesNote: string,
) {
  if (tasksLength === 0)
    return {
      verificacao: null,
      observacoes:
        'Nenhuma tarefa aberta encontrada na Sprint — confirme manualmente.',
    }
  if (problems.length === 0) {
    return {
      verificacao: 'OK',
      observacoes: `Todas as tarefas da Sprint que já entraram em Desenvolvimento têm horas de Desenvolvimento apontadas, e as que já chegaram em "Em Teste" têm também horas de Qualidade.\n\n${rolesNote}`,
    }
  }
  const detail = problems
    .map(
      (p) =>
        `- #${p.task.id} (${p.task.title})${p.stageTitle ? ` [etapa: ${p.stageTitle}]` : ''}: falta hora de ${p.missing.join(' e de ')}`,
    )
    .join('\n')
  return {
    verificacao: 'NOK',
    observacoes: `Encontrei ${problems.length} problema(s):\n\n${detail}\n\n${rolesNote}\n\n(Classificação de papel via campo "Cargo" do usuário no Bitrix e de etapa via nome da coluna do Kanban da Sprint — confira se bateu certo.)`,
  }
}

export type Justificativa = {
  text: string
  source: 'bate-papo' | 'descrição da tarefa'
} | null

// ── Regra: "Caso alguma Tarefa não possua tempo destinado a Desenvolvimento ou a Teste..." ──
export function evalTarefaSemHoraJustificada(
  tasksLength: number,
  problems: HourProblem[],
  justificativas: Justificativa[],
) {
  if (tasksLength === 0)
    return {
      verificacao: null,
      observacoes:
        'Nenhuma tarefa aberta encontrada na Sprint — confirme manualmente.',
    }
  if (problems.length === 0)
    return {
      verificacao: 'OK',
      observacoes:
        'Nenhuma tarefa está sem hora de Desenvolvimento/Qualidade esperada nesta Sprint — não há nada a justificar.',
    }

  const results = problems.map((p, i) => ({
    ...p,
    justificativa: justificativas[i],
  }))
  const semJustificativa = results.filter((r) => !r.justificativa)
  const comJustificativa = results.filter((r) => r.justificativa)

  const detailJustificadas = comJustificativa
    .map(
      (p) =>
        `- #${p.task.id} (${p.task.title}): falta hora de ${p.missing.join(' e de ')} — justificado na ${p.justificativa!.source}: "${p.justificativa!.text.slice(0, 200)}"`,
    )
    .join('\n')
  const detailSemJustificativa = semJustificativa
    .map(
      (p) =>
        `- #${p.task.id} (${p.task.title}): falta hora de ${p.missing.join(' e de ')} — SEM nenhuma mensagem explicando no cartão`,
    )
    .join('\n')

  if (semJustificativa.length === 0) {
    return {
      verificacao: 'OK',
      observacoes: `Todas as ${results.length} tarefa(s) sem hora de Desenvolvimento/Qualidade esperada têm justificativa registrada no cartão:\n\n${detailJustificadas}`,
    }
  }
  return {
    verificacao: 'NOK',
    observacoes: `${semJustificativa.length} de ${results.length} tarefa(s) sem hora esperada NÃO têm justificativa no cartão:\n\n${detailSemJustificativa}${comJustificativa.length ? `\n\nCom justificativa:\n${detailJustificadas}` : ''}`,
  }
}

export function computeBurndownDeviation(
  tasks: BitrixTask[],
  scrumFields: ScrumFields[],
  sprint: Sprint,
) {
  let totalPoints = 0
  let completedPoints = 0
  tasks.forEach((t, i) => {
    const points = Number(scrumFields[i]?.storyPoints) || 0
    totalPoints += points
    if (String(t.status) === '5') completedPoints += points
  })

  const todayIso = new Date().toISOString().slice(0, 10)
  const allDays = listWeekdays(sprint.dateStart, sprint.dateEnd)
  const elapsedDays = listWeekdays(
    sprint.dateStart,
    todayIso < sprint.dateEnd.slice(0, 10) ? todayIso : sprint.dateEnd,
  ).length
  const totalDays = allDays.length || 1

  const idealFraction = Math.min(1, elapsedDays / totalDays)
  const idealRemaining = totalPoints * (1 - idealFraction)
  const actualRemaining = totalPoints - completedPoints
  const deviationPct =
    totalPoints > 0
      ? ((actualRemaining - idealRemaining) / totalPoints) * 100
      : 0

  return {
    totalPoints,
    completedPoints,
    actualRemaining,
    idealRemaining,
    deviationPct,
    elapsedDays,
    totalDays,
  }
}

export type PlanoAcaoRow = {
  origem: string
  indicador: string
  causa: string
  responsavel: string
  acao: string
  dataAcao: string
  status: string
}

export function filterPlanoAcaoRows(rows: PlanoAcaoRow[], sprintLabel: string) {
  const versionToken = sprintLabel.match(/\d{4}\.\d{2}\.\d+\.\d+/)
  const token = versionToken
    ? versionToken[0]
    : sprintLabel
        .split(' (')[0]
        .replace(/^Sprint\s+/i, '')
        .trim()
  return {
    token,
    matches: rows.filter(
      (r) => r.origem.includes(token) && /burndown/i.test(r.indicador),
    ),
  }
}

// ── Regra: "As medições dos indicadores estão sendo registradas?" (só Burndown, verificável ao vivo) ──
export function evalIndicadoresBurndown(
  burndown: ReturnType<typeof computeBurndownDeviation>,
  repositorioGroupId: string | null | undefined,
  planoAcao: { token: string; matches: PlanoAcaoRow[] } | null,
  planoAcaoError: string | null,
) {
  const withinTarget = burndown.deviationPct <= 10
  const resumo = `Burndown: ${burndown.totalPoints} pontos totais, ${burndown.completedPoints} concluídos, restam ${burndown.actualRemaining.toFixed(1)} (ideal seria ${burndown.idealRemaining.toFixed(1)} com ${burndown.elapsedDays}/${burndown.totalDays} dias úteis decorridos) → desvio de ${burndown.deviationPct.toFixed(1)}% (meta: até 10%).`

  if (withinTarget)
    return { verificacao: 'OK', observacoes: `${resumo} Dentro da meta.` }

  if (!repositorioGroupId) {
    return {
      verificacao: null,
      observacoes: `${resumo} Fora da meta — precisa ter uma linha no Plano de Ação, mas o ID do grupo "Repositório Zion" não está configurado em Configurações para eu conferir. Confirme manualmente.`,
    }
  }

  if (planoAcaoError) {
    return {
      verificacao: null,
      observacoes: `${resumo} Fora da meta — precisa ter uma linha no Plano de Ação, mas não consegui ler a planilha: ${planoAcaoError} Confirme manualmente.`,
    }
  }

  if (!planoAcao || planoAcao.matches.length === 0) {
    return {
      verificacao: 'NOK',
      observacoes: `${resumo} Fora da meta, e não encontrei nenhuma linha de Burndown para esta Sprint (${planoAcao?.token}) na planilha "Plano de Ação Indicadores Projetos.xlsx".`,
    }
  }
  const linhas = planoAcao.matches
    .map(
      (r) =>
        `- ${r.dataAcao || r.origem}: causa "${r.causa}" — ação: "${r.acao || 'EM BRANCO'}" — status: ${r.status || 'EM BRANCO'}`,
    )
    .join('\n')
  return {
    verificacao: 'OK',
    observacoes: `${resumo} Fora da meta, mas encontrei registro no Plano de Ação:\n\n${linhas}`,
  }
}

export type RiskRow = {
  timeImpactado: string
  descricao: string
  status: string
  requerContingencia: string
  acaoContingencia: string
  responsavelContingencia: string
  dataContingencia: unknown
  requerMitigacao: string
  acaoMitigacao: string
  responsavelMitigacao: string
  dataMitigacao: unknown
}

export function filterRiskRegisterRows(rows: RiskRow[], grupoNome: string) {
  const grupoTokens = normalize(grupoNome).split(/\s+/).filter(Boolean)
  return rows.filter((r) => {
    const time = normalize(r.timeImpactado)
    return grupoTokens.some((tok) => tok.length > 2 && time.includes(tok))
  })
}

// ── Regra: "As avaliações da Gestão de Risco estão ocorrendo?" ──
export function evalGestaoRisco(
  repositorioGroupId: string | null | undefined,
  riskRegister: { rows: RiskRow[]; updatedAt: unknown } | null,
  riskRegisterError: string | null,
  grupoNome: string,
) {
  if (!repositorioGroupId) {
    return {
      verificacao: null,
      observacoes:
        'ID do grupo "Repositório Zion" não configurado em Configurações — não consigo checar a Planilha de Riscos. Confirme manualmente.',
    }
  }
  if (riskRegisterError || !riskRegister) {
    return {
      verificacao: null,
      observacoes: `Não consegui ler a Planilha de Riscos: ${riskRegisterError || 'erro desconhecido'} Confirme manualmente.`,
    }
  }

  const meus = filterRiskRegisterRows(riskRegister.rows, grupoNome)
  if (meus.length === 0) {
    return {
      verificacao: null,
      observacoes: `Planilha de Riscos atualizada em ${formatDateBr(riskRegister.updatedAt)}, mas não encontrei nenhum risco na aba "GR" com "Time impactado" batendo com "${grupoNome}" — confirme manualmente se o nome do time na planilha é diferente do esperado.`,
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const atrasados: string[] = []
  const semPlano: string[] = []
  const comPlano: string[] = []
  meus.forEach((r) => {
    if (normalize(r.status) !== 'aberto') return

    if (/^sim$/i.test(r.requerContingencia)) {
      const temPlano = Boolean(r.acaoContingencia && r.responsavelContingencia)
      ;(temPlano ? comPlano : semPlano).push(
        `${r.descricao} — Contingência (resp.: ${r.responsavelContingencia || 'EM BRANCO'})`,
      )
      if (r.dataContingencia) {
        const dt = new Date(r.dataContingencia as any)
          .toISOString()
          .slice(0, 10)
        if (dt < todayIso)
          atrasados.push(
            `${r.descricao} — Contingência vencida em ${formatDateBr(dt)}`,
          )
      }
    }
    if (/^sim$/i.test(r.requerMitigacao)) {
      const temPlano = Boolean(r.acaoMitigacao && r.responsavelMitigacao)
      ;(temPlano ? comPlano : semPlano).push(
        `${r.descricao} — Mitigação (resp.: ${r.responsavelMitigacao || 'EM BRANCO'})`,
      )
      if (r.dataMitigacao) {
        const dt = new Date(r.dataMitigacao as any).toISOString().slice(0, 10)
        if (dt < todayIso)
          atrasados.push(
            `${r.descricao} — Mitigação vencida em ${formatDateBr(dt)}`,
          )
      }
    }
  })

  const resumoPlanilha = `Planilha de Riscos ("${grupoNome}"), última atualização do arquivo em ${formatDateBr(riskRegister.updatedAt)}.`
  const planoNote = `Plano de ação sendo acompanhado (${comPlano.length}): ${comPlano.length ? comPlano.join('; ') : '-'}.`

  if (atrasados.length === 0 && semPlano.length === 0) {
    return {
      verificacao: 'OK',
      observacoes: `${resumoPlanilha} Nenhum risco aberto com prazo vencido, e todo risco que exige contingência/mitigação tem plano de ação preenchido.\n\n${planoNote}`,
    }
  }
  const problemas: string[] = []
  if (atrasados.length)
    problemas.push(
      `Risco(s) aberto(s) com prazo vencido:\n${atrasados.map((a) => `- ${a}`).join('\n')}`,
    )
  if (semPlano.length)
    problemas.push(
      `Plano de ação NÃO sendo acompanhado (ação/responsável em branco):\n${semPlano.map((a) => `- ${a}`).join('\n')}`,
    )
  return {
    verificacao: 'NOK',
    observacoes: `${resumoPlanilha}\n\n${problemas.join('\n\n')}\n\n${planoNote}`,
  }
}

// ── Regras de IA (Fase 4) — leem ATA (PDF)/Gestão de Mudanças (docx) direto
// do Bitrix Disk, mandando o ARQUIVO pra OpenAI (gpt-4o-mini já lê PDF/docx
// nativamente) em vez de extrair texto no servidor — pdf-parse tem
// incompatibilidade documentada em Supabase Edge Functions/Deno, então nem
// tentamos. As funções abaixo só recebem o JSON já respondido pela IA
// (parseado em index.ts) e decidem OK/NOK/null — mesma divisão pura/I-O da
// Fase 3. Decisão do Everton (2026-07-13): manda o arquivo pra OpenAI, ciente
// da política de retenção padrão da API (não usado pra treino, retido por
// pouco tempo por segurança) — mesmo padrão de exposição que o resto do
// projeto já usa com outras telas de IA.

export type AiCronogramaResult = {
  preenchido: boolean
  trecho?: string
  comentario?: string
}

// ── Regra: "O Tech Lead apresentou a todos os stakeholders o cronograma..." ──
export function evalCronogramaApresentado(r: AiCronogramaResult) {
  return {
    verificacao: r.preenchido ? 'OK' : 'NOK',
    observacoes: `IA: seção "1.5 Período Sprint" ${r.preenchido ? 'está preenchida' : 'NÃO está preenchida corretamente'} — "${r.trecho || ''}". ${r.comentario || ''}`,
  }
}

export type AiAprovacaoResult = {
  aprovado: boolean | null
  trecho?: string
  comentario?: string
}

// ── Regra: "Os stakeholders aprovaram as demandas planejadas..." ──
export function evalStakeholdersAprovaram(r: AiAprovacaoResult) {
  const label =
    r.aprovado === true
      ? 'positiva'
      : r.aprovado === false
        ? 'negativa'
        : 'não encontrada'
  return {
    verificacao:
      r.aprovado === true ? 'OK' : r.aprovado === false ? 'NOK' : null,
    observacoes: `IA: aprovação na seção "8. APROVAÇÃO DO CONTEÚDO DA SPRINT" está ${label} — "${r.trecho || ''}". ${r.comentario || ''}${r.aprovado === null ? ' Confirme manualmente.' : ''}`,
  }
}

export type AiAtaCriadaResult = {
  completo: boolean
  tarefas_sem_estimativa?: string[]
  comentario?: string
}

// ── Regra: "O Tech Lead criou uma Ata de Reunião, detalhando as tarefas..." ──
export function evalAtaCriada(r: AiAtaCriadaResult) {
  const semEstimativa = (r.tarefas_sem_estimativa || []).join(', ')
  return {
    verificacao: r.completo ? 'OK' : 'NOK',
    observacoes: `IA: ${r.completo ? 'todas as tarefas da ATA têm horas/pontos e os totais da seção 5 estão preenchidos' : `faltam estimativas em: ${semEstimativa || 'não especificado'}`}. ${r.comentario || ''}`,
  }
}

export type AiHorasAtaResult = {
  horas_totais_ata: number | null
  trecho?: string
}

// ── Regra: "O Tech Lead montou a Sprint com as tarefas que foram elencadas..." (nunca decide sozinha) ──
export function evalMontouSprintConformeAta(
  totalSeconds: number,
  tasksLength: number,
  r: AiHorasAtaResult,
) {
  const sprintHours = totalSeconds / 3600
  const ataHours =
    typeof r.horas_totais_ata === 'number' ? r.horas_totais_ata : null
  const diffNote =
    ataHours != null
      ? `Diferença de ${Math.abs(sprintHours - ataHours).toFixed(0)}h (esperado: a Sprint em andamento só soma tarefas ainda abertas, então alguma diferença é normal).`
      : 'Não encontrei o total de horas na ATA.'
  return {
    verificacao: null,
    observacoes: `Soma das horas estimadas das ${tasksLength} tarefas abertas na Sprint (Bitrix): ${formatHours(totalSeconds)}. IA encontrou na ATA: ${ataHours != null ? `${ataHours}h` : 'não encontrado'}. ${diffNote} Confirme antes de marcar.`,
  }
}

export type DiaComImpedimento = {
  data: string
  trecho: string
  teve_encaminhamento: boolean
}

// ── Regra: "O Tech Lead providenciou a resolução para situações que os colaboradores necessitem de apoio..." ──
export function evalApoioColaboradores(
  windowStart: string,
  windowEndInclusive: string,
  cardId: string,
  reportsLength: number,
  dias: DiaComImpedimento[],
  comentario: string | undefined,
) {
  if (reportsLength === 0) {
    return {
      verificacao: null,
      observacoes: `Não encontrei mensagens de relato diário no cartão "Daily" (#${cardId}) entre ${formatDateBr(windowStart)} e ${formatDateBr(windowEndInclusive)} — confirme manualmente (entrevista com o time).`,
    }
  }
  if (dias.length === 0) {
    return {
      verificacao: 'OK',
      observacoes: `Nenhum impedimento/necessidade de apoio foi reportado nas dailys deste Monitoramento (${formatDateBr(windowStart)} a ${formatDateBr(windowEndInclusive)}), pelas mensagens do cartão "Daily" (#${cardId}). ${comentario || ''}`,
    }
  }
  const semEncaminhamento = dias.filter((d) => d.teve_encaminhamento !== true)
  const detail = dias
    .map(
      (d) =>
        `- ${d.data}: "${d.trecho}" — ${d.teve_encaminhamento ? 'com encaminhamento' : 'SEM encaminhamento claro'}`,
    )
    .join('\n')
  return {
    verificacao: semEncaminhamento.length === 0 ? 'OK' : null,
    observacoes: `${dias.length} dia(s) com impedimento/apoio reportado nas dailys (${formatDateBr(windowStart)} a ${formatDateBr(windowEndInclusive)}):\n\n${detail}\n\n${comentario || ''}${semEncaminhamento.length ? ' Confirme com o time se os itens sem encaminhamento claro foram mesmo resolvidos.' : ''}`,
  }
}

export type AiGestaoMudancasResult = {
  documentado: boolean
  horas_atualizadas: number | null
  trecho?: string
  comentario?: string
}

// ── Regra: "Houve Gestão de Mudanças?..." ──
export function evalGestaoMudancas(
  gmFileName: string | null,
  totalSeconds: number,
  r: AiGestaoMudancasResult | null,
) {
  if (!gmFileName) {
    return {
      verificacao: 'OK',
      observacoes:
        'Nenhum arquivo "GM" encontrado na pasta da Sprint — não houve Gestão de Mudanças a documentar nesta Sprint.',
    }
  }
  if (!r || r.documentado !== true || r.horas_atualizadas == null) {
    return {
      verificacao: 'NOK',
      observacoes: `Arquivo "${gmFileName}" encontrado, mas não achei o item "4.3. Quantidade Estimada de Horas das Tarefas da Sprint Atualizada" preenchido claramente. ${r?.comentario || ''}`,
    }
  }
  const totalHoras = totalSeconds / 3600
  const gmHoras = Number(r.horas_atualizadas)
  const diff = Math.abs(gmHoras - totalHoras)
  const bateu = diff < 0.5
  return {
    verificacao: bateu ? 'OK' : 'NOK',
    observacoes: bateu
      ? `Item "4.3" da GM (${gmFileName}) diz ${gmHoras}h — bate com as horas totais estimadas dos cartões na Sprint agora no Bitrix (${totalHoras.toFixed(1)}h).`
      : `Item "4.3" da GM (${gmFileName}) diz ${gmHoras}h, mas as horas totais estimadas dos cartões na Sprint agora no Bitrix somam ${totalHoras.toFixed(1)}h — diferença de ${diff.toFixed(1)}h. "${r.trecho || ''}"`,
  }
}

/**
 * Qual pergunta do checklist casa com qual regra — mesmo prefixo normalizado
 * usado no original (RULES[].match). 10 regras não-IA (Fase 3) + 6 de IA
 * (Fase 4, esta entrega); as demais devolvem null (o front mostra "ainda não
 * implementado", igual a qualquer item sem regra).
 */
export const RULE_KEYS = [
  'backlog_analisado',
  'scrum_poker_parcial',
  'sprint_criada',
  'reuniao_explicacao_time',
  'sprint_iniciada',
  'daily_realizada',
  'dev_qa_horas_registradas',
  'tarefa_sem_hora_justificada',
  'indicadores_burndown',
  'gestao_risco',
  'cronograma_apresentado',
  'stakeholders_aprovaram',
  'ata_criada',
  'montou_sprint_conforme_ata',
  'apoio_colaboradores',
  'gestao_mudancas',
] as const
export type RuleKey = (typeof RULE_KEYS)[number]

const MATCHERS: Array<{ key: RuleKey; startsWith: string }> = [
  {
    key: 'backlog_analisado',
    startsWith: 'o tech lead analisou as demandas cadastradas em backlog',
  },
  {
    key: 'scrum_poker_parcial',
    startsWith:
      'o levantamento de esforcos tecnicos das equipes de desenvolvimento e qualidade foi feito com a tecnica',
  },
  {
    key: 'sprint_criada',
    startsWith: 'o tech lead criou uma nova sprint na ferramenta bitrix',
  },
  {
    key: 'reuniao_explicacao_time',
    startsWith:
      'houve a reuniao em que o tech lead explicou para a equipe de dev team',
  },
  {
    key: 'sprint_iniciada',
    startsWith:
      'o tech lead iniciou efetivamente a sprint na ferramenta bitrix',
  },
  {
    key: 'daily_realizada',
    startsWith: 'o tech lead esta realizando reunioes diarias',
  },
  {
    key: 'dev_qa_horas_registradas',
    startsWith:
      'os desenvolvedores e analistas de qualidade registraram os horarios',
  },
  {
    key: 'tarefa_sem_hora_justificada',
    startsWith: 'caso alguma tarefa nao possua tempo destinado',
  },
  {
    key: 'indicadores_burndown',
    startsWith: 'as medicoes dos indicadores estao sendo registradas',
  },
  {
    key: 'gestao_risco',
    startsWith: 'as avaliacoes da gestao de risco estao ocorrendo',
  },
  {
    key: 'cronograma_apresentado',
    startsWith: 'o tech lead apresentou a todos os stakeholders o cronograma',
  },
  {
    key: 'stakeholders_aprovaram',
    startsWith: 'os stakeholders aprovaram as demandas planejadas',
  },
  {
    key: 'ata_criada',
    startsWith: 'o tech lead criou uma ata de reuniao, detalhando as tarefas',
  },
  {
    key: 'montou_sprint_conforme_ata',
    startsWith:
      'o tech lead montou a sprint com as tarefas que foram elencadas',
  },
  {
    key: 'apoio_colaboradores',
    startsWith:
      'o tech lead providenciou a resolucao para situacoes que os colaboradores necessitem de apoio',
  },
  { key: 'gestao_mudancas', startsWith: 'houve gestao de mudancas' },
]

export function matchRule(questao: string): RuleKey | null {
  const n = normalize(questao)
  const found = MATCHERS.find((m) => n.startsWith(m.startsWith))
  return found ? found.key : null
}

/** Calcula a janela (dias ainda não avaliados) de um bloco de Monitoramento, a partir da data_auditoria dos blocos anteriores (M1 -> M2 -> M3), na ordem do nome do bloco. */
export function computeMonitoringWindow(
  sprintDateStart: string,
  blocks: Array<{ blockKey: string; dataAuditoria: string | null }>,
  currentBlockKey: string,
): MonitoringWindow {
  const monitoramentoBlocks = blocks
    .filter((b) => /^Monitoramento/i.test(b.blockKey.split('::')[0]))
    .sort((a, b) =>
      a.blockKey.localeCompare(b.blockKey, 'pt-BR', { numeric: true }),
    )

  const idx = monitoramentoBlocks.findIndex(
    (b) => b.blockKey === currentBlockKey,
  )
  const previous = idx > 0 ? monitoramentoBlocks[idx - 1] : null
  const current = monitoramentoBlocks[idx]

  return {
    windowStart: previous?.dataAuditoria || sprintDateStart,
    windowEndExclusive:
      current?.dataAuditoria || new Date().toISOString().slice(0, 10),
  }
}
