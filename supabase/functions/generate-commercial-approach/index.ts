import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { buildAiPrompt, fetchAiConfigs } from '../_shared/build-ai-prompt.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => ({}))
    const { lead_id, cnae, porte_empresa, dores_principais } = payload

    if (!lead_id) {
      return new Response(
        JSON.stringify({ error: 'O parâmetro lead_id é obrigatório.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ─── Buscar API Key ────────────────────────────────────
    const { data: configData } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'openai_config')
      .maybeSingle()

    let apiKey = Deno.env.get('OPENAI_API_KEY')
    if (configData?.value && (configData.value as any).api_key) {
      apiKey = (configData.value as any).api_key
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'Chave da OpenAI não configurada no sistema.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ─── Montar System Prompt (contexto estruturado) ───────
    const aiConfigs = await fetchAiConfigs(supabaseAdmin)
    let systemPrompt = buildAiPrompt(aiConfigs)

    // Fallback: se nenhuma configuração nova existe, usar o campo antigo
    if (!systemPrompt.trim()) {
      const { data: legacyContext } = await supabaseAdmin
        .from('configuracoes_sistema')
        .select('contexto_empresa_ia')
        .eq('id', 1)
        .maybeSingle()

      systemPrompt =
        legacyContext?.contexto_empresa_ia ||
        'Atue como um especialista em vendas B2B.'
    }

    // ─── User Prompt (dados do lead) ───────────────────────
    const userPrompt = `PERFIL DO LEAD:
CNAE / Setor: ${cnae || 'Não informado'}
Porte da Empresa: ${porte_empresa || 'Não informado'}
Dores Principais: ${dores_principais ? (typeof dores_principais === 'string' ? dores_principais : JSON.stringify(dores_principais)) : 'Não informado'}

Retorne EXATAMENTE um objeto JSON com as seguintes chaves:
- "abordagem_gerada": (string) Um texto persuasivo para email focado nas dores específicas do lead, conectando com as funcionalidades e benefícios do nosso produto.
- "personas_decisoras": (array de strings) 2 a 3 cargos na empresa que costumam decidir este tipo de compra.
- "argumentos_venda": (array de strings) 3 a 5 argumentos fortes conectando as dores do lead com benefícios específicos do nosso produto.
- "proximos_passos": (array de strings) 2 a 3 ações recomendadas para o vendedor executar na sequência.
- "canais_recomendados": (array de strings) Canais ideais para abordagem: email, whatsapp, linkedin, ligacao.`

    // ─── Chamar OpenAI ─────────────────────────────────────
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 1500,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        `Erro na API OpenAI: ${errorData.error?.message || response.statusText}`,
      )
    }

    const aiData = await response.json()
    const contentStr = aiData.choices?.[0]?.message?.content || '{}'

    let generated
    try {
      generated = JSON.parse(contentStr)
    } catch (_e) {
      throw new Error('A resposta da OpenAI não retornou um JSON válido.')
    }

    // ─── Salvar no banco ───────────────────────────────────
    const { error: insertError } = await supabaseAdmin
      .from('lead_abordagens_comerciais')
      .insert({
        lead_id,
        cnae: cnae || null,
        porte_empresa: porte_empresa || null,
        dores_principais: dores_principais || null,
        abordagem_gerada: generated.abordagem_gerada || null,
        personas_decisoras: generated.personas_decisoras || [],
        argumentos_venda: generated.argumentos_venda || [],
        proximos_passos: generated.proximos_passos || [],
        canais_recomendados: generated.canais_recomendados || [],
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })

    if (insertError) {
      throw new Error(
        `Erro ao salvar abordagem no banco: ${insertError.message}`,
      )
    }

    return new Response(JSON.stringify({ success: true, result: generated }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('generate-commercial-approach error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
