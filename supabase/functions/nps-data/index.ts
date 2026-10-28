import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador das telas NPS Gestão / NPS Radar (módulo Auditoria):
// view 'responses', 'configs', 'apoio-list', 'apoio-create' ou 'apoio-delete'.
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

    const payload = await req.json().catch(() => ({}))
    const { view } = payload

    if (view === 'configs') {
      const { data, error } = await supabaseAdmin.rpc('auditoria_nps_configs')
      if (error) throw error
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (view === 'responses') {
      const { sheetConfig, dateFrom, dateTo, client } = payload
      if (!sheetConfig) {
        return new Response(
          JSON.stringify({ error: 'sheetConfig obrigatório.' }),
          {
            status: 400,
            headers: corsHeaders,
          },
        )
      }

      let query = supabaseAdmin
        .from('nps_responses')
        .select(
          'id, client, reference_date, reference_raw, support_score, cs_score, overall_score, raw_fields, source_index',
        )
        .eq('sheet_config', sheetConfig)
        .order('reference_date', { ascending: false, nullsFirst: false })
        .order('source_index', { ascending: false })

      if (dateFrom) query = query.gte('reference_date', dateFrom)
      if (dateTo) query = query.lte('reference_date', dateTo)
      if (client) query = query.ilike('client', `%${client}%`)

      const { data, error } = await query
      if (error) throw error
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (view === 'apoio-list') {
      const { sheetConfig, dateFrom, dateTo } = payload
      if (!sheetConfig) {
        return new Response(
          JSON.stringify({ error: 'sheetConfig obrigatório.' }),
          {
            status: 400,
            headers: corsHeaders,
          },
        )
      }

      let query = supabaseAdmin
        .from('nps_apoio_ausencias')
        .select('id, client, meeting_date, created_at')
        .eq('sheet_config', sheetConfig)
        .order('meeting_date', { ascending: false })

      if (dateFrom) query = query.gte('meeting_date', dateFrom)
      if (dateTo) query = query.lte('meeting_date', dateTo)

      const { data, error } = await query
      if (error) throw error
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (view === 'apoio-create') {
      const { sheetConfig, client, meetingDate } = payload
      if (!sheetConfig || !client || !meetingDate) {
        return new Response(
          JSON.stringify({
            error: 'sheetConfig, client e meetingDate são obrigatórios.',
          }),
          {
            status: 400,
            headers: corsHeaders,
          },
        )
      }

      const { data, error } = await supabaseAdmin
        .from('nps_apoio_ausencias')
        .insert({
          sheet_config: sheetConfig,
          client,
          meeting_date: meetingDate,
          created_by: userData.id,
        })
        .select('id, client, meeting_date, created_at')
        .single()
      if (error) throw error
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (view === 'apoio-delete') {
      const { id } = payload
      if (!id) {
        return new Response(JSON.stringify({ error: 'id obrigatório.' }), {
          status: 400,
          headers: corsHeaders,
        })
      }

      const { error } = await supabaseAdmin
        .from('nps_apoio_ausencias')
        .delete()
        .eq('id', id)
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
