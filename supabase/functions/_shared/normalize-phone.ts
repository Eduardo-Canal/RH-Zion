// Normalização e validação de telefone celular brasileiro.
// Exportado aqui para ser testável via vitest (arquivo sem dependências Deno).

export const VALID_BR_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35,
  37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88,
  89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
])

export type PhoneResult =
  | { valid: true; number: string }
  | { valid: false; reason: string }

export function normalizeBRPhone(raw: string): PhoneResult {
  const digits = raw.replace(/\D/g, '')
  let n: string
  if (digits.startsWith('55')) {
    n = digits
  } else if (digits.length === 10 || digits.length === 11) {
    n = '55' + digits
  } else {
    return {
      valid: false,
      reason: `comprimento inesperado: ${digits.length} dígitos`,
    }
  }
  if (n.length !== 13) {
    return {
      valid: false,
      reason: `${n.length} dígitos após normalizar (esperado 13)`,
    }
  }
  const ddd = parseInt(n.slice(2, 4), 10)
  if (!VALID_BR_DDDS.has(ddd)) {
    return { valid: false, reason: `DDD ${ddd} não existe no Brasil` }
  }
  if (n[4] !== '9') {
    return {
      valid: false,
      reason: `dígito na posição 4 = '${n[4]}' (esperado '9' para celular)`,
    }
  }
  return { valid: true, number: n }
}
