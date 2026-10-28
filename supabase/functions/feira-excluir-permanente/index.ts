import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

function jsonResp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type',
      },
    })
  }
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResp(400, { ok: false, error: 'INVALID_JSON' })
  }

  const { feira_id, confirmacao_nome } = body

  if (!feira_id) return jsonResp(400, { ok: false, error: 'MISSING_FEIRA_ID' })

  try {
    // 1. Buscar feira
    const { data: feira } = await supabase
      .from('automacao_config')
      .select('id, nome')
      .eq('id', feira_id)
      .maybeSingle()

    if (!feira) return jsonResp(404, { ok: false, error: 'FEIRA_NOT_FOUND' })

    // 2. Validar status
    const { data: statusRow } = await supabase.rpc('feira_calcular_status', {
      p_feira_id: feira_id,
    })

    const status = statusRow as string | null
    const bloqueados = ['em_execucao', 'pos_feira']
    if (status && bloqueados.includes(status)) {
      return jsonResp(409, {
        ok: false,
        error: 'STATUS_INVALIDO',
        message: `Não é possível excluir uma feira com status "${status}".`,
      })
    }

    // 3. Validar confirmação por nome (quando fornecida)
    if (confirmacao_nome !== undefined) {
      const nomeNorm = (s: string) => s.trim().toLowerCase()
      if (nomeNorm(confirmacao_nome) !== nomeNorm(feira.nome)) {
        return jsonResp(400, {
          ok: false,
          error: 'NOME_INCORRETO',
          message: 'O nome digitado não corresponde ao nome da feira.',
        })
      }
    }

    // 4. DELETE — CASCADE cuida de leads, disparos e execuções
    const { error: deleteErr } = await supabase
      .from('automacao_config')
      .delete()
      .eq('id', feira_id)

    if (deleteErr) throw deleteErr

    console.log(
      `[feira-excluir-permanente] ${feira_id} (${feira.nome}) removida`,
    )
    return jsonResp(200, { ok: true, nome_removido: feira.nome })
  } catch (err: any) {
    console.error('[feira-excluir-permanente] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
