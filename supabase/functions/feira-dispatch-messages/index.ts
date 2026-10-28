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

    const { automacao_config_id } = await req.json().catch(() => ({}))

    if (!automacao_config_id) {
      return jsonResp(400, { ok: false, error: 'MISSING_PARAMS' })
    }

    // ── 1. Buscar configuração da feira ─────────────────────────────────────
    const { data: config, error: configErr } = await supabase
      .from('automacao_config')
      .select(
        'id, nome, tipo_campanha, roles_pode_disparar, disparo_delay_horas, disparo_jitter_seg_min, disparo_jitter_seg_max, disparo_limite_diario',
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

    const podeDispararPorPermissao =
      Array.isArray(perfilData?.permissoes) &&
      (perfilData.permissoes as string[]).includes('Feiras: Gerenciar')
    const podeDispararPorRole = rolesPermitidas.includes(perfilData?.nome || '')
    if (!podeDispararPorPermissao && !podeDispararPorRole) {
      return jsonResp(403, {
        ok: false,
        error: 'PERMISSION_DENIED',
        mensagem: `Perfil '${perfilData?.nome || ''}' não tem permissão para disparar mensagens desta feira.`,
      })
    }

    // ── 3. Buscar leads pendentes ────────────────────────────────────────────
    const { data: leads, error: leadsErr } = await supabase
      .from('leads_automacao_pendentes')
      .select(
        'id, telefone, razao_social, dados_completos, bitrix_match_tipo, mensagem_disparo_editada',
      )
      .eq('automacao_config_id', automacao_config_id)
      .eq('descartado_disparo', false)
      .is('whatsapp_status', null)
      .not('telefone', 'is', null)

    if (leadsErr) {
      return jsonResp(500, { ok: false, error: leadsErr.message })
    }

    if (!leads || leads.length === 0) {
      return jsonResp(200, {
        ok: true,
        agendados: 0,
        mensagem: 'Nenhum lead pendente encontrado para disparo.',
      })
    }

    // ── 4. Calcular agendamentos com jitter + limite diário ─────────────────
    // disparo_delay_horas foi descontinuada neste cálculo (Prompt 92 — Gap B):
    // a feira perdia timing esperando até 24h (default) para o 1º disparo.
    // Comportamento agora igual ao feira-dispatch-fup: dispara já, só com
    // espaçamento (jitter) e respeitando horário comercial. Coluna mantida no
    // banco e no select acima por compatibilidade — remoção completa fica p/ depois.
    const jitterMin = config.disparo_jitter_seg_min ?? 30
    const jitterMax = config.disparo_jitter_seg_max ?? 90
    const limiteDiario = config.disparo_limite_diario ?? 80

    // Garantir horário comercial (8h-19h BRT = UTC-3)
    function proximoHorarioComercial(timestampMs: number): number {
      const d = new Date(timestampMs)
      const brtOffset = -3 * 3600 * 1000
      const brt = new Date(timestampMs + brtOffset)
      const hora = brt.getUTCHours()
      const minuto = brt.getUTCMinutes()

      if (hora < 8) {
        // Antes das 8h: avançar para 8h
        return timestampMs + (8 - hora) * 3600 * 1000 - minuto * 60 * 1000
      } else if (hora >= 19) {
        // Após 19h: avançar para 8h do próximo dia
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

    for (const lead of leads) {
      // Controle de limite diário
      const diaLead = new Date(cursorMs).toDateString()
      if (diaLead !== diaAtual) {
        enviadosNodia = 0
        diaAtual = diaLead
      }

      if (enviadosNodia >= limiteDiario) {
        // Avançar para próximo dia útil às 8h
        const d = new Date(cursorMs)
        d.setUTCDate(d.getUTCDate() + 1)
        d.setUTCHours(11, 0, 0, 0) // 8h BRT = 11h UTC
        cursorMs = d.getTime()
        enviadosNodia = 0
        diaAtual = d.toDateString()
      }

      // Gerar mensagem (editada pelo SDR ou via IA)
      let mensagem = lead.mensagem_disparo_editada || ''

      if (!mensagem) {
        // Gerar via feira-generate-message
        try {
          const genResp = await supabase.functions.invoke(
            'feira-generate-message',
            {
              body: { lead_pendente_id: lead.id },
            },
          )
          mensagem = genResp.data?.mensagem || ''
        } catch {
          // Fallback mínimo
          const dados: any = lead.dados_completos || {}
          const nome =
            (dados.nome || lead.razao_social || '').split(' ')[0] || 'você'
          mensagem = `Oi ${nome}, aqui é a Débora da Zion! Foi ótimo te conhecer na feira. Posso te enviar mais informações?`
        }
      }

      if (!mensagem) continue

      // Calcular timestamp final com jitter
      const jitterMs =
        (Math.floor(Math.random() * (jitterMax - jitterMin + 1)) + jitterMin) *
        1000
      const agendadoPara = new Date(cursorMs + jitterMs)

      registros.push({ lead, agendadoPara, mensagem })

      // Avançar cursor (jitter + tempo médio de digitação da mensagem)
      const digitacaoMs = Math.max(5000, mensagem.length * 80)
      cursorMs = agendadoPara.getTime() + digitacaoMs
      enviadosNodia++
    }

    if (registros.length === 0) {
      return jsonResp(200, {
        ok: true,
        agendados: 0,
        mensagem: 'Nenhum lead com telefone válido e mensagem gerada.',
      })
    }

    // ── 5. Inserir em feira_disparos_log + atualizar leads ──────────────────
    const agora2 = new Date().toISOString()

    for (const r of registros) {
      const telefone =
        (r.lead.dados_completos as any)?.telefone || r.lead.telefone || ''

      if (telefone.includes('@')) {
        console.warn(
          `[feira-dispatch] telefone parece JID (contém '@'), lead ${r.lead.id}: "${telefone}" — pulando`,
        )
        continue
      }

      const { data: logEntry, error: logErr } = await supabase
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
        })
        .select('id')
        .single()

      if (logErr || !logEntry?.id) {
        if (logErr?.code === '23505') {
          // Violação do índice uq_feira_disparos_ativo: já existe disparo ativo.
          // Reconciliar o status para que o lead saia da próxima seleção.
          await supabase
            .from('leads_automacao_pendentes')
            .update({ whatsapp_status: 'agendado' })
            .eq('id', r.lead.id)
          console.warn(
            `[feira-dispatch] lead ${r.lead.id} já tinha disparo ativo — status reconciliado`,
          )
        } else {
          console.error(
            `[feira-dispatch] falha ao gravar log para lead ${r.lead.id}:`,
            logErr?.message,
          )
        }
        continue
      }

      await supabase
        .from('leads_automacao_pendentes')
        .update({ whatsapp_status: 'agendado' })
        .eq('id', r.lead.id)
    }

    const primeiroDisparo = registros[0].agendadoPara.toISOString()
    const ultimoDisparo =
      registros[registros.length - 1].agendadoPara.toISOString()

    console.log(
      `[feira-dispatch] ${registros.length} mensagens agendadas para ${config.nome} por ${userId}`,
    )

    return jsonResp(200, {
      ok: true,
      agendados: registros.length,
      primeiro_disparo: primeiroDisparo,
      ultimo_disparo: ultimoDisparo,
    })
  } catch (err: any) {
    console.error('[feira-dispatch-messages] erro:', err.message)
    return jsonResp(500, { ok: false, error: err.message })
  }
})
