import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { buildAiPrompt, fetchAiConfigs } from '../_shared/build-ai-prompt.ts'
import { checkPhoneExclusion } from '../_shared/bitrix-exclusion.ts'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RoutePayload {
  instance_id: string
  conversation_id: string
  message_db_id: string
  message: any
  phone: string
  contact_name: string
  text: string
  msg_type: string
  quoted_message_id: string | null
  is_reanalysis?: boolean
}

// ─── Buscar entidade Bitrix pelo telefone ─────────────────────────────────────

async function findBitrixEntityByPhone(
  bitrixUrl: string,
  phone: string,
): Promise<{ id: string; tipo: 'lead' | 'contact' | null }> {
  const digits = phone.replace(/\D/g, '')
  const phoneVariants = [
    digits,
    digits.startsWith('55') ? digits.slice(2) : `55${digits}`,
  ]

  for (const variant of phoneVariants) {
    try {
      // Uma única request retorna LEAD e CONTACT no mesmo resultado
      const res = await fetch(
        `${bitrixUrl}crm.duplicate.findByComm.json?type=PHONE&values[]=${encodeURIComponent(variant)}`,
      )
      const data = await res.json()
      const leads: number[] = data?.result?.LEAD || []
      if (leads.length > 0) return { id: String(leads[0]), tipo: 'lead' }
      const contacts: number[] = data?.result?.CONTACT || []
      if (contacts.length > 0)
        return { id: String(contacts[0]), tipo: 'contact' }
    } catch {
      // ignora erros de busca
    }
  }

  return { id: '', tipo: null }
}

// ─── Gerar sugestões de co-piloto via GPT-4o (contextualizado R11) ───────────

interface CopilotoConfig {
  modelo: string
  temperature: number
  max_tokens: number
  instrucoes_adicionais: string
  objecoes_a_quebrar: Array<{ objecao: string; estrategia: string }>
}

interface SugestaoEstruturada {
  tom_cliente: string
  sinais_detectados: string[]
  sugestoes: Array<{ estrategia: string; texto: string }>
}

const DEFAULT_COPILOTO_CONFIG: CopilotoConfig = {
  modelo: 'gpt-4o',
  temperature: 0.7,
  max_tokens: 800,
  instrucoes_adicionais:
    'Foque em qualificar o lead, identificar dores reais e ancorar valor antes de preço.',
  objecoes_a_quebrar: [],
}

async function gerarSugestoesCoPiloto(
  supabase: ReturnType<typeof createClient>,
  historico: Array<{ role: string; content: string }>,
  mensagemAtual: string,
  nomeContato: string,
  openaiKey: string,
): Promise<SugestaoEstruturada | null> {
  // ── 1. Buscar configs IA do banco em paralelo ─────────────────────────────
  const [aiConfigs, copilotoRes] = await Promise.all([
    fetchAiConfigs(supabase),
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'ai_copiloto_config')
      .maybeSingle(),
  ])

  const copilotoConfig: CopilotoConfig = {
    ...DEFAULT_COPILOTO_CONFIG,
    ...((copilotoRes.data?.value as Partial<CopilotoConfig>) || {}),
  }

  // ── 2. Montar system prompt rico ───────────────────────────────────────────
  const promptIdentidade = buildAiPrompt(aiConfigs)

  const promptObjecoes = copilotoConfig.objecoes_a_quebrar?.length
    ? '\n\nOBJEÇÕES COMUNS E ESTRATÉGIAS:\n' +
      copilotoConfig.objecoes_a_quebrar
        .map((o) => `- "${o.objecao}" → ${o.estrategia}`)
        .join('\n')
    : ''

  const promptCopiloto = `

VOCÊ ESTÁ ATUANDO COMO CO-PILOTO DE UM EXECUTIVO DE VENDAS

Seu papel: analisar a conversa de WhatsApp em andamento e sugerir 3 respostas variadas que o executivo pode enviar ao cliente. Você NÃO envia as mensagens — apenas sugere.

${copilotoConfig.instrucoes_adicionais}
${promptObjecoes}

TAREFA EM 2 ETAPAS:

ETAPA 1 — Análise do tom/humor do cliente:
Classifique em uma única palavra: interessado | hesitante | cetico | frustrado | decidido | confuso | indiferente | urgente
Liste 1-3 sinais textuais que justificam essa classificação.

ETAPA 2 — 3 sugestões de resposta:
Cada sugestão deve ter uma ESTRATÉGIA explícita (ex: "Ancorar valor", "Quebrar objeção de preço", "Fazer pergunta consultiva", "Marcar reunião", "Pedir esclarecimento").
Texto da sugestão: máximo 2 linhas, profissional mas natural, sem floreios.

FORMATO DE SAÍDA (JSON estrito, sem markdown, sem explicação):
{
  "tom_cliente": "<palavra>",
  "sinais_detectados": ["<sinal1>", "<sinal2>"],
  "sugestoes": [
    { "estrategia": "<nome curto>", "texto": "<resposta sugerida>" },
    { "estrategia": "<nome curto>", "texto": "<resposta sugerida>" },
    { "estrategia": "<nome curto>", "texto": "<resposta sugerida>" }
  ]
}

Contexto: você está sugerindo respostas para uma conversa com ${nomeContato}.`

  const systemPrompt = promptIdentidade + promptCopiloto

  // ── 3. Chamar OpenAI ──────────────────────────────────────────────────────
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: copilotoConfig.modelo,
      max_tokens: copilotoConfig.max_tokens,
      temperature: copilotoConfig.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historico.slice(-10),
        {
          role: 'user',
          content: `ÚLTIMA MENSAGEM DO CLIENTE: "${mensagemAtual}"\n\nAnalise e responda no formato JSON especificado.`,
        },
      ],
    }),
  })

  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content?.trim() || '{}'

  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/```$/, '')
      .trim()
    const parsed = JSON.parse(cleaned) as SugestaoEstruturada
    if (!parsed.tom_cliente || !Array.isArray(parsed.sugestoes)) return null
    return parsed
  } catch {
    return null
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })

  // Guard de chamada interna — achado de auditoria de 22/07/2026: esta
  // function não tinha nenhuma checagem de auth e, se chamada anonimamente,
  // consumia OpenAI e escrevia em whatsapp_ai_suggestions/Bitrix. Único
  // chamador real é o whatsapp-webhook-router (2 pontos) e o cron
  // whatsapp-retry-unprocessed (edge function → edge function) — só aceita
  // Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) {
    console.error(
      '[executive] SUPABASE_SERVICE_ROLE_KEY não configurado — recusando execução.',
    )
    return new Response('Configuração interna ausente', { status: 500 })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) {
    return new Response('Token ausente', { status: 401 })
  }

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    console.error('[executive] Authorization inválido — chamada recusada.')
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
    message_db_id,
    phone,
    contact_name,
    text,
    msg_type,
  } = payload

  const isReanalysis = payload.is_reanalysis === true
  if (isReanalysis) {
    console.log(
      `[executive-handler] REANÁLISE de mensagem editada pelo cliente: ${message_db_id}`,
    )
  }

  console.log(
    '[executive] payload recebido: phone=' +
      phone +
      ' text="' +
      (text || '').slice(0, 40) +
      '" msg_type=' +
      msg_type,
  )
  if (!phone || !msg_type) {
    console.warn('[executive] payload incompleto, abortando')
    return new Response('OK', { status: 200 })
  }
  // Mensagens de mídia (áudio, imagem, etc.) têm text vazio — permitir
  if (msg_type === 'texto' && !text?.trim()) {
    console.warn('[executive] mensagem de texto vazia, abortando')
    return new Response('OK', { status: 200 })
  }

  try {
    // ── 1. Carregar dados da instância executiva ───────────────────────────────
    const [instanceRes, moduleConfigRes, openaiRes, bitrixUrl] =
      await Promise.all([
        supabase
          .from('whatsapp_instances')
          .select('instance_key, bitrix_user_id, bitrix_user_nome')
          .eq('id', instance_id)
          .maybeSingle(),
        supabase
          .from('whatsapp_module_config')
          .select('uazapi_base_url, uazapi_global_token')
          .eq('id', 1)
          .maybeSingle(),
        supabase
          .from('settings')
          .select('value')
          .eq('key', 'openai_config')
          .maybeSingle(),
        getBitrixWebhookUrl(supabase),
      ])

    const executivo = instanceRes.data
    const openaiKey: string =
      (openaiRes.data?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''

    // ── 2. Buscar entidade Bitrix pelo telefone do contato ─────────────────────
    let bitrixEntityId = ''
    let bitrixEntityType: 'lead' | 'contact' | null = null
    let entityTypeId = 1 // 1=lead, 3=contact

    // Verificar se a conversa já tem entidade vinculada
    const { data: convData } = await supabase
      .from('whatsapp_conversations')
      .select('bitrix_entity_id, bitrix_entity_type')
      .eq('id', conversation_id)
      .maybeSingle()

    if (convData?.bitrix_entity_id) {
      bitrixEntityId = convData.bitrix_entity_id
      bitrixEntityType = (convData.bitrix_entity_type as any) || 'lead'
      entityTypeId = bitrixEntityType === 'contact' ? 3 : 1
    } else if (bitrixUrl) {
      // ── Telefone excluído do fluxo Bitrix (N-20) ────────────────────────
      // Assimetria de erro declarada: se a consulta de exclusão falhar
      // (rede/DB), o auto-vínculo ABORTA (fail-closed) — diferente de
      // add-message-to-batch/webhook-router. Aqui o efeito colateral é criar
      // um vínculo permanente (bitrix_entity_id gravado na conversa) que não
      // se desfaz sozinho reprocessando a mensagem depois; melhor não
      // vincular agora e tentar de novo na próxima mensagem do que vincular
      // errado por causa de uma falha transitória de consulta.
      const exclusion = await checkPhoneExclusion(supabase, phone)
      if (exclusion.status === 'error') {
        console.warn(
          '[executive] checagem de exclusão falhou, abortando auto-vínculo (fail-closed):',
          exclusion.message,
        )
      } else if (exclusion.status === 'not_excluded') {
        const found = await findBitrixEntityByPhone(bitrixUrl, phone)
        if (found.id) {
          bitrixEntityId = found.id
          bitrixEntityType = found.tipo
          entityTypeId = found.tipo === 'contact' ? 3 : 1

          // Vincular à conversa para não buscar novamente
          await supabase
            .from('whatsapp_conversations')
            .update({
              bitrix_entity_id: found.id,
              bitrix_entity_type: found.tipo || 'lead',
            })
            .eq('id', conversation_id)
        }
      }
      // exclusion.status === 'excluded' → não busca nem vincula, segue sem entidade
    }

    // ── 3. Post no Bitrix: removido em R12-B (responsabilidade do batch) ─────────
    // O webhook-router chama add-message-to-batch que acumula e dispara flush.

    // ── 4. Marcar mensagem como processada ────────────────────────────────────
    await supabase
      .from('whatsapp_messages')
      .update({ processado: true })
      .eq('id', message_db_id)

    // ── 5. Gerar sugestões de co-piloto (apenas para mensagens de texto) ───────
    if (msg_type !== 'texto' || !text.trim() || !openaiKey) {
      return new Response('OK', { status: 200 })
    }

    // ── 5.1 Geração de sugestões IA em BACKGROUND ────────────────────────────
    // A chamada OpenAI leva 3-6s. Se aguardar aqui, o Deno isolate é morto por
    // wall clock timeout antes do INSERT. Usa EdgeRuntime.waitUntil pra rodar
    // após retornar 200 — o isolate fica vivo até a Promise terminar.

    const backgroundTask = (async () => {
      try {
        // Buscar histórico recente da conversa (inclui mídia como placeholder)
        const { data: historico } = await supabase
          .from('whatsapp_messages')
          .select(
            'direcao, conteudo, tipo, caption, media_ai_description, media_transcription',
          )
          .eq('conversation_id', conversation_id)
          .order('criado_em', { ascending: false })
          .limit(10)

        const labelMidia: Record<string, string> = {
          imagem: '[Cliente enviou uma imagem]',
          audio: '[Cliente enviou um áudio]',
          documento: '[Cliente enviou um documento PDF]',
          video: '[Cliente enviou um vídeo]',
          sticker: '[Cliente enviou um sticker]',
        }

        const msgs = (historico || [])
          .reverse()
          .map((m) => {
            const tipo = m.tipo as string
            const direcao = m.direcao as 'recebida' | 'enviada'

            if (tipo === 'texto' && m.conteudo) {
              return {
                role: direcao === 'recebida' ? 'user' : 'assistant',
                content: m.conteudo as string,
              }
            }

            if (direcao === 'recebida' && labelMidia[tipo]) {
              const aiDesc = (m.media_ai_description as string | null)?.trim()
              const transcricao = (
                m.media_transcription as string | null
              )?.trim()
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

            if (direcao === 'enviada' && labelMidia[tipo]) {
              return {
                role: 'assistant' as const,
                content: `[Enviei ${tipo === 'imagem' ? 'uma imagem' : tipo === 'documento' ? 'um documento' : `um ${tipo}`}]`,
              }
            }

            return null
          })
          .filter(
            (x): x is { role: 'user' | 'assistant'; content: string } =>
              x !== null,
          )

        const resultado = await gerarSugestoesCoPiloto(
          supabase,
          msgs,
          text,
          contact_name,
          openaiKey,
        ).catch((e) => {
          console.warn('[executive] falha ao gerar sugestões:', e.message)
          return null
        })

        if (resultado && resultado.sugestoes?.length > 0) {
          const { data: msgRow } = await supabase
            .from('whatsapp_messages')
            .select('id')
            .eq('id', message_db_id)
            .maybeSingle()

          await supabase.from('whatsapp_ai_suggestions').insert({
            conversation_id: conversation_id,
            message_id: msgRow?.id || null,
            sugestoes: resultado,
            contexto: text.slice(0, 200),
          })

          console.log(
            `[executive] sugestões geradas para ${phone} (tom: ${resultado.tom_cliente})`,
          )
        } else {
          console.warn(
            `[executive] OpenAI retornou estrutura inválida para ${phone}`,
          )
        }
      } catch (bgErr: any) {
        console.error('[executive] background task erro:', bgErr.message)
      }
    })()

    // EdgeRuntime.waitUntil garante que a Promise continua rodando após o
    // retorno HTTP, sem ser cortada pelo isolate timeout normal.
    // @ts-ignore - EdgeRuntime é global do supabase-edge-runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask)
    } else {
      // Fallback: ambiente sem EdgeRuntime (ex: testes locais sem Supabase)
      backgroundTask.catch((e) =>
        console.error('[executive] bg sem waitUntil:', e?.message),
      )
    }

    return new Response('OK', { status: 200 })
  } catch (err: any) {
    console.error('[executive] erro:', err.message)
    return new Response('OK', { status: 200 })
  }
})
