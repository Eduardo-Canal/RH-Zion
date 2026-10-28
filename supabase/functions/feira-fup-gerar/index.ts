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
    // somente_vazias=true: só gera para quem ainda não tem mensagem (preserva edições)
    // somente_vazias=false: regenera tudo (sobrescreve)
    const somenteVazias: boolean = body.somente_vazias !== false

    if (!automacao_config_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_PARAMS' })
    }

    // ── 1. Config + permissão ───────────────────────────────────────────────
    const { data: config, error: configErr } = await supabase
      .from('automacao_config')
      .select('id, tipo_campanha, roles_pode_disparar')
      .eq('id', automacao_config_id)
      .maybeSingle()

    if (configErr || !config)
      return jsonResp(404, { ok: false, error: 'CONFIG_NOT_FOUND' })
    if (config.tipo_campanha !== 'feira')
      return jsonResp(400, { ok: false, error: 'NOT_A_FEIRA_CONFIG' })

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
      rolesPermitidas.includes(perfilData?.nome || '')
    if (!pode) {
      return jsonResp(403, {
        ok: false,
        error: 'PERMISSION_DENIED',
        mensagem: `Perfil '${perfilData?.nome || ''}' não tem permissão.`,
      })
    }

    // ── 2. Não-respondentes elegíveis ───────────────────────────────────────
    const { data: leads, error: leadsErr } = await supabase
      .from('leads_automacao_pendentes')
      .select('id, mensagem_fup_editada')
      .eq('automacao_config_id', automacao_config_id)
      .eq('descartado_disparo', false)
      .eq('whatsapp_status', 'enviado')
      .not('telefone', 'is', null)
    if (leadsErr) return jsonResp(500, { ok: false, error: leadsErr.message })

    // Excluir quem já tem FUP ativo (mensagem já travada no log)
    const { data: fupsAtivos } = await supabase
      .from('feira_disparos_log')
      .select('lead_pendente_id')
      .eq('automacao_config_id', automacao_config_id)
      .eq('tipo_disparo', 'fup')
      .in('status', ['agendado', 'enviando', 'enviado'])
    const jaTemFup = new Set(
      (fupsAtivos || []).map((f: any) => f.lead_pendente_id),
    )

    let alvos = (leads || []).filter((l: any) => !jaTemFup.has(l.id))
    const totalElegiveis = alvos.length

    if (somenteVazias) {
      alvos = alvos.filter(
        (l: any) =>
          !l.mensagem_fup_editada || l.mensagem_fup_editada.trim() === '',
      )
    }

    const pulados = totalElegiveis - alvos.length

    if (alvos.length === 0) {
      return jsonResp(200, {
        ok: true,
        gerados: 0,
        pulados,
        total_elegiveis: totalElegiveis,
        erros: 0,
      })
    }

    // ── 3. Gerar em lotes (concorrência limitada) ───────────────────────────
    const chunkSize = 5
    let gerados = 0
    let erros = 0

    for (let i = 0; i < alvos.length; i += chunkSize) {
      const chunk = alvos.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(async (lead: any) => {
          try {
            const gen = await supabase.functions.invoke(
              'feira-generate-message',
              {
                body: { lead_pendente_id: lead.id, modo: 'fup' },
              },
            )
            const msg = gen.data?.mensagem
            if (msg) {
              const { error: upErr } = await supabase
                .from('leads_automacao_pendentes')
                .update({ mensagem_fup_editada: msg })
                .eq('id', lead.id)
              if (upErr) erros++
              else gerados++
            } else {
              erros++
            }
          } catch {
            erros++
          }
        }),
      )
    }

    console.log(
      `[feira-fup-gerar] feira ${automacao_config_id}: gerados ${gerados}, pulados ${pulados}, erros ${erros}`,
    )

    return jsonResp(200, {
      ok: true,
      gerados,
      pulados,
      total_elegiveis: totalElegiveis,
      erros,
    })
  } catch (err: any) {
    console.error('[feira-fup-gerar] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
