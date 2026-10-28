import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const bodyKey: string = (body.apiKey || '').trim()

    let keyToTest = bodyKey
    let keySource: 'body' | 'system' = 'body'

    if (!keyToTest) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'openai_config')
        .maybeSingle()

      keyToTest =
        (data?.value as any)?.api_key || Deno.env.get('OPENAI_API_KEY') || ''
      keySource = 'system'
    }

    if (!keyToTest) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Nenhuma chave configurada no sistema.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${keyToTest}` },
    })

    if (response.ok) {
      const message =
        keySource === 'system'
          ? 'A chave salva no sistema está funcionando.'
          : 'A chave informada funciona (lembre-se de salvá-la).'
      return new Response(JSON.stringify({ success: true, message }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else {
      const errorData = await response.json()
      return new Response(
        JSON.stringify({
          success: false,
          error: errorData.error?.message || 'Chave de API inválida.',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
