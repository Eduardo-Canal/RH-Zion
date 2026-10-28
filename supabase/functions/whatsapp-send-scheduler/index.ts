import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string
  instance_id: string
  automacao_config_id: string | null
  lead_cnpj: string | null
  phone: string
  contact_name: string | null
  mensagem: string
  tentativas: number
  max_tentativas: number
  sequence_step: number
  message_type: string
}

interface ModuleConfig {
  uazapi_base_url: string
  uazapi_global_token: string
  horario_inicio: string
  horario_fim: string
  dias_semana: number[]
}

// ─── Autorização ──────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  const secret =
    Deno.env.get('WHATSAPP_SCHEDULER_SECRET') || 'zion-whatsapp-local-2026'
  const auth = req.headers.get('Authorization') || ''
  return auth === `Bearer ${secret}`
}

// ─── Verificar horário comercial ──────────────────────────────────────────────

function isBusinessHour(config: ModuleConfig): boolean {
  const now = new Date()
  const diaSemana = now.getDay()
  if (!config.dias_semana.includes(diaSemana)) return false

  const [hIni, mIni] = config.horario_inicio.split(':').map(Number)
  const [hFim, mFim] = config.horario_fim.split(':').map(Number)
  const minAtual = now.getHours() * 60 + now.getMinutes()
  return minAtual >= hIni * 60 + mIni && minAtual < hFim * 60 + mFim
}

// ─── Helper de token e body ───────────────────────────────────────────────────

function buildApiParams(
  instanceToken: string | null,
  globalToken: string,
  instanceKey: string,
): { token: string; instanceBody: Record<string, string> } {
  const token = instanceToken?.trim() || globalToken
  const instanceBody = instanceToken?.trim()
    ? {}
    : { instanceName: instanceKey }
  return { token, instanceBody }
}

// ─── Item 4: Typing simulation ────────────────────────────────────────────────
// Envia presença "composing", aguarda tempo proporcional à mensagem, depois "paused"

async function sendTypingPresence(
  baseUrl: string,
  token: string,
  instanceBody: Record<string, string>,
  phone: string,
  textLength: number,
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/sendPresence`
  const durationMs = Math.min(6000, Math.max(2000, textLength * 40))

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({
      ...instanceBody,
      number: phone,
      presence: 'composing',
    }),
  }).catch(() => {})

  await new Promise((r) => setTimeout(r, durationMs))

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({
      ...instanceBody,
      number: phone,
      presence: 'paused',
    }),
  }).catch(() => {})
}

// Predicado único: phone válido = só dígitos (sanitizado pelo queue-leads / feira-dispatch).
// Usado nos guards do loop SDR e do loop feira — uma regra, dois pontos.
const isDigitsOnly = (p: string) => /^\d+$/.test(p)

import { normalizeBRPhone } from '../_shared/normalize-phone.ts'

// ─── Enviar mensagem de texto ─────────────────────────────────────────────────

async function sendTextMessage(
  baseUrl: string,
  token: string,
  instanceBody: Record<string, string>,
  phone: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ ...instanceBody, number: phone, text }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`uazapi sendText ${res.status}: ${body}`)
  }
}

// ─── Item 2: Enviar mensagem com botões (primeiro contato) ────────────────────

async function sendButtonMessage(
  baseUrl: string,
  token: string,
  instanceBody: Record<string, string>,
  phone: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/send/buttons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({
      ...instanceBody,
      number: phone,
      text,
      footer: 'Zion Logtec',
      buttons: [
        {
          buttonId: 'interesse',
          buttonText: { displayText: '✅ Tenho interesse' },
          type: 1,
        },
        {
          buttonId: 'mais_info',
          buttonText: { displayText: '💬 Me conta mais' },
          type: 1,
        },
        {
          buttonId: 'nao_obg',
          buttonText: { displayText: '❌ Não, obrigado' },
          type: 1,
        },
      ],
      headerType: 1,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`uazapi sendButtons ${res.status}: ${body}`)
  }
}

// ─── Contar envios de hoje para uma campanha ──────────────────────────────────

async function countEnviadosHoje(
  supabase: ReturnType<typeof createClient>,
  automacaoConfigId: string,
): Promise<number> {
  const hoje = new Date()
  const inicioHoje = new Date(
    hoje.getFullYear(),
    hoje.getMonth(),
    hoje.getDate(),
  ).toISOString()

  const { count } = await supabase
    .from('whatsapp_send_queue')
    .select('id', { count: 'exact', head: true })
    .eq('automacao_config_id', automacaoConfigId)
    .in('status', ['enviado', 'enviando'])
    .gte('enviado_em', inicioHoje)

  return count || 0
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
    // ── 1. Carregar configuração do módulo ────────────────────────────────────
    const { data: moduleConfig } = await supabase
      .from('whatsapp_module_config')
      .select(
        'uazapi_base_url, uazapi_global_token, horario_inicio, horario_fim, dias_semana',
      )
      .eq('id', 1)
      .maybeSingle()

    if (!moduleConfig) {
      console.warn('[send-scheduler] módulo WhatsApp não configurado')
      return json({ ok: true, enviados: 0, motivo: 'sem config' })
    }

    const config = moduleConfig as ModuleConfig

    // ── 2. Verificar horário comercial ────────────────────────────────────────
    if (!isBusinessHour(config)) {
      console.log('[send-scheduler] fora do horário comercial — abortando')
      return json({ ok: true, enviados: 0, motivo: 'fora horario' })
    }

    if (!config.uazapi_global_token) {
      console.warn('[send-scheduler] token uazapi não configurado')
      return json({ ok: true, enviados: 0, motivo: 'sem token' })
    }

    // ── 3. Buscar instância principal conectada (com instance_token) ──────────
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_key, instance_token')
      .eq('tipo', 'principal')
      .eq('ativo', true)
      .eq('status', 'conectado')
      .maybeSingle()

    if (!instance?.instance_key) {
      console.log('[send-scheduler] nenhuma instância principal conectada')
      return json({ ok: true, enviados: 0, motivo: 'sem instancia' })
    }

    const { token, instanceBody } = buildApiParams(
      instance.instance_token,
      config.uazapi_global_token,
      instance.instance_key,
    )
    const baseUrl = config.uazapi_base_url || 'https://free.uazapi.com'

    // ── 4. Buscar itens vencidos na fila ──────────────────────────────────────
    const agora = new Date().toISOString()
    const { data: items } = await supabase
      .from('whatsapp_send_queue')
      .select(
        'id, instance_id, automacao_config_id, lead_cnpj, phone, contact_name, mensagem, tentativas, max_tentativas, sequence_step, message_type',
      )
      .eq('status', 'pendente')
      .eq('instance_id', instance.id)
      .lte('agendado_para', agora)
      .order('agendado_para', { ascending: true })
      .limit(10)

    const limiteCache: Record<string, { enviados: number; limite: number }> = {}
    let totalEnviados = 0
    let totalErros = 0

    for (const item of (items || []) as QueueItem[]) {
      // ── 5. Verificar limite diário por campanha ─────────────────────────
      if (item.automacao_config_id) {
        if (!limiteCache[item.automacao_config_id]) {
          const { data: camp } = await supabase
            .from('automacao_config')
            .select('whatsapp_limite_diario')
            .eq('id', item.automacao_config_id)
            .maybeSingle()

          const enviados = await countEnviadosHoje(
            supabase,
            item.automacao_config_id,
          )
          limiteCache[item.automacao_config_id] = {
            enviados,
            limite: camp?.whatsapp_limite_diario || 50,
          }
        }

        const cache = limiteCache[item.automacao_config_id]
        if (cache.enviados >= cache.limite) {
          console.log(
            `[send-scheduler] campanha ${item.automacao_config_id} atingiu limite diário`,
          )
          await supabase
            .from('whatsapp_send_queue')
            .update({
              status: 'cancelado',
              erro_mensagem: 'Limite diário atingido',
              atualizado_em: new Date().toISOString(),
            })
            .eq('id', item.id)
          continue
        }
      }

      // ── 6. Lock otimista ────────────────────────────────────────────────
      // .select('id') devolve as linhas afetadas: array vazio = outro processo
      // já trancou (UPDATE não casou com .eq('status','pendente')), sem ser erro.
      const { data: locked, error: lockError } = await supabase
        .from('whatsapp_send_queue')
        .update({ status: 'enviando', atualizado_em: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pendente')
        .select('id')

      if (lockError || !locked || locked.length === 0) continue

      // Validar e normalizar telefone BR antes do envio
      const phoneSDR = normalizeBRPhone(item.phone)
      if (!phoneSDR.valid) {
        console.error(
          `[send-scheduler] sdr: phone inválido "${item.phone}" — ${phoneSDR.reason}, item ${item.id}`,
        )
        await supabase
          .from('whatsapp_send_queue')
          .update({
            status: 'erro',
            erro_mensagem: `telefone fora do padrão celular BR - revisar (${phoneSDR.reason})`,
            agendado_para: null,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', item.id)
        continue
      }

      try {
        // ── 7. Item 4: Typing simulation antes de enviar ────────────────
        await sendTypingPresence(
          baseUrl,
          token,
          instanceBody,
          phoneSDR.number,
          item.mensagem.length,
        )

        // ── 8. Enviar mensagem (botão no primeiro contato, texto nos demais)
        const useButton =
          item.sequence_step === 0 && item.message_type === 'botao'
        if (useButton) {
          try {
            await sendButtonMessage(
              baseUrl,
              token,
              instanceBody,
              phoneSDR.number,
              item.mensagem,
            )
          } catch (btnErr: any) {
            // Fallback para texto se botões não suportados
            console.warn(
              `[send-scheduler] sendButtons falhou, fallback para texto: ${btnErr.message}`,
            )
            await sendTextMessage(
              baseUrl,
              token,
              instanceBody,
              phoneSDR.number,
              item.mensagem,
            )
          }
        } else {
          await sendTextMessage(
            baseUrl,
            token,
            instanceBody,
            phoneSDR.number,
            item.mensagem,
          )
        }

        // ── 9. Marcar como enviado ────────────────────────────────────
        await supabase
          .from('whatsapp_send_queue')
          .update({
            status: 'enviado',
            enviado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', item.id)

        // ── 10. Atualizar status do lead ──────────────────────────────
        if (item.lead_cnpj && item.automacao_config_id) {
          await supabase
            .from('leads_automacao_pendentes')
            .update({
              whatsapp_status: 'enviado',
              whatsapp_enviado_em: new Date().toISOString(),
            })
            .eq('cnpj', item.lead_cnpj)
            .eq('automacao_config_id', item.automacao_config_id)
        }

        if (item.automacao_config_id && limiteCache[item.automacao_config_id]) {
          limiteCache[item.automacao_config_id].enviados++
        }

        totalEnviados++
        console.log(
          `[send-scheduler] enviado para ${item.phone} step${item.sequence_step} (${item.contact_name || item.lead_cnpj})`,
        )
      } catch (sendErr: any) {
        console.error(
          `[send-scheduler] falha ao enviar para ${item.phone}:`,
          sendErr.message,
        )
        totalErros++

        const novasTentativas = (item.tentativas || 0) + 1
        const statusFinal =
          novasTentativas >= (item.max_tentativas || 3) ? 'erro' : 'pendente'

        if (
          statusFinal === 'erro' &&
          item.lead_cnpj &&
          item.automacao_config_id
        ) {
          await supabase
            .from('leads_automacao_pendentes')
            .update({ whatsapp_status: 'erro' })
            .eq('cnpj', item.lead_cnpj)
            .eq('automacao_config_id', item.automacao_config_id)
        }

        const backoffMs = novasTentativas * 5 * 60 * 1000
        const proximaTentativa = new Date(Date.now() + backoffMs).toISOString()

        await supabase
          .from('whatsapp_send_queue')
          .update({
            status: statusFinal,
            tentativas: novasTentativas,
            erro_mensagem: sendErr.message,
            agendado_para: statusFinal === 'pendente' ? proximaTentativa : null,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', item.id)
      }
    }

    console.log(
      `[send-scheduler] fila SDR — enviados: ${totalEnviados}, erros: ${totalErros}`,
    )

    // ── R15: Processar fila de disparos de feiras (feira_disparos_log) ────────
    let feiraEnviados = 0
    let feiraErros = 0

    const { data: feiraItems } = await supabase
      .from('feira_disparos_log')
      .select(
        'id, lead_pendente_id, mensagem_final, whatsapp_phone, automacao_config_id, tipo_disparo',
      )
      .eq('status', 'agendado')
      .lte('agendado_para', agora)
      .order('agendado_para', { ascending: true })
      .limit(20)

    for (const feiraItem of feiraItems || []) {
      const phone = feiraItem.whatsapp_phone
      if (!phone) {
        await supabase
          .from('feira_disparos_log')
          .update({ status: 'falha', erro_mensagem: 'Telefone não informado' })
          .eq('id', feiraItem.id)
        continue
      }

      // Validar e normalizar telefone BR antes do envio
      const phoneResult = normalizeBRPhone(phone)
      if (!phoneResult.valid) {
        console.warn(
          `[send-scheduler] feira: phone inválido "${phone}" — ${phoneResult.reason}, lead ${feiraItem.lead_pendente_id}`,
        )
        await supabase
          .from('feira_disparos_log')
          .update({
            status: 'falha',
            erro_mensagem: `telefone fora do padrão celular BR - revisar (${phoneResult.reason})`,
          })
          .eq('id', feiraItem.id)
        continue
      }

      if (!feiraItem.mensagem_final || feiraItem.mensagem_final.length === 0) {
        console.error(
          `[send-scheduler] feira: mensagem_final vazia ou nula, lead ${feiraItem.lead_pendente_id}`,
        )
        await supabase
          .from('feira_disparos_log')
          .update({
            status: 'falha',
            erro_mensagem: 'mensagem_final vazia ou nula',
          })
          .eq('id', feiraItem.id)
        continue
      }

      // ── Lock otimista: evita envio duplicado em execuções concorrentes ──────
      const { data: feiraLocked, error: feiraLockErr } = await supabase
        .from('feira_disparos_log')
        .update({ status: 'enviando' })
        .eq('id', feiraItem.id)
        .eq('status', 'agendado')
        .select('id')
      if (feiraLockErr || !feiraLocked || feiraLocked.length === 0) {
        console.warn(
          `[send-scheduler] feira: lock não adquirido para ${feiraItem.id} — outro processo já processou`,
        )
        continue
      }

      // FUP: não enviar se o lead já respondeu entre o agendamento e o envio
      if (feiraItem.tipo_disparo === 'fup') {
        const { data: leadAtual } = await supabase
          .from('leads_automacao_pendentes')
          .select('whatsapp_status')
          .eq('id', feiraItem.lead_pendente_id)
          .maybeSingle()
        if (leadAtual?.whatsapp_status === 'respondido') {
          await supabase
            .from('feira_disparos_log')
            .update({
              status: 'cancelado',
              erro_mensagem: 'Lead respondeu antes do envio do FUP',
            })
            .eq('id', feiraItem.id)
          console.log(
            `[send-scheduler] FUP cancelado: lead ${feiraItem.lead_pendente_id} já respondeu`,
          )
          continue
        }
      }

      try {
        await sendTypingPresence(
          baseUrl,
          token,
          instanceBody,
          phoneResult.number,
          feiraItem.mensagem_final.length,
        )
        await sendTextMessage(
          baseUrl,
          token,
          instanceBody,
          phoneResult.number,
          feiraItem.mensagem_final,
        )

        await supabase
          .from('feira_disparos_log')
          .update({
            status: 'enviado',
            enviado_em: new Date().toISOString(),
          })
          .eq('id', feiraItem.id)

        await supabase
          .from('leads_automacao_pendentes')
          .update({
            whatsapp_status: 'enviado',
            whatsapp_enviado_em: new Date().toISOString(),
            whatsapp_phone: phoneResult.number,
          })
          .eq('id', feiraItem.lead_pendente_id)
          .neq('whatsapp_status', 'respondido')

        feiraEnviados++
        console.log(
          `[send-scheduler] feira enviado para ${phoneResult.number} (lead ${feiraItem.lead_pendente_id})`,
        )
      } catch (sendErr: any) {
        console.error(
          `[send-scheduler] feira falha para ${phoneResult.number}:`,
          sendErr.message,
        )
        feiraErros++

        await supabase
          .from('feira_disparos_log')
          .update({
            status: 'falha',
            erro_mensagem: sendErr.message,
          })
          .eq('id', feiraItem.id)

        await supabase
          .from('leads_automacao_pendentes')
          .update({
            whatsapp_status: 'erro',
          })
          .eq('id', feiraItem.lead_pendente_id)
      }
    }

    if (feiraEnviados + feiraErros > 0) {
      console.log(
        `[send-scheduler] fila feira — enviados: ${feiraEnviados}, erros: ${feiraErros}`,
      )
    }

    return json({
      ok: true,
      enviados: totalEnviados,
      erros: totalErros,
      feira_enviados: feiraEnviados,
      feira_erros: feiraErros,
    })
  } catch (err: any) {
    console.error('[send-scheduler] erro geral:', err.message)
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
