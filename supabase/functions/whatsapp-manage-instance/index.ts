import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { isPhoneSilenced } from '../_shared/silenceFilter.ts'
import { isServiceRoleCall } from '../_shared/require-user.ts'

// ─── Helper: normalizar message_id removendo prefixo do uazapi ──────────────
// O uazapi às vezes manda IDs no formato "<phone>:<id>" no echo de mensagens
// enviadas. Stripa o prefixo para que o onConflict('message_id') deduplique
// corretamente quando whatsapp-send-message já inseriu a mensagem.
function normalizeMessageId(rawId: string | null | undefined): string {
  if (!rawId) return ''
  const colonIdx = rawId.lastIndexOf(':')
  if (colonIdx > 0 && rawId.length - colonIdx - 1 >= 16) {
    return rawId.slice(colonIdx + 1)
  }
  return rawId
}

// ─── Helpers uazapi.dev ────────────────────────────────────────────────────────

async function uazapiRequest(
  baseUrl: string,
  token: string,
  path: string,
  method = 'GET',
  body?: any,
): Promise<any> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      token: token,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      data?.msg ||
      data?.detail ||
      data?.description
    throw new Error(
      msg ? String(msg) : `uazapi HTTP ${res.status}: ${JSON.stringify(data)}`,
    )
  }
  return data
}

/**
 * Roteia chamadas à API uazapi: paths são sempre planos (/instance/connect, /chat/find, etc.).
 * A uazapi não usa chave embutida no path — autenticação é pelo header `token`.
 * - Com instance_token: usa o token da instância (autenticação por instância)
 * - Sem instance_token: usa o globalToken como fallback
 */
function instanceApiRequest(
  baseUrl: string,
  globalToken: string,
  instanceKey: string,
  instanceToken: string | null | undefined,
  path: string,
  method = 'GET',
  body?: any,
): Promise<any> {
  if (instanceToken?.trim()) {
    return uazapiRequest(baseUrl, instanceToken.trim(), path, method, body)
  }
  return uazapiRequest(baseUrl, globalToken, path, method, body)
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Acesso restrito a Administrador — achado de auditoria de 22/07/2026:
    // esta function não tinha nenhuma checagem de auth e permitia ler/reescrever
    // o uazapi_global_token e sequestrar o webhook de todas as instâncias.
    // Mesmo padrão de admin-create-user / sync-commission-consultant.
    //
    // Exceção mínima (N-07): service-role só pode consultar status — é a
    // chamada interna do whatsapp-health-check, que não carrega JWT de usuário.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Token ausente' }, 401)

    let payload: any

    if (isServiceRoleCall(req)) {
      payload = await req.json().catch(() => ({}))
      if (payload?.action !== 'status') {
        return json({ error: 'Service-role só pode consultar status' }, 403)
      }
    } else {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim()
      const supabaseAuth = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY') || '',
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      )
      const { data: userData, error: userError } =
        await supabaseAuth.auth.getUser(token)
      if (userError || !userData?.user)
        return json({ error: 'Token inválido' }, 401)

      const { data: profile } = await supabase
        .from('profiles')
        .select('*, perfis_acesso(*)')
        .eq('user_id', userData.user.id)
        .maybeSingle()

      const pa: any = profile?.perfis_acesso
      const nomePerfil = Array.isArray(pa) ? pa[0]?.nome : pa?.nome
      const permissoesPerfil = Array.isArray(pa)
        ? pa[0]?.permissoes
        : pa?.permissoes
      const isAdmin =
        nomePerfil === 'Administrador' ||
        (Array.isArray(permissoesPerfil) &&
          permissoesPerfil.includes('Acessar Admin'))
      if (!isAdmin)
        return json({ error: 'Acesso restrito a administradores' }, 403)

      payload = await req.json().catch(() => ({}))
    }

    const { data: moduleConfig } = await supabase
      .from('whatsapp_module_config')
      .select('uazapi_base_url, uazapi_global_token')
      .eq('id', 1)
      .maybeSingle()

    const baseUrl = moduleConfig?.uazapi_base_url || 'https://free.uazapi.com'
    const globalToken = moduleConfig?.uazapi_global_token || ''

    const { action } = payload

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: instances, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .order('criado_em', { ascending: true })

      if (error) throw error
      return json({ instances: instances || [] })
    }

    // ── CREATE ────────────────────────────────────────────────────────────────
    if (action === 'create') {
      const {
        nome,
        tipo,
        bitrix_user_id,
        bitrix_user_nome,
        profile_user_id,
        instance_key: providedKey,
        instance_token: providedToken,
      } = payload

      if (!nome) return json({ error: 'Campo "nome" obrigatório' }, 400)

      let instanceKey: string
      let uazapiRes: any = null

      if (providedKey?.trim()) {
        instanceKey = providedKey.trim()
      } else {
        if (!globalToken)
          return json(
            {
              error:
                'Token uazapi não configurado. Configure em Configurações > WhatsApp.',
            },
            400,
          )
        const nomeSlug =
          nome
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 8) || 'inst'
        instanceKey = `zion${nomeSlug}${Date.now().toString(36)}`

        // /instance/init exige header "admintoken" e body com "name".
        // Não usar uazapiRequest aqui — ela manda header "token", que a uazapi
        // rejeita como Unauthorized para chamadas administrativas.
        const initUrl = `${baseUrl.replace(/\/$/, '')}/instance/init`
        const initRes = await fetch(initUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            admintoken: globalToken,
          },
          body: JSON.stringify({ name: instanceKey }),
        })

        const initData = await initRes.json().catch(() => null)

        if (!initRes.ok) {
          const apiErr =
            initData?.message || initData?.error || `HTTP ${initRes.status}`
          const status =
            initRes.status === 401 || initRes.status === 403 ? 401 : 500
          return json(
            { error: `Falha ao criar instância na uazapi: ${apiErr}` },
            status,
          )
        }

        uazapiRes = initData
      }

      // Extrair token retornado pela uazapi na criação automática
      const tokenFromUazapi =
        uazapiRes?.token || uazapiRes?.instance?.token || null
      const finalInstanceToken = providedToken?.trim() || tokenFromUazapi

      const { data: instance, error: insertError } = await supabase
        .from('whatsapp_instances')
        .insert({
          nome,
          tipo: tipo || 'executivo',
          instance_key: instanceKey,
          instance_token: finalInstanceToken,
          status: 'desconectado',
          bitrix_user_id: bitrix_user_id || null,
          bitrix_user_nome: bitrix_user_nome || null,
          profile_user_id: profile_user_id || null,
        })
        .select()
        .single()

      if (insertError) throw insertError
      return json({ instance, uazapi: uazapiRes })
    }

    // ── UPDATE_TOKEN — salvar token da instância ──────────────────────────────
    if (action === 'update_token') {
      const { instance_id, instance_token } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { error } = await supabase
        .from('whatsapp_instances')
        .update({
          instance_token: instance_token?.trim() || null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', instance_id)

      if (error) throw error
      return json({ success: true })
    }

    // ── QR ────────────────────────────────────────────────────────────────────
    if (action === 'qr') {
      const { instance_id } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token, status')
        .eq('id', instance_id)
        .maybeSingle()

      if (!instance) return json({ error: 'Instância não encontrada' }, 404)
      if (!instance.instance_token && !globalToken) {
        return json(
          {
            error:
              'Token da instância não configurado. Informe o Instance Token obtido no painel uazapi.dev.',
          },
          400,
        )
      }

      await supabase
        .from('whatsapp_instances')
        .update({
          status: 'conectando',
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', instance_id)

      // Paid tier (zionlogtec.uazapi.com): POST /instance/connect com instance token
      // Free tier (free.uazapi.com): GET /instance/connect
      let connectRes: any = null
      const candidates = [
        ['/instance/connect', 'POST'],
        ['/instance/connect', 'GET'],
        ['/instance/qrcode', 'GET'],
        ['/instance/qr', 'GET'],
      ] as const

      for (const [path, method] of candidates) {
        try {
          connectRes = await instanceApiRequest(
            baseUrl,
            globalToken,
            instance.instance_key,
            instance.instance_token,
            path,
            method,
          )
          const testQr =
            connectRes?.instance?.qrcode ||
            connectRes?.qrcode ||
            connectRes?.base64 ||
            connectRes?.qr
          if (testQr) break // QR encontrado, parar tentativas
          // Sem QR mas sem erro — pode ser que já está conectado
          const jaConectado =
            connectRes?.status?.connected === true ||
            connectRes?.instance?.status === 'open'
          if (jaConectado) break
        } catch (e: any) {
          if (
            !e.message?.includes('405') &&
            !e.message?.includes('404') &&
            !e.message?.includes('Method Not Allowed') &&
            !e.message?.includes('Not Found')
          ) {
            throw e // erro inesperado, propagar
          }
          // 404/405 → tentar próximo candidato
        }
      }

      const qr =
        connectRes?.instance?.qrcode ||
        connectRes?.qrcode ||
        connectRes?.base64 ||
        connectRes?.qr
      console.log(
        '[manage-instance] connect raw response:',
        JSON.stringify(connectRes),
      )
      return json({ qr: qr || null, raw: connectRes })
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (action === 'status') {
      const { instance_id } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token')
        .eq('id', instance_id)
        .maybeSingle()

      if (!instance) return json({ error: 'Instância não encontrada' }, 404)

      // Endpoint correto: GET /instance/status
      // Resposta: { instance: { status, qrcode, ... }, status: { connected, loggedIn, jid } }
      const statusRes = await instanceApiRequest(
        baseUrl,
        globalToken,
        instance.instance_key,
        instance.instance_token,
        '/instance/status',
      )

      const connected =
        statusRes?.status?.connected === true ||
        statusRes?.status?.loggedIn === true
      const rawStatus: string =
        statusRes?.instance?.status || statusRes?.status?.state || ''
      const newStatus = connected ? 'conectado' : 'desconectado'
      // status pode também retornar qrcode quando ainda aguardando scan
      const qrFromStatus =
        statusRes?.instance?.qrcode ||
        statusRes?.qrcode ||
        statusRes?.qr ||
        null

      const updates: Record<string, any> = {
        status: newStatus,
        ultimo_ping: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }
      if (connected) {
        const jid = statusRes?.status?.jid || ''
        if (jid) updates.numero = jid.split('@')[0].split(':')[0]
      }

      await supabase
        .from('whatsapp_instances')
        .update(updates)
        .eq('id', instance_id)

      return json({ status: newStatus, raw: rawStatus, qr: qrFromStatus })
    }

    // ── DISCONNECT ────────────────────────────────────────────────────────────
    if (action === 'disconnect') {
      const { instance_id } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token')
        .eq('id', instance_id)
        .maybeSingle()

      if (!instance) return json({ error: 'Instância não encontrada' }, 404)

      if (instance.instance_token || globalToken) {
        // Endpoint correto: POST /instance/disconnect
        await instanceApiRequest(
          baseUrl,
          globalToken,
          instance.instance_key,
          instance.instance_token,
          '/instance/disconnect',
          'POST',
        ).catch(() => {
          /* ignora se já estava desconectado */
        })
      }

      await supabase
        .from('whatsapp_instances')
        .update({
          status: 'desconectado',
          numero: '',
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', instance_id)

      return json({ success: true })
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { instance_id } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token, tipo')
        .eq('id', instance_id)
        .maybeSingle()

      if (!instance) return json({ error: 'Instância não encontrada' }, 404)

      // Endpoint correto: DELETE /instance (usa token da própria instância ou admin token)
      if (instance.instance_token || globalToken) {
        await instanceApiRequest(
          baseUrl,
          globalToken,
          instance.instance_key,
          instance.instance_token,
          '/instance',
          'DELETE',
        ).catch(() => {})
      }

      await supabase
        .from('whatsapp_instances')
        .update({
          ativo: false,
          status: 'desconectado',
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', instance_id)

      return json({ success: true })
    }

    // ── UPDATE_NUMBER ─────────────────────────────────────────────────────────
    if (action === 'update_number') {
      const { instance_id, numero } = payload
      if (!instance_id || !numero)
        return json({ error: 'instance_id e numero obrigatórios' }, 400)

      await supabase
        .from('whatsapp_instances')
        .update({
          numero,
          status: 'conectado',
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', instance_id)

      return json({ success: true })
    }

    // ── REGISTER_WEBHOOK — registra URL do webhook em todas as instâncias ────────
    if (action === 'register_webhook') {
      const { instance_id } = payload
      // PUBLIC_FUNCTIONS_URL é a URL pública das edge functions (acessível pelo uazapi externo).
      // Em ambiente local: URL do tunnel (ex: https://xxxx.serveousercontent.com)
      // Em Oracle Cloud: domínio público da API (ex: https://api.zionlogtec.com.br)
      // Fallback para SUPABASE_URL apenas se PUBLIC_FUNCTIONS_URL não existir (modo dev sem tunnel)
      const publicUrl =
        Deno.env.get('PUBLIC_FUNCTIONS_URL') ||
        Deno.env.get('SUPABASE_URL') ||
        ''
      if (!publicUrl) {
        return json(
          {
            error:
              'PUBLIC_FUNCTIONS_URL não configurada — webhook não pode ser registrado',
          },
          500,
        )
      }
      const webhookSecret = Deno.env.get('WHATSAPP_WEBHOOK_SECRET') || ''
      const webhookUrl = webhookSecret
        ? `${publicUrl}/functions/v1/whatsapp-webhook-router?secret=${webhookSecret}`
        : `${publicUrl}/functions/v1/whatsapp-webhook-router`

      const query = supabase
        .from('whatsapp_instances')
        .select('id, instance_key, instance_token')
        .eq('ativo', true)
      if (instance_id) query.eq('id', instance_id)

      const { data: instances, error: listErr } = await query
      if (listErr) throw listErr

      const results: any[] = []
      for (const inst of instances || []) {
        if (!inst.instance_token && !globalToken) {
          results.push({ id: inst.id, status: 'sem_token' })
          continue
        }
        try {
          await instanceApiRequest(
            baseUrl,
            globalToken,
            inst.instance_key,
            inst.instance_token,
            '/webhook',
            'POST',
            {
              enabled: true,
              url: webhookUrl,
              events: ['messages', 'connection'],
              excludeMessages: ['wasSentByApi'],
            },
          )
          results.push({ id: inst.id, status: 'ok' })
        } catch (e: any) {
          results.push({ id: inst.id, status: 'erro', message: e.message })
        }
      }
      return json({ results, webhook_url: webhookUrl })
    }

    // ── SAVE_CONFIG ───────────────────────────────────────────────────────────
    if (action === 'save_config') {
      const {
        uazapi_base_url,
        uazapi_global_token,
        horario_inicio,
        horario_fim,
        dias_semana,
        responsavel_bitrix_id,
        responsavel_nome,
        prompt_base,
        chatbot_stop_keyword,
        chatbot_stop_minutes,
      } = payload

      const updates: any = { atualizado_em: new Date().toISOString() }
      if (uazapi_base_url !== undefined)
        updates.uazapi_base_url = uazapi_base_url
      if (uazapi_global_token !== undefined)
        updates.uazapi_global_token = uazapi_global_token
      if (horario_inicio !== undefined) updates.horario_inicio = horario_inicio
      if (horario_fim !== undefined) updates.horario_fim = horario_fim
      if (dias_semana !== undefined) updates.dias_semana = dias_semana
      if (responsavel_bitrix_id !== undefined)
        updates.responsavel_bitrix_id = responsavel_bitrix_id
      if (responsavel_nome !== undefined)
        updates.responsavel_nome = responsavel_nome
      if (prompt_base !== undefined) updates.prompt_base = prompt_base
      if (chatbot_stop_keyword !== undefined)
        updates.chatbot_stop_keyword = chatbot_stop_keyword
      if (chatbot_stop_minutes !== undefined)
        updates.chatbot_stop_minutes = chatbot_stop_minutes

      const { error } = await supabase
        .from('whatsapp_module_config')
        .update(updates)
        .eq('id', 1)
      if (error) throw error
      return json({ success: true })
    }

    // ── GET_CONFIG ────────────────────────────────────────────────────────────
    if (action === 'get_config') {
      const { data: config, error } = await supabase
        .from('whatsapp_module_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle()

      if (error) throw error
      return json({ config })
    }

    // ── SYNC_RECENT — importa chats e mensagens dos últimos 7 dias ──────────
    if (action === 'sync_recent') {
      const { instance_id } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token')
        .eq('id', instance_id)
        .maybeSingle()

      if (!instance) return json({ error: 'Instância não encontrada' }, 404)
      if (!instance.instance_token && !globalToken) {
        return json({ error: 'Token não configurado' }, 400)
      }

      let chatsRes: any
      try {
        chatsRes = await instanceApiRequest(
          baseUrl,
          globalToken,
          instance.instance_key,
          instance.instance_token,
          '/chat/find',
          'POST',
          { limit: 50, sort: '-wa_lastMsgTimestamp' },
        )
      } catch (e: any) {
        return json({ error: `Erro ao buscar chats: ${e.message}` }, 500)
      }

      console.log(
        '[sync_recent] /chat/find raw:',
        JSON.stringify(chatsRes).slice(0, 500),
      )
      const chats: any[] = chatsRes?.chats || []
      let conversasImportadas = 0
      let mensagensImportadas = 0
      const erros: string[] = []

      const typeMap: Record<string, string> = {
        conversation: 'texto',
        extendedTextMessage: 'texto',
        imageMessage: 'imagem',
        documentMessage: 'documento',
        audioMessage: 'audio',
        videoMessage: 'video',
        stickerMessage: 'sticker',
      }

      for (const chat of chats) {
        const jid: string = chat.wa_chatid || chat.wa_fastid || ''
        if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast'))
          continue

        const phone = jid.replace(/@s\.whatsapp\.net$/, '').split(':')[0]

        // Filtro de silenciamento: pula chats de números silenciados.
        // Mantém paridade com o filtro do whatsapp-webhook-router para
        // garantir que mensagens silenciadas nunca toquem o banco.
        const silenced = await isPhoneSilenced(supabase, instance_id, phone)
        if (silenced) {
          console.log(`[sync_recent] chat ${phone} silenciado, pulando`)
          continue
        }

        const contactName: string =
          chat.wa_contactName || chat.wa_name || chat.name || phone
        // wa_lastMsgTimestamp do uazapi já vem em ms; evitar multiplicar por 1000 novamente
        const tsToMs = (ts: number) => (ts > 1e12 ? ts : ts * 1000)
        const lastContact = chat.wa_lastMsgTimestamp
          ? new Date(tsToMs(chat.wa_lastMsgTimestamp)).toISOString()
          : new Date().toISOString()

        const { data: existingConv } = await supabase
          .from('whatsapp_conversations')
          .select('id')
          .eq('instance_id', instance_id)
          .eq('phone', phone)
          .maybeSingle()

        let convId: string
        if (existingConv) {
          await supabase
            .from('whatsapp_conversations')
            .update({ contact_name: contactName, ultimo_contato: lastContact })
            .eq('id', existingConv.id)
          convId = existingConv.id
        } else {
          const { data: newConv, error: createErr } = await supabase
            .from('whatsapp_conversations')
            .insert({
              instance_id,
              phone,
              contact_name: contactName,
              estado: 'INICIO',
              bot_ativo: true,
              automacao_config_id: null,
              ultimo_contato: lastContact,
            })
            .select('id')
            .single()

          if (createErr || !newConv) {
            erros.push(`Conv ${phone}: ${createErr?.message}`)
            continue
          }
          convId = newConv.id
          conversasImportadas++
        }

        let msgsRes: any
        try {
          msgsRes = await instanceApiRequest(
            baseUrl,
            globalToken,
            instance.instance_key,
            instance.instance_token,
            '/message/find',
            'POST',
            { chatid: jid, limit: 100, offset: 0 },
          )
        } catch (e: any) {
          erros.push(`Msgs ${phone}: ${e.message}`)
          continue
        }

        for (const msg of msgsRes?.messages || []) {
          if (!msg.messageid) continue
          const rawType: string = msg.messageType || 'texto'
          const tipo =
            typeMap[rawType] ||
            ([
              'texto',
              'imagem',
              'documento',
              'audio',
              'video',
              'sticker',
            ].includes(rawType)
              ? rawType
              : 'texto')

          // Não armazenar JSON de metadata de mídia como conteudo legível
          const textIsJsonMeta =
            msg.text &&
            typeof msg.text === 'string' &&
            msg.text.trim().startsWith('{')
          const upsertData: Record<string, any> = {
            conversation_id: convId,
            message_id: normalizeMessageId(msg.messageid),
            direcao: msg.fromMe ? 'enviada' : 'recebida',
            tipo,
            conteudo: textIsJsonMeta ? null : msg.text || null,
            processado: true,
          }
          if (msg.messageTimestamp) {
            const tsMs =
              msg.messageTimestamp > 1e12
                ? msg.messageTimestamp
                : msg.messageTimestamp * 1000
            upsertData.criado_em = new Date(tsMs).toISOString()
          }

          const { error: msgErr } = await supabase
            .from('whatsapp_messages')
            .upsert(upsertData, { onConflict: 'message_id' })

          if (!msgErr) mensagensImportadas++
        }
      }

      const totalIndividuais = chats.filter((c) => {
        const j = c.wa_chatid || c.wa_fastid || ''
        return j && !j.endsWith('@g.us') && !j.endsWith('@broadcast')
      }).length

      return json({
        success: true,
        conversas: conversasImportadas,
        mensagens: mensagensImportadas,
        total_chats: totalIndividuais,
        total_chats_raw: chats.length,
        ...(erros.length > 0 ? { erros } : {}),
      })
    }

    // ── HISTORY_SYNC_DEEP — solicita histórico >7 dias ao WhatsApp ──────────
    if (action === 'history_sync_deep') {
      const { instance_id } = payload
      if (!instance_id) return json({ error: 'instance_id obrigatório' }, 400)

      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_key, instance_token')
        .eq('id', instance_id)
        .maybeSingle()

      if (!instance) return json({ error: 'Instância não encontrada' }, 404)
      if (!instance.instance_token && !globalToken) {
        return json({ error: 'Token não configurado' }, 400)
      }

      const { data: conversations } = await supabase
        .from('whatsapp_conversations')
        .select('id, phone')
        .eq('instance_id', instance_id)
        .order('ultimo_contato', { ascending: false })
        .limit(30)

      const results: Array<{
        phone: string
        status: string
        message?: string
      }> = []

      for (const conv of conversations || []) {
        const jid = `${conv.phone}@s.whatsapp.net`
        try {
          await instanceApiRequest(
            baseUrl,
            globalToken,
            instance.instance_key,
            instance.instance_token,
            '/message/history-sync',
            'POST',
            { number: jid, count: 100 },
          )
          results.push({ phone: conv.phone, status: 'solicitado' })
        } catch (e: any) {
          results.push({
            phone: conv.phone,
            status: 'erro',
            message: e.message,
          })
        }
      }

      return json({
        success: true,
        total: conversations?.length || 0,
        results,
        note: 'As mensagens chegarão via webhook nos próximos instantes.',
      })
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400)
  } catch (err: any) {
    console.error('whatsapp-manage-instance error:', err)
    return json({ error: err.message }, 500)
  }
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
