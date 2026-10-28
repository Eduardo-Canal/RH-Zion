import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import { getBitrixMpsWebhookUrl } from '../_shared/get-bitrix-mps-webhook-url.ts'
import * as XLSX from 'npm:xlsx@0.18.5'
import {
  matchRule,
  computeMonitoringWindow,
  evalBacklogAnalisado,
  evalScrumPokerParcial,
  evalSprintCriada,
  evalReuniaoExplicacaoTime,
  evalSprintIniciada,
  evalDailyRealizada,
  computeDevQaHourProblems,
  evalDevQaHorasRegistradas,
  evalTarefaSemHoraJustificada,
  computeBurndownDeviation,
  filterPlanoAcaoRows,
  evalIndicadoresBurndown,
  evalGestaoRisco,
  evalCronogramaApresentado,
  evalStakeholdersAprovaram,
  evalAtaCriada,
  evalMontouSprintConformeAta,
  evalApoioColaboradores,
  evalGestaoMudancas,
  normalize,
  addDays,
} from './mps-automation-core.ts'

// Automação via Bitrix do MPS (Fases 3 e 4) — porte funcional de
// ProjetoAuditMPS/src/services/auditAutomation.js + bitrix.js. Fase 3: as
// 10 regras 'api'/'partial' (Bitrix puro). Fase 4 (esta entrega): as 6
// regras que leem ATA (PDF)/Gestão de Mudanças (docx) — mandam o ARQUIVO
// direto pra OpenAI (gpt-4o-mini já lê PDF/docx nativamente, ver guia
// oficial da OpenAI, "file inputs") em vez de extrair texto no servidor com
// pdf-parse/mammoth — pdf-parse tem incompatibilidade DOCUMENTADA em
// Supabase Edge Functions/Deno (achado numa discussão oficial do Supabase),
// então nem tentamos. Decisão consciente do Everton (2026-07-13): o arquivo
// passa pela política de retenção padrão da API OpenAI (não usada pra
// treino, retida por pouco tempo por segurança) — mesmo padrão de exposição
// que o resto do projeto já usa em outras telas de IA.
//
// Usa _shared/bitrix-client.ts (mesmo cliente de todo o resto da Auditoria)
// em vez de reimplementar rate-limit/retry — o token bucket no banco já
// resolve o principal risco encontrado na investigação (~30-60 chamadas por
// bloco de Monitoramento, sem cache no original). Aqui, além disso,
// memoizamos por execução (mesmo request) o que o original SEMPRE refazia
// do zero: o cartão "Planejamento da Sprint" (usado por 2 regras) e
// computeDevQaHourProblems (usado por outras 2) — melhoria deliberada em
// cima do original, não uma fidelidade a menos.
//
// Usa um webhook EXCLUSIVO do MPS (settings.bitrix24_webhook_mps), separado
// do bitrix24_webhook_sprint que o sync de Não Conformidades usa — decisão
// do Everton (2026-07-13): o MPS eventualmente cria tarefa no Bitrix (Fase
// 5, Não Conformidade), e toda ação de um webhook aparece no Bitrix como
// feita pelo usuário dono dele. Deve ser gerado a partir de um usuário "de
// sistema" dedicado, não uma conta pessoal — ver get-bitrix-mps-webhook-url.ts.
// Escopo necessário: tasks, sonet_group, disk, im, user — não confirmado
// ainda que o webhook novo já tenha todos (ver BACKLOG.md). Se faltar
// escopo, o erro do Bitrix aparece como texto na Observação do item
// (avisar em vez de silenciar), não trava a automação dos outros itens.

const SETTINGS_KEY = 'mps_sprint_config'
const SPRINT_STATUS_LABELS: Record<string, string> = {
  active: 'ativa',
  planned: 'planejada',
  completed: 'concluída',
}

function formatDateBr(isoDate: string) {
  const d = isoDate ? new Date(isoDate) : null
  if (!d || Number.isNaN(d.getTime())) return '?'
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))
  const dd = String(isDateOnly ? d.getUTCDate() : d.getDate()).padStart(2, '0')
  const mm = String((isDateOnly ? d.getUTCMonth() : d.getMonth()) + 1).padStart(
    2,
    '0',
  )
  const yyyy = isDateOnly ? d.getUTCFullYear() : d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

async function getSprints(
  bitrix: ReturnType<typeof createBitrixClient>,
  groupId: string,
) {
  // callBitrixAllPagesByOffset, não callBitrixAllPages — tasks.api.scrum.sprint.list
  // não devolve next/total na resposta, então a paginação por `next` nunca
  // avança da 1ª página (mesmo achado do sync-sprint-bitrix, ver bitrix-client.ts).
  const result = await bitrix.callBitrixAllPagesByOffset(
    'tasks.api.scrum.sprint.list',
    { filter: { GROUP_ID: groupId }, order: { DATE_START: 'DESC' } },
  )
  return (result as any[]).map((s) => ({
    id: String(s.id),
    status: s.status,
    statusLabel: SPRINT_STATUS_LABELS[s.status] || s.status,
    dateStart: s.dateStart,
    dateEnd: s.dateEnd,
    label: /\d{2}\/\d{2}\/\d{4}/.test(s.name)
      ? s.name
      : `${s.name} (${formatDateBr(s.dateStart)} - ${formatDateBr(s.dateEnd)})`,
  }))
}

async function getBacklogId(
  bitrix: ReturnType<typeof createBitrixClient>,
  groupId: string,
) {
  const result: any = await bitrix.callBitrix('tasks.api.scrum.backlog.get', {
    id: groupId,
  })
  return result.id
}

async function getScrumTask(
  bitrix: ReturnType<typeof createBitrixClient>,
  taskId: string,
) {
  return bitrix.callBitrix('tasks.api.scrum.task.get', {
    id: taskId,
  }) as Promise<{ storyPoints?: number }>
}

async function listOpenTasks(
  bitrix: ReturnType<typeof createBitrixClient>,
  filter: Record<string, unknown>,
) {
  const result: any = await bitrix.callBitrix('tasks.task.list', {
    filter: { ...filter, '!STATUS': 5 },
    select: ['ID', 'TITLE', 'TIME_ESTIMATE', 'STAGE_ID'],
  })
  return ((result?.tasks || []) as any[]).map((t) => ({
    id: String(t.id),
    title: t.title,
    timeEstimate: Number(t.timeEstimate) || 0,
    stageId: String(t.stageId ?? ''),
  }))
}

async function listAllTasks(
  bitrix: ReturnType<typeof createBitrixClient>,
  filter: Record<string, unknown>,
) {
  const result: any = await bitrix.callBitrix('tasks.task.list', {
    filter,
    select: ['ID', 'TITLE', 'STATUS', 'TIME_ESTIMATE'],
  })
  return ((result?.tasks || []) as any[]).map((t) => ({
    id: String(t.id),
    title: t.title,
    timeEstimate: Number(t.timeEstimate) || 0,
    status: String(t.status ?? ''),
  }))
}

async function getTaskTimeLog(
  bitrix: ReturnType<typeof createBitrixClient>,
  taskId: string,
) {
  const result = await bitrix.callBitrixAllPages('task.elapseditem.getlist', {
    TASKID: taskId,
    ORDER: {},
    FILTER: {},
  })
  return (result as any[]).map((item) => ({
    date: String(item.CREATED_DATE || item.DATE_CREATE || '').slice(0, 10),
    seconds: Number(item.SECONDS) || (Number(item.MINUTES) || 0) * 60,
    userId: String(item.USER_ID || ''),
  }))
}

async function getSprintStages(
  bitrix: ReturnType<typeof createBitrixClient>,
  sprintId: string,
) {
  const result: any = await bitrix.callBitrix(
    'tasks.api.scrum.kanban.getStages',
    { sprintId },
  )
  return ((result || []) as any[]).map((s) => ({
    id: String(s.id),
    title: s.name || '',
    sort: Number(s.sort) || 0,
  }))
}

async function getUsers(
  bitrix: ReturnType<typeof createBitrixClient>,
  userIds: string[],
) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return []
  const result: any = await bitrix.callBitrix('user.get', {
    FILTER: { ID: ids },
  })
  return ((result || []) as any[]).map((u) => ({
    id: String(u.ID),
    name: `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim(),
    workPosition: u.WORK_POSITION || '',
  }))
}

async function getTaskComments(
  bitrix: ReturnType<typeof createBitrixClient>,
  taskId: string,
  sinceIso?: string,
) {
  const taskResult: any = await bitrix.callBitrix('tasks.task.get', {
    taskId,
    select: ['*'],
  })
  const chatId = taskResult?.task?.chatId
  if (!chatId) return []

  const dialogId = `chat${chatId}`
  const all: any[] = []
  let lastId: string | null = null
  for (let page = 0; page < 20; page++) {
    const params: Record<string, unknown> = { DIALOG_ID: dialogId, LIMIT: 50 }
    if (lastId) params.LAST_ID = lastId
    const result: any = await bitrix.callBitrix(
      'im.dialog.messages.get',
      params,
    )
    const messages = result?.messages || []
    if (messages.length === 0) break
    all.push(...messages)
    lastId = messages[messages.length - 1].id
    const oldestDate = messages[messages.length - 1].date
    if (sinceIso && oldestDate && String(oldestDate).slice(0, 10) < sinceIso)
      break
    if (messages.length < 50) break
  }
  return all
    .map((m) => ({
      date: String(m.date || '').slice(0, 10),
      text: m.text || '',
      author: `user #${m.author_id}`,
    }))
    .filter((c) => !/^\[USER=\d+\]/.test(c.text.trim()))
}

async function getGroupDiskRootId(
  bitrix: ReturnType<typeof createBitrixClient>,
  groupId: string,
) {
  const storages: any = await bitrix.callBitrix('disk.storage.getlist', {
    filter: { ENTITY_TYPE: 'group', ENTITY_ID: groupId },
  })
  const storage = (storages || [])[0]
  if (!storage)
    throw new Error(
      `Storage de Arquivos (Disco) não encontrado para o grupo ${groupId} no Bitrix.`,
    )
  return storage.ROOT_OBJECT_ID
}

async function findDiskChild(
  bitrix: ReturnType<typeof createBitrixClient>,
  folderId: string,
  predicate: (f: any) => boolean,
) {
  const children: any = await bitrix.callBitrix('disk.folder.getchildren', {
    id: folderId,
  })
  return (children || []).find(predicate)
}

async function downloadDiskFile(
  bitrix: ReturnType<typeof createBitrixClient>,
  fileId: string,
) {
  const file: any = await bitrix.callBitrix('disk.file.get', { id: fileId })
  const response = await fetch(file.DOWNLOAD_URL)
  if (!response.ok)
    throw new Error(
      `Falha ao baixar "${file.NAME}" do Bitrix (status ${response.status}).`,
    )
  return new Uint8Array(await response.arrayBuffer())
}

async function findSprintFolder(
  bitrix: ReturnType<typeof createBitrixClient>,
  rootId: string,
  sprintLabel: string,
) {
  const versionMatch = sprintLabel.match(/\d{4}\.\d{2}\.\d+\.\d+/)
  const token = versionMatch
    ? versionMatch[0]
    : sprintLabel.split(' (')[0].trim()
  const isSprintFolder = (f: any) =>
    f.TYPE === 'folder' && f.NAME.includes(token)

  const direct = await findDiskChild(bitrix, rootId, isSprintFolder)
  if (direct) return { folder: direct, token }

  const year = token.slice(0, 4)
  const yearFolder = await findDiskChild(
    bitrix,
    rootId,
    (f) => f.TYPE === 'folder' && f.NAME.trim() === year,
  )
  const nested = yearFolder
    ? await findDiskChild(bitrix, yearFolder.ID, isSprintFolder)
    : null
  return { folder: nested, token }
}

async function findAtaFile(
  bitrix: ReturnType<typeof createBitrixClient>,
  sprintFolderId: string,
) {
  return findDiskChild(
    bitrix,
    sprintFolderId,
    (f) => f.TYPE === 'file' && /ata/i.test(f.NAME) && /\.pdf$/i.test(f.NAME),
  )
}

/** Pode haver várias revisões (GM01, GM02, ...) na pasta — sempre lê a de maior número (fallback pra mais recente por data se não achar número). */
async function findGmFile(
  bitrix: ReturnType<typeof createBitrixClient>,
  sprintFolderId: string,
) {
  const children: any = await bitrix.callBitrix('disk.folder.getchildren', {
    id: sprintFolderId,
  })
  const gmFiles = ((children || []) as any[]).filter(
    (f) => f.TYPE === 'file' && /^GM/i.test(f.NAME) && /\.docx$/i.test(f.NAME),
  )
  if (gmFiles.length === 0) return null
  gmFiles.sort((a, b) => {
    const numA = Number((a.NAME.match(/(\d+)/) || [])[1]) || -1
    const numB = Number((b.NAME.match(/(\d+)/) || [])[1]) || -1
    if (numA !== numB) return numB - numA
    return new Date(b.UPDATE_TIME).getTime() - new Date(a.UPDATE_TIME).getTime()
  })
  return gmFiles[0]
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function parseAiJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/)
  const jsonText = match ? match[0] : text
  try {
    return JSON.parse(jsonText)
  } catch {
    throw new Error(
      `Resposta da IA não veio em JSON válido: ${text.slice(0, 200)}`,
    )
  }
}

async function getOpenAiApiKey(supabaseAdmin: any): Promise<string> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'openai_config')
    .maybeSingle()
  const apiKey = (data?.value as any)?.api_key || Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('Chave da OpenAI não configurada no sistema.')
  return apiKey
}

// Mesmo prompt-base do original (auditAutomation.js), só ajustado pro
// modelo ler o ARQUIVO anexo em vez de "o texto extraído do PDF" (já que
// não extraímos texto no servidor — ver comentário no topo do arquivo).
const AI_SYSTEM_PROMPT =
  'Você audita atas de reunião de planejamento de Sprint de um time de software. Leia o arquivo anexo (ata em PDF, ou relatório de Gestão de Mudanças em Word) com atenção e responda SEMPRE em JSON puro, sem markdown e sem texto fora do JSON.'

async function askOpenAiWithFile(
  apiKey: string,
  userPrompt: string,
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
) {
  const base64 = base64FromBytes(fileBytes)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: fileName,
                file_data: `data:${mimeType};base64,${base64}`,
              },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 600,
    }),
  })
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}))
    throw new Error(
      errData.error?.message || `Erro na API OpenAI (${response.status})`,
    )
  }
  const data = await response.json()
  return parseAiJson(data.choices?.[0]?.message?.content || '')
}

async function askOpenAiText(apiKey: string, userPrompt: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 600,
    }),
  })
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}))
    throw new Error(
      errData.error?.message || `Erro na API OpenAI (${response.status})`,
    )
  }
  const data = await response.json()
  return parseAiJson(data.choices?.[0]?.message?.content || '')
}

/** Lê "Plano de Ação Indicadores Projetos.xlsx" (aba "Plano de Ação") do grupo Repositório Zion. Header na linha 8 (1-indexed) — colunas C..I = origem/indicador/causa/responsavel/acao/dataAcao/status. */
async function getPlanoAcaoRows(
  bitrix: ReturnType<typeof createBitrixClient>,
  repositorioGroupId: string,
) {
  const rootId = await getGroupDiskRootId(bitrix, repositorioGroupId)
  const indicadoresFolder = await findDiskChild(
    bitrix,
    rootId,
    (f) => f.TYPE === 'folder' && /indicadores por projeto/i.test(f.NAME),
  )
  if (!indicadoresFolder)
    throw new Error(
      'Pasta "Indicadores por projetos" não encontrada no Repositório Zion.',
    )
  const wmsFolder = await findDiskChild(
    bitrix,
    indicadoresFolder.ID,
    (f) => f.TYPE === 'folder' && /wms/i.test(f.NAME),
  )
  if (!wmsFolder)
    throw new Error(
      'Pasta "Solução WMS" não encontrada em Indicadores por projetos.',
    )
  const file = await findDiskChild(
    bitrix,
    wmsFolder.ID,
    (f) =>
      f.TYPE === 'file' &&
      /plano de a[çc][ãa]o/i.test(f.NAME) &&
      /\.xlsx$/i.test(f.NAME),
  )
  if (!file)
    throw new Error(
      'Arquivo "Plano de Ação Indicadores Projetos.xlsx" não encontrado em Solução WMS.',
    )

  const bytes = await downloadDiskFile(bitrix, file.ID)
  const wb = XLSX.read(bytes, { type: 'array' })
  const ws = wb.Sheets['Plano de Ação']
  if (!ws) throw new Error('Aba "Plano de Ação" não encontrada no arquivo.')
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
  })

  const out = []
  for (let r = 7; r < rows.length; r++) {
    const row = rows[r] || []
    const origem = String(row[2] ?? '').trim()
    if (!origem) continue
    out.push({
      origem,
      indicador: String(row[3] ?? '').trim(),
      causa: String(row[4] ?? '').trim(),
      responsavel: String(row[5] ?? '').trim(),
      acao: String(row[6] ?? '').trim(),
      dataAcao: String(row[7] ?? '').trim(),
      status: String(row[8] ?? '').trim(),
    })
  }
  return out
}

/** Lê "Planilha de Riscos_Times Zion.xlsx" (aba "GR") do grupo Repositório Zion. Header na linha 1 — colunas B/C/I/K/L/M/N/Q/R/S/T. */
async function getRiskRegister(
  bitrix: ReturnType<typeof createBitrixClient>,
  repositorioGroupId: string,
) {
  const rootId = await getGroupDiskRootId(bitrix, repositorioGroupId)
  const folder = await findDiskChild(
    bitrix,
    rootId,
    (f) => f.TYPE === 'folder' && /gest[ãa]o de risco/i.test(f.NAME),
  )
  if (!folder)
    throw new Error(
      'Pasta "Gestão de Risco" não encontrada no Repositório Zion.',
    )
  const file = await findDiskChild(
    bitrix,
    folder.ID,
    (f) =>
      f.TYPE === 'file' &&
      /planilha de riscos/i.test(f.NAME) &&
      /\.xlsx$/i.test(f.NAME),
  )
  if (!file)
    throw new Error(
      'Planilha de Riscos não encontrada na pasta "Gestão de Risco".',
    )

  const bytes = await downloadDiskFile(bitrix, file.ID)
  const wb = XLSX.read(bytes, { type: 'array' })
  const ws = wb.Sheets['GR']
  if (!ws) throw new Error('Aba "GR" não encontrada na Planilha de Riscos.')
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
  })

  const out = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || []
    const timeImpactado = String(row[1] ?? '').trim()
    const descricao = String(row[2] ?? '').trim()
    if (!timeImpactado && !descricao) continue
    out.push({
      timeImpactado,
      descricao,
      status: String(row[8] ?? '').trim(),
      requerContingencia: String(row[10] ?? '').trim(),
      acaoContingencia: String(row[11] ?? '').trim(),
      responsavelContingencia: String(row[12] ?? '').trim(),
      dataContingencia: row[13] ?? null,
      requerMitigacao: String(row[16] ?? '').trim(),
      acaoMitigacao: String(row[17] ?? '').trim(),
      responsavelMitigacao: String(row[18] ?? '').trim(),
      dataMitigacao: row[19] ?? null,
    })
  }
  return { rows: out, updatedAt: file.UPDATE_TIME }
}

type Ctx = {
  bitrix: ReturnType<typeof createBitrixClient>
  supabaseAdmin: any
  groupId: string
  grupoNome: string
  sprint: any
  repositorioGroupId: string | null
  monitoringWindow: { windowStart: string; windowEndExclusive: string }
  memo: Record<string, Promise<any>>
}

function memoized<T>(
  ctx: Ctx,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  if (!ctx.memo[key]) ctx.memo[key] = factory()
  return ctx.memo[key]
}

/** Só busca a chave da OpenAI quando alguma regra de IA de fato roda — blocos só com regras Bitrix-puro nunca pagam essa leitura extra. */
async function getOpenAiKey(ctx: Ctx): Promise<string> {
  return memoized(ctx, 'openaiApiKey', () => getOpenAiApiKey(ctx.supabaseAdmin))
}

/** Memoizado por execução — as 4 regras que leem a ATA (cronograma, aprovação, ata criada, montou sprint) reaproveitam a mesma pasta/arquivo/bytes, um único download por "Buscar automação do bloco". */
async function getSprintFolderId(ctx: Ctx): Promise<string> {
  return memoized(ctx, 'sprintFolderId', async () => {
    const rootId = await getGroupDiskRootId(ctx.bitrix, ctx.groupId)
    const { folder, token } = await findSprintFolder(
      ctx.bitrix,
      rootId,
      ctx.sprint.label,
    )
    if (!folder)
      throw new Error(
        `Pasta da Sprint "${token}" não encontrada em Arquivos no Bitrix.`,
      )
    return folder.ID
  })
}

async function getAtaFile(
  ctx: Ctx,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  return memoized(ctx, 'ataFile', async () => {
    const folderId = await getSprintFolderId(ctx)
    const file = await findAtaFile(ctx.bitrix, folderId)
    if (!file)
      throw new Error(
        'ATA não encontrada na pasta da Sprint em Arquivos no Bitrix.',
      )
    const bytes = await downloadDiskFile(ctx.bitrix, file.ID)
    return { bytes, fileName: file.NAME }
  })
}

async function getGmFile(
  ctx: Ctx,
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  return memoized(ctx, 'gmFile', async () => {
    const folderId = await getSprintFolderId(ctx)
    const file = await findGmFile(ctx.bitrix, folderId)
    if (!file) return null
    const bytes = await downloadDiskFile(ctx.bitrix, file.ID)
    return { bytes, fileName: file.NAME }
  })
}

async function getPlanejamentoCard(ctx: Ctx) {
  return memoized(ctx, 'planejamentoCard', async () => {
    const tasks = await listOpenTasks(ctx.bitrix, {
      SPRINT_ID: ctx.sprint.id,
      '%TITLE': 'Planejamento da Sprint',
    })
    return tasks[0]
  })
}

async function getDevQaHourProblems(ctx: Ctx) {
  return memoized(ctx, 'devQaHourProblems', async () => {
    const tasks = await listOpenTasks(ctx.bitrix, { SPRINT_ID: ctx.sprint.id })
    if (tasks.length === 0) return { tasks, problems: [], rolesNote: '' }
    const stages = await getSprintStages(ctx.bitrix, ctx.sprint.id)
    const logsByTask = await Promise.all(
      tasks.map((t) => getTaskTimeLog(ctx.bitrix, t.id)),
    )
    const allUserIds = [...new Set(logsByTask.flat().map((e) => e.userId))]
    const users = await getUsers(ctx.bitrix, allUserIds)
    const { problems, rolesNote } = computeDevQaHourProblems(
      tasks,
      stages,
      logsByTask,
      users,
    )
    return { tasks, problems, rolesNote }
  })
}

async function runRule(key: string, questao: string, ctx: Ctx) {
  switch (key) {
    case 'backlog_analisado': {
      const backlogId = await getBacklogId(ctx.bitrix, ctx.groupId)
      const tasks = await listOpenTasks(ctx.bitrix, { BACKLOG_ID: backlogId })
      const scrumFields = await Promise.all(
        tasks.map((t) => getScrumTask(ctx.bitrix, t.id)),
      )
      return evalBacklogAnalisado(tasks, scrumFields)
    }
    case 'scrum_poker_parcial':
      return evalScrumPokerParcial(await getPlanejamentoCard(ctx))
    case 'sprint_criada':
      return evalSprintCriada(ctx.sprint)
    case 'reuniao_explicacao_time':
      return evalReuniaoExplicacaoTime(await getPlanejamentoCard(ctx))
    case 'sprint_iniciada':
      return evalSprintIniciada(ctx.sprint)
    case 'daily_realizada': {
      const tasks = await listAllTasks(ctx.bitrix, {
        SPRINT_ID: ctx.sprint.id,
        '%TITLE': 'Daily',
      })
      const card = tasks[0]
      if (!card)
        return evalDailyRealizada(
          undefined,
          ctx.sprint,
          [],
          [],
          ctx.monitoringWindow,
        )
      const log = await getTaskTimeLog(ctx.bitrix, card.id)
      const comments = await getTaskComments(
        ctx.bitrix,
        card.id,
        ctx.monitoringWindow.windowStart,
      )
      return evalDailyRealizada(
        card,
        ctx.sprint,
        log,
        comments,
        ctx.monitoringWindow,
      )
    }
    case 'dev_qa_horas_registradas': {
      const { tasks, problems, rolesNote } = await getDevQaHourProblems(ctx)
      return evalDevQaHorasRegistradas(tasks.length, problems, rolesNote)
    }
    case 'tarefa_sem_hora_justificada': {
      const { tasks, problems } = await getDevQaHourProblems(ctx)
      const justificativas = await Promise.all(
        problems.map(async (p) => {
          const [comments, taskData] = await Promise.all([
            getTaskComments(ctx.bitrix, p.task.id),
            ctx.bitrix.callBitrix('tasks.task.get', {
              taskId: p.task.id,
              select: ['DESCRIPTION'],
            }) as Promise<any>,
          ])
          const human = comments.filter((c) => c.text.trim())
          const description = String(taskData?.task?.description || '').trim()
          if (human[0])
            return { text: human[0].text, source: 'bate-papo' as const }
          if (description)
            return { text: description, source: 'descrição da tarefa' as const }
          return null
        }),
      )
      return evalTarefaSemHoraJustificada(
        tasks.length,
        problems,
        justificativas,
      )
    }
    case 'indicadores_burndown': {
      const tasks = await listAllTasks(ctx.bitrix, { SPRINT_ID: ctx.sprint.id })
      const scrumFields = await Promise.all(
        tasks.map((t) => getScrumTask(ctx.bitrix, t.id)),
      )
      const burndown = computeBurndownDeviation(tasks, scrumFields, ctx.sprint)
      if (burndown.deviationPct <= 10 || !ctx.repositorioGroupId) {
        return evalIndicadoresBurndown(
          burndown,
          ctx.repositorioGroupId,
          null,
          null,
        )
      }
      try {
        const rows = await getPlanoAcaoRows(ctx.bitrix, ctx.repositorioGroupId)
        const plano = filterPlanoAcaoRows(rows, ctx.sprint.label)
        return evalIndicadoresBurndown(
          burndown,
          ctx.repositorioGroupId,
          plano,
          null,
        )
      } catch (err: any) {
        return evalIndicadoresBurndown(
          burndown,
          ctx.repositorioGroupId,
          null,
          err.message,
        )
      }
    }
    case 'gestao_risco': {
      if (!ctx.repositorioGroupId)
        return evalGestaoRisco(null, null, null, ctx.grupoNome)
      try {
        const riskRegister = await getRiskRegister(
          ctx.bitrix,
          ctx.repositorioGroupId,
        )
        return evalGestaoRisco(
          ctx.repositorioGroupId,
          riskRegister,
          null,
          ctx.grupoNome,
        )
      } catch (err: any) {
        return evalGestaoRisco(
          ctx.repositorioGroupId,
          null,
          err.message,
          ctx.grupoNome,
        )
      }
    }

    // ── Fase 4 (IA) — mandam o arquivo (ATA/GM) direto pra OpenAI. As 4
    // regras da ATA reaproveitam o mesmo download (getAtaFile memoizado).
    case 'cronograma_apresentado': {
      const { bytes, fileName } = await getAtaFile(ctx)
      const prompt = `Arquivo da ATA (${fileName}) em anexo.\n\nA seção "1.5. Período Sprint" está preenchida corretamente com o período da Sprint atual (formato dd/mm/aaaa - dd/mm/aaaa)? Responda em JSON: {"preenchido": true|false, "trecho": "valor encontrado ou vazio", "comentario": "breve"}.`
      const r = await askOpenAiWithFile(
        await getOpenAiKey(ctx),
        prompt,
        bytes,
        fileName,
        'application/pdf',
      )
      return evalCronogramaApresentado(r)
    }
    case 'stakeholders_aprovaram': {
      const { bytes, fileName } = await getAtaFile(ctx)
      const prompt = `Arquivo da ATA (${fileName}) em anexo.\n\nNa seção "8. APROVAÇÃO DO CONTEÚDO DA SPRINT" (geralmente um checkbox "Todos estão de acordo" / "Não estão de acordo"), a aprovação está marcada como positiva? Responda em JSON: {"aprovado": true|false|null, "trecho": "o que foi encontrado", "comentario": "breve"} (use null se não encontrar a seção).`
      const r = await askOpenAiWithFile(
        await getOpenAiKey(ctx),
        prompt,
        bytes,
        fileName,
        'application/pdf',
      )
      return evalStakeholdersAprovaram(r)
    }
    case 'ata_criada': {
      const { bytes, fileName } = await getAtaFile(ctx)
      const prompt = `Arquivo da ATA (${fileName}) em anexo.\n\nNas seções "3. RESUMO DOS PONTOS DISCUTIDOS" (lista de tarefas, formato "<código> - <descrição> - N PONTOS / N HORAS") e "5. HORAS ESTIMADAS DA SPRINT" (totais), toda tarefa listada tem pontos e horas definidos, e os totais da seção 5 estão preenchidos? IMPORTANTE: "0 PONTOS" é um valor válido e esperado para tarefas administrativas/fixas (ex: Daily, Planejamento da Sprint, Reuniões Gerais, Alinhamento Stakeholders) — isso NÃO conta como faltando estimativa. Só conte como faltando se o campo de pontos ou horas estiver de fato ausente/em branco (sem número nenhum), não quando o valor for explicitamente 0. Responda em JSON: {"completo": true|false, "tarefas_sem_estimativa": ["..."], "comentario": "breve"}.`
      const r = await askOpenAiWithFile(
        await getOpenAiKey(ctx),
        prompt,
        bytes,
        fileName,
        'application/pdf',
      )
      return evalAtaCriada(r)
    }
    case 'montou_sprint_conforme_ata': {
      const tasks = await listOpenTasks(ctx.bitrix, {
        SPRINT_ID: ctx.sprint.id,
      })
      const totalSeconds = tasks.reduce(
        (sum, t) => sum + (t.timeEstimate || 0),
        0,
      )
      const { bytes, fileName } = await getAtaFile(ctx)
      const prompt = `Arquivo da ATA (${fileName}) em anexo.\n\nQual o valor de "Horas Totais Estimadas de Tarefas" (seção "5. HORAS ESTIMADAS DA SPRINT", item 5.5)? Responda em JSON: {"horas_totais_ata": number|null, "trecho": "..."}.`
      const r = await askOpenAiWithFile(
        await getOpenAiKey(ctx),
        prompt,
        bytes,
        fileName,
        'application/pdf',
      )
      return evalMontouSprintConformeAta(totalSeconds, tasks.length, r)
    }
    case 'apoio_colaboradores': {
      const tasks = await listAllTasks(ctx.bitrix, {
        SPRINT_ID: ctx.sprint.id,
        '%TITLE': 'Daily',
      })
      const card = tasks[0]
      if (!card)
        return {
          verificacao: 'NOK',
          observacoes: 'Cartão "Daily" não encontrado na Sprint atual.',
        }
      const windowEndInclusive = addDays(
        ctx.monitoringWindow.windowEndExclusive,
        -1,
      )
      const comments = await getTaskComments(
        ctx.bitrix,
        card.id,
        ctx.monitoringWindow.windowStart,
      )
      // Relato diário sempre começa com "dd/mm" na própria linha — filtra fora
      // as notificações automáticas do Bitrix (ex.: "adicionou uma entrada de tempo").
      const reports = comments.filter(
        (c) =>
          c.date >= ctx.monitoringWindow.windowStart &&
          c.date <= windowEndInclusive &&
          /^\d{2}\/\d{2}\b/.test(c.text.trim()),
      )
      if (reports.length === 0) {
        return evalApoioColaboradores(
          ctx.monitoringWindow.windowStart,
          windowEndInclusive,
          card.id,
          0,
          [],
          undefined,
        )
      }
      const textoRelatos = reports.map((r) => r.text).join('\n---\n')
      const prompt = `Mensagens de relato diário do cartão "Daily" de uma Sprint (uma por dia, separadas por "---"):\n\n${textoRelatos}\n\nCada mensagem começa com a data (dd/mm) e diz se houve algum impedimento/necessidade de apoio (técnico ou de regra de negócio) reportado pelo time, e às vezes se já foi resolvido ou está sendo tratado. Pra cada dia que reportou algum impedimento/apoio necessário, esse impedimento parece ter recebido alguma resolução/encaminhamento (mesmo que "sendo verificado" ou "resolvido antes da daily")? Responda em JSON: {"dias_com_impedimento": [{"data": "dd/mm", "trecho": "...", "teve_encaminhamento": true|false}], "comentario": "breve"}.`
      const r = await askOpenAiText(await getOpenAiKey(ctx), prompt)
      return evalApoioColaboradores(
        ctx.monitoringWindow.windowStart,
        windowEndInclusive,
        card.id,
        reports.length,
        r.dias_com_impedimento || [],
        r.comentario,
      )
    }
    case 'gestao_mudancas': {
      const tasks = await listAllTasks(ctx.bitrix, { SPRINT_ID: ctx.sprint.id })
      const totalSeconds = tasks.reduce(
        (sum, t) => sum + (t.timeEstimate || 0),
        0,
      )
      const gmFile = await getGmFile(ctx)
      if (!gmFile) return evalGestaoMudancas(null, totalSeconds, null)
      const prompt = `Arquivo de Gestão de Mudanças (${gmFile.fileName}) em anexo.\n\nQual o valor do item "4.3. Quantidade Estimada de Horas das Tarefas da Sprint Atualizada"? Responda em JSON: {"documentado": true|false, "horas_atualizadas": number|null, "trecho": "trecho relevante encontrado", "comentario": "breve"} (use "documentado": false se o documento não tiver esse item preenchido claramente).`
      const r = await askOpenAiWithFile(
        await getOpenAiKey(ctx),
        prompt,
        gmFile.bytes,
        gmFile.fileName,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      return evalGestaoMudancas(gmFile.fileName, totalSeconds, r)
    }
    default:
      return { implemented: false }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader)
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const {
      data: { user: userData },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !userData)
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: corsHeaders,
      })

    const payload = await req.json().catch(() => ({}))
    const { mode, auditId, blockKey, questionKey, groupId } = payload

    const bitrixWebhookUrl = await getBitrixMpsWebhookUrl(supabaseAdmin)
    const bitrix = createBitrixClient(
      supabaseUrl,
      serviceRoleKey,
      bitrixWebhookUrl,
    )

    // Mode "sprints": lista sprints do Bitrix pra um grupo — usado pelo seletor
    // da tela "Nova Auditoria" (sugestão em vez de digitar o nome à mão).
    if (mode === 'sprints') {
      if (!groupId)
        return new Response(JSON.stringify({ error: 'groupId obrigatório.' }), {
          status: 400,
          headers: corsHeaders,
        })
      const sprints = await getSprints(bitrix, String(groupId))
      return new Response(JSON.stringify({ sprints }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!auditId || !blockKey) {
      return new Response(
        JSON.stringify({ error: 'auditId e blockKey obrigatórios.' }),
        { status: 400, headers: corsHeaders },
      )
    }

    const { data: audit, error: auditErr } = await supabaseAdmin
      .from('mps_audits')
      .select('*')
      .eq('id', auditId)
      .single()
    if (auditErr || !audit)
      return new Response(
        JSON.stringify({ error: 'Auditoria não encontrada.' }),
        { status: 404, headers: corsHeaders },
      )

    const { data: blocos, error: blocosErr } = await supabaseAdmin
      .from('mps_audit_blocos')
      .select('block_key, data_auditoria')
      .eq('audit_id', auditId)
    if (blocosErr) throw blocosErr

    const { data: settingsRow } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle()
    const settings = settingsRow?.value || {}

    // Grupo vem direto do Bitrix (sprint_groups, sincronizado pela aba Sprint
    // via sonet_group.get) — mesma fonte que a tela Nova Auditoria usa desde
    // 2026-07-16, não mais o cadastro manual settings.mps_sprint_config.grupos.
    const { data: grupoRow, error: grupoErr } = await supabaseAdmin
      .from('sprint_groups')
      .select('id, name')
      .eq('name', audit.grupo)
      .maybeSingle()
    if (grupoErr) throw grupoErr
    if (!grupoRow) {
      return new Response(
        JSON.stringify({
          error: `Grupo "${audit.grupo}" não encontrado no Bitrix — sincronize a aba Sprint pra atualizar a lista de grupos.`,
        }),
        { status: 400, headers: corsHeaders },
      )
    }
    const grupo = { name: grupoRow.name, bitrix_group_id: grupoRow.id }

    const sprints = await getSprints(bitrix, grupo.bitrix_group_id)
    const sprint = sprints.find((s) => s.label === audit.projeto_sprint)
    if (!sprint) {
      return new Response(
        JSON.stringify({
          error: `Não encontrei a Sprint "${audit.projeto_sprint}" no Bitrix (grupo ${grupo.name}). Confira se o nome bate exatamente com o do Bitrix.`,
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    const ctx: Ctx = {
      bitrix,
      supabaseAdmin,
      groupId: grupo.bitrix_group_id,
      grupoNome: grupo.name,
      sprint,
      repositorioGroupId: settings.repositorio_zion_group_id || null,
      monitoringWindow: computeMonitoringWindow(
        sprint.dateStart,
        (blocos || []).map((b: any) => ({
          blockKey: b.block_key,
          dataAuditoria: b.data_auditoria,
        })),
        blockKey,
      ),
      memo: {},
    }

    const blockDef = (audit.estrutura || []).find(
      (b: any) => b.key === blockKey,
    )
    if (!blockDef)
      return new Response(
        JSON.stringify({
          error: 'Bloco não encontrado na estrutura da auditoria.',
        }),
        { status: 404, headers: corsHeaders },
      )

    const questoes = questionKey
      ? blockDef.itens.filter((it: any) => it.key === questionKey)
      : blockDef.itens

    const results: Record<string, any> = {}
    for (const item of questoes) {
      const ruleKey = matchRule(item.questao)
      if (!ruleKey) {
        results[item.key] = { implemented: false }
        continue
      }
      try {
        const r = await runRule(ruleKey, item.questao, ctx)
        results[item.key] = { implemented: true, ...r }
      } catch (err: any) {
        // Mesma regra do original: erro vira NOK explicado, não crash — a
        // pessoa vê exatamente por que não deu pra verificar (ex.: falta
        // escopo `disk`/`im` no webhook, pasta da Sprint não existe, etc.).
        results[item.key] = {
          implemented: true,
          verificacao: null,
          observacoes: `Não foi possível verificar automaticamente: ${err.message}`,
        }
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
