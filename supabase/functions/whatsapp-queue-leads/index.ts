import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// ─── Autorização ──────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const secret =
    Deno.env.get('WHATSAPP_SCHEDULER_SECRET') || 'zion-whatsapp-local-2026'
  const auth = req.headers.get('Authorization') || ''
  return auth === `Bearer ${secret}`
}

// ─── Substituição de variáveis de template ────────────────────────────────────

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '')
}

// ─── Extrair telefone limpo ───────────────────────────────────────────────────

function extractPhone(lead: Record<string, any>): string | null {
  const raw: string = lead.telefone || lead.dados_completos?.telefone || ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.startsWith('55') ? digits : `55${digits}`
}

// ─── Verificar se número existe no WhatsApp ───────────────────────────────────
// Retorna true se existe ou se a verificação falhou (evita falsos negativos)

async function verifyPhone(
  baseUrl: string,
  instanceToken: string | null,
  globalToken: string,
  instanceKey: string,
  phone: string,
): Promise<boolean> {
  const token = instanceToken?.trim() || globalToken
  if (!token) return true // sem token, assume válido

  const body: Record<string, any> = { number: phone }
  if (!instanceToken?.trim()) body.instanceName = instanceKey

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/contact/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify(body),
    })
    if (!res.ok) return true // erro HTTP → assume válido
    const data = await res.json().catch(() => ({}))
    // uazapi retorna { exists: true/false } ou { onWhatsapp: true/false }
    if (data.exists === false) return false
    if (data.onWhatsapp === false) return false
    return true
  } catch {
    return true // falha de rede → assume válido
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 })
  if (!isAuthorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // ── 1. Carregar config e instância principal em paralelo ──────────────────
    const [moduleRes, instanceRes] = await Promise.all([
      supabase
        .from('whatsapp_module_config')
        .select('uazapi_base_url, uazapi_global_token')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('whatsapp_instances')
        .select('id, instance_key, instance_token')
        .eq('tipo', 'principal')
        .eq('ativo', true)
        .eq('status', 'conectado')
        .maybeSingle(),
    ])

    const moduleConfig = moduleRes.data
    const instance = instanceRes.data
    const baseUrl = moduleConfig?.uazapi_base_url || 'https://free.uazapi.com'
    const globalToken: string = moduleConfig?.uazapi_global_token || ''

    if (!instance) {
      console.log(
        '[queue-leads] nenhuma instância principal conectada — abortando',
      )
      return json({
        ok: true,
        enfileirados: 0,
        followups: 0,
        motivo: 'sem instancia',
      })
    }

    const instanceToken: string | null = instance.instance_token || null
    const instanceKey: string = instance.instance_key

    // ── 2. Buscar campanhas ativas com WhatsApp habilitado ─────────────────────
    const { data: campanhas } = await supabase
      .from('automacao_config')
      .select(
        'id, whatsapp_template, whatsapp_delay_min, whatsapp_delay_max, whatsapp_limite_diario',
      )
      .eq('ativo', true)
      .eq('whatsapp_ativo', true)

    let totalEnfileirados = 0
    let totalFollowups = 0

    if (campanhas && campanhas.length > 0) {
      for (const campanha of campanhas) {
        if (!campanha.whatsapp_template) continue

        // ── 3. Quantos já foram enviados hoje nesta campanha ────────────────
        const hoje = new Date()
        const inicioHoje = new Date(
          hoje.getFullYear(),
          hoje.getMonth(),
          hoje.getDate(),
        ).toISOString()

        const { count: enviadosHoje } = await supabase
          .from('whatsapp_send_queue')
          .select('id', { count: 'exact', head: true })
          .eq('automacao_config_id', campanha.id)
          .in('status', ['enviado', 'enviando'])
          .gte('criado_em', inicioHoje)

        const slotsDisponiveis =
          (campanha.whatsapp_limite_diario || 50) - (enviadosHoje || 0)
        if (slotsDisponiveis <= 0) {
          console.log(
            `[queue-leads] campanha ${campanha.id} atingiu limite diário`,
          )
          continue
        }

        // ── 4. Leads elegíveis: enviado_bitrix, sem whatsapp_status, com telefone
        const { data: leads } = await supabase
          .from('leads_automacao_pendentes')
          .select(
            'id, razao_social, cnpj, municipio, uf, porte, telefone, sugestao_abordagem, dados_completos',
          )
          .eq('automacao_config_id', campanha.id)
          .eq('status', 'enviado_bitrix')
          .is('whatsapp_status', null)
          .limit(slotsDisponiveis)

        if (!leads || leads.length === 0) continue

        let proximoEnvio = new Date()
        let enfileiradosCampanha = 0

        for (const lead of leads) {
          const phone = extractPhone(lead)
          if (!phone) {
            console.log(
              `[queue-leads] lead ${lead.cnpj} sem telefone válido — ignorado`,
            )
            continue
          }

          // ── 5. Item 1: Verificar se número existe no WhatsApp ─────────────
          const existeNoWA = await verifyPhone(
            baseUrl,
            instanceToken,
            globalToken,
            instanceKey,
            phone,
          )
          if (!existeNoWA) {
            console.log(
              `[queue-leads] ${lead.cnpj} não está no WhatsApp — ignorado`,
            )
            await supabase
              .from('leads_automacao_pendentes')
              .update({
                whatsapp_status: 'numero_invalido',
                whatsapp_phone: phone,
              })
              .eq('id', lead.id)
            continue
          }

          // Template substitution
          const nomeEmpresa = lead.razao_social || ''
          const vars: Record<string, string> = {
            nome: nomeEmpresa.split(' ')[0] || nomeEmpresa,
            empresa: nomeEmpresa,
            cnpj: lead.cnpj || '',
            municipio: lead.municipio || '',
            uf: lead.uf || '',
            porte: lead.porte || '',
            abordagem: lead.sugestao_abordagem || '',
          }
          const mensagem = applyTemplate(campanha.whatsapp_template, vars)

          const delayMin = (campanha.whatsapp_delay_min || 45) * 1000
          const delayMax = (campanha.whatsapp_delay_max || 90) * 1000
          const delay =
            Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin
          proximoEnvio = new Date(proximoEnvio.getTime() + delay)

          const { error: queueError } = await supabase
            .from('whatsapp_send_queue')
            .insert({
              instance_id: instance.id,
              automacao_config_id: campanha.id,
              lead_cnpj: lead.cnpj,
              phone,
              contact_name: nomeEmpresa,
              mensagem,
              status: 'pendente',
              agendado_para: proximoEnvio.toISOString(),
              numero_verificado: true,
              sequence_step: 0,
              message_type: 'botao', // primeiro contato usa botões
            })

          if (queueError) {
            console.error(
              `[queue-leads] erro ao enfileirar ${lead.cnpj}:`,
              queueError.message,
            )
            continue
          }

          await supabase
            .from('leads_automacao_pendentes')
            .update({ whatsapp_status: 'na_fila', whatsapp_phone: phone })
            .eq('id', lead.id)

          enfileiradosCampanha++
          totalEnfileirados++
        }

        console.log(
          `[queue-leads] campanha ${campanha.id}: ${enfileiradosCampanha} leads enfileirados`,
        )
      }
    }

    // ── 6. Item 3: Multi-touch — follow-ups para quem não respondeu ───────────
    // Dias de espera entre cada step: step0→1=2d, step1→2=3d, step2→3=3d
    const stepIntervalDays = [2, 3, 3]
    const followupTemplates: Record<number, string> = {
      1: `Olá {{nome}}! 👋 Tentei contato anteriormente sobre soluções para {{empresa}}. Ficou com alguma dúvida? Seria um prazer conversar!`,
      2: `Oi {{nome}}! Sei que sua agenda pode estar corrida, mas queria saber se teve oportunidade de pensar em como podemos ajudar {{empresa}}. 🤝`,
      3: `{{nome}}, última mensagem da minha parte. Se precisar de nós no futuro, é só chamar! Estaremos disponíveis para {{empresa}} quando precisar. 👋`,
    }

    const { data: followupLeads } = await supabase
      .from('leads_automacao_pendentes')
      .select(
        'id, razao_social, cnpj, municipio, uf, porte, telefone, sugestao_abordagem, whatsapp_phone, whatsapp_enviado_em, whatsapp_sequence_step, automacao_config_id',
      )
      .eq('whatsapp_status', 'enviado')
      .lt('whatsapp_sequence_step', 3)
      .not('whatsapp_phone', 'is', null)
      .limit(100)

    if (followupLeads && followupLeads.length > 0) {
      let proximoFollowup = new Date()

      for (const lead of followupLeads) {
        const step = lead.whatsapp_sequence_step || 0
        const intervalDays = stepIntervalDays[step] || 2
        const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000)
        const lastSent = lead.whatsapp_enviado_em
          ? new Date(lead.whatsapp_enviado_em)
          : null

        if (!lastSent || lastSent >= cutoff) continue // ainda não é hora

        const phone = lead.whatsapp_phone || extractPhone(lead)
        if (!phone) continue

        const nextStep = step + 1
        const template = followupTemplates[nextStep]
        if (!template) continue

        // Checar se já existe item pendente para este step
        const { count: jaNaFila } = await supabase
          .from('whatsapp_send_queue')
          .select('id', { count: 'exact', head: true })
          .eq('lead_cnpj', lead.cnpj)
          .eq('sequence_step', nextStep)
          .in('status', ['pendente', 'enviando', 'enviado'])

        if (jaNaFila && jaNaFila > 0) continue

        const nomeEmpresa = lead.razao_social || ''
        const vars: Record<string, string> = {
          nome: nomeEmpresa.split(' ')[0] || nomeEmpresa,
          empresa: nomeEmpresa,
          cnpj: lead.cnpj || '',
          municipio: lead.municipio || '',
          uf: lead.uf || '',
          porte: lead.porte || '',
          abordagem: lead.sugestao_abordagem || '',
        }
        const mensagem = applyTemplate(template, vars)

        // Delay aleatório de 60–120s entre follow-ups
        const delay = Math.floor(Math.random() * 60000) + 60000
        proximoFollowup = new Date(proximoFollowup.getTime() + delay)

        const { error: fuErr } = await supabase
          .from('whatsapp_send_queue')
          .insert({
            instance_id: instance.id,
            automacao_config_id: lead.automacao_config_id,
            lead_cnpj: lead.cnpj,
            phone,
            contact_name: nomeEmpresa,
            mensagem,
            status: 'pendente',
            agendado_para: proximoFollowup.toISOString(),
            numero_verificado: true,
            sequence_step: nextStep,
            message_type: 'texto',
          })

        if (fuErr) {
          console.error(
            `[queue-leads] erro follow-up ${lead.cnpj} step${nextStep}:`,
            fuErr.message,
          )
          continue
        }

        // Atualizar step e data do último envio no lead
        await supabase
          .from('leads_automacao_pendentes')
          .update({
            whatsapp_sequence_step: nextStep,
            whatsapp_enviado_em: new Date().toISOString(),
          })
          .eq('id', lead.id)

        totalFollowups++
        console.log(
          `[queue-leads] follow-up step${nextStep} agendado para ${lead.cnpj}`,
        )
      }
    }

    return json({
      ok: true,
      enfileirados: totalEnfileirados,
      followups: totalFollowups,
    })
  } catch (err: any) {
    console.error('[queue-leads] erro:', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
