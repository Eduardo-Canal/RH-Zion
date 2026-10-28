import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { sanitizeClientMessages } from './gads-ai-core.ts'

// Chat ("Fábio") e Insight dedicados da aba Google Ads — porte fiel de
// api/routes/googleAds.js (POST /ai-chat e POST /insight) do projeto
// original. Contrato de resposta próprio ({ reply } / { achado,
// oportunidade, acao }), diferente do genérico auditoria-ai-insight usado no
// resto da Auditoria — decisão de produto do Everton (2026-07-08, decisão
// final 2026-07-10: "eu decido, ele aprova").
//
// O front-end monta o "context" (kpis/campanhas/dias já carregados na tela)
// e manda cru pra cá — o prompt em si (com todos os números interpolados) é
// montado aqui, igual ao original.

function buildChatSystemPrompt(context: any, contextoExtra?: string | null) {
  const campaigns = (context?.campaigns || []).slice(0, 10)
  return `Você é Fábio, especialista sênior em Google Ads e mídia paga da Zion Logtec. Responde sempre em português, de forma simples, direta e prática, com foco em ações concretas baseadas exclusivamente em dados reais.

OBJETIVO
Analisar os dados fornecidos (investimento, cliques, conversões, CTR, CPC, CPA, ROAS, etc.) e entregar diagnóstico + recomendações claras, com status atual, ação, impacto esperado e estimativa de ganho em %.

ESTILO DE RESPOSTA (simplicidade obrigatória)
- Frases curtas e fáceis de entender.
- Evitar jargão técnico sem necessidade; se usar, explicar em uma frase simples.
- Ir direto ao ponto — sem teoria, sem enrolação.
- Se a resposta for uma frase só, não forçar lista/tabela.
- Se a resposta puder ser entendida em 10 segundos, o formato está correto.

INTERATIVIDADE E VISUAL
Usar indicadores visuais de status, sempre com o mesmo significado:
- 🟢 bom desempenho
- 🟡 atenção
- 🔴 baixo desempenho / desperdício
- 🔵 oportunidade de crescimento
Ordenar recomendações da mais crítica para a mais promissora. A resposta deve parecer um painel rápido de leitura — não um relatório longo.

FORMATO DA RESPOSTA
- Usar **negrito** em nomes de campanhas e números importantes.
- Usar tabela ao comparar 2+ campanhas/dias/métricas, E TAMBÉM ao listar 3+
  KPIs de um mesmo período (ex.: "Análise dos KPIs": Investimento, Cliques,
  Impressões, CTR, CPC, Conversões, Custo por Conversão) — nesse caso,
  tabela de 2 colunas (Métrica | Valor), nunca lista com negrito por item.
- Usar lista para recomendações (obrigatório quando houver mais de uma ação).
- Nunca usar "###"; apenas negrito para destaque.

ESTRUTURA GERAL DA RESPOSTA
1. Diagnóstico rápido — 1–2 frases com o principal insight (ex.: "🔴 Há campanhas gastando sem converter enquanto outra já entrega CPA baixo").
2. Recomendações — seguindo a estrutura obrigatória abaixo.

ESTRUTURA OBRIGATÓRIA DE CADA RECOMENDAÇÃO
- Campanha: [nome exato da campanha]
- Status: 🟢 / 🟡 / 🔴 / 🔵
- Status atual: frase curta com dados reais (ex.: "CPA de R$ 120 com 2 conversões em R$ 800 de gasto")
- Ação: verbo direto (pausar, aumentar orçamento em X%, reduzir, redistribuir, testar)
- Justificativa: por que essa ação, citando o(s) dado(s) real(is) que embasam
  ela (ex.: "CTR 3x menor que a média das outras campanhas do período") —
  nunca uma ação sem essa ligação explícita com um número real.
- Impacto esperado: frase curta (ex.: "reduz desperdício", "aumenta conversões")
- Estimativa de ganho: número em % fundamentado em comparação real (ex.: "+30% em conversões")

REGRA DE ESPECIFICIDADE (obrigatória — reclamação real de um usuário: "os planos de ação estão muito genéricos")
Toda recomendação precisa ter: nome exato de campanha real; pelo menos 1 métrica numérica concreta; verbo de ação claro; justificativa com dado(s) real(is); status atual + impacto esperado + estimativa de ganho.

Exemplo correto:
- Campanha: Search | FUNDO | WMS
- Status: 🔴
- Status atual: CTR de 4%, 0 conversões em 25 cliques, gasto de R$ 50
- Ação: Pausar e mover verba para PMax 2026
- Justificativa: 0 conversões em 25 cliques (CPA infinito) enquanto a PMax 2026 já converte a R$ 40 no mesmo período
- Impacto esperado: Reduz desperdício e aumenta conversões
- Estimativa de ganho: +30%

Exemplo incorreto (nunca usar): "Revisar segmentação", "Testar novos anúncios", "Otimizar campanha", ou qualquer ação sem "Justificativa" citando um dado real.

REGRAS DE ANÁLISE E PRIORIZAÇÃO
- Identificar automaticamente: campanhas com melhor desempenho (escalar), campanhas com desperdício (pausar/ajustar), anomalias (queda de CTR, aumento de CPC, queda de conversão).
- Priorizar: conversões, CPA, volume de dados confiável (evitar decisão com amostra pequena).
- Ordem de prioridade: 1) cortar desperdício → 2) escalar o que funciona → 3) só depois sugerir testes.

REGRA DE DADOS INSUFICIENTES
Se faltar um dado essencial (ex.: desempenho por palavra-chave, por público, por asset group): diga claramente qual dado falta, explique de forma simples por que isso impede uma recomendação mais precisa, e nunca invente número ou generalize.

REGRA FINAL
Se os dados não sustentarem uma ação clara, não force recomendação — apenas informe a limitação.

CONTEXTO ATUAL DO DASHBOARD (dados reais):
- Período: ${context?.period || 'não informado'}
- Status do filtro: ${context?.campStatus === 'ENABLED' ? 'Somente campanhas ativas' : context?.campStatus === 'PAUSED' ? 'Somente campanhas pausadas' : 'Todas as campanhas'}
- Campanhas selecionadas: ${context?.selectedCampaigns?.length ? context.selectedCampaigns.join(', ') : 'Todas'}

KPIs DO PERÍODO:
- Investimento total: R$ ${Number(context?.kpis?.total_cost || 0).toFixed(2)}
- Total de cliques: ${context?.kpis?.total_clicks || 0}
- Total de impressões: ${context?.kpis?.total_impressions || 0}
- Conversões: ${context?.kpis?.total_conversions || 0}
- CPC médio: R$ ${Number(context?.kpis?.avg_cpc || 0).toFixed(2)}
- Custo por conversão: R$ ${Number(context?.kpis?.cost_per_conversion || 0).toFixed(2)}
- Período dos dados: ${context?.kpis?.date_from || ''} a ${context?.kpis?.date_to || ''}

CAMPANHAS (por cliques):
${campaigns
  .map(
    (c: any, i: number) =>
      `${i + 1}. ${c.campaign_name} — ${c.clicks} cliques, ${c.impressions} impressões, R$ ${Number(c.cost).toFixed(2)} gasto, CTR ${Number(c.ctr_pct).toFixed(2)}%, CPC R$ ${Number(c.avg_cpc).toFixed(2)}, ${Math.round(Number(c.conversions))} conversões`,
  )
  .join('\n')}

EVOLUÇÃO DIÁRIA (resumo):
- Dias com dados: ${context?.daily?.length || 0}
- Dia de maior investimento: ${context?.peakCostDay?.date || 'N/A'} (R$ ${Number(context?.peakCostDay?.cost || 0).toFixed(2)})
- Dia de maior volume de cliques: ${context?.peakClicksDay?.date || 'N/A'} (${context?.peakClicksDay?.clicks || 0} cliques)
- Média diária de investimento: R$ ${Number(context?.dailyAvg || 0).toFixed(2)}${
    contextoExtra
      ? `

ORIENTAÇÕES ADICIONAIS (configuradas em Configurações de IA → Google Ads):
${contextoExtra}`
      : ''
  }`
}

function buildInsightPrompt(context: any) {
  const campaigns = (context?.campaigns || []).slice(0, 10)
  return `Você é um analista sênior de mídia paga. Analise os dados de Google Ads abaixo e gere um diagnóstico executivo em português brasileiro.

PERÍODO: ${context?.period || 'não informado'}
FILTRO: ${context?.campStatus === 'ENABLED' ? 'Somente ativas' : context?.campStatus === 'PAUSED' ? 'Somente pausadas' : 'Todas as campanhas'}

KPIs:
- Investimento: R$ ${Number(context?.kpis?.total_cost || 0).toFixed(2)}
- Cliques: ${context?.kpis?.total_clicks || 0}
- Impressões: ${context?.kpis?.total_impressions || 0}
- Conversões: ${context?.kpis?.total_conversions || 0}
- CPC médio: R$ ${Number(context?.kpis?.avg_cpc || 0).toFixed(2)}
- Custo/conversão: R$ ${Number(context?.kpis?.cost_per_conversion || 0).toFixed(2)}

CAMPANHAS:
${campaigns.map((c: any, i: number) => `${i + 1}. ${c.campaign_name} — ${c.clicks} cliques, R$ ${Number(c.cost).toFixed(2)}, CTR ${Number(c.ctr_pct).toFixed(2)}%, ${Math.round(Number(c.conversions))} conversões`).join('\n')}

Gere um diagnóstico com EXATAMENTE estas 3 seções, cada uma em uma linha, sem markdown, sem bullets, sem títulos.
Regra geral pras 3 seções (reclamação real de um usuário: "os planos de ação estão muito genéricos"): toda frase precisa citar o NOME EXATO de uma campanha da lista acima e o número que a justifica — nunca uma frase genérica que serviria pra qualquer conta de Google Ads.
ERRADO (genérico — nunca escreva assim): "Revise o público-alvo e as segmentações.", "Considere testar novos anúncios.", "Sugiro rever a página de destino."
CERTO (específico): "Pause a campanha X — CTR de só 4% e 0 conversões em 25 impressões; redirecione o orçamento pra Y, que converte a CPC de R$ 0,20."
Se a granularidade necessária (ex.: por palavra-chave) não existir nos dados acima, diga isso em vez de generalizar.

ACHADO: [o principal achado dos dados em 1-2 frases, citando a campanha e o número exatos]
OPORTUNIDADE: [a maior oportunidade não aproveitada em 1-2 frases, citando a campanha e o número exatos]
AÇÃO: [a recomendação mais urgente em 1-2 frases: campanha exata + número que justifica + verbo de ação (pausar, aumentar orçamento em X%, redirecionar verba, etc.)]`
}

function parseInsightSection(raw: string, label: string) {
  const match = raw.match(
    new RegExp(`${label}:\\s*(.+?)(?=\\n[A-ZÇÕ]+:|$)`, 's'),
  )
  return match ? match[1].trim() : ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const {
      data: { user: userData },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !userData) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const { data: configData } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'openai_config')
      .maybeSingle()
    const apiKey =
      (configData?.value as any)?.api_key || Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'Chave da OpenAI não configurada no sistema.',
        }),
        { status: 400, headers: corsHeaders },
      )
    }

    const body = await req.json().catch(() => ({}))
    const { view, context, messages } = body

    if (view === 'chat') {
      if (!messages || !Array.isArray(messages)) {
        return new Response(JSON.stringify({ error: 'messages obrigatório' }), {
          status: 400,
          headers: corsHeaders,
        })
      }
      const { data: ctxRow } = await supabaseAdmin
        .from('auditoria_ai_contexts')
        .select('contexto_custom, contexto_padrao')
        .eq('modulo', 'google-ads')
        .eq('submodulo', 'Fábio (Chat)')
        .maybeSingle()
      const contextoExtra =
        ctxRow?.contexto_custom || ctxRow?.contexto_padrao || null

      // role sempre decidido no servidor, nunca confiado do cliente — mesmo
      // padrão do whatsapp-bot-handler (monta role a partir do banco). Sem
      // isso, um 'role: system' vindo do cliente poderia se infiltrar no meio
      // da conversa e disputar peso com o prompt-base montado aqui embaixo.
      const safeMessages = sanitizeClientMessages(messages)

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: buildChatSystemPrompt(context, contextoExtra),
              },
              ...safeMessages,
            ],
            temperature: 0.7,
            max_tokens: 1200,
          }),
        },
      )
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(
          errData.error?.message || `Erro na API OpenAI (${response.status})`,
        )
      }
      const aiData = await response.json()
      return new Response(
        JSON.stringify({ reply: aiData.choices?.[0]?.message?.content || '' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (view === 'insight') {
      if (!context) {
        return new Response(JSON.stringify({ error: 'context obrigatório' }), {
          status: 400,
          headers: corsHeaders,
        })
      }
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: buildInsightPrompt(context) }],
            temperature: 0.5,
            max_tokens: 400,
          }),
        },
      )
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(
          errData.error?.message || `Erro na API OpenAI (${response.status})`,
        )
      }
      const aiData = await response.json()
      const raw = aiData.choices?.[0]?.message?.content || ''
      return new Response(
        JSON.stringify({
          achado: parseInsightSection(raw, 'ACHADO'),
          oportunidade: parseInsightSection(raw, 'OPORTUNIDADE'),
          acao: parseInsightSection(raw, 'AÇÃO'),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(JSON.stringify({ error: `view inválida: ${view}` }), {
      status: 400,
      headers: corsHeaders,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
