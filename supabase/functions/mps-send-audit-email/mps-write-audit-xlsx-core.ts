// Fase 6 do MPS (parte "anexo do arquivo") — calcula ONDE escrever cada
// resposta na planilha original da auditoria, sem tocar em nenhuma
// biblioteca de xlsx (isso fica no index.ts, com xlsx-populate — ver
// BACKLOG.md sobre por que não é SheetJS/ExcelJS: nenhum dos dois preserva
// formatação condicional ao regravar um arquivo existente).
//
// Porte funcional de excelGenerator.js (writeBlockIntoWorkbook/
// pickMetaValue) — row/col aqui já vêm em 1-based (formato que
// xlsx-populate espera pra `sheet.cell(row, col)`); o parser
// (mps-template-parser.ts) guarda 0-based, então +1 acontece aqui, não lá.

export type CellWrite = { row: number; col: number; value: string }

function normalizeLabel(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function formatDateBr(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-')
  return `${dd}/${mm}/${yyyy}`
}

/** Porte de pickMetaValue — casa o rótulo (Data/Auditor/Projeto-Sprint-Categoria) com o valor certo da auditoria. */
export function computeMetaFieldWrites(
  metaFields: { label: string; row: number; col: number }[],
  meta: { dataAuditoria?: string; auditor?: string; projetoSprint?: string },
): CellWrite[] {
  const writes: CellWrite[] = []
  for (const f of metaFields) {
    const n = normalizeLabel(f.label)
    let value: string | undefined
    if (n.includes('data'))
      value = meta.dataAuditoria ? formatDateBr(meta.dataAuditoria) : undefined
    else if (n.includes('auditor')) value = meta.auditor
    else if (
      n.includes('projeto') ||
      n.includes('sprint') ||
      n.includes('categoria')
    )
      value = meta.projetoSprint
    if (value !== undefined && value !== '')
      writes.push({ row: f.row + 1, col: f.col + 1, value })
  }
  return writes
}

/** Porte de writeBlockIntoWorkbook (só a parte da tabela de itens) — escreve verificação/observações/NC de cada item respondido. */
export function computeAnswerWrites(
  columns: { verificacao: number; observacoes: number; nc: number },
  itens: { key: string }[],
  respostas: Record<
    string,
    | {
        verificacao?: string
        observacoes?: string
        nc_task_id?: string | number
      }
    | undefined
  >,
): CellWrite[] {
  const writes: CellWrite[] = []
  for (const item of itens) {
    const resp = respostas[item.key]
    if (!resp) continue
    const row = Number(item.key.split('||')[1]) + 1
    if (columns.verificacao !== -1)
      writes.push({
        row,
        col: columns.verificacao + 1,
        value: resp.verificacao || '',
      })
    if (columns.observacoes !== -1)
      writes.push({
        row,
        col: columns.observacoes + 1,
        value: resp.observacoes || '',
      })
    if (columns.nc !== -1 && resp.nc_task_id)
      writes.push({ row, col: columns.nc + 1, value: `#${resp.nc_task_id}` })
  }
  return writes
}
