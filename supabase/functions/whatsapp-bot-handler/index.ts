import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { buildAiPrompt, fetchAiConfigs } from '../_shared/build-ai-prompt.ts'
import { isBusinessHour } from './is-business-hour.ts'
import { escolherExecutivoAgenda } from './agenda-distribuicao.ts'
import {
  ofereceuAgendamento,
  aceitouOferta,
  pediuAgendamento,
} from './oferta-detector.ts'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RoutePayload {
  instance_id: string
  conversation_id: string
  conversation_estado: string
  bot_ativo: boolean
  message_db_id: string
  message: any
  phone: string
  contact_name: string
  text: string
  msg_type: string
  button_id: string | null
  button_text: string | null
}

type EstadoBot =
  | 'INICIO'
  | 'CONVERSANDO'
  | 'OFERTA_AGENDAMENTO'
  | 'COLETANDO_DIA'
  | 'COLETANDO_HORARIO'
  | 'AGENDADO'
  | 'HUMANO'

interface Conversa {
  id: string
  estado: EstadoBot
  bot_ativo: boolean
  agendamento_dia: string | null
  agendamento_hora: string | null
  bitrix_entity_id: string | null
  bitrix_entity_type: string | null
  automacao_config_id: string | null
  lead_score: number
  contexto_enviado_uazapi: boolean
  agenda_disponibilizacao_id: string | null
}

// ─── Enviar mensagem WhatsApp ─────────────────────────────────────────────────

async function sendMessage(
  baseUrl: string,
  instanceToken: string | null,
  globalToken: string,
  instanceKey: string,
  phone: string,
  text: string,
): Promise<void> {
  const token = instanceToken?.trim() || globalToken
  const body: Record<string, string> = { number: phone, text }
  if (!instanceToken?.trim()) body.instanceName = instanceKey

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn(
        `[bot] envio falhou: HTTP ${res.status} — ${errBody.slice(0, 200)}`,
      )
    }
  } catch (e) {
    console.warn('[bot] falha ao enviar (rede):', e)
  }
}

// ─── Item 5: Sincronizar contexto do lead no CRM uazapi ──────────────────────

async function syncLeadContext(
  baseUrl: string,
  instanceToken: string | null,
  globalToken: string,
  instanceKey: string,
  phone: string,
  leadData: Record<string, any>,
): Promise<void> {
  const token = instanceToken?.trim() || globalToken
  if (!token) return

  const body: Record<string, any> = { number: phone, ...leadData }
  if (!instanceToken?.trim()) body.instanceName = instanceKey

  await fetch(`${baseUrl.replace(/\/$/, '')}/chat/editLead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(body),
  }).catch((e) => console.warn('[bot] editLead falhou:', e))
}

// ─── Item 5: Atualizar score do lead e notificar Bitrix se quente ─────────────

async function updateLeadScore(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  delta: number,
  cfg: any,
  bitrixUrl: string | null,
  phone: string,
  contactName: string,
): Promise<number> {
  const { data: conv } = await supabase
    .from('whatsapp_conversations')
    .select('lead_score')
    .eq('id', conversationId)
    .maybeSingle()

  const oldScore = conv?.lead_score || 0
  const newScore = Math.max(0, oldScore + delta)

  await supabase
    .from('whatsapp_conversations')
    .update({ lead_score: newScore })
    .eq('id', conversationId)

  // Notificar responsável quando lead cruza limiar de "quente" (score 5)
  if (
    oldScore < 5 &&
    newScore >= 5 &&
    bitrixUrl &&
    cfg?.responsavel_bitrix_id
  ) {
    fetch(`${bitrixUrl}im.notify.system.add.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        USER_ID: cfg.responsavel_bitrix_id,
        MESSAGE: `🔥 *Lead quente!* ${contactName} (${phone}) atingiu score ${newScore} no WhatsApp. Ação recomendada!`,
      }),
    }).catch(() => {})
  }

  return newScore
}

// ─── GPT-4o-mini: resposta do chatbot ────────────────────────────────────────

async function gerarRespostaBot(
  historico: Array<{ role: 'user' | 'assistant'; content: string }>,
  promptBase: string,
  openaiKey: string,
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      temperature: 0.7,
      messages: [{ role: 'system', content: promptBase }, ...historico],
    }),
  })

  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

// ─── Extração de datas/horas ──────────────────────────────────────────────────

function extrairDia(texto: string): string | null {
  const meses: Record<string, string> = {
    jan: '01',
    fev: '02',
    mar: '03',
    abr: '04',
    mai: '05',
    jun: '06',
    jul: '07',
    ago: '08',
    set: '09',
    out: '10',
    nov: '11',
    dez: '12',
  }
  const rSlash = texto.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (rSlash) {
    const dia = rSlash[1].padStart(2, '0')
    const mes = rSlash[2].padStart(2, '0')
    const ano = rSlash[3]
      ? rSlash[3].slice(-2)
      : new Date().getFullYear().toString().slice(-2)
    return `${dia}/${mes}/${ano.length === 2 ? '20' + ano : ano}`
  }
  const rExt = texto.match(/(\d{1,2})\s+de\s+([a-záàâãéêíóôõúç]+)/i)
  if (rExt) {
    const dia = rExt[1].padStart(2, '0')
    const mesKey = rExt[2].toLowerCase().slice(0, 3)
    const mes = meses[mesKey]
    if (mes) return `${dia}/${mes}/${new Date().getFullYear()}`
  }
  const diasSemana = [
    'segunda',
    'terça',
    'quarta',
    'quinta',
    'sexta',
    'sábado',
    'sab',
    'segunda-feira',
    'terça-feira',
  ]
  for (const d of diasSemana) {
    if (texto.toLowerCase().includes(d)) return texto.trim()
  }
  return null
}

function extrairHora(texto: string): string | null {
  const r = texto.match(/(\d{1,2})[h:hH](\d{0,2})/i)
  if (r) {
    const h = r[1].padStart(2, '0')
    const m = (r[2] || '00').padStart(2, '0')
    return `${h}:${m}`
  }
  return null
}

// ─── Helpers de intenção ──────────────────────────────────────────────────────

function isPausaRequest(texto: string, stopKeyword: string): boolean {
  const t = texto.toLowerCase().trim()
  if (stopKeyword && t === stopKeyword.toLowerCase()) return true
  const triggers = [
    'falar com atendente',
    'falar com pessoa',
    'humano',
    'atendimento humano',
    'quero falar com',
    'me passa para',
    'transfere',
    'não quero robô',
    'nao quero robo',
  ]
  return triggers.some((tr) => t.includes(tr))
}

function demonstraInteresse(texto: string): boolean {
  const triggers = [
    'quero',
    'tenho interesse',
    'me interessa',
    'pode me',
    'gostaria',
    'quando',
    'como funciona',
    'mais informações',
    'me conta mais',
  ]
  const t = texto.toLowerCase()
  return triggers.some((tr) => t.includes(tr))
}

// ─── Buscar histórico de mensagens ────────────────────────────────────────────

async function buscarHistorico(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  limite = 12,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select(
      'direcao, conteudo, tipo, caption, media_ai_description, media_transcription',
    )
    .eq('conversation_id', conversationId)
    .order('criado_em', { ascending: false })
    .limit(limite)

  if (!data) return []

  const labelMidia: Record<string, string> = {
    imagem: '[Cliente enviou uma imagem]',
    audio: '[Cliente enviou um áudio]',
    documento: '[Cliente enviou um documento PDF]',
    video: '[Cliente enviou um vídeo]',
    sticker: '[Cliente enviou um sticker]',
  }

  return data
    .reverse()
    .map((m) => {
      const tipo = m.tipo as string
      const direcao = m.direcao as 'recebida' | 'enviada'

      // Texto puro
      if (tipo === 'texto' && m.conteudo) {
        return {
          role: direcao === 'recebida' ? 'user' : 'assistant',
          content: m.conteudo as string,
        }
      }

      // Mídia recebida: usa transcrição/descrição IA quando disponível, senão placeholder
      if (direcao === 'recebida' && labelMidia[tipo]) {
        const aiDesc = (m.media_ai_description as string | null)?.trim()
        const transcricao = (m.media_transcription as string | null)?.trim()
        const caption = (m.caption as string | null)?.trim()
        let content: string
        if (tipo === 'audio' && transcricao) {
          content = `[Áudio transcrito]: ${transcricao}`
        } else if (aiDesc) {
          content = caption
            ? `[Imagem do cliente: ${aiDesc}] (legenda: "${caption}")`
            : `[Imagem do cliente: ${aiDesc}]`
        } else {
          content = caption
            ? `${labelMidia[tipo]} com legenda: "${caption}"`
            : labelMidia[tipo]
        }
        return { role: 'user' as const, content }
      }

      // Mídia enviada pelo bot/executivo
      if (direcao === 'enviada' && labelMidia[tipo]) {
        return {
          role: 'assistant' as const,
          content: `[Enviei ${tipo === 'imagem' ? 'uma imagem' : tipo === 'documento' ? 'um documento' : `um ${tipo}`}]`,
        }
      }

      return null
    })
    .filter(
      (x): x is { role: 'user' | 'assistant'; content: string } => x !== null,
    )
}

// ─── Criar atividade de agendamento no Bitrix ─────────────────────────────────

async function criarAgendamentoBitrix(
  bitrixUrl: string,
  conversa: Conversa,
  phone: string,
  contactName: string,
  dia: string,
  hora: string,
): Promise<void> {
  const entityId = conversa.bitrix_entity_id
    ? parseInt(conversa.bitrix_entity_id)
    : null
  const entityTypeId = conversa.bitrix_entity_type === 'deal' ? 2 : 1

  const descricao = [
    `[b]Agendamento via WhatsApp[/b]`,
    ``,
    `[b]Contato:[/b] ${contactName} (${phone})`,
    `[b]Data:[/b] ${dia}`,
    `[b]Horário:[/b] ${hora}`,
    ``,
    `_Agendado automaticamente pelo bot LeadFinderZion_`,
  ].join('\n')

  const promises: Promise<any>[] = []

  promises.push(
    fetch(`${bitrixUrl}im.notify.system.add.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        USER_ID: 1,
        MESSAGE: `📅 Novo agendamento via WhatsApp!\n*${contactName}* (${phone})\n📆 ${dia} às ${hora}`,
      }),
    }).catch(() => {}),
  )

  if (entityId) {
    promises.push(
      fetch(`${bitrixUrl}crm.activity.todo.add.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerTypeId: entityTypeId,
          ownerId: entityId,
          description: descricao,
          deadline: `${dia} ${hora}:00`,
        }),
      }).catch(() => {}),
    )
  }

  await Promise.all(promises)
}

// ─── Transição de estado ──────────────────────────────────────────────────────

async function transicionarEstado(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  novoEstado: EstadoBot,
  extras: Record<string, any> = {},
): Promise<void> {
  await supabase
    .from('whatsapp_conversations')
    .update({
      estado: novoEstado,
      ultimo_contato: new Date().toISOString(),
      ...extras,
    })
    .eq('id', conversationId)
}

// ─── Escolher executivo, enviar o link de agenda e registrar a disponibilização ─
// Usada tanto pelo aceite em OFERTA_AGENDAMENTO quanto pelo pedido direto do
// lead em CONVERSANDO (item 1.3) — mesmo comportamento nos dois pontos de entrada.

async function enviarLinkAgenda(deps: {
  supabase: ReturnType<typeof createClient>
  baseUrl: string
  instanceToken: string | null
  globalToken: string
  instanceKey: string
  phone: string
  contact_name: string
  conversation_id: string
  conversa: Conversa
  cfg: any
  bitrixUrl: string | null
}): Promise<void> {
  const {
    supabase,
    baseUrl,
    instanceToken,
    globalToken,
    instanceKey,
    phone,
    contact_name,
    conversation_id,
    conversa,
    cfg,
    bitrixUrl,
  } = deps

  const { data: agendaCfgRow } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'agenda_config')
    .maybeSingle()
  const agendaCfg = (agendaCfgRow?.value as any) || {}

  const executivo = await escolherExecutivoAgenda(supabase)

  if (!executivo) {
    const msgSemExecutivo =
      agendaCfg.mensagem_sem_executivo ||
      `Vou te conectar com um de nossos atendentes para agendar o melhor horário. Em breve alguém da equipe entra em contato!`
    await sendMessage(
      baseUrl,
      instanceToken,
      globalToken,
      instanceKey,
      phone,
      msgSemExecutivo,
    )
    await salvarMensagemBot(supabase, conversation_id, msgSemExecutivo)
    await transicionarEstado(supabase, conversation_id, 'HUMANO', {
      bot_ativo: false,
    })
  } else {
    const template =
      agendaCfg.mensagem_link ||
      `Perfeito! Vou te passar a agenda de {{executivo}} para você escolher o melhor horário: {{link}}. Me confirma aqui o dia e horário que você marcar, por favor?`
    const msgLink = template
      .replace(/\{\{executivo\}\}/g, executivo.nome)
      .replace(/\{\{link\}\}/g, executivo.link_agenda)

    await sendMessage(
      baseUrl,
      instanceToken,
      globalToken,
      instanceKey,
      phone,
      msgLink,
    )
    await salvarMensagemBot(supabase, conversation_id, msgLink)

    const { data: disponibilizacao } = await supabase
      .from('agenda_disponibilizacoes')
      .insert({
        conversation_id,
        telefone_lead: phone,
        nome_lead: contact_name || null,
        profile_id: executivo.profile_id,
        link_enviado: executivo.link_agenda,
        feira_id: conversa.automacao_config_id || null,
      })
      .select('id')
      .single()

    await transicionarEstado(supabase, conversation_id, 'COLETANDO_DIA', {
      agenda_disponibilizacao_id: disponibilizacao?.id || null,
    })
  }

  await updateLeadScore(
    supabase,
    conversation_id,
    2,
    cfg,
    bitrixUrl,
    phone,
    contact_name,
  )
  if (bitrixUrl && cfg.responsavel_bitrix_id) {
    fetch(`${bitrixUrl}im.notify.system.add.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        USER_ID: cfg.responsavel_bitrix_id,
        MESSAGE: `📅 *${contact_name}* (${phone}) está pronto para receber o link de agenda.`,
      }),
    }).catch(() => {})
  }
}

// ─── Salvar mensagem enviada ──────────────────────────────────────────────────

async function salvarMensagemBot(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  texto: string,
): Promise<void> {
  const { error } = await supabase.from('whatsapp_messages').insert({
    conversation_id: conversationId,
    message_id: `bot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    direcao: 'enviada',
    tipo: 'texto',
    conteudo: texto,
    processado: true,
  })
  if (error)
    console.warn('[bot] falha ao salvar mensagem do bot:', error.message)
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })

  // Guard de chamada interna — achado de auditoria de 22/07/2026: esta
  // function não tinha nenhuma checagem de auth e, se chamada anonimamente,
  // enviava mensagem real no WhatsApp / consumia OpenAI / gravava no Bitrix.
  // Único chamador real é o whatsapp-webhook-router (edge function → edge
  // function) — só aceita Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) {
    console.error(
      '[bot-handler] SUPABASE_SERVICE_ROLE_KEY não configurado — recusando execução.',
    )
    return new Response('Configuração interna ausente', { status: 500 })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) {
    return new Response('Token ausente', { status: 401 })
  }

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    console.error('[bot-handler] Authorization inválido — chamada recusada.')
    return new Response('Acesso restrito a chamadas internas', { status: 403 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let payload: RoutePayload
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const {
    instance_id,
    conversation_id,
    bot_ativo,
    message_db_id,
    phone,
    contact_name,
    text,
    msg_type,
    button_id,
    button_text,
  } = payload

  // Aceitar texto e respostas de botão/lista
  const isTextual = ['texto', 'button_response', 'list_response'].includes(
    msg_type,
  )
  if (!isTextual || (!text.trim() && !button_id)) {
    return new Response('OK', { status: 200 })
  }

  try {
    // ── 1. Carregar configuração e instância em paralelo ──────────────────────
    const [moduleConfigRes, instanceRes, openaiRes, bitrixUrl] =
      await Promise.all([
        supabase
          .from('whatsapp_module_config')
          .select(
            'uazapi_base_url, uazapi_global_token, horario_inicio, horario_fim, dias_semana, prompt_base, responsavel_bitrix_id, responsavel_nome, chatbot_stop_keyword, chatbot_stop_minutes, bot_pausado_globalmente',
          )
          .eq('id', 1)
          .maybeSingle(),
        supabase
          .from('whatsapp_instances')
          .select('instance_key, instance_token')
          .eq('id', instance_id)
          .maybeSingle(),
        supabase
          .from('settings')
          .select('value')
          .eq('key', 'openai_config')
          .maybeSingle(),
        getBitrixWebhookUrl(supabase),
      ])

    const cfg = moduleConfigRes.data
    if (!cfg) return new Response('OK', { status: 200 })

    // Pausa global temporária (marketing revisando o modelo de resposta) —
    // ignora TODA conversa, inclusive contato novo que ainda não tem linha
    // em whatsapp_conversations. Não afeta whatsapp-group-handler (feira).
    if (cfg.bot_pausado_globalmente) {
      console.log(
        '[bot] pausado globalmente (whatsapp_module_config.bot_pausado_globalmente) — ignorado',
      )
      return new Response('OK', { status: 200 })
    }

    // Contexto rico de IA (empresa/produto/personas/regras) + prompt específico do bot
    const aiConfigs = await fetchAiConfigs(supabase)
    const contextoRico = buildAiPrompt(aiConfigs)
    const promptBotFinal = contextoRico
      ? `${contextoRico}\n\n─── INSTRUÇÕES DO ATENDIMENTO ───\n${cfg.prompt_base || ''}`
      : cfg.prompt_base || ''

    const baseUrl = cfg.uazapi_base_url || 'https://free.uazapi.com'
    const globalToken: string = cfg.uazapi_global_token || ''
    const instanceKey: string = instanceRes.data?.instance_key || ''
    const instanceToken: string | null =
      instanceRes.data?.instance_token || null
    const openaiKey: string =
      (openaiRes.data?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    const stopKeyword: string = cfg.chatbot_stop_keyword || 'parar'

    if (!instanceToken && !globalToken) {
      console.warn('[bot] nenhum token disponível para envio')
      return new Response('OK', { status: 200 })
    }

    // ── 2. Carregar conversa completa ─────────────────────────────────────────
    const { data: conversa } = await supabase
      .from('whatsapp_conversations')
      .select(
        'id, estado, bot_ativo, agendamento_dia, agendamento_hora, bitrix_entity_id, bitrix_entity_type, automacao_config_id, lead_score, contexto_enviado_uazapi, agenda_disponibilizacao_id',
      )
      .eq('id', conversation_id)
      .maybeSingle()

    if (!conversa) return new Response('OK', { status: 200 })

    // ── 3. Se bot desligado → ignorar ────────────────────────────────────────
    if (!conversa.bot_ativo) {
      console.log(`[bot] conversa ${conversation_id} em modo humano — ignorado`)
      return new Response('OK', { status: 200 })
    }

    const emHorario = isBusinessHour(
      cfg.horario_inicio,
      cfg.horario_fim,
      cfg.dias_semana,
    )
    const estado = conversa.estado as EstadoBot

    if (estado === 'AGENDADO' || estado === 'HUMANO') {
      return new Response('OK', { status: 200 })
    }

    // ── 4. Fora de horário: mensagem de ausência (apenas no primeiro contato) ─
    if (!emHorario) {
      if (estado === 'INICIO') {
        const msgAusencia = [
          `Olá, ${contact_name}! 👋`,
          ``,
          `Recebemos seu contato e em breve nossa equipe dará seguimento ao seu atendimento. Obrigado! 😊`,
        ].join('\n')

        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgAusencia,
        )
        await salvarMensagemBot(supabase, conversation_id, msgAusencia)
        await transicionarEstado(supabase, conversation_id, 'CONVERSANDO')
      }
      return new Response('OK', { status: 200 })
    }

    // ── 5. Verificar solicitação de pausa/handoff humano ──────────────────────
    const textoParaVerificar = button_text || text
    if (isPausaRequest(textoParaVerificar, stopKeyword)) {
      const msgHandoff = [
        `Entendido! Vou conectar você com um de nossos atendentes. 🙋`,
        ``,
        `Em breve alguém da equipe entrará em contato.`,
        `Horário de atendimento: ${cfg.horario_inicio} às ${cfg.horario_fim}.`,
      ].join('\n')

      await sendMessage(
        baseUrl,
        instanceToken,
        globalToken,
        instanceKey,
        phone,
        msgHandoff,
      )
      await salvarMensagemBot(supabase, conversation_id, msgHandoff)
      await transicionarEstado(supabase, conversation_id, 'HUMANO', {
        bot_ativo: false,
      })

      if (bitrixUrl && cfg.responsavel_bitrix_id) {
        fetch(`${bitrixUrl}im.notify.system.add.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            USER_ID: cfg.responsavel_bitrix_id,
            MESSAGE: `🆘 *${contact_name}* (${phone}) solicitou atendimento humano no WhatsApp.`,
          }),
        }).catch(() => {})
      }

      return new Response('OK', { status: 200 })
    }

    // ── 6. Item 2: Resposta de botão ──────────────────────────────────────────
    if (button_id) {
      if (button_id === 'interesse' || button_id === 'mais_info') {
        const msgOferta = [
          `Ótimo! Fico feliz com seu interesse! 😊`,
          ``,
          `Gostaríamos de apresentar nossas soluções em detalhes. Posso agendar uma conversa rápida com nosso time?`,
          ``,
          `Responda *sim* para agendar ou *agora não* se preferir.`,
        ].join('\n')

        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgOferta,
        )
        await salvarMensagemBot(supabase, conversation_id, msgOferta)
        await transicionarEstado(
          supabase,
          conversation_id,
          'OFERTA_AGENDAMENTO',
        )
        await updateLeadScore(
          supabase,
          conversation_id,
          3,
          cfg,
          bitrixUrl,
          phone,
          contact_name,
        )

        await supabase
          .from('leads_automacao_pendentes')
          .update({ whatsapp_status: 'respondido' })
          .eq('whatsapp_phone', phone.replace(/\D/g, ''))
          .eq('whatsapp_status', 'enviado')
      } else if (button_id === 'nao_obg') {
        const msgFim = `Entendido! Sem problemas. Se mudar de ideia ou precisar de alguma solução no futuro, é só chamar. 😊`
        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgFim,
        )
        await salvarMensagemBot(supabase, conversation_id, msgFim)
        await transicionarEstado(supabase, conversation_id, 'CONVERSANDO')
        await updateLeadScore(
          supabase,
          conversation_id,
          -1,
          cfg,
          bitrixUrl,
          phone,
          contact_name,
        )
      }

      await supabase
        .from('whatsapp_messages')
        .update({ processado: true })
        .eq('id', message_db_id)
      return new Response('OK', { status: 200 })
    }

    // ── 7. Item 5: Na primeira resposta — sincronizar contexto no uazapi CRM ──
    if (!conversa.contexto_enviado_uazapi) {
      // Buscar dados do lead para enriquecer o CRM do uazapi
      const { data: leadData } = await supabase
        .from('leads_automacao_pendentes')
        .select('razao_social, cnpj, porte, municipio, uf, sugestao_abordagem')
        .eq('whatsapp_phone', phone.replace(/\D/g, ''))
        .maybeSingle()

      await syncLeadContext(
        baseUrl,
        instanceToken,
        globalToken,
        instanceKey,
        phone,
        {
          lead_name: contact_name,
          lead_status: 'Lead WhatsApp Ativo',
          lead_tags: ['automacao_zion'],
          custom1: leadData?.cnpj ? `CNPJ: ${leadData.cnpj}` : '',
          custom2: leadData?.porte ? `Porte: ${leadData.porte}` : '',
          custom3: leadData?.municipio
            ? `${leadData.municipio}/${leadData.uf || ''}`
            : '',
          custom4: leadData?.sugestao_abordagem || '',
          custom5: `Lead Score: ${conversa.lead_score || 0}`,
        },
      )

      await supabase
        .from('whatsapp_conversations')
        .update({ contexto_enviado_uazapi: true })
        .eq('id', conversation_id)

      // +1 por qualquer resposta inicial
      await updateLeadScore(
        supabase,
        conversation_id,
        1,
        cfg,
        bitrixUrl,
        phone,
        contact_name,
      )
    }

    // ── 8. Máquina de estados ─────────────────────────────────────────────────

    if (estado === 'COLETANDO_DIA') {
      const dia = extrairDia(text)
      if (dia) {
        const msgHora = `Ótimo! Qual horário seria melhor para você? (ex: 14h, 10:30h)`
        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgHora,
        )
        await salvarMensagemBot(supabase, conversation_id, msgHora)
        await transicionarEstado(
          supabase,
          conversation_id,
          'COLETANDO_HORARIO',
          { agendamento_dia: dia },
        )
      } else {
        const msgRetry = `Não entendi a data. Pode me dizer no formato dd/mm ou "segunda-feira"?`
        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgRetry,
        )
        await salvarMensagemBot(supabase, conversation_id, msgRetry)
      }
      return new Response('OK', { status: 200 })
    }

    if (estado === 'COLETANDO_HORARIO') {
      const hora = extrairHora(text)
      if (hora) {
        const dia = conversa.agendamento_dia || 'a definir'
        const msgConfirma = [
          `✅ Perfeito! Agendamento confirmado:`,
          ``,
          `📅 Data: ${dia}`,
          `🕐 Horário: ${hora}`,
          ``,
          `Nossa equipe entrará em contato. Até lá! 😊`,
        ].join('\n')

        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgConfirma,
        )
        await salvarMensagemBot(supabase, conversation_id, msgConfirma)
        await transicionarEstado(supabase, conversation_id, 'AGENDADO', {
          agendamento_hora: hora,
          bot_ativo: false,
        })
        await updateLeadScore(
          supabase,
          conversation_id,
          5,
          cfg,
          bitrixUrl,
          phone,
          contact_name,
        )

        if (conversa.agenda_disponibilizacao_id) {
          await supabase
            .from('agenda_disponibilizacoes')
            .update({
              agendado: true,
              agendado_em: new Date().toISOString(),
              agendamento_dia: dia,
              agendamento_hora: hora,
            })
            .eq('id', conversa.agenda_disponibilizacao_id)
        }

        if (bitrixUrl) {
          await criarAgendamentoBitrix(
            bitrixUrl,
            conversa,
            phone,
            contact_name,
            dia,
            hora,
          )
        }

        await supabase
          .from('leads_automacao_pendentes')
          .update({ whatsapp_status: 'agendado' })
          .eq('whatsapp_phone', phone.replace(/\D/g, ''))
          .in('whatsapp_status', ['enviado', 'respondido'])
      } else {
        const msgRetry = `Não identifiquei o horário. Pode informar assim: "14h" ou "10:30"?`
        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgRetry,
        )
        await salvarMensagemBot(supabase, conversation_id, msgRetry)
      }
      return new Response('OK', { status: 200 })
    }

    if (estado === 'OFERTA_AGENDAMENTO') {
      const textoLower = text.toLowerCase()
      const aceitou = aceitouOferta(text)
      const recusou = [
        'não',
        'nao',
        'n',
        'agora não',
        'depois',
        'outra hora',
      ].some((t) => textoLower === t || textoLower.startsWith(t))

      if (aceitou) {
        await enviarLinkAgenda({
          supabase,
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          contact_name,
          conversation_id,
          conversa,
          cfg,
          bitrixUrl,
        })
      } else if (recusou) {
        const msgFim = `Tudo bem! Quando quiser conversar é só chamar. 😊`
        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgFim,
        )
        await salvarMensagemBot(supabase, conversation_id, msgFim)
        await transicionarEstado(supabase, conversation_id, 'CONVERSANDO')
      } else {
        if (!openaiKey) return new Response('OK', { status: 200 })
        const historico = await buscarHistorico(supabase, conversation_id)
        const resposta = await gerarRespostaBot(
          historico,
          promptBotFinal,
          openaiKey,
        )
        if (resposta) {
          await sendMessage(
            baseUrl,
            instanceToken,
            globalToken,
            instanceKey,
            phone,
            resposta,
          )
          await salvarMensagemBot(supabase, conversation_id, resposta)
        }
      }
      return new Response('OK', { status: 200 })
    }

    // ── 9. INICIO ou CONVERSANDO: resposta via IA ─────────────────────────────
    // Pedido explícito e determinístico do lead vem ANTES da IA: não depende
    // de fraseologia nem arrisca a IA conduzir o agendamento ela mesma.
    if (estado === 'CONVERSANDO' && pediuAgendamento(text)) {
      await enviarLinkAgenda({
        supabase,
        baseUrl,
        instanceToken,
        globalToken,
        instanceKey,
        phone,
        contact_name,
        conversation_id,
        conversa,
        cfg,
        bitrixUrl,
      })
      return new Response('OK', { status: 200 })
    }

    if (!openaiKey) {
      const msgSemIA = `Olá! 👋 Recebemos sua mensagem. Em breve nossa equipe entrará em contato.`
      await sendMessage(
        baseUrl,
        instanceToken,
        globalToken,
        instanceKey,
        phone,
        msgSemIA,
      )
      await salvarMensagemBot(supabase, conversation_id, msgSemIA)
      await transicionarEstado(supabase, conversation_id, 'CONVERSANDO')
      return new Response('OK', { status: 200 })
    }

    if (estado === 'INICIO') {
      await transicionarEstado(supabase, conversation_id, 'CONVERSANDO')
    }

    const historico = await buscarHistorico(supabase, conversation_id)

    let resposta = ''
    let iaErro: Error | null = null
    try {
      resposta = await gerarRespostaBot(historico, promptBotFinal, openaiKey)
    } catch (err: any) {
      iaErro = err
    }

    if (!resposta) {
      console.error(
        '[bot-handler] IA FALHOU - respondendo com fallback:',
        iaErro?.message ?? 'resposta vazia',
      )
      const msgFallback = `Olá! 👋 Recebemos sua mensagem e em breve nossa equipe dará seguimento ao seu atendimento. Obrigado! 😊`
      await sendMessage(
        baseUrl,
        instanceToken,
        globalToken,
        instanceKey,
        phone,
        msgFallback,
      )
      await salvarMensagemBot(supabase, conversation_id, msgFallback)
      await supabase
        .from('whatsapp_messages')
        .update({ processado: true })
        .eq('id', message_db_id)
      return new Response('OK', { status: 200 })
    }

    await sendMessage(
      baseUrl,
      instanceToken,
      globalToken,
      instanceKey,
      phone,
      resposta,
    )
    await salvarMensagemBot(supabase, conversation_id, resposta)

    // ── 9b. Sincroniza o estado quando a própria IA oferece agendamento ───────
    // A IA (texto livre, guiada pelo prompt_base) pode oferecer agendamento por
    // conta própria, desacoplada da heurística demonstraInteresse (item 10, que
    // olha a mensagem do LEAD). Sem isto, o lead aceita e cai de novo na IA
    // livre — sem link, sem registro em agenda_disponibilizacoes.
    const sincronizou =
      estado === 'CONVERSANDO' && ofereceuAgendamento(resposta)
    if (sincronizou) {
      await transicionarEstado(supabase, conversation_id, 'OFERTA_AGENDAMENTO')
    }

    // ── 10. Oferecer agendamento após interesse demonstrado ───────────────────
    // Não roda no mesmo turno em que o bloco 9b já sincronizou — evita ofertar
    // duas vezes (a da IA + a hardcoded desta heurística) na mesma resposta.
    if (!sincronizou && historico.length >= 3 && demonstraInteresse(text)) {
      const jaOfertado = historico.some(
        (m) => m.role === 'assistant' && m.content.includes('agendamento'),
      )
      if (!jaOfertado) {
        await new Promise((r) => setTimeout(r, 2000))
        const msgOferta = `\n\nGostaríamos de apresentar nossas soluções em detalhes. Posso agendar uma conversa com nosso time? 📅`
        await sendMessage(
          baseUrl,
          instanceToken,
          globalToken,
          instanceKey,
          phone,
          msgOferta,
        )
        await salvarMensagemBot(supabase, conversation_id, msgOferta)
        await transicionarEstado(
          supabase,
          conversation_id,
          'OFERTA_AGENDAMENTO',
        )
        await updateLeadScore(
          supabase,
          conversation_id,
          2,
          cfg,
          bitrixUrl,
          phone,
          contact_name,
        )

        await supabase
          .from('leads_automacao_pendentes')
          .update({ whatsapp_status: 'respondido' })
          .eq('whatsapp_phone', phone.replace(/\D/g, ''))
          .eq('whatsapp_status', 'enviado')
      }
    }

    await supabase
      .from('whatsapp_messages')
      .update({ processado: true })
      .eq('id', message_db_id)
    return new Response('OK', { status: 200 })
  } catch (err: any) {
    console.error('[bot] erro:', err.message, err.stack)
    return new Response('OK', { status: 200 })
  }
})
