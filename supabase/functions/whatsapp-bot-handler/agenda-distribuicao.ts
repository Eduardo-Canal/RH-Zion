// Projeto Agenda, Fase B: seleção balanceada do executivo para distribuição de
// agenda. Critério: menor nº de envios na semana corrente (segunda 00:00
// America/Sao_Paulo até agora); empate = mais tempo sem receber (sem histórico
// = prioridade máxima). Elegível = participa_agenda=true AND ativo=true AND
// link_agenda preenchido.

export interface ExecutivoElegivel {
  profile_id: string
  nome: string
  link_agenda: string
}

export interface ExecutivoEscolhido {
  profile_id: string
  nome: string
  link_agenda: string
}

// Início da semana corrente (segunda 00:00) em America/Sao_Paulo, como instante UTC.
// Brasil não tem horário de verão desde 2019: America/Sao_Paulo = UTC-3 o ano todo.
export function inicioSemanaAtualUTC(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const WEEKDAY_MAP: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const diaSemana = WEEKDAY_MAP[get('weekday')]
  const ano = Number(get('year'))
  const mes = Number(get('month'))
  const dia = Number(get('day'))

  const diasDesdeSegunda = (diaSemana + 6) % 7
  // Data local (SP) tratada como UTC só para aritmética de dias (sem hora envolvida).
  const dataCorrenteUTC = Date.UTC(ano, mes - 1, dia)
  const segunda = new Date(
    dataCorrenteUTC - diasDesdeSegunda * 24 * 60 * 60 * 1000,
  )

  // 00:00 em São Paulo = 03:00 UTC (UTC-3 fixo) no mesmo dia calendário.
  return new Date(
    Date.UTC(
      segunda.getUTCFullYear(),
      segunda.getUTCMonth(),
      segunda.getUTCDate(),
      3,
      0,
      0,
    ),
  )
}

// Função pura: escolhe o executivo de menor carga dado os dados já buscados.
export function selecionarMenorCarga(
  elegiveis: ExecutivoElegivel[],
  contagemSemana: Record<string, number>,
  ultimoEnvio: Record<string, string | null>,
): ExecutivoEscolhido | null {
  if (elegiveis.length === 0) return null

  let escolhido = elegiveis[0]
  let melhorContagem = contagemSemana[escolhido.profile_id] ?? 0
  let melhorUltimo = ultimoEnvio[escolhido.profile_id] ?? null

  for (const cand of elegiveis.slice(1)) {
    const contagem = contagemSemana[cand.profile_id] ?? 0
    const ultimo = ultimoEnvio[cand.profile_id] ?? null

    if (contagem < melhorContagem) {
      escolhido = cand
      melhorContagem = contagem
      melhorUltimo = ultimo
      continue
    }
    if (contagem > melhorContagem) continue

    // Empate na contagem: sem histórico (null) tem prioridade máxima sobre
    // quem já recebeu algum dia; entre dois com histórico, vence quem
    // recebeu há mais tempo (menor enviado_em).
    if (melhorUltimo === null) continue
    if (ultimo === null || ultimo < melhorUltimo) {
      escolhido = cand
      melhorContagem = contagem
      melhorUltimo = ultimo
    }
  }

  return {
    profile_id: escolhido.profile_id,
    nome: escolhido.nome,
    link_agenda: escolhido.link_agenda,
  }
}

// Orquestrador: busca elegíveis + histórico no banco e aplica a seleção pura.
export async function escolherExecutivoAgenda(
  supabase: any,
  now: Date = new Date(),
): Promise<ExecutivoEscolhido | null> {
  const { data: elegiveisRaw } = await supabase
    .from('profiles')
    .select('id, nome, link_agenda')
    .eq('participa_agenda', true)
    .eq('ativo', true)
    .not('link_agenda', 'is', null)
    .neq('link_agenda', '')

  const elegiveis: ExecutivoElegivel[] = (elegiveisRaw ?? []).map((p: any) => ({
    profile_id: p.id,
    nome: p.nome,
    link_agenda: p.link_agenda,
  }))
  if (elegiveis.length === 0) return null

  const ids = elegiveis.map((e) => e.profile_id)
  const inicioSemana = inicioSemanaAtualUTC(now)

  const [{ data: envioSemana }, { data: historico }] = await Promise.all([
    supabase
      .from('agenda_disponibilizacoes')
      .select('profile_id')
      .in('profile_id', ids)
      .gte('enviado_em', inicioSemana.toISOString()),
    supabase
      .from('agenda_disponibilizacoes')
      .select('profile_id, enviado_em')
      .in('profile_id', ids),
  ])

  const contagemSemana: Record<string, number> = {}
  for (const row of envioSemana ?? []) {
    contagemSemana[row.profile_id] = (contagemSemana[row.profile_id] ?? 0) + 1
  }

  const ultimoEnvio: Record<string, string | null> = {}
  for (const row of historico ?? []) {
    const atual = ultimoEnvio[row.profile_id]
    if (!atual || row.enviado_em > atual)
      ultimoEnvio[row.profile_id] = row.enviado_em
  }
  for (const id of ids) if (!(id in ultimoEnvio)) ultimoEnvio[id] = null

  return selecionarMenorCarga(elegiveis, contagemSemana, ultimoEnvio)
}
