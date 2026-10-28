import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Roteador da tela Suporte (módulo Auditoria). Views religadas: 'data'
// (dashboard principal, Etapa 1), 'tempos' (Tempos & SLA), 'analytics'
// (Analítico), 'resolucao' (Resolução) e 'qualidade' (Qualidade), todas em
// 2026-07-10. 'niveis'/'fora-fluxo' seguem bloqueadas — dependem de
// suporte_historico, alimentada só via Postgres interno da Zion
// (inalcançável da AWS, mesma decisão de infra do Oracle/Horas Previstas) —
// ver BACKLOG.md.
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
    const { view, dateStart, dateEnd, categorias } = payload

    let result: any

    switch (view) {
      case 'data': {
        const catList = categorias
          ? String(categorias)
              .split(',')
              .map((c: string) => c.trim())
              .filter(Boolean)
          : null
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_suporte_data',
          {
            p_date_start: dateStart || null,
            p_date_end: dateEnd || null,
            p_categorias: catList && catList.length ? catList : null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'tempos': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_suporte_tempos',
          {
            p_date_start: dateStart || null,
            p_date_end: dateEnd || null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'analytics': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_suporte_analytics',
          {
            p_date_start: dateStart || null,
            p_date_end: dateEnd || null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'resolucao': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_suporte_resolucao',
          {
            p_date_start: dateStart || null,
            p_date_end: dateEnd || null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'qualidade': {
        const { data, error } = await supabaseAdmin.rpc(
          'auditoria_suporte_qualidade',
          {
            p_date_start: dateStart || null,
            p_date_end: dateEnd || null,
          },
        )
        if (error) throw error
        result = data
        break
      }
      case 'sync-status': {
        const { data, error } = await supabaseAdmin
          .from('suporte_sync_status')
          .select('*')
          .eq('id', 1)
          .maybeSingle()
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
