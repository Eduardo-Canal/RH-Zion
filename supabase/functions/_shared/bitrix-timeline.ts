import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3'

// ─── Formatação ───────────────────────────────────────────────────────────────

export interface FormatarArgs {
  text: string
  msgType: string
  direcao: 'recebida' | 'enviada'
  contactName: string
  executivoNome: string
  timestamp?: number // unix seconds
  // R12-A: campos opcionais de enriquecimento (retrocompatível)
  audioTranscription?: string | null
  audioDurationSeconds?: number | null
  aiDescription?: string | null
  caption?: string | null
}

export function formatarComentarioTimeline(args: FormatarArgs): string {
  const {
    text,
    msgType,
    direcao,
    contactName,
    executivoNome,
    timestamp,
    audioTranscription,
    audioDurationSeconds,
    aiDescription,
    caption,
  } = args

  const icon = direcao === 'recebida' ? '📥' : '📤'
  const quem = direcao === 'recebida' ? contactName : executivoNome
  const tipoLabel = msgType && msgType !== 'texto' ? ` [${msgType}]` : ''
  const dt = timestamp ? new Date(timestamp * 1000) : new Date()
  const dataStr = dt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  // ── Montar bloco de conteúdo conforme tipo ────────────────────────────────
  let conteudo = ''

  if (msgType === 'audio') {
    const duracao = audioDurationSeconds
      ? ` (${Math.floor(audioDurationSeconds / 60)}:${String(audioDurationSeconds % 60).padStart(2, '0')})`
      : ''
    if (audioTranscription?.trim()) {
      conteudo = `[áudio${duracao}]\nTranscrição: ${audioTranscription.trim()}`
    } else {
      conteudo = `[áudio${duracao} — transcrição indisponível]`
    }
  } else if (msgType === 'imagem') {
    const partes: string[] = []
    if (caption?.trim()) partes.push(`Legenda: ${caption.trim()}`)
    if (aiDescription?.trim())
      partes.push(`Análise IA: ${aiDescription.trim()}`)
    conteudo = partes.length ? `[imagem]\n${partes.join('\n')}` : '[imagem]'
  } else if (msgType === 'documento') {
    conteudo = caption?.trim()
      ? `[documento]\nLegenda: ${caption.trim()}`
      : '[documento]'
  } else if (msgType === 'video') {
    conteudo = caption?.trim()
      ? `[vídeo]\nLegenda: ${caption.trim()}`
      : '[vídeo]'
  } else {
    conteudo = text?.trim() || '[mídia sem texto]'
  }

  return [
    `${icon} [b][WhatsApp${tipoLabel}][/b] ${direcao === 'recebida' ? 'recebida' : 'enviada'} · ${dataStr}`,
    `[i]${quem}[/i]`,
    '',
    conteudo,
    '',
    '─────────────',
    'Registrado via Lead Finder Zion',
  ].join('\n')
}

// ─── Formatador de BATCH (R12-B) ──────────────────────────────────────────────

export interface MensagemDoBatch {
  direcao: 'recebida' | 'enviada'
  tipo: string
  conteudo: string
  caption: string | null
  criadoEm: Date
  mediaTranscription: string | null
  audioDurationSeconds: number | null
  mediaAiDescription: string | null
}

export interface FormatarBatchArgs {
  mensagens: MensagemDoBatch[]
  contactName: string
  executivoNome: string
}

function formatarHorario(dt: Date): string {
  return dt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarDataCompleta(dt: Date): string {
  return dt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarConteudoMsg(m: MensagemDoBatch): string {
  if (m.tipo === 'audio') {
    const duracao = m.audioDurationSeconds
      ? ` ${Math.floor(m.audioDurationSeconds / 60)}:${String(m.audioDurationSeconds % 60).padStart(2, '0')}`
      : ''
    if (m.mediaTranscription?.trim()) {
      return `[áudio${duracao}]: ${m.mediaTranscription.trim()}`
    }
    return `[áudio${duracao} — transcrição indisponível]`
  }
  if (m.tipo === 'imagem') {
    const sub: string[] = ['[imagem]']
    if (m.caption?.trim()) sub.push(`legenda: "${m.caption.trim()}"`)
    if (m.mediaAiDescription?.trim())
      sub.push(`análise IA: ${m.mediaAiDescription.trim()}`)
    return sub.join(' • ')
  }
  if (m.tipo === 'documento') {
    return m.caption?.trim()
      ? `[documento]: ${m.caption.trim()}`
      : '[documento]'
  }
  if (m.tipo === 'video') {
    return m.caption?.trim() ? `[vídeo]: ${m.caption.trim()}` : '[vídeo]'
  }
  return m.conteudo?.trim() || '[mídia sem texto]'
}

export function formatarBatchTimeline(args: FormatarBatchArgs): string {
  const { mensagens, contactName, executivoNome } = args
  if (!mensagens.length) return ''

  const primeira = mensagens[0].criadoEm
  const ultima = mensagens[mensagens.length - 1].criadoEm

  const cabecalho = `💬 [b][WhatsApp][/b] Conversa com ${contactName} — ${formatarDataCompleta(primeira)} a ${formatarHorario(ultima)}`
  const exec = `[i]Executiva: ${executivoNome}[/i]`

  const linhas = mensagens.map((m) => {
    const icon = m.direcao === 'recebida' ? '📥' : '📤'
    const quem = m.direcao === 'recebida' ? contactName : executivoNome
    const hora = formatarHorario(m.criadoEm)
    return `${icon} ${hora} — ${quem}: ${formatarConteudoMsg(m)}`
  })

  return [
    cabecalho,
    exec,
    '',
    ...linhas,
    '',
    '─────────────',
    `${mensagens.length} ${mensagens.length === 1 ? 'mensagem' : 'mensagens'} · Registrado via Lead Finder Zion`,
  ].join('\n')
}

// ─── Mapeamento de tipos Bitrix ───────────────────────────────────────────────

const ENTITY_TYPE_ID: Record<string, number> = {
  lead: 1,
  deal: 2,
  contact: 3,
  company: 4,
}

// ─── Postar comentário com idempotência ───────────────────────────────────────

export interface PostarArgs {
  supabase: SupabaseClient
  bitrixUrl: string
  conversationId: string
  messageDbId: string | null
  entityType: string
  entityId: string | number
  comentario: string
}

export async function postarComentarioTimeline(
  args: PostarArgs,
): Promise<void> {
  const {
    supabase,
    bitrixUrl,
    conversationId,
    messageDbId,
    entityType,
    entityId,
    comentario,
  } = args

  // Idempotência: se já existe log de sucesso para essa mensagem+entidade, pula
  if (messageDbId) {
    const { data: existing } = await supabase
      .from('whatsapp_bitrix_timeline_log')
      .select('id')
      .eq('message_id', messageDbId)
      .eq('bitrix_entity_type', entityType)
      .eq('bitrix_entity_id', String(entityId))
      .eq('status', 'success')
      .maybeSingle()

    if (existing) return
  }

  const entityTypeId = ENTITY_TYPE_ID[entityType] ?? 1

  try {
    const res = await fetch(`${bitrixUrl}crm.timeline.comment.add.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          ENTITY_ID: parseInt(String(entityId)),
          ENTITY_TYPE_ID: entityTypeId,
          COMMENT: comentario,
        },
      }),
    })

    const ok = res.ok

    const { error: logErr } = await supabase
      .from('whatsapp_bitrix_timeline_log')
      .insert({
        message_id: messageDbId || null,
        conversation_id: conversationId,
        bitrix_entity_type: entityType,
        bitrix_entity_id: String(entityId),
        status: ok ? 'success' : 'failed',
        error_message: ok ? null : `HTTP ${res.status}`,
        posted_at: ok ? new Date().toISOString() : null,
      })
    if (logErr)
      console.warn('[bitrix-timeline] log insert failed:', logErr.message)
  } catch (e: any) {
    await supabase.from('whatsapp_bitrix_timeline_log').insert({
      message_id: messageDbId || null,
      conversation_id: conversationId,
      bitrix_entity_type: entityType,
      bitrix_entity_id: String(entityId),
      status: 'failed',
      error_message: e?.message || 'unknown error',
      posted_at: null,
    })
  }
}

// ─── Buscar deals abertos vinculados ─────────────────────────────────────────

export async function buscarDealsAbertos(
  bitrixUrl: string,
  entityType: string,
  entityId: string | number,
): Promise<Array<{ id: string }>> {
  const dealIds = new Set<string>()

  async function fetchDealsBy(
    filterKey: 'CONTACT_ID' | 'COMPANY_ID',
    filterVal: string | number,
  ) {
    try {
      const res = await fetch(
        `${bitrixUrl}crm.deal.list.json?filter[${filterKey}]=${filterVal}&filter[CLOSED]=N&select[]=ID`,
      )
      if (!res.ok) return
      const data = await res.json()
      for (const d of data?.result || []) {
        if (d?.ID) dealIds.add(String(d.ID))
      }
    } catch {}
  }

  if (entityType === 'company') {
    // Empresa: buscar deals direto via COMPANY_ID
    await fetchDealsBy('COMPANY_ID', entityId)
  } else if (entityType === 'contact') {
    // Contato: buscar deals via CONTACT_ID + também via COMPANY_ID do contato (se houver)
    await fetchDealsBy('CONTACT_ID', entityId)

    // Buscar empresa do contato e adicionar deals dela
    try {
      const res = await fetch(`${bitrixUrl}crm.contact.get.json?id=${entityId}`)
      if (res.ok) {
        const data = await res.json()
        const companyId = data?.result?.COMPANY_ID
        if (companyId && String(companyId) !== '0') {
          await fetchDealsBy('COMPANY_ID', companyId)
        }
      }
    } catch {}
  }
  // Lead: sem busca de deals

  return Array.from(dealIds).map((id) => ({ id }))
}

// ─── Buscar Leads abertos vinculados ─────────────────────────────────────────
// Lead aberto = STATUS_SEMANTIC_ID = 'P' (Processing/em andamento)
// Status terminais: 'CONVERTED' (virou Deal), 'JUNK' (descartado)
export async function buscarLeadsAbertos(
  bitrixUrl: string,
  entityType: string,
  entityId: string | number,
): Promise<Array<{ id: string }>> {
  const leadIds = new Set<string>()

  async function fetchLeadsByCompany(companyId: string | number) {
    try {
      const res = await fetch(
        `${bitrixUrl}crm.lead.list.json?filter[COMPANY_ID]=${companyId}&filter[STATUS_SEMANTIC_ID]=P&select[]=ID`,
      )
      if (!res.ok) return
      const data = await res.json()
      for (const l of data?.result || []) {
        if (l?.ID) leadIds.add(String(l.ID))
      }
    } catch {}
  }

  async function fetchLeadsByContact(contactId: string | number) {
    try {
      const res = await fetch(
        `${bitrixUrl}crm.lead.list.json?filter[CONTACT_ID]=${contactId}&filter[STATUS_SEMANTIC_ID]=P&select[]=ID`,
      )
      if (!res.ok) return
      const data = await res.json()
      for (const l of data?.result || []) {
        if (l?.ID) leadIds.add(String(l.ID))
      }
    } catch {}
  }

  if (entityType === 'company') {
    await fetchLeadsByCompany(entityId)
  } else if (entityType === 'contact') {
    await fetchLeadsByContact(entityId)
    // Também buscar via empresa do contato
    try {
      const res = await fetch(`${bitrixUrl}crm.contact.get.json?id=${entityId}`)
      if (res.ok) {
        const data = await res.json()
        const companyId = data?.result?.COMPANY_ID
        if (companyId && String(companyId) !== '0') {
          await fetchLeadsByCompany(companyId)
        }
      }
    } catch {}
  }
  // Para entityType === 'lead' ou 'deal', não busca outros leads (entidade principal já recebe)

  return Array.from(leadIds).map((id) => ({ id }))
}

// ─── Post híbrido: entidade principal + todos os deals abertos ────────────────

export interface HibridoArgs {
  supabase: SupabaseClient
  bitrixUrl: string
  conversationId: string
  messageDbId: string | null
  entityType: string
  entityId: string | number
  comentario: string
}

// Pausa mínima entre chamadas diretas ao Bitrix para respeitar quota (2 req/s)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function postarTimelineHibrido(args: HibridoArgs): Promise<void> {
  const { entityType, entityId, bitrixUrl } = args

  // Postar na entidade principal
  await postarComentarioTimeline(args)

  // Postar em Deals e Leads abertos vinculados (apenas para contact/company)
  if (entityType === 'contact' || entityType === 'company') {
    // Deals abertos
    const deals = await buscarDealsAbertos(bitrixUrl, entityType, entityId)
    for (const deal of deals) {
      await sleep(600) // ~1.6 req/s, abaixo do limite do Bitrix (2 req/s)
      await postarComentarioTimeline({
        ...args,
        entityType: 'deal',
        entityId: deal.id,
      })
    }

    // Leads abertos
    const leads = await buscarLeadsAbertos(bitrixUrl, entityType, entityId)
    for (const lead of leads) {
      await sleep(600)
      await postarComentarioTimeline({
        ...args,
        entityType: 'lead',
        entityId: lead.id,
      })
    }
  }
}
