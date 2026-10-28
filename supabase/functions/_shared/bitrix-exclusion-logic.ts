// Lógica pura de canonicalização de telefone para exclusão do fluxo Bitrix
// (N-20) — sem dependências Deno, testável via vitest. A parte com I/O
// (consulta a whatsapp_bitrix_excluded_phones) fica em bitrix-exclusion.ts,
// que importa este arquivo.
//
// phoneKey() é a ÚNICA fonte de canonicalização usada tanto na gravação
// (seed manual em produção, ver migration 20260726100000) quanto na consulta
// (os 4 guards). Se as duas pontas canonicalizarem de formas diferentes, a
// comparação nunca bate — e isso é uma falha SILENCIOSA: não há erro, não há
// log, só o vazamento de uma conversa que deveria estar bloqueada seguindo
// normalmente pro Bitrix. Por isso: nunca comparar telefone bruto, sempre
// via phoneKey() daqui.
//
// Regra (validada em 2026-07-26 contra os 396 registros reais de
// whatsapp_conversations — ver docs/oci-inventarios/valida-phonekey-20260726.sql,
// 0 não-normalizáveis, 100% das chaves com 10 dígitos): chave = DDD (2 dígitos) + últimos 8
// dígitos do número, descartando o DDI 55 (quando presente) e o 9º dígito de
// celular (quando presente). A extração do DDI é dirigida por TAMANHO total
// da string, nunca por prefixo — stripar "55" só porque a string começa com
// "55" apagaria o DDD 55 real (Santa Maria/RS) em números de 11 dígitos.
//
//   13 dígitos, começa com 55 → DDD = posições 3-4, chave = DDD + últimos 8
//   12 dígitos, começa com 55 → DDD = posições 3-4, chave = DDD + últimos 8
//   11 dígitos                → DDD = posições 1-2, chave = DDD + últimos 8
//   10 dígitos                → a própria string já é a chave
//   qualquer outro caso       → não normalizável (retorna null)

export function phoneKey(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  const len = digits.length

  if (len === 13 && digits.startsWith('55')) {
    return digits.slice(2, 4) + digits.slice(-8)
  }
  if (len === 12 && digits.startsWith('55')) {
    return digits.slice(2, 4) + digits.slice(-8)
  }
  if (len === 11) {
    return digits.slice(0, 2) + digits.slice(-8)
  }
  if (len === 10) {
    return digits
  }
  return null
}
