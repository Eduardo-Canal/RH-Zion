import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { buildAiPrompt, fetchAiConfigs } from '../_shared/build-ai-prompt.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const {
      apiKey: payloadApiKey,
      cnae,
      porte,
      dores,
      useStructuredContext,
    } = payload

    // ─── Resolver API Key ──────────────────────────────────
    let apiKey = payloadApiKey

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    if (!apiKey) {
      // Tentar buscar da tabela settings
      const { data: configData } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'openai_config')
        .maybeSingle()

      if (configData?.value && (configData.value as any).api_key) {
        apiKey = (configData.value as any).api_key
      } else {
        apiKey = Deno.env.get('OPENAI_API_KEY')
      }
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'API Key não fornecida.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ─── Montar System Prompt ──────────────────────────────
    let systemPrompt = ''

    if (useStructuredContext) {
      const aiConfigs = await fetchAiConfigs(supabaseAdmin)
      systemPrompt = buildAiPrompt(aiConfigs)
    }

    // Fallback para prompt genérico
    if (!systemPrompt.trim()) {
      const { data: legacyContext } = await supabaseAdmin
        .from('configuracoes_sistema')
        .select('contexto_empresa_ia')
        .eq('id', 1)
        .maybeSingle()

      systemPrompt =
        legacyContext?.contexto_empresa_ia ||
        'Atue como um especialista em vendas B2B altamente qualificado.'
    }

    // ─── User Prompt ───────────────────────────────────────
    const userPrompt = `Crie uma abordagem curta e persuasiva (estilo cold mail ou mensagem de LinkedIn) para iniciar uma conversa com uma empresa que possui o seguinte perfil:

- CNAE / Setor de Atuação: ${cnae || 'Não especificado'}
- Porte da Empresa: ${porte || 'Não especificado'}
- Principais dores/desafios enfrentados: ${dores || 'Não especificado'}

A abordagem deve:
1. Ser direta, profissional e não parecer automatizada.
2. Focar em como nossas soluções podem resolver as dores mencionadas.
3. Conter uma chamada para ação (CTA) clara e convidativa no final, sem ser agressiva.
4. Ser dividida em pequenos parágrafos para facilitar a leitura.`

    // ─── Chamar OpenAI ─────────────────────────────────────
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.7,
      }),
    })

    if (response.ok) {
      const data = await response.json()
      const generatedText =
        data.choices && data.choices.length > 0
          ? data.choices[0].message.content
          : 'Nenhuma resposta gerada.'

      return new Response(
        JSON.stringify({ success: true, result: generatedText }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    } else {
      const errorData = await response.json().catch(() => ({}))
      return new Response(
        JSON.stringify({
          success: false,
          error:
            errorData.error?.message ||
            'Erro ao comunicar com a API da OpenAI.',
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro interno no servidor.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
