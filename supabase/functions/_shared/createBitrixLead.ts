// Shared: criar lead de feira no Bitrix24 via crm.lead.add

export interface LeadDados {
  nome: string
  empresa: string
  cargo: string
  telefone: string
  email: string
  website: string
  cnpj: string
  observacoes: string
}

export async function createBitrixLead(
  bitrixUrl: string,
  dados: LeadDados,
  caption: string,
  origemNome: string,
  capturadorNome: string,
  stageId?: string,
  tituloCustom?: string,
): Promise<string> {
  const anoAtual = new Date().getFullYear()
  const dataCaptura = new Date().toLocaleDateString('pt-BR')
  // Prioridade de abordagem: capturador marcou "quente" na observação ou na
  // legenda digitada. Só afeta o título — não muda dedup, fields nem storage.
  const ehQuente = /\bquente\b/i.test(
    `${dados.observacoes || ''} ${caption || ''}`,
  )
  const titulo =
    (tituloCustom ||
      (dados.empresa
        ? `${origemNome} — ${dados.empresa}`
        : `${origemNome} — Lead Feira`)) + (ehQuente ? ' (QUENTE)' : '')

  const comentario = [
    `[b]LEAD CAPTURADO EM FEIRA — ${origemNome}[/b]`,
    `[b]Origem:[/b] Feira ${origemNome} - Capturado por ${capturadorNome} em ${dataCaptura}`,
    '',
    dados.nome ? `[b]Nome:[/b] ${dados.nome}` : '',
    dados.empresa ? `[b]Empresa:[/b] ${dados.empresa}` : '',
    dados.cargo ? `[b]Cargo:[/b] ${dados.cargo}` : '',
    dados.telefone ? `[b]Telefone:[/b] ${dados.telefone}` : '',
    dados.email ? `[b]E-mail:[/b] ${dados.email}` : '',
    dados.website ? `[b]Site:[/b] ${dados.website}` : '',
    dados.cnpj ? `[b]CNPJ:[/b] ${dados.cnpj}` : '',
    caption ? `\n[b]Observação do executivo:[/b] ${caption}` : '',
    dados.observacoes && dados.observacoes !== caption
      ? `[b]Observações IA:[/b] ${dados.observacoes}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const fields: Record<string, any> = {
    TITLE: titulo,
    ...(stageId ? { STATUS_ID: stageId } : {}),
    NAME: dados.nome.split(' ')[0] || dados.nome,
    LAST_NAME: dados.nome.split(' ').slice(1).join(' ') || '',
    COMPANY_TITLE: dados.empresa,
    POST: dados.cargo,
    OPENED: 'Y',
    SOURCE_ID: 'B24_APPLICATION',
    UTM_SOURCE: 'Lead Finder Zion — Feira',
    COMMENTS: comentario,
  }

  if (dados.telefone) {
    fields.PHONE = [{ VALUE: dados.telefone, VALUE_TYPE: 'WORK' }]
  }
  if (dados.email) {
    fields.EMAIL = [{ VALUE: dados.email, VALUE_TYPE: 'WORK' }]
  }
  if (dados.website) {
    fields.WEB = [{ VALUE: dados.website, VALUE_TYPE: 'WORK' }]
  }
  if (dados.cnpj) {
    fields.UF_CRM_LEAD_1644319583429 = dados.cnpj.replace(/\D/g, '')
  }

  const res = await fetch(`${bitrixUrl}crm.lead.add.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })

  const data = await res.json()
  if (!res.ok || !data.result)
    throw new Error(`Bitrix crm.lead.add falhou: ${JSON.stringify(data)}`)
  return String(data.result)
}
