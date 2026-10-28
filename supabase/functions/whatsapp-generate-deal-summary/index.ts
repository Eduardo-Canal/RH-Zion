import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

interface RequestPayload {
  conversation_id: string
  deal_id: number
  force?: boolean
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  function jsonResp(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: RequestPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResp(400, { error: 'Invalid JSON' })
  }

  const { conversation_id, deal_id, force = false } = payload

  if (!conversation_id || !deal_id) {
    return jsonResp(400, {
      error: 'conversation_id e deal_id são obrigatórios',
    })
  }

  try {
    // ── 1. Verificar cache (se não forçado) ───────────────────────────────────
    if (!force) {
      const { data: cached } = await supabase
        .from('whatsapp_deal_summaries')
        .select('summary, generated_at, tokens_used')
        .eq('conversation_id', conversation_id)
        .eq('deal_id', deal_id)
        .maybeSingle()

      if (cached) {
        return jsonResp(200, {
          summary: cached.summary,
          generated_at: cached.generated_at,
          tokens_used: cached.tokens_used,
          from_cache: true,
        })
      }
    }

    // ── 2. Buscar dados em paralelo ───────────────────────────────────────────
    const [openaiRes, bitrixUrl, messagesRes, convRes] = await Promise.all([
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'openai_config')
        .maybeSingle(),
      getBitrixWebhookUrl(supabase),
      supabase
        .from('whatsapp_messages')
        .select('direcao, conteudo, tipo, criado_em')
        .eq('conversation_id', conversation_id)
        .order('criado_em', { ascending: true })
        .limit(60),
      supabase
        .from('whatsapp_conversations')
        .select('phone, contact_name')
        .eq('id', conversation_id)
        .maybeSingle(),
    ])

    const openaiKey: string =
      (openaiRes.data?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    if (!openaiKey) return jsonResp(400, { error: 'OpenAI não configurada' })

    // ── 3. Buscar deal no Bitrix ──────────────────────────────────────────────
    let dealInfo = ''
    try {
      const dealRes = await fetch(`${bitrixUrl}crm.deal.get.json?id=${deal_id}`)
      const dealData = await dealRes.json()
      const d = dealData?.result
      if (d) {
        const lines = [
          `Título: ${d.TITLE || '—'}`,
          `Estágio: ${d.STAGE_ID || '—'}`,
          `Pipeline (category_id): ${d.CATEGORY_ID ?? '0'}`,
          `Valor: ${d.OPPORTUNITY ? `${d.OPPORTUNITY} ${d.CURRENCY_ID || 'BRL'}` : '—'}`,
          `Data prevista de fechamento: ${d.CLOSEDATE ? String(d.CLOSEDATE).split('T')[0] : '—'}`,
          `Responsável ID: ${d.ASSIGNED_BY_ID || '—'}`,
          `Criado em: ${d.DATE_CREATE ? String(d.DATE_CREATE).split('T')[0] : '—'}`,
          `Modificado em: ${d.DATE_MODIFY ? String(d.DATE_MODIFY).split('T')[0] : '—'}`,
        ]
        if (d.COMMENTS)
          lines.push(`Observações: ${String(d.COMMENTS).slice(0, 300)}`)
        dealInfo = lines.join('\n')
      }
    } catch (e: any) {
      console.warn('[deal-summary] falha ao buscar deal no Bitrix:', e.message)
    }

    // ── 4. Formatar histórico de mensagens ────────────────────────────────────
    const msgs = (messagesRes.data || [])
      .map((m) => {
        const dir = m.direcao === 'recebida' ? 'Cliente' : 'Executivo'
        const ts = m.criado_em
          ? new Date(m.criado_em).toLocaleString('pt-BR')
          : ''
        const texto = m.conteudo?.trim() || `[${m.tipo}]`
        return `[${ts}] ${dir}: ${texto}`
      })
      .join('\n')

    const contactName =
      convRes.data?.contact_name || convRes.data?.phone || 'Contato'

    // ── 5. Chamar OpenAI ──────────────────────────────────────────────────────
    const systemPrompt = [
      'Você é um assistente de CRM para executivos de vendas.',
      'Analise os dados do negócio no Bitrix24 e o histórico de mensagens WhatsApp.',
      'Gere um resumo executivo estruturado, incluindo:',
      '- Estado atual do negócio (estágio, valor, prazo)',
      '- Principais pontos discutidos na conversa',
      '- Compromissos assumidos e próximos passos',
      '- Nível de interesse/engajamento do cliente',
      'Seja conciso (máximo 200 palavras). Use markdown com subtítulos em negrito. Escreva em português.',
    ].join('\n')

    const userContent = [
      `## Negócio #${deal_id} — ${contactName}`,
      '',
      '### Dados do negócio (Bitrix24)',
      dealInfo || '(dados não disponíveis)',
      '',
      '### Histórico da conversa WhatsApp',
      msgs || '(sem mensagens registradas)',
    ].join('\n')

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      throw new Error(`OpenAI ${aiRes.status}: ${errText.slice(0, 200)}`)
    }

    const aiData = await aiRes.json()
    const summary: string = aiData.choices?.[0]?.message?.content?.trim() || ''
    const tokensUsed: number | null = aiData.usage?.total_tokens ?? null

    if (!summary) throw new Error('OpenAI retornou resumo vazio')

    // ── 6. Upsert no cache ────────────────────────────────────────────────────
    const { data: upserted, error: upsertError } = await supabase
      .from('whatsapp_deal_summaries')
      .upsert(
        {
          conversation_id,
          deal_id,
          summary,
          model: 'gpt-4o-mini',
          tokens_used: tokensUsed,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'conversation_id,deal_id' },
      )
      .select('generated_at')
      .single()

    if (upsertError) throw new Error(`Upsert falhou: ${upsertError.message}`)

    return jsonResp(200, {
      summary,
      generated_at: upserted.generated_at,
      tokens_used: tokensUsed,
      from_cache: false,
    })
  } catch (err: any) {
    console.error('[deal-summary] erro:', err.message)
    return jsonResp(500, { error: err.message })
  }
})
