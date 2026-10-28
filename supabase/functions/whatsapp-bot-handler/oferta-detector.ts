// Fase B (correção de dessincronia): a IA gera texto livre e, guiada pelo
// prompt_base, pode oferecer agendamento por conta própria — desacoplado da
// heurística demonstraInteresse (que olha a mensagem do LEAD, não a resposta
// da IA). Este módulo detecta essa oferta na resposta da IA e robustece a
// detecção de aceite do lead (evitando falsos positivos de `includes` cru em
// tokens curtos e negações como "não pode").

// ─── Detectar oferta de agendamento na resposta da IA ──────────────────────────

const PADROES_OFERTA_AGENDAMENTO: RegExp[] = [
  /\bagendar\b/i,
  /\bagende\b/i,
  /\bagendamento\b/i,
  /marcar\s+(um|uma)?\s*(conversa|reuni[ãa]o|bate-?papo|hor[áa]rio)/i,
  /conversar\s+com\s+(um|uma|nosso|nossa|nossos)\s+especialista/i,
  /falar\s+com\s+(um|uma|nosso|nossa|nossos)\s+especialista/i,
  /bate-?papo\s+com\s+(nosso|nossos|nossa|um)\s+(time|especialista|equipe)/i,
  /informe\s+(suas|as)\s+(op[çc][õo]es\s+de\s+)?(datas?|hor[áa]rios?)/i,
]

export function ofereceuAgendamento(respostaIA: string): boolean {
  return PADROES_OFERTA_AGENDAMENTO.some((re) => re.test(respostaIA))
}

// ─── Detectar aceite do lead (robusto a negação e a falsos positivos) ──────────

// Tokens curtos: usar \b (palavra inteira) — includes('sim') pegaria "assim",
// "simples", "simulação"; includes('pode') pegaria "podem", "poderia".
const TOKENS_ACEITE_CURTOS = [
  'sim',
  's',
  'ok',
  'pode',
  'claro',
  'quero',
  'vamos',
  'combinado',
  'perfeito',
]

// Frases: includes normal é seguro (baixo risco de substring indesejada).
const FRASES_ACEITE = ['claro que sim', 'vamos sim']

function temNegacaoImediatamenteAntes(texto: string, token: string): boolean {
  return new RegExp(`n[ãa]o\\s+${token}\\b`, 'i').test(texto)
}

export function aceitouOferta(texto: string): boolean {
  const t = texto.toLowerCase().trim()
  if (FRASES_ACEITE.some((f) => t.includes(f))) return true
  return TOKENS_ACEITE_CURTOS.some((tok) => {
    const re = new RegExp(`\\b${tok}\\b`, 'i')
    return re.test(t) && !temNegacaoImediatamenteAntes(t, tok)
  })
}

// ─── Detectar PEDIDO direto do lead para agendar (determinístico) ──────────────
// Correção estrutural: não depende da fraseologia da IA nem de heurísticas de
// "interesse" — o lead pode pedir para agendar a qualquer momento em
// CONVERSANDO, e o link sai direto, sem a IA tentar conduzir o agendamento.

// Prefixo de negação reaproveitado do padrão usado em aceitouOferta: bloqueia
// o match se "não"/"nao" aparecer imediatamente antes da primeira palavra do
// padrão (ex.: "não quero agendar" não deve contar como pedido).
const SEM_NEGACAO_ANTES = '(?<!n[ãa]o\\s)'

const PADROES_PEDIDO_AGENDAMENTO: RegExp[] = [
  new RegExp(`${SEM_NEGACAO_ANTES}vamos\\s+agendar`, 'i'),
  new RegExp(`${SEM_NEGACAO_ANTES}quero\\s+agendar`, 'i'),
  new RegExp(`${SEM_NEGACAO_ANTES}pode(mos)?\\s+agendar`, 'i'),
  new RegExp(`${SEM_NEGACAO_ANTES}como\\s+(agendo|agendar)`, 'i'),
  new RegExp(`${SEM_NEGACAO_ANTES}(quero|vamos|pode(mos)?)\\s+marcar`, 'i'),
  new RegExp(
    `${SEM_NEGACAO_ANTES}agenda(r)?\\s+(uma|a|essa|esta)?\\s*(conversa|reuni[ãa]o|call|visita|apresenta[çc][ãa]o|demonstra[çc][ãa]o|demo)`,
    'i',
  ),
  new RegExp(
    `${SEM_NEGACAO_ANTES}(manda|envia)(r)?\\s+(o\\s+)?link\\s+da\\s+agenda`,
    'i',
  ),
]

export function pediuAgendamento(textoLead: string): boolean {
  return PADROES_PEDIDO_AGENDAMENTO.some((re) => re.test(textoLead))
}
