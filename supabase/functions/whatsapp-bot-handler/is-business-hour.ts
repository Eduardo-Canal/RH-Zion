// Horários da config são interpretados em America/Sao_Paulo (hora do Brasil).

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function isBusinessHour(
  horarioInicio: string,
  horarioFim: string,
  diasSemana: number[],
  now: Date = new Date(),
): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const diaSemana = WEEKDAY_MAP[get('weekday')]
  const horaAtual = Number(get('hour'))
  const minutoAtual = Number(get('minute'))

  if (!diasSemana.includes(diaSemana)) return false

  const [hIni, mIni] = horarioInicio.split(':').map(Number)
  const [hFim, mFim] = horarioFim.split(':').map(Number)
  const minAtual = horaAtual * 60 + minutoAtual
  return minAtual >= hIni * 60 + mIni && minAtual < hFim * 60 + mFim
}
