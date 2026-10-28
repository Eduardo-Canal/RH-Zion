import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

// ─── Constantes ──────────────────────────────────────────────────────────────

const NOTIFY_COOLDOWN_HOURS = 4 // não notifica novamente antes de N horas
const STATUS_TIMEOUT = 15000 // timeout ao chamar manage-instance/status (ms)

// ─── Helper: chamar manage-instance action=status ─────────────────────────────

async function checkInstanceStatus(
  supabaseUrl: string,
  serviceRoleKey: string,
  instanceId: string,
): Promise<{ ok: boolean; connected?: boolean; error?: string }> {
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), STATUS_TIMEOUT)
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/whatsapp-manage-instance`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ action: 'status', instance_id: instanceId }),
        signal: ctrl.signal,
      },
    )
    clearTimeout(timeoutId)
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { ok: true, connected: data?.status === 'conectado' }
  } catch (err: any) {
    clearTimeout(timeoutId)
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
    }
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // ── 0. Validar secret do header Authorization ───────────────────────────────
  const { data: healthCfg } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'whatsapp_health_check_config')
    .maybeSingle()
  const expectedSecret: string = healthCfg?.value?.secret_key || ''

  if (expectedSecret) {
    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.error('[whatsapp-health-check] Authorization ausente ou inválido')
      return json({ error: 'unauthorized' }, 401)
    }
  } else {
    console.warn(
      '[whatsapp-health-check] health-check sem secret configurado — executando sem validação',
    )
  }

  // ── 1. Buscar todas instâncias ativas (executivo e principal) ────────────
  const { data: instances, error: queryError } = await supabase
    .from('whatsapp_instances')
    .select('id, nome, tipo, status, profile_user_id, last_disconnect_notified')
    .eq('ativo', true)

  if (queryError) {
    console.error(
      '[health-check] erro ao buscar instâncias:',
      queryError.message,
    )
    return json({ error: queryError.message }, 500)
  }

  if (!instances || instances.length === 0) {
    return json({
      success: true,
      total: 0,
      message: 'Nenhuma instância ativa.',
    })
  }

  let verificadas = 0
  let conectadas = 0
  let desconectadas = 0
  let notificadas = 0
  let erros = 0

  const cooldownMs = NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000
  const now = new Date()

  // ── 2. Para cada instância, checar status ──────────────────────────────────
  for (const inst of instances) {
    const result = await checkInstanceStatus(
      supabaseUrl,
      serviceRoleKey,
      inst.id,
    )
    verificadas++

    if (!result.ok) {
      console.warn(
        `[health-check] instância ${inst.nome} (${inst.id}): erro=${result.error}`,
      )
      erros++
      continue
    }

    if (result.connected) {
      conectadas++
      continue
    }

    // Instância desconectada
    desconectadas++

    // ── 3. Notificar se cooldown expirado e há usuário vinculado ───────────
    if (!inst.profile_user_id) {
      // Sem usuário vinculado, não há quem notificar
      continue
    }

    const lastNotified = inst.last_disconnect_notified
      ? new Date(inst.last_disconnect_notified).getTime()
      : 0
    const diffMs = now.getTime() - lastNotified

    if (diffMs < cooldownMs) {
      // Já notificado recentemente, pular
      continue
    }

    // Buscar profile (id da tabela profiles, usado pela tabela notifications.user_id)
    // ATENÇÃO: tabela notifications usa auth.users.id, então user_id vem do profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id, nome')
      .eq('user_id', inst.profile_user_id)
      .maybeSingle()

    if (!profile) {
      console.warn(
        `[health-check] profile não encontrado para profile_user_id=${inst.profile_user_id}`,
      )
      continue
    }

    // Criar notificação
    const { error: notifError } = await supabase.from('notifications').insert({
      user_id: profile.user_id,
      title: '⚠ WhatsApp desconectado',
      message: `Sua instância WhatsApp "${inst.nome}" está desconectada. Reconecte em Configurações → WhatsApp para continuar recebendo mensagens.`,
      read: false,
    })

    if (notifError) {
      console.warn(
        `[health-check] erro ao criar notificação: ${notifError.message}`,
      )
      continue
    }

    // Atualizar last_disconnect_notified
    await supabase
      .from('whatsapp_instances')
      .update({ last_disconnect_notified: now.toISOString() })
      .eq('id', inst.id)

    notificadas++
    console.log(
      `[health-check] notificação criada para usuário ${profile.nome} (instância ${inst.nome} desconectada)`,
    )
  }

  console.log(
    `[health-check] verificadas=${verificadas} conectadas=${conectadas} desconectadas=${desconectadas} notificadas=${notificadas} erros=${erros}`,
  )

  return json({
    success: true,
    verificadas,
    conectadas,
    desconectadas,
    notificadas,
    erros,
  })
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
