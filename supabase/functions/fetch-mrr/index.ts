import { createSupabaseAdmin } from '../_shared/supabase-admin.ts'
import { corsHeaders } from '../_shared/cors.ts'

const FETCH_TIMEOUT_MS = 25000
const BASE_URL = 'https://api-v2.contaazul.com'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(
        `Timeout ao conectar com ${url} (>${FETCH_TIMEOUT_MS / 1000}s)`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function getStoredTokens(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from('tokens_contaazul')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle()
  return data
}

async function loadContaAzulCredentials(supabaseAdmin: any) {
  let clientId = Deno.env.get('CLIENT_ID') || ''
  let clientSecret = Deno.env.get('CLIENT_SECRET') || ''
  try {
    const { data } = await supabaseAdmin
      .from('abc_curve_config')
      .select('config')
      .eq('type', 'conta_azul')
      .maybeSingle()
    if (data?.config) {
      clientId = String(data.config.client_id || clientId)
      clientSecret = String(data.config.client_secret || clientSecret)
    }
  } catch {
    /* fallback to env */
  }
  return { clientId, clientSecret }
}

async function refreshAccessToken(supabaseAdmin: any, refreshToken: string) {
  const tokenUrl = 'https://auth.contaazul.com/oauth2/token'
  const credentials = await loadContaAzulCredentials(supabaseAdmin)
  const payload = new URLSearchParams()
  payload.set('grant_type', 'refresh_token')
  payload.set('refresh_token', refreshToken)
  payload.set('client_id', credentials.clientId)
  payload.set('client_secret', credentials.clientSecret)

  const res = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(JSON.stringify(data))

  await supabaseAdmin.from('tokens_contaazul').upsert(
    {
      id: '00000000-0000-0000-0000-000000000001',
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in
        ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  return data
}

async function getAccessToken(supabaseAdmin: any) {
  const stored = await getStoredTokens(supabaseAdmin)
  if (!stored)
    throw new Error(
      'Nenhum token Conta Azul registrado. Faça o fluxo de autenticação OAuth.',
    )
  if (stored.expires_at && new Date(stored.expires_at) < new Date()) {
    if (!stored.refresh_token)
      throw new Error('Token expirado e refresh token não encontrado.')
    const refreshed = await refreshAccessToken(
      supabaseAdmin,
      stored.refresh_token,
    )
    return refreshed.access_token
  }
  return stored.access_token
}

async function callApi(accessToken: string, path: string) {
  const url = `${BASE_URL}${path}`
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(JSON.stringify(data))
  return data
}

// Busca todos os contratos do ContaAzul com paginação
// A API usa parâmetros em português: pagina + tamanho_pagina (não page + size)
async function fetchAllContratos(accessToken: string): Promise<any[]> {
  const all: any[] = []
  const seenIds = new Set<string>()
  let pagina = 0 // ContaAzul usa índice 0-based
  let skipCount = 0 // tolera páginas duplicadas (bug do ContaAzul: pagina=1 repete pagina=0)

  while (true) {
    // Ambos data_inicio e data_fim são obrigatórios; data_fim=2099 para incluir prazo indeterminado
    // NOTA: campo_ordenado_ascendente=DATA_INICIO causa bug onde pagina=1 repete pagina=0 — sem sort
    const res = await callApi(
      accessToken,
      `/v1/contratos?data_inicio=2000-01-01&data_fim=2099-12-31&tamanho_pagina=100&pagina=${pagina}`,
    )

    // A resposta pode ser array direto ou wrapper {itens, itens_totais, ...}
    if (pagina === 0)
      console.log(
        `[fetch-mrr] contratos resp_raw=${JSON.stringify(res).slice(0, 200)}`,
      )
    const items: any[] = Array.isArray(res)
      ? res
      : res.itens || res.items || res.data || res.contratos || []

    if (!items.length) {
      console.log(`[fetch-mrr] contratos pagina=${pagina} sem itens — fim`)
      break
    }

    const newItems = items.filter(
      (c: any) => c.id && !seenIds.has(String(c.id)),
    )

    // ContaAzul bug: pagina=1 sempre repete pagina=0 — tolera até 2 páginas duplicadas consecutivas
    if (!newItems.length) {
      skipCount++
      console.log(
        `[fetch-mrr] contratos pagina=${pagina} duplicados (skip ${skipCount}/2)`,
      )
      if (skipCount >= 2) break
      pagina++
      continue
    }
    skipCount = 0
    for (const c of newItems) seenIds.add(String(c.id))
    all.push(...newItems)

    // API ContaAzul usa campo português: itens_totais
    const total = Number(
      res?.itens_totais ||
        res?.totalDeItens ||
        res?.total_de_itens ||
        res?.totalItems ||
        res?.total ||
        res?.quantidade_total ||
        0,
    )
    console.log(
      `[fetch-mrr] contratos pagina=${pagina} +${newItems.length} acumulado=${all.length}${total ? `/${total}` : ''}`,
    )

    if (total > 0 && all.length >= total) break
    pagina++
    await sleep(300)
  }

  if (all.length > 0) {
    const sample = all[0]
    console.log(
      `[fetch-mrr] contrato sample keys: ${Object.keys(sample).join(',')}`,
    )
    console.log(
      `[fetch-mrr] contrato sample cliente: ${JSON.stringify(sample.cliente ?? sample.pessoa ?? 'sem_cliente')}`,
    )
    console.log(
      `[fetch-mrr] contrato sample status: ${sample.status ?? sample.situacao}`,
    )
  }

  return all
}

// Enriquece contratos buscando CNPJ via GET /v1/pessoas/{id} para cada cliente único
async function enriquecerClientesComCnpj(
  accessToken: string,
  contratos: any[],
): Promise<void> {
  const clienteIds = new Map<string, any>()
  for (const c of contratos) {
    const id = c.cliente?.id || c.pessoa?.id
    if (id && !clienteIds.has(id)) clienteIds.set(id, c.cliente || c.pessoa)
  }

  console.log(
    `[fetch-mrr] buscando CNPJ para ${clienteIds.size} clientes únicos...`,
  )
  let enriquecidos = 0

  for (const [id, clienteObj] of clienteIds) {
    try {
      const pessoa = await callApi(accessToken, `/v1/pessoas/${id}`)
      if (pessoa?.documento) {
        clienteObj.documento = pessoa.documento
        enriquecidos++
      }
    } catch {
      /* ignora erros individuais */
    }
    await sleep(150)
  }

  console.log(
    `[fetch-mrr] ${enriquecidos}/${clienteIds.size} clientes com CNPJ obtido`,
  )
}

const PALAVRAS_IGNORADAS = new Set([
  'ltda',
  'ltda.',
  's.a.',
  'sa',
  's/a',
  'eireli',
  'me',
  'epp',
  'inc',
  'epp.',
  'e',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'com',
  'the',
  '-',
  'para',
  'logistica',
  'logísticas',
  'logístico',
  'transportes',
  'transporte',
  'comercio',
  'comércio',
  'importacao',
  'exportacao',
  'importação',
  'exportação',
  'industria',
  'indústria',
  'servicos',
  'serviços',
  'solucoes',
  'soluções',
  'express',
  'cargo',
  'cargas',
  'brasil',
  'nacional',
  'group',
  'grupo',
  'holding',
  'armazens',
  'armazéns',
  'distribuicao',
  'distribuição',
])

function palavrasSignificativas(nome: string): string[] {
  return nome
    .toLowerCase()
    .split(/[\s\-\/]+/)
    .filter((p) => p.length > 2 && !PALAVRAS_IGNORADAS.has(p))
}

function similaridadeNomes(nomeA: string, nomeB: string): number {
  const palavrasA = new Set(palavrasSignificativas(nomeA))
  const palavrasB = new Set(palavrasSignificativas(nomeB))
  if (!palavrasA.size || !palavrasB.size) return 0
  let coincidencias = 0
  for (const p of palavrasA) {
    if (palavrasB.has(p)) coincidencias++
  }
  return coincidencias / Math.min(palavrasA.size, palavrasB.size)
}

// Constrói mapas de lookup a partir dos contratos (cliente.documento e cliente.nome)
function buildLookupFromContratos(contratos: any[]): {
  byCnpj: Map<string, { cliente: any; contratos: any[] }>
  byBaseCnpj: Map<string, { cliente: any; contratos: any[] }[]>
  byWord: Map<string, { cliente: any; contratos: any[] }[]>
} {
  const byCnpj = new Map<string, { cliente: any; contratos: any[] }>()
  const byBaseCnpj = new Map<string, { cliente: any; contratos: any[] }[]>()
  const byWord = new Map<string, { cliente: any; contratos: any[] }[]>()
  const clienteMap = new Map<string, { cliente: any; contratos: any[] }>()

  for (const c of contratos) {
    const clienteId = String(c.cliente?.id || c.pessoa?.id || '')
    if (!clienteId) continue

    if (!clienteMap.has(clienteId)) {
      clienteMap.set(clienteId, {
        cliente: c.cliente || c.pessoa || {},
        contratos: [],
      })
    }
    clienteMap.get(clienteId)!.contratos.push(c)
  }

  for (const entry of clienteMap.values()) {
    const { cliente } = entry
    const cnpj = (cliente.documento || '').replace(/\D/g, '')
    if (cnpj.length >= 11) {
      byCnpj.set(cnpj, entry)
      // Índice por CNPJ base (8 dígitos) para match de filial diferente
      const base = cnpj.slice(0, 8)
      if (!byBaseCnpj.has(base)) byBaseCnpj.set(base, [])
      byBaseCnpj.get(base)!.push(entry)
    }

    const nome = cliente.nome || cliente.name || ''
    for (const word of palavrasSignificativas(nome)) {
      if (!byWord.has(word)) byWord.set(word, [])
      byWord.get(word)!.push(entry)
    }
  }

  return { byCnpj, byBaseCnpj, byWord }
}

function buscarClientePorCnpj(
  byCnpj: Map<string, { cliente: any; contratos: any[] }>,
  cnpj: string,
): { cliente: any; contratos: any[] } | null {
  return byCnpj.get(cnpj.replace(/\D/g, '')) ?? null
}

// Fallback: mesmo CNPJ base (primeiros 8 dígitos), filial diferente
// Retorna apenas se houver exatamente 1 candidato — evita ambiguidade
function buscarClientePorCnpjBase(
  byBaseCnpj: Map<string, { cliente: any; contratos: any[] }[]>,
  cnpj: string,
): { cliente: any; contratos: any[] } | null {
  const base = cnpj.replace(/\D/g, '').slice(0, 8)
  const candidatos = byBaseCnpj.get(base) ?? []
  return candidatos.length === 1 ? candidatos[0] : null
}

function buscarClientePorNome(
  byWord: Map<string, { cliente: any; contratos: any[] }[]>,
  nomeOriginal: string,
): { cliente: any; contratos: any[] } | null {
  const nomeTrimmed = nomeOriginal.trim()
  if (!nomeTrimmed) return null
  const palavras = palavrasSignificativas(nomeTrimmed)
  if (palavras.length < 2) return null

  const candidatos = new Map<string, { cliente: any; contratos: any[] }>()
  for (const word of palavras) {
    for (const entry of byWord.get(word) || []) {
      const id = entry.cliente?.id || entry.cliente?.nome || ''
      if (id) candidatos.set(String(id), entry)
    }
  }

  let melhor: { cliente: any; contratos: any[] } | null = null
  let melhorSim = 0
  for (const entry of candidatos.values()) {
    const nome = entry.cliente?.nome || ''
    if (!(entry.cliente?.documento || '').replace(/\D/g, '')) continue
    const sim = similaridadeNomes(nomeTrimmed, nome)
    if (sim > melhorSim) {
      melhorSim = sim
      melhor = entry
    }
  }

  return melhorSim >= 0.5 ? melhor : null
}

function normalizeContratos(rawContratos: any[]): any[] {
  return rawContratos.map((c: any) => {
    const valor = Number(
      c.total ?? c.total_proximo_vencimento ?? c.valor ?? c.amount ?? 0,
    )
    const status = c.status ?? c.situacao ?? 'DESCONHECIDO'
    const isAtivo =
      status.toLowerCase() === 'ativo' || status.toLowerCase() === 'active'
    return {
      id: c.id ?? null,
      descricao:
        c.descricao ?? c.nome ?? (c.numero ? `Contrato #${c.numero}` : ''),
      valor: Number.isFinite(valor) ? valor : 0,
      status,
      ativo: isAtivo,
      periodicidade: c.termos?.tipo_expiracao ?? c.periodicidade ?? null,
    }
  })
}

// Salva snapshot dos contratos capturados para diagnóstico
async function salvarContratosNoBanco(
  supabaseAdmin: any,
  contratos: any[],
  agora: string,
): Promise<void> {
  if (!contratos.length) return
  try {
    await supabaseAdmin
      .from('dados_capturados_contaazul')
      .not('id', 'is', null)
      .delete()
    const rows = contratos.map((c: any) => ({
      pessoa_id: String(c.cliente?.id || c.pessoa?.id || ''),
      nome: c.cliente?.nome || c.pessoa?.nome || c.descricao || '',
      documento: (c.cliente?.documento || c.pessoa?.documento || '').replace(
        /\D/g,
        '',
      ),
      tipo: c.status ?? c.situacao ?? '',
      raw: c,
      capturado_em: agora,
    }))
    const chunkSize = 500
    for (let i = 0; i < rows.length; i += chunkSize) {
      await supabaseAdmin
        .from('dados_capturados_contaazul')
        .insert(rows.slice(i, i + chunkSize))
    }
  } catch {
    /* não interrompe sync */
  }
}

async function registrarDivergencia(
  supabaseAdmin: any,
  client: any,
  cnpjContaAzul: string,
  nomeContaAzul: string,
  mrr: number,
  contratos: any[],
) {
  const { data: existing } = await supabaseAdmin
    .from('cnpj_divergencias')
    .select('id,cnpj_contaazul')
    .eq('bitrix_id', client.bitrix_id)
    .eq('status', 'pendente')
    .maybeSingle()

  const cnpjBitrix = client.cnpj?.replace(/\D/g, '') || ''

  if (existing?.id) {
    if (existing.cnpj_contaazul !== cnpjContaAzul) {
      await supabaseAdmin
        .from('cnpj_divergencias')
        .eq('id', existing.id)
        .update({
          cnpj_contaazul: cnpjContaAzul,
          nome_contaazul: nomeContaAzul,
          mrr,
          contratos,
          detectado_em: new Date().toISOString(),
        })
    }
  } else {
    await supabaseAdmin.from('cnpj_divergencias').insert({
      bitrix_id: client.bitrix_id,
      company_name: client.company_name,
      cnpj_bitrix: cnpjBitrix,
      cnpj_contaazul: cnpjContaAzul,
      nome_contaazul: nomeContaAzul,
      mrr,
      contratos,
      status: 'pendente',
    })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const supabaseAdmin = createSupabaseAdmin()
    const token = await getAccessToken(supabaseAdmin)

    const cnpjs =
      Array.isArray(body.cnpjs) && body.cnpjs.length > 0 ? body.cnpjs : []
    const sincronizadoPor: string | null = body.user_id || null
    const sincronizadoPorNome: string | null = body.user_name || null
    const agora = new Date().toISOString()

    // Busca contratos diretamente — contorna a limitação de paginação da API /v1/pessoas
    const todosContratos = await fetchAllContratos(token)
    console.log(
      `[fetch-mrr] total contratos carregados: ${todosContratos.length}`,
    )

    // Filtra apenas contratos ativos para o cálculo de MRR
    const contratosAtivos = todosContratos.filter((c: any) => {
      const status = (c.status ?? c.situacao ?? '').toLowerCase()
      return status === 'ativo' || status === 'active'
    })
    console.log(`[fetch-mrr] contratos ativos: ${contratosAtivos.length}`)

    // Enriquece contratos com CNPJ (campo não vem na listagem, busca individual por ID)
    await enriquecerClientesComCnpj(token, contratosAtivos)

    // Salva snapshot para diagnóstico
    await salvarContratosNoBanco(supabaseAdmin, contratosAtivos, agora)

    // Constrói mapas de lookup por CNPJ e por nome
    const { byCnpj, byBaseCnpj, byWord } =
      buildLookupFromContratos(contratosAtivos)
    console.log(`[fetch-mrr] clientes únicos com CNPJ: ${byCnpj.size}`)

    // Busca clientes do Bitrix
    const clientsRes = await supabaseAdmin
      .from('bitrix_clients_zion')
      .select('id,bitrix_id,company_name,cnpj,porte')
      .not('cnpj', 'is', null)
      .list()

    const clients = (clientsRes.data ?? []).filter((c: any) =>
      c.cnpj?.replace(/\D/g, ''),
    )
    const cnpjsLimpos = cnpjs.map((c: string) => c.replace(/\D/g, ''))
    const targets =
      cnpjsLimpos.length > 0
        ? clients.filter((c: any) =>
            cnpjsLimpos.includes(c.cnpj?.replace(/\D/g, '')),
          )
        : clients

    const results: any[] = []

    for (const client of targets) {
      const cnpj = client.cnpj?.replace(/\D/g, '')
      if (!cnpj) continue

      try {
        let match = buscarClientePorCnpj(byCnpj, cnpj)
        let divergenciaCnpj = false

        if (!match) {
          // Nível 2: match por nome (similaridade)
          const matchNome = buscarClientePorNome(
            byWord,
            client.company_name || '',
          )
          // Nível 3: match por CNPJ base (mesma empresa, filial diferente)
          const matchBase = !matchNome
            ? buscarClientePorCnpjBase(byBaseCnpj, cnpj)
            : null
          const matchFallback = matchNome || matchBase

          if (matchFallback) {
            const cnpjContaAzul = (
              matchFallback.cliente.documento || ''
            ).replace(/\D/g, '')
            const nomeContaAzul = matchFallback.cliente.nome || ''
            const contratos = normalizeContratos(matchFallback.contratos)
            const mrr = contratos
              .filter((c) => c.ativo && c.periodicidade === 'NUNCA')
              .reduce((s, c) => s + c.valor, 0)
            const origem = matchBase ? 'filial' : 'nome'
            await registrarDivergencia(
              supabaseAdmin,
              client,
              cnpjContaAzul,
              nomeContaAzul,
              mrr,
              contratos,
            )
            results.push({
              cnpj,
              success: false,
              divergencia: true,
              message: `CNPJ divergente (${origem}): Bitrix=${cnpj} / ContaAzul=${cnpjContaAzul}`,
              cnpj_contaazul: cnpjContaAzul,
              nome_contaazul: nomeContaAzul,
              mrr,
            })
          } else {
            results.push({
              cnpj,
              success: false,
              message: 'Cliente não encontrado no Conta Azul',
            })
          }
          continue
        }

        // Verifica divergência de CNPJ
        const cnpjContaAzulRetornado = (match.cliente.documento || '').replace(
          /\D/g,
          '',
        )
        if (cnpjContaAzulRetornado && cnpjContaAzulRetornado !== cnpj)
          divergenciaCnpj = true

        const contratos = normalizeContratos(match.contratos)
        const mrr = contratos
          .filter((c) => c.ativo && c.periodicidade === 'NUNCA')
          .reduce((s, c) => s + c.valor, 0)
        const nomeCliente =
          match.cliente.nome || match.cliente.name || client.company_name || ''

        if (divergenciaCnpj) {
          await registrarDivergencia(
            supabaseAdmin,
            client,
            cnpjContaAzulRetornado,
            nomeCliente,
            mrr,
            contratos,
          )
        }

        // Atualiza cache
        const { data: existingCache } = await supabaseAdmin
          .from('contaazul_cache')
          .select('id')
          .eq('cnpj', cnpj)
          .maybeSingle()

        if (existingCache?.id) {
          await supabaseAdmin
            .from('contaazul_cache')
            .eq('id', existingCache.id)
            .update({
              nome_cliente: nomeCliente,
              mrr,
              contratos,
              atualizado_em: agora,
              sincronizado_por: sincronizadoPor,
              sincronizado_por_nome: sincronizadoPorNome,
            })
        } else {
          await supabaseAdmin.from('contaazul_cache').insert({
            cnpj,
            nome_cliente: nomeCliente,
            mrr,
            contratos,
            atualizado_em: agora,
            sincronizado_por: sincronizadoPor,
            sincronizado_por_nome: sincronizadoPorNome,
          })
        }

        await supabaseAdmin.from('contaazul_sync_historico').insert({
          cnpj,
          nome_cliente: nomeCliente,
          mrr,
          contratos,
          sincronizado_em: agora,
          sincronizado_por: sincronizadoPor,
          sincronizado_por_nome: sincronizadoPorNome,
        })

        await supabaseAdmin
          .from('bitrix_clients_zion')
          .eq('id', client.id)
          .update({ mrr, company_name: client.company_name ?? nomeCliente })

        results.push({
          cnpj,
          success: true,
          mrr,
          nome_cliente: nomeCliente,
          contratos,
        })
      } catch (clientErr: any) {
        results.push({
          cnpj,
          success: false,
          message: clientErr.message || String(clientErr),
        })
      }
    }

    const found = results.filter((r) => r.success).length
    const divergencias = results.filter((r) => r.divergencia).length
    const notFound = results.filter((r) => !r.success && !r.divergencia).length

    return new Response(
      JSON.stringify({
        success: true,
        message: 'MRR atualizado',
        total_contratos_contaazul: todosContratos.length,
        contratos_ativos: contratosAtivos.length,
        clientes_unicos_contaazul: byCnpj.size,
        resultado: {
          encontrados: found,
          divergencias,
          nao_encontrados: notFound,
        },
        data: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
