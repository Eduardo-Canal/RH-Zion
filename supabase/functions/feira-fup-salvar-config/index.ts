import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/require-user.ts'

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  // Guard de usuário — achado de auditoria: permissão não pode mais depender
  // do disparado_por cru do body (spoofável). Identidade vem do JWT validado.
  const userResult = await requireUser(req)
  if (!userResult.ok) return userResult.response
  const { userId } = userResult

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json().catch(() => ({}))
    const { automacao_config_id } = body
    const templateFup: string =
      typeof body.template_fup === 'string' ? body.template_fup : ''
    const contextoFupIa: string =
      typeof body.contexto_fup_ia === 'string' ? body.contexto_fup_ia : ''

    if (!automacao_config_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_PARAMS' })
    }

    // ── 1. Config + validação de que é feira ────────────────────────────────
    const { data: config, error: configErr } = await supabase
      .from('automacao_config')
      .select('id, tipo_campanha, roles_pode_disparar')
      .eq('id', automacao_config_id)
      .maybeSingle()

    if (configErr || !config)
      return jsonResp(404, { ok: false, error: 'CONFIG_NOT_FOUND' })
    if (config.tipo_campanha !== 'feira')
      return jsonResp(400, { ok: false, error: 'NOT_A_FEIRA_CONFIG' })

    // ── 2. Permissão (Feiras: FUP / Gerenciar / role) ───────────────────────
    const rolesPermitidas: string[] = config.roles_pode_disparar || [
      'Administrador',
      'SDR',
    ]
    const { data: profileData } = await supabase
      .from('profiles')
      .select('perfil_id')
      .eq('user_id', userId)
      .maybeSingle()
    const { data: perfilData } = await supabase
      .from('perfis_acesso')
      .select('nome, permissoes')
      .eq('id', profileData?.perfil_id || '')
      .maybeSingle()
    const perms = Array.isArray(perfilData?.permissoes)
      ? (perfilData.permissoes as string[])
      : []
    const pode =
      perms.includes('Feiras: FUP') ||
      perms.includes('Feiras: Gerenciar') ||
      perfilData?.nome === 'Administrador' ||
      rolesPermitidas.includes(perfilData?.nome || '')
    if (!pode) {
      return jsonResp(403, {
        ok: false,
        error: 'PERMISSION_DENIED',
        mensagem: `Perfil '${perfilData?.nome || ''}' não tem permissão.`,
      })
    }

    // ── 3. Gravar SOMENTE os dois campos do FUP (service_role, ignora RLS) ──
    const { error: upErr } = await supabase
      .from('automacao_config')
      .update({ template_fup: templateFup, contexto_fup_ia: contextoFupIa })
      .eq('id', automacao_config_id)

    if (upErr) return jsonResp(500, { ok: false, error: upErr.message })

    return jsonResp(200, { ok: true })
  } catch (err: any) {
    console.error('[feira-fup-salvar-config] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
