import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Acesso negado: Token ausente' }),
        {
          status: 401,
          headers: corsHeaders,
        },
      )
    }

    const supabaseAuth = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      {
        global: { headers: { Authorization: authHeader } },
      },
    )

    const { data: userData, error: userError } =
      await supabaseAuth.auth.getUser()
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Acesso negado: Usuário inválido' }),
        {
          status: 401,
          headers: corsHeaders,
        },
      )
    }

    const payload = await req.json().catch(() => ({}))
    const { featureName, moduleName, description } = payload

    if (!featureName || !moduleName || !description) {
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios ausentes' }),
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    // Check if the exact feature already exists in the selected module
    const { data: existingDoc } = await supabaseAdmin
      .from('documentation')
      .select('*')
      .eq('feature_name', featureName)
      .eq('module', moduleName)
      .maybeSingle()

    const now = new Date().toISOString()

    if (existingDoc) {
      // Create history record
      await supabaseAdmin.from('documentation_history').insert({
        documentation_id: existingDoc.id,
        old_description: existingDoc.description,
        changed_by: userData.user.id,
        changed_at: now,
      })

      // Update current version
      await supabaseAdmin
        .from('documentation')
        .update({
          description,
          version: existingDoc.version + 1,
          updated_at: now,
        })
        .eq('id', existingDoc.id)
    } else {
      // Insert new documentation
      await supabaseAdmin.from('documentation').insert({
        module: moduleName,
        feature_name: featureName,
        description,
        version: 1,
        updated_at: now,
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
