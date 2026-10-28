import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import {
  buildAiPromptLeve,
  fetchAiConfigs,
} from '../_shared/build-ai-prompt.ts'
import { isServiceRoleCall, requireUser } from '../_shared/require-user.ts'

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  // Guard híbrido — achado de auditoria: function não tinha nenhuma
  // checagem de auth. Chamadores internos (feira-fup-gerar, feira-dispatch-fup,
  // feira-dispatch-messages) usam service-role; o frontend usa JWT de usuário.
  if (!isServiceRoleCall(req)) {
    const userResult = await requireUser(req)
    if (!userResult.ok) return userResult.response
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { lead_pendente_id, modo } = await req.json().catch(() => ({}))
    if (!lead_pendente_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_LEAD_PENDENTE_ID' })
    }

    const isFup = modo === 'fup'

    // ── 1. Buscar lead + config ─────────────────────────────────────────────
    const { data: lead, error: leadErr } = await supabase
      .from('leads_automacao_pendentes')
      .select(
        '*, automacao_config:automacao_config_id(template_msg_novo, template_msg_existente, template_fup, contexto_fup_ia)',
      )
      .eq('id', lead_pendente_id)
      .maybeSingle()

    if (leadErr || !lead) {
      return jsonResp(404, { ok: false, error: 'LEAD_NOT_FOUND' })
    }

    const config = (lead as any).automacao_config
    const isNovo = (lead.bitrix_match_tipo || 'novo') === 'novo'

    // ── 2. Escolher template ────────────────────────────────────────────────
    const templateNovo =
      config?.template_msg_novo ||
      'Oi {{nome}}, aqui é a Débora da Zion! {{IA_CONTEXTO}}\nPosso te enviar mais informações?'
    const templateExistente =
      config?.template_msg_existente ||
      'Oi {{nome}}, foi ótimo te ver na feira! Vou alinhar com seu responsável aqui na Zion e te retorno em breve.'
    const templateFup =
      config?.template_fup ||
      'Oi {{nome}}, passando para retomar nosso contato da feira. {{IA_CONTEXTO}}\nFaz sentido conversarmos?'

    const template = isFup
      ? templateFup
      : isNovo
        ? templateNovo
        : templateExistente

    // ── 3. Extrair dados do lead ────────────────────────────────────────────
    const dados: any = lead.dados_completos || {}
    const primeiroNome =
      (dados.nome || lead.razao_social || '').split(' ')[0] || 'você'
    const empresa = dados.empresa || lead.razao_social || ''
    const cargo = dados.cargo || ''
    const observacoes = dados.observacoes || ''
    const matchTipo = lead.bitrix_match_tipo || 'novo'
    const contextoFup = config?.contexto_fup_ia || ''

    // ── 4. Gerar bloco IA para {{IA_CONTEXTO}} ──────────────────────────────
    // FUP gera para qualquer match; inicial mantém o comportamento atual (só novo).
    let iaContexto = ''
    if (template.includes('{{IA_CONTEXTO}}') && (isFup || isNovo)) {
      const openaiRes = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'openai_config')
        .maybeSingle()
      const openaiKey: string =
        (openaiRes.data?.value as any)?.api_key ||
        Deno.env.get('OPENAI_API_KEY') ||
        ''

      if (openaiKey) {
        const aiConfigs = await fetchAiConfigs(supabase)
        const contextoLeve = buildAiPromptLeve(aiConfigs)
        const temTomConfigurado = !!aiConfigs.rules?.tom

        const prompt = isFup
          ? [
              contextoLeve || 'Você é um SDR comercial da Zion.',
              'Esta é uma mensagem de FOLLOW-UP para um contato da feira que recebeu',
              'uma primeira mensagem e NÃO respondeu. Escreva UMA frase curta (max 25 palavras)',
              'que retome o contato de forma leve e cordial, sem cobrança e sem soar insistente.',
              '',
              'Contexto do follow-up (definido pela equipe):',
              contextoFup || '(não informado)',
              '',
              'Dados do contato:',
              `- Empresa: ${empresa}`,
              `- Cargo: ${cargo}`,
              `- Observações da feira: ${observacoes || 'não informadas'}`,
              '',
              'Regras:',
              temTomConfigurado
                ? ''
                : '- Tom: cordial, profissional, não-comercial',
              '- Sem emojis',
              '- Sem markdown',
              '- Apenas a frase, sem prefixos como "Texto:" ou "Resposta:"',
            ]
              .filter(Boolean)
              .join('\n')
          : [
              contextoLeve || 'Você é um SDR comercial da Zion.',
              'Com base no contexto abaixo, escreva UMA frase curta (max 25 palavras)',
              'que continue uma saudação inicial, referenciando especificamente o que',
              'foi conversado na feira.',
              '',
              `Contexto:`,
              `- Tipo de match: ${matchTipo}`,
              `- Empresa: ${empresa}`,
              `- Cargo: ${cargo}`,
              `- Observações da feira: ${observacoes || 'não informadas'}`,
              '',
              'Regras:',
              temTomConfigurado
                ? ''
                : '- Tom: cordial, profissional, não-comercial',
              '- Sem emojis',
              '- Sem markdown',
              '- Apenas a frase, sem prefixos como "Texto:" ou "Resposta:"',
            ]
              .filter(Boolean)
              .join('\n')

        try {
          const res = await fetch(
            'https://api.openai.com/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${openaiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 80,
                temperature: 0.7,
                messages: [{ role: 'user', content: prompt }],
              }),
            },
          )

          if (res.ok) {
            const data = await res.json()
            iaContexto = data.choices?.[0]?.message?.content?.trim() || ''
          }
        } catch (e: any) {
          console.warn(
            '[feira-generate-message] IA falhou, usando fallback:',
            e.message,
          )
        }
      }

      if (!iaContexto) {
        if (isFup) {
          iaContexto = empresa
            ? `vi que ainda não conseguimos conversar sobre ${empresa}.`
            : 'vi que ainda não conseguimos conversar desde a feira.'
        } else {
          iaContexto = empresa
            ? `foi ótimo conversar com você sobre ${empresa} na feira.`
            : 'foi ótimo te conhecer na feira.'
        }
      }
    }

    // ── 5. Resolver placeholders ────────────────────────────────────────────
    let mensagem = template
      .replace(/\{\{nome\}\}/gi, primeiroNome)
      .replace(/\{\{empresa\}\}/gi, empresa)
      .replace(/\{\{IA_CONTEXTO\}\}/gi, iaContexto)
      .trim()

    return jsonResp(200, {
      ok: true,
      modo: isFup ? 'fup' : 'inicial',
      mensagem,
      dados: {
        primeiroNome,
        empresa,
        cargo,
        observacoes,
        matchTipo,
        iaContexto,
      },
    })
  } catch (err: any) {
    console.error('[feira-generate-message] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
