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

  const { feira_id, arquivar } = body

  if (!feira_id) return jsonResp(400, { ok: false, error: 'MISSING_FEIRA_ID' })
  if (typeof arquivar !== 'boolean')
    return jsonResp(400, { ok: false, error: 'MISSING_ARQUIVAR' })

  try {
    // 1. Validar status
    const { data: statusRow } = await supabase.rpc('feira_calcular_status', {
      p_feira_id: feira_id,
    })

    const status = statusRow as string | null
    if (!status) return jsonResp(404, { ok: false, error: 'FEIRA_NOT_FOUND' })

    const bloqueados = ['em_execucao', 'pos_feira']
    if (bloqueados.includes(status)) {
      return jsonResp(409, {
        ok: false,
        error: 'STATUS_INVALIDO',
        message: `Não é possível arquivar uma feira com status "${status}".`,
      })
    }

    // 2. Atualizar arquivada
    const { error: updateErr } = await supabase
      .from('automacao_config')
      .update({ arquivada: arquivar })
      .eq('id', feira_id)

    if (updateErr) throw updateErr

    console.log(`[feira-arquivar] ${feira_id} arquivada=${arquivar}`)
    return jsonResp(200, { ok: true, arquivada: arquivar })
  } catch (err: any) {
    console.error('[feira-arquivar] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
