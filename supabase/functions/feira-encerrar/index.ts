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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  const { feira_id, cancelar_disparos = true } = body

  if (!feira_id) return jsonResp(400, { ok: false, error: 'MISSING_FEIRA_ID' })

  try {
    // 1. Buscar e validar status
    const { data: statusRow } = await supabase.rpc('feira_calcular_status', {
      p_feira_id: feira_id,
    })

    const status = statusRow as string | null
    if (!status) return jsonResp(404, { ok: false, error: 'FEIRA_NOT_FOUND' })
    if (status !== 'em_execucao') {
      return jsonResp(409, {
        ok: false,
        error: 'STATUS_INVALIDO',
        message: `Só é possível encerrar uma feira "em_execucao". Status atual: ${status}`,
      })
    }

    // 2. Marcar encerrada_em
    const { error: updateErr } = await supabase
      .from('automacao_config')
      .update({ encerrada_em: new Date().toISOString() })
      .eq('id', feira_id)

    if (updateErr) throw updateErr

    let disparosCancelados = 0

    // 3. Cancelar disparos agendados se solicitado
    if (cancelar_disparos) {
      const { count: logCount } = await supabase
        .from('feira_disparos_log')
        .update({
          status: 'cancelado',
          erro_mensagem: 'Feira encerrada antecipadamente',
        })
        .eq('automacao_config_id', feira_id)
        .eq('status', 'agendado')
        .select('*', { count: 'exact', head: true })

      await supabase
        .from('leads_automacao_pendentes')
        .update({ whatsapp_status: 'cancelado' })
        .eq('automacao_config_id', feira_id)
        .eq('whatsapp_status', 'agendado')

      disparosCancelados = logCount || 0
    }

    console.log(
      `[feira-encerrar] ${feira_id} encerrada. disparos_cancelados=${disparosCancelados}`,
    )
    return jsonResp(200, { ok: true, disparos_cancelados: disparosCancelados })
  } catch (err: any) {
    console.error('[feira-encerrar] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
