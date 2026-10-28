import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador único para a tela CS COM (módulo Auditoria).
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
    const {
      view,
      entityId,
      status,
      categoryId,
      dateFrom,
      dateTo,
      excludeNutri,
      year,
    } = payload

    let result: any

    switch (view) {
      case 'categories': {
        const { data, error } = await supabaseAdmin
          .from('crm_categories')
          .select('id, name')
          .order('name')
        if (error) throw error
        result = data
        break
      }
      case 'stages': {
        let q = supabaseAdmin
          .from('crm_stages')
          .select('id, name, semantic, entity_id, sort')
          .order('sort')
        if (entityId) q = q.eq('entity_id', entityId)
        const { data, error } = await q
        if (error) throw error
        result = data
        break
      }
      case 'deals': {
        const { data, error } = await supabaseAdmin.rpc('auditoria_cs_deals', {
          p_status: status ?? null,
          p_category_id: categoryId ?? null,
          p_date_from: dateFrom ?? null,
          p_date_to: dateTo ?? null,
          p_exclude_nutri: excludeNutri === true || excludeNutri === 'true',
        })
        if (error) throw error
        result = data
        break
      }
      case 'conversion': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_cs_conversion',
          {
            p_category_id: categoryId ?? null,
            p_date_from: dateFrom ?? null,
            p_date_to: dateTo ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'won-summary': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_cs_won_summary',
          {
            p_category_id: categoryId ?? null,
            p_date_from: dateFrom ?? null,
            p_date_to: dateTo ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'quarterly-revenue': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_cs_quarterly_revenue',
          {
            p_year: year ?? null,
            p_category_id: categoryId ?? null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      default:
        return new Response(
          JSON.stringify({ error: `view inválida: ${view}` }),
          { status: 400, headers: corsHeaders },
        )
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})
