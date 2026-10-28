import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import {
  validatePrincipalInstance,
  buildGroupConfigInsert,
} from './build-group-config.ts'

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

  const { nome_grupo, participantes } = body

  if (!nome_grupo?.trim()) {
    return jsonResp(400, { ok: false, error: 'MISSING_NOME_GRUPO' })
  }

  if (!Array.isArray(participantes) || participantes.length === 0) {
    return jsonResp(400, { ok: false, error: 'MISSING_PARTICIPANTES' })
  }

  // Normaliza para E.164 sem "+", garantindo o DDI 55. Mesma regra do
  // helper normalizePhoneBR do front: 10 díg → infere o 9º; 11 díg → prefixa
  // 55; 12-13 díg começando com 55 → mantém. Rede de segurança para números
  // que cheguem sem o país por qualquer origem (cadastro antigo, sync, etc.).
  function normalizarBR(raw: any): string | null {
    const digits = String(raw).replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 13) return null
    if (digits.length === 10)
      return '55' + digits.slice(0, 2) + '9' + digits.slice(2)
    if (digits.length === 11) return '55' + digits
    if (digits.startsWith('55')) return digits
    return null
  }

  const sanitized: string[] = participantes
    .map(normalizarBR)
    .filter((p): p is string => !!p && p.length >= 12)

  if (sanitized.length === 0) {
    return jsonResp(400, {
      ok: false,
      error: 'INVALID_PARTICIPANTES',
      message:
        'Nenhum participante válido — informe números com mínimo 12 dígitos',
    })
  }

  try {
    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('id, nome, instance_key, instance_token, status')
        .eq('tipo', 'principal')
        .eq('ativo', true)
        .maybeSingle(),
    ])

    const moduleConfig = moduleRes.data

    if (!moduleConfig?.uazapi_base_url) {
      return jsonResp(503, { ok: false, error: 'WHATSAPP_NOT_CONFIGURED' })
    }

    // A mesma instância que cria o grupo na uazapi é a que fica gravada em
    // whatsapp_group_config (buildGroupConfigInsert, abaixo) — uma única
    // consulta, sem fallback pra outra instância nem pro token global se a
    // principal não servir (validatePrincipalInstance cobre presença, conexão
    // e token próprio).
    const validation = validatePrincipalInstance(
      instanceRes.data,
      instanceRes.error,
    )
    if (!validation.ok) {
      return jsonResp(validation.status, {
        ok: false,
        error: validation.code,
        message: validation.message,
      })
    }
    const instance = validation.principal

    const baseUrl = moduleConfig.uazapi_base_url.replace(/\/$/, '')
    // Token da própria principal, garantido presente por validatePrincipalInstance.
    const token = instance.instance_token!.trim()

    console.log(
      `[feira-create-grupo] criando "${nome_grupo}" com ${sanitized.length} participante(s) via instância principal "${instance.nome}"`,
    )

    const uazapiRes = await fetch(`${baseUrl}/group/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({
        name: nome_grupo.trim(),
        participants: sanitized,
      }),
    })

    const raw = await uazapiRes.json()
    console.log(
      '[feira-create-grupo] uazapi response bruto:',
      JSON.stringify(raw),
    )

    if (!uazapiRes.ok) {
      return jsonResp(502, {
        ok: false,
        error: raw?.error || `uazapi respondeu ${uazapiRes.status}`,
        raw,
      })
    }

    // uazapi retorna { group: { JID: "..." }, failed: [...] }
    const jid: string =
      raw?.group?.JID ||
      raw?.group?.jid ||
      raw?.JID ||
      raw?.jid ||
      raw?.id ||
      raw?.group_id ||
      ''

    if (!jid) {
      return jsonResp(502, {
        ok: false,
        error: 'JID_NOT_FOUND',
        message: 'Grupo criado mas JID não retornado pela uazapi',
        raw,
      })
    }

    const { data: groupConfig, error: errGroup } = await supabase
      .from('whatsapp_group_config')
      .upsert(buildGroupConfigInsert(jid, nome_grupo.trim(), instance), {
        onConflict: 'group_id',
      })
      .select('id')
      .single()

    if (errGroup) {
      return jsonResp(500, {
        ok: false,
        error: 'Erro ao gravar config do grupo: ' + errGroup.message,
      })
    }

    return jsonResp(200, {
      ok: true,
      group_id: jid,
      nome: nome_grupo.trim(),
      group_config_id: groupConfig.id,
    })
  } catch (err: any) {
    console.error('[feira-create-grupo] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
