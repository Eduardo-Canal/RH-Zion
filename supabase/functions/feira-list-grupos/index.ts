import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

function jsonResp(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // 1. Buscar config uazapi
    const { data: moduleConfig } = await supabase
      .from('whatsapp_module_config')
      .select('uazapi_base_url, uazapi_global_token')
      .eq('id', 1)
      .maybeSingle()

    if (!moduleConfig?.uazapi_base_url || !moduleConfig?.uazapi_global_token) {
      return jsonResp(503, { ok: false, error: 'WHATSAPP_NOT_CONFIGURED' })
    }

    // 2. Instância principal ativa
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('instance_key')
      .eq('ativo', true)
      .order('criado_em', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!instance?.instance_key) {
      return jsonResp(503, { ok: false, error: 'NO_ACTIVE_INSTANCE' })
    }

    const baseUrl = moduleConfig.uazapi_base_url.replace(/\/$/, '')
    const globalToken = moduleConfig.uazapi_global_token
    const instanceKey = instance.instance_key

    // 3. GET chats de grupo via uazapi
    const res = await fetch(
      `${baseUrl}/instance/${instanceKey}/chats?type=group`,
      { headers: { token: globalToken } },
    )

    if (!res.ok) {
      return jsonResp(502, {
        ok: false,
        error: `uazapi respondeu ${res.status}`,
      })
    }

    const raw = await res.json()
    const chats: any[] = Array.isArray(raw)
      ? raw
      : raw?.chats || raw?.data || raw?.result || []

    // 4. Filtrar apenas grupos e mapear campos
    const grupos = chats
      .filter(
        (c: any) =>
          c.is_group === true || (c.id || c.group_id || '').endsWith('@g.us'),
      )
      .map((c: any) => ({
        group_id: c.id || c.group_id || '',
        nome: c.name || c.subject || c.pushName || c.id || '',
        participantes_count:
          c.participants_count ?? c.participantsCount ?? c.participantes ?? 0,
      }))
      .filter((g: any) => g.group_id)

    console.log(
      `[feira-list-grupos] instância ${instanceKey}: ${grupos.length} grupos encontrados`,
    )
    return jsonResp(200, { ok: true, grupos })
  } catch (err: any) {
    console.error('[feira-list-grupos] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
