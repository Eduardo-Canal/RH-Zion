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
    const leadIds: string[] = Array.isArray(body.lead_ids)
      ? body.lead_ids.filter((x: any) => typeof x === 'string')
      : []

    if (!automacao_config_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_PARAMS' })
    }
    if (leadIds.length === 0) {
      return jsonResp(400, {
        ok: false,
        error: 'NO_LEADS_SELECTED',
        mensagem: 'Nenhum contato selecionado.',
      })
    }

    // ── 1. Buscar configuração da feira ─────────────────────────────────────
    const { data: config, error: configErr } = await supabase
      .from('automacao_config')
      .select(
        'id, nome, tipo_campanha, roles_pode_disparar, disparo_jitter_seg_min, disparo_jitter_seg_max, disparo_limite_diario',
      )
      .eq('id', automacao_config_id)
      .maybeSingle()

    if (configErr || !config) {
      return jsonResp(404, { ok: false, error: 'CONFIG_NOT_FOUND' })
    }

    if (config.tipo_campanha !== 'feira') {
      return jsonResp(400, { ok: false, error: 'NOT_A_FEIRA_CONFIG' })
    }

    // ── 2. Validar permissão do usuário ─────────────────────────────────────
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
    const podeDispararPorPermissao =
      perms.includes('Feiras: FUP') || perms.includes('Feiras: Gerenciar')
    const podeDispararPorRole = rolesPermitidas.includes(perfilData?.nome || '')
    if (!podeDispararPorPermissao && !podeDispararPorRole) {
      return jsonResp(403, {
        ok: false,
        error: 'PERMISSION_DENIED',
        mensagem: `Perfil '${perfilData?.nome || ''}' não tem permissão para disparar FUP desta feira.`,
      })
    }

    // ── 3. Validar os leads selecionados ────────────────────────────────────
    // Só envia FUP para quem: pertence à feira, foi chamado e NÃO respondeu
    // (whatsapp_status='enviado'), não foi descartado e tem telefone.
    const { data: leads, error: leadsErr } = await supabase
      .from('leads_automacao_pendentes')
      .select(
        'id, telefone, razao_social, dados_completos, bitrix_match_tipo, mensagem_fup_editada, whatsapp_phone',
      )
      .eq('automacao_config_id', automacao_config_id)
      .eq('descartado_disparo', false)
      .eq('whatsapp_status', 'enviado')
      .not('telefone', 'is', null)
      .in('id', leadIds)

    if (leadsErr) {
      return jsonResp(500, { ok: false, error: leadsErr.message })
    }

    // ── 3b. Excluir quem já tem um FUP ativo (anti-duplicidade) ─────────────
    const { data: fupsAtivos } = await supabase
      .from('feira_disparos_log')
      .select('lead_pendente_id')
      .eq('automacao_config_id', automacao_config_id)
      .eq('tipo_disparo', 'fup')
      .in('status', ['agendado', 'enviando', 'enviado'])

    const jaTemFup = new Set(
      (fupsAtivos || []).map((f: any) => f.lead_pendente_id),
    )
    const candidatos = (leads || []).filter((l: any) => !jaTemFup.has(l.id))

    const ignorados = leadIds.length - candidatos.length

    if (candidatos.length === 0) {
      return jsonResp(200, {
        ok: true,
        agendados: 0,
        ignorados,
        mensagem:
          'Nenhum dos contatos selecionados está elegível (já respondeu, já tem FUP ativo ou sem telefone).',
      })
    }

    // ── 4. Agendar com espaçamento de segurança (horário comercial + jitter) ─
    const jitterMin = config.disparo_jitter_seg_min ?? 30
    const jitterMax = config.disparo_jitter_seg_max ?? 90
    const limiteDiario = config.disparo_limite_diario ?? 80

    function proximoHorarioComercial(timestampMs: number): number {
      const brtOffset = -3 * 3600 * 1000
      const brt = new Date(timestampMs + brtOffset)
      const hora = brt.getUTCHours()
      const minuto = brt.getUTCMinutes()

      if (hora < 8) {
        return timestampMs + (8 - hora) * 3600 * 1000 - minuto * 60 * 1000
      } else if (hora >= 19) {
        return timestampMs + (24 - hora + 8) * 3600 * 1000 - minuto * 60 * 1000
      }
      return timestampMs
    }

    const registros: Array<{
      lead: any
      agendadoPara: Date
      mensagem: string
    }> = []
    let cursorMs = proximoHorarioComercial(Date.now())
    let enviadosNodia = 0
    let diaAtual = new Date(cursorMs).toDateString()

    for (const lead of candidatos) {
      const diaLead = new Date(cursorMs).toDateString()
      if (diaLead !== diaAtual) {
        enviadosNodia = 0
        diaAtual = diaLead
      }

      if (enviadosNodia >= limiteDiario) {
        const d = new Date(cursorMs)
        d.setUTCDate(d.getUTCDate() + 1)
        d.setUTCHours(11, 0, 0, 0) // 8h BRT = 11h UTC
        cursorMs = d.getTime()
        enviadosNodia = 0
        diaAtual = d.toDateString()
      }

      let mensagem = lead.mensagem_fup_editada || ''
      if (!mensagem) {
        try {
          const genResp = await supabase.functions.invoke(
            'feira-generate-message',
            {
              body: { lead_pendente_id: lead.id, modo: 'fup' },
            },
          )
          mensagem = genResp.data?.mensagem || ''
        } catch {
          const dados: any = lead.dados_completos || {}
          const nome =
            (dados.nome || lead.razao_social || '').split(' ')[0] || 'você'
          mensagem = `Oi ${nome}, passando para retomar nosso contato da feira. Faz sentido conversarmos?`
        }
      }
      if (!mensagem) continue

      const jitterMs =
        (Math.floor(Math.random() * (jitterMax - jitterMin + 1)) + jitterMin) *
        1000
      const agendadoPara = new Date(cursorMs + jitterMs)

      registros.push({ lead, agendadoPara, mensagem })

      const digitacaoMs = Math.max(5000, mensagem.length * 80)
      cursorMs = agendadoPara.getTime() + digitacaoMs
      enviadosNodia++
    }

    if (registros.length === 0) {
      return jsonResp(200, {
        ok: true,
        agendados: 0,
        ignorados,
        mensagem: 'Nenhum contato com mensagem válida.',
      })
    }

    // ── 5. Inserir no log com tipo_disparo='fup' (NÃO altera whatsapp_status) ─
    const agora2 = new Date().toISOString()
    let inseridos = 0

    for (const r of registros) {
      const telefone =
        r.lead.whatsapp_phone ||
        (r.lead.dados_completos as any)?.telefone ||
        r.lead.telefone ||
        ''
      if (telefone.includes('@')) {
        console.warn(
          `[feira-dispatch-fup] telefone parece JID, lead ${r.lead.id}: "${telefone}" — pulando`,
        )
        continue
      }

      const { error: logErr } = await supabase
        .from('feira_disparos_log')
        .insert({
          automacao_config_id,
          lead_pendente_id: r.lead.id,
          disparado_por: userId,
          disparado_em: agora2,
          agendado_para: r.agendadoPara.toISOString(),
          mensagem_final: r.mensagem,
          whatsapp_phone: telefone.replace(/\D/g, ''),
          status: 'agendado',
          tipo_disparo: 'fup',
        })

      if (logErr) {
        if (logErr.code === '23505') {
          console.warn(
            `[feira-dispatch-fup] lead ${r.lead.id} já tinha FUP ativo — ignorado`,
          )
        } else {
          console.error(
            `[feira-dispatch-fup] falha ao gravar log para lead ${r.lead.id}:`,
            logErr.message,
          )
        }
        continue
      }
      inseridos++
    }

    const primeiroDisparo = registros[0].agendadoPara.toISOString()
    const ultimoDisparo =
      registros[registros.length - 1].agendadoPara.toISOString()

    console.log(
      `[feira-dispatch-fup] ${inseridos} FUPs agendados para ${config.nome} por ${userId}`,
    )

    return jsonResp(200, {
      ok: true,
      agendados: inseridos,
      ignorados,
      primeiro_disparo: primeiroDisparo,
      ultimo_disparo: ultimoDisparo,
    })
  } catch (err: any) {
    console.error('[feira-dispatch-fup] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
