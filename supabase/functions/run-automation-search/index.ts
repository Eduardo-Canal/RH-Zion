import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

// ─── Phone type helpers ───────────────────────────────────────────────────────
function isCelular(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  if (digits.length >= 10) return digits[2] === '9'
  return digits[0] === '9'
}
function phoneType(phone: string): string {
  return isCelular(phone) ? 'MOBILE' : 'WORK'
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('AUTOMATION_SECRET_KEY') || ''
  if (!expected) return false
  const provided = (req.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  return provided === expected
}

// ─── Casa dos Dados ──────────────────────────────────────────────────────────
async function searchCasaDados(
  cnaes: string[],
  ufs: string[] | null,
  portes: string[] | null,
  municipios: string[] | null,
  limite: number,
  apiKey: string,
  pagina: number,
): Promise<any[]> {
  const sanitized = cnaes
    .map((c) => String(c).replace(/\D/g, ''))
    .filter(Boolean)
  if (sanitized.length === 0) return []

  const body: any = {
    limite,
    pagina,
    codigo_atividade_principal: sanitized,
    situacao_cadastral: ['ATIVA'],
  }
  if (ufs && ufs.length > 0) body.uf = ufs
  if (portes && portes.length > 0)
    body.porte = portes.map((p) => p.toUpperCase())
  if (municipios && municipios.length > 0) body.municipio = municipios

  const res = await fetch(
    'https://api.casadosdados.com.br/v5/cnpj/pesquisa?tipo_resultado=completo',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey.replace(/^Bearer\s+/i, '').trim(),
      },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) throw new Error(`Casa dos Dados API respondeu ${res.status}`)
  const data = await res.json()
  return Array.isArray(data?.cnpjs) ? data.cnpjs : []
}

// ─── Mapper ──────────────────────────────────────────────────────────────────
function mapEmpresa(empresa: any) {
  const endereco = empresa.endereco || {}

  let municipio = empresa.municipio || endereco.municipio || ''
  if (typeof municipio === 'object') municipio = municipio?.nome || ''

  let uf = empresa.uf || endereco.uf || ''
  if (typeof uf === 'object') uf = uf?.sigla || ''

  // Telefones — API v5 usa contato_telefonico: [{ddd, numero, tipo}]
  const telefonesDetalhados: Array<{ numero: string; tipo: string }> = []
  const rawTelContato =
    empresa.contato_telefonico || empresa.telefone || empresa.telefones
  if (Array.isArray(rawTelContato)) {
    for (const t of rawTelContato) {
      if (typeof t === 'string') {
        telefonesDetalhados.push({ numero: t, tipo: 'fixo' })
      } else if (t?.ddd && t?.numero) {
        telefonesDetalhados.push({
          numero: `(${t.ddd}) ${t.numero}`,
          tipo: t.tipo || 'fixo',
        })
      } else if (t?.completo) {
        telefonesDetalhados.push({ numero: t.completo, tipo: t.tipo || 'fixo' })
      }
    }
  } else if (rawTelContato?.ddd && rawTelContato?.numero) {
    telefonesDetalhados.push({
      numero: `(${rawTelContato.ddd}) ${rawTelContato.numero}`,
      tipo: 'fixo',
    })
  } else if (typeof rawTelContato === 'string' && rawTelContato) {
    telefonesDetalhados.push({ numero: rawTelContato, tipo: 'fixo' })
  }
  const telefone = telefonesDetalhados
    .map((t) => (t.tipo === 'celular' ? `${t.numero} [cel]` : t.numero))
    .join(' / ')

  // Emails — API v5 usa contato_email: [{email, valido}]
  const emailsDetalhados: Array<{ email: string; valido: boolean }> = []
  const rawEmail = empresa.contato_email || empresa.email || empresa.emails
  if (Array.isArray(rawEmail)) {
    for (const e of rawEmail) {
      if (typeof e === 'string' && e)
        emailsDetalhados.push({ email: e, valido: true })
      else if (e?.email)
        emailsDetalhados.push({ email: e.email, valido: e.valido !== false })
    }
  } else if (typeof rawEmail === 'string' && rawEmail) {
    emailsDetalhados.push({ email: rawEmail, valido: true })
  }
  const email = emailsDetalhados.map((e) => e.email).join(' / ')

  // CNAE
  const rawCnae = empresa.cnae_fiscal_principal || empresa.atividade_principal
  let cnaePrincipal = ''
  if (rawCnae) {
    if (typeof rawCnae === 'string') {
      cnaePrincipal = rawCnae
    } else if (typeof rawCnae === 'object') {
      const codigo = rawCnae.codigo || rawCnae.code || ''
      const descricao = rawCnae.descricao || rawCnae.description || ''
      cnaePrincipal =
        codigo && descricao
          ? `${codigo} - ${descricao}`
          : descricao || codigo || ''
    }
  }

  // Porte
  const rawPorte = empresa.porte_empresa || empresa.porte
  let porte = ''
  if (rawPorte) {
    if (typeof rawPorte === 'string') porte = rawPorte
    else if (typeof rawPorte === 'object')
      porte =
        rawPorte.descricao || rawPorte.description || rawPorte.codigo || ''
  }

  // Situação cadastral
  const rawSit = empresa.situacao_cadastral
  const situacaoCadastral =
    typeof rawSit === 'object' && rawSit !== null
      ? rawSit.situacao_atual || ''
      : typeof rawSit === 'string'
        ? rawSit
        : ''

  // Sócios — API v5 usa quadro_societario
  const rawSocios = empresa.quadro_societario || empresa.socios || []
  const socios = rawSocios.map((s: any) => ({
    nome: s.nome || s.razao_social || '',
    qualificacao:
      typeof s.qualificacao_socio === 'string'
        ? s.qualificacao_socio
        : s.qualificacao_socio?.descricao || s.qualificacao || '',
    data_entrada: s.data_entrada_sociedade || s.data_entrada || '',
    faixa_etaria: s.faixa_etaria_descricao || s.faixa_etaria || '',
    tipo: s.identificador_socio || '',
    email: null,
    telefone: null,
  }))

  return {
    cnpj: empresa.cnpj || '',
    razao_social: empresa.razao_social || empresa.nome_fantasia || '',
    nome_fantasia: empresa.nome_fantasia || '',
    cnae_principal: cnaePrincipal,
    municipio: String(municipio),
    uf: String(uf),
    porte,
    situacao_cadastral: situacaoCadastral,
    capital_social: empresa.capital_social ? Number(empresa.capital_social) : 0,
    data_abertura: empresa.data_abertura || empresa.data_inicio_atividade || '',
    cep: endereco.cep || empresa.cep || '',
    email,
    telefone,
    telefones_detalhados: telefonesDetalhados,
    emails_detalhados: emailsDetalhados,
    socios,
    dados_completos: empresa,
  }
}

// ─── Formatar CNPJ com máscara XX.XXX.XXX/XXXX-XX ───────────────────────────
function formatCnpj(cnpj: string): string {
  const c = cnpj.replace(/\D/g, '')
  if (c.length !== 14) return c
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
}

// ─── Geração de abordagem IA ─────────────────────────────────────────────────
async function generateApproach(
  lead: ReturnType<typeof mapEmpresa>,
  contextoIa: string | null,
  openaiKey: string,
): Promise<string> {
  const systemPrompt = contextoIa
    ? `Você é especialista em vendas B2B para a Zionlogtec (tecnologia logística). Contexto desta campanha: ${contextoIa}`
    : 'Você é especialista em vendas B2B para a Zionlogtec, empresa de tecnologia para o setor logístico.'

  const userPrompt = `Crie uma sugestão de abordagem comercial objetiva para o SDR usar no primeiro contato com este lead:
Empresa: ${lead.razao_social}
CNAE: ${lead.cnae_principal}
Porte: ${lead.porte}
Localização: ${lead.municipio}/${lead.uf}

Retorne apenas o texto da abordagem (máximo 3 parágrafos), sem JSON, sem títulos.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  })

  if (!res.ok) throw new Error(`OpenAI respondeu ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

// ─── Bitrix rate-limiter helper ───────────────────────────────────────────────
function makeBitrixCaller(
  rateLimiterUrl: string,
  bitrixBaseUrl: string,
  serviceRoleKey: string,
) {
  return async function callBitrix(
    endpoint: string,
    method = 'GET',
    body?: any,
  ): Promise<any> {
    let attempt = 1
    const maxRetries = 3
    let delay = 1000

    while (attempt <= maxRetries + 1) {
      try {
        const res = await fetch(rateLimiterUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            endpoint: bitrixBaseUrl + endpoint,
            method,
            headers: { 'Content-Type': 'application/json' },
            body,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.success) {
          const errMsg = data.message || data.error || 'Bitrix API error'
          if (res.status === 429 || errMsg.includes('Rate limit')) {
            const match = errMsg.match(/em (\d+) segundos/)
            if (match?.[1])
              delay = Math.min(parseInt(match[1], 10) * 1000, 60000)
          }
          throw new Error(errMsg)
        }
        return data.data
      } catch (err: any) {
        if (attempt > maxRetries) throw err
        await new Promise((r) => setTimeout(r, delay))
        delay *= 2
        attempt++
      }
    }
  }
}

// ─── Buscar ou criar empresa no Bitrix24 ─────────────────────────────────────
async function findOrCreateBitrixCompany(
  lead: ReturnType<typeof mapEmpresa>,
  callBitrix: (endpoint: string, method?: string, body?: any) => Promise<any>,
): Promise<number | null> {
  const cleanCnpj = lead.cnpj.replace(/\D/g, '')

  if (cleanCnpj) {
    const cnpjBusca = formatCnpj(cleanCnpj)
    try {
      const searchRes = await callBitrix(
        `crm.company.list.json?filter[UF_CRM_6241B0B267ED3]=${encodeURIComponent(cnpjBusca)}&select[]=ID`,
      )
      if (searchRes?.result && searchRes.result.length > 0) {
        return parseInt(searchRes.result[0].ID)
      }
    } catch (e) {
      console.warn(`Busca de empresa Bitrix falhou para CNPJ ${cleanCnpj}:`, e)
    }
  }

  // Não encontrou — criar empresa
  const cnpjFormatado = cleanCnpj ? formatCnpj(cleanCnpj) : ''

  const phonesForBitrix: any[] = []
  if (lead.telefones_detalhados && lead.telefones_detalhados.length > 0) {
    for (const t of lead.telefones_detalhados) {
      phonesForBitrix.push({ VALUE: t.numero, VALUE_TYPE: phoneType(t.numero) })
    }
  } else if (lead.telefone) {
    for (const num of lead.telefone.split(' / ')) {
      const n = num.replace(' [cel]', '').trim()
      if (n) phonesForBitrix.push({ VALUE: n, VALUE_TYPE: phoneType(n) })
    }
  }

  const emailsForBitrix: any[] = []
  if (lead.emails_detalhados && lead.emails_detalhados.length > 0) {
    for (const e of lead.emails_detalhados) {
      emailsForBitrix.push({ VALUE: e.email, VALUE_TYPE: 'WORK' })
    }
  } else if (lead.email) {
    for (const em of lead.email.split(' / ')) {
      if (em.trim())
        emailsForBitrix.push({ VALUE: em.trim(), VALUE_TYPE: 'WORK' })
    }
  }

  const companyFields: any = {
    TITLE: lead.razao_social || 'Empresa Sem Nome',
    ADDRESS_CITY: lead.municipio || '',
    ADDRESS_PROVINCE: lead.uf || '',
  }

  if (lead.cep) companyFields.ADDRESS_POSTAL_CODE = lead.cep
  if (cnpjFormatado) {
    companyFields.UF_CRM_6241B0B267ED3 = cnpjFormatado
    companyFields.UF_CRM_1742992784 = cnpjFormatado
  }
  if (phonesForBitrix.length > 0) companyFields.PHONE = phonesForBitrix
  if (emailsForBitrix.length > 0) companyFields.EMAIL = emailsForBitrix
  if (lead.cnae_principal) companyFields.UF_CRM_1771423651 = lead.cnae_principal
  if (lead.nome_fantasia) companyFields.UF_CRM_1742990673 = lead.nome_fantasia
  if (lead.situacao_cadastral) {
    companyFields.UF_CRM_1742990227 = lead.situacao_cadastral
    companyFields.UF_CRM_1742990271 = lead.situacao_cadastral
  }
  if (lead.porte) companyFields.UF_CRM_1742990347 = lead.porte
  if (lead.capital_social) companyFields.REVENUE = lead.capital_social
  if (lead.data_abertura) companyFields.UF_CRM_1742990450 = lead.data_abertura

  const createRes = await callBitrix('crm.company.add.json', 'POST', {
    fields: companyFields,
  })
  return createRes?.result ? parseInt(createRes.result) : null
}

// ─── Criar contatos dos sócios e vincular à empresa ──────────────────────────
async function createSocioContacts(
  lead: ReturnType<typeof mapEmpresa>,
  companyId: number,
  callBitrix: (endpoint: string, method?: string, body?: any) => Promise<any>,
): Promise<number[]> {
  const contactIds: number[] = []
  for (const socio of lead.socios || []) {
    if (socio.tipo && socio.tipo !== 'Pessoa Física') continue
    const nomeCompleto: string = socio.nome || ''
    if (!nomeCompleto) continue

    const partes = nomeCompleto.trim().split(/\s+/)
    const firstName = partes[0] || nomeCompleto
    const lastName = partes.slice(1).join(' ') || ''

    const contactFields: any = {
      NAME: firstName,
      LAST_NAME: lastName,
      POST: socio.qualificacao || 'Sócio',
      COMPANY_ID: companyId,
      SOURCE_ID: 'B24_APPLICATION',
      OPENED: 'Y',
    }

    // Sem contato individual da API — usa o da empresa como referência
    if (lead.telefones_detalhados?.[0]) {
      const t = lead.telefones_detalhados[0]
      contactFields.PHONE = [
        { VALUE: t.numero, VALUE_TYPE: phoneType(t.numero) },
      ]
    } else if (lead.telefone) {
      const n = lead.telefone.split(' / ')[0].replace(' [cel]', '').trim()
      contactFields.PHONE = [{ VALUE: n, VALUE_TYPE: phoneType(n) }]
    }

    if (lead.emails_detalhados?.[0]) {
      contactFields.EMAIL = [
        { VALUE: lead.emails_detalhados[0].email, VALUE_TYPE: 'WORK' },
      ]
    } else if (lead.email) {
      contactFields.EMAIL = [
        { VALUE: lead.email.split(' / ')[0].trim(), VALUE_TYPE: 'WORK' },
      ]
    }

    if (socio.faixa_etaria)
      contactFields.UF_CRM_CONTACT_FAIXA_ETARIA = socio.faixa_etaria

    try {
      const res = await callBitrix('crm.contact.add.json', 'POST', {
        fields: contactFields,
      })
      const contactId = res?.result ? parseInt(res.result) : null
      if (contactId) {
        contactIds.push(contactId)
        await callBitrix('crm.company.contact.add.json', 'POST', {
          id: companyId,
          fields: {
            CONTACT_ID: contactId,
            IS_PRIMARY: contactIds.length === 1 ? 'Y' : 'N',
          },
        })
      }
    } catch (err: any) {
      console.warn(
        `Falha ao criar contato para sócio ${nomeCompleto}:`,
        err.message,
      )
    }
  }
  return contactIds
}

// ─── Criar entidade (Lead ou Deal) no Bitrix24 ───────────────────────────────
async function createBitrixEntity(
  lead: ReturnType<typeof mapEmpresa>,
  companyId: number | null,
  contactIds: number[],
  stageId: string | null,
  pipelineId: string | null,
  entityType: string,
  sugestaoAbordagem: string | null,
  campanhaName: string,
  callBitrix: (endpoint: string, method?: string, body?: any) => Promise<any>,
): Promise<string> {
  const cleanCnpj = lead.cnpj.replace(/\D/g, '')
  const razaoSocial = lead.razao_social || 'Lead'
  const anoAtual = new Date().getFullYear()
  const titulo = `[${razaoSocial}] Projeto MLW ${anoAtual}`

  // Sócios no contexto
  const sociosText = (lead.socios || [])
    .map((s: any) => {
      const qual = s.qualificacao ? ` (${s.qualificacao})` : ''
      const faixa = s.faixa_etaria ? ` — ${s.faixa_etaria}` : ''
      const entrada = s.data_entrada ? ` — Entrada: ${s.data_entrada}` : ''
      return `${s.nome}${qual}${faixa}${entrada}`
    })
    .join('\n- ')

  // Montar contexto completo para o Bitrix (igual ao fluxo manual)
  const leadInfoContext = [
    `[b]DADOS DA PESQUISA (AUTOMAÇÃO SDR — ${campanhaName})[/b]`,
    '',
    `[b]Razão Social:[/b] ${lead.razao_social || 'N/A'}`,
    `[b]CNPJ:[/b] ${cleanCnpj ? formatCnpj(cleanCnpj) : 'N/A'}`,
    `[b]CNAE Principal:[/b] ${lead.cnae_principal || 'N/A'}`,
    `[b]Porte:[/b] ${lead.porte || 'N/A'}`,
    `[b]Situação:[/b] ${lead.situacao_cadastral || 'N/A'}`,
    `[b]Município/UF:[/b] ${lead.municipio || ''} - ${lead.uf || ''}`,
    `[b]E-mail:[/b] ${lead.email || 'N/A'}`,
    `[b]Telefone:[/b] ${lead.telefone || 'N/A'}`,
    sociosText ? `\n[b]Sócios:[/b]\n- ${sociosText}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const approachContext = sugestaoAbordagem
    ? `\n\n[b]ABORDAGEM SUGERIDA (IA)[/b]\n\n${sugestaoAbordagem}`
    : ''

  const fullContext = leadInfoContext + approachContext

  let entityId: string

  // Montar todos os telefones/emails para Lead/Deal
  const phonesForEntity: any[] = []
  if (lead.telefones_detalhados && lead.telefones_detalhados.length > 0) {
    for (const t of lead.telefones_detalhados) {
      phonesForEntity.push({ VALUE: t.numero, VALUE_TYPE: phoneType(t.numero) })
    }
  } else if (lead.telefone) {
    const n = lead.telefone.split(' / ')[0].replace(' [cel]', '').trim()
    phonesForEntity.push({ VALUE: n, VALUE_TYPE: phoneType(n) })
  }

  const emailsForEntity: any[] = []
  if (lead.emails_detalhados && lead.emails_detalhados.length > 0) {
    for (const e of lead.emails_detalhados) {
      emailsForEntity.push({ VALUE: e.email, VALUE_TYPE: 'WORK' })
    }
  } else if (lead.email) {
    emailsForEntity.push({
      VALUE: lead.email.split(' / ')[0].trim(),
      VALUE_TYPE: 'WORK',
    })
  }

  if (entityType === 'LEAD') {
    const fields: any = {
      TITLE: titulo,
      COMPANY_TITLE: razaoSocial,
      OPENED: 'Y',
      SOURCE_ID: 'B24_APPLICATION',
      ADDRESS_CITY: lead.municipio,
      ADDRESS_PROVINCE: lead.uf,
      UTM_SOURCE: 'Lead Finder Zion',
      COMMENTS: fullContext,
    }

    if (stageId) fields.STATUS_ID = stageId
    if (companyId) fields.COMPANY_ID = companyId
    if (phonesForEntity.length > 0) fields.PHONE = phonesForEntity
    if (emailsForEntity.length > 0) fields.EMAIL = emailsForEntity
    if (cleanCnpj) fields.UF_CRM_LEAD_1644319583429 = cleanCnpj

    const res = await callBitrix('crm.lead.add.json', 'POST', { fields })
    entityId = String(res?.result || '')
  } else {
    // DEAL
    const fields: any = {
      TITLE: titulo,
      OPENED: 'Y',
      COMMENTS: fullContext,
    }

    if (stageId) fields.STAGE_ID = stageId
    if (pipelineId) fields.CATEGORY_ID = pipelineId
    if (companyId) fields.COMPANY_ID = companyId

    const res = await callBitrix('crm.deal.add.json', 'POST', { fields })
    entityId = String(res?.result || '')
  }

  // Vincular contatos dos sócios ao Deal/Lead
  if (entityId && contactIds.length > 0) {
    const linkEndpoint =
      entityType === 'LEAD'
        ? 'crm.lead.contact.add.json'
        : 'crm.deal.contact.add.json'
    for (const contactId of contactIds) {
      try {
        await callBitrix(linkEndpoint, 'POST', {
          id: parseInt(entityId),
          fields: { CONTACT_ID: contactId },
        })
      } catch (linkErr: any) {
        console.warn(`Falha ao vincular contato ${contactId}:`, linkErr.message)
      }
    }
  }

  // Adicionar comentário de timeline
  if (entityId && fullContext) {
    try {
      const entityTypeId = entityType === 'LEAD' ? 1 : 2
      await callBitrix('crm.timeline.comment.add.json', 'POST', {
        fields: {
          ENTITY_ID: parseInt(entityId),
          ENTITY_TYPE_ID: entityTypeId,
          COMMENT: fullContext,
        },
      })
    } catch (commentErr: any) {
      console.warn(
        `Falha ao adicionar comentário de timeline para entidade ${entityId}:`,
        commentErr.message,
      )
    }
  }

  return entityId
}

// ─── Notificação no grupo Bitrix ─────────────────────────────────────────────
async function notifyBitrixGroup(
  groupId: string,
  message: string,
  callBitrix: (endpoint: string, method?: string, body?: any) => Promise<any>,
): Promise<void> {
  await callBitrix('im.message.add.json', 'POST', {
    DIALOG_ID: groupId,
    MESSAGE: message,
  })
}

// ─── Handler principal ───────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

  try {
    const payload = await req.json().catch(() => ({}))
    const { config_id } = payload

    // ── Carregar configurações ativas ──────────────────────────────────────
    const today = new Date().toISOString().split('T')[0]
    let query = supabaseAdmin
      .from('automacao_config')
      .select('*')
      .eq('ativo', true)
      .or(`data_fim.is.null,data_fim.gte.${today}`)
      .lte('data_inicio', today)

    if (config_id) query = query.eq('id', config_id)

    const { data: configs, error: configError } = await query
    if (configError)
      throw new Error(`Erro ao carregar configurações: ${configError.message}`)

    if (!configs || configs.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'Nenhuma automação ativa encontrada.',
          executions: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ── Dependências globais ────────────────────────────────────────────────
    const { data: configSistema } = await supabaseAdmin
      .from('configuracoes_sistema')
      .select('casadosdados_api_token')
      .eq('id', 1)
      .maybeSingle()

    const casaDadosKey = configSistema?.casadosdados_api_token?.trim() || ''
    if (!casaDadosKey)
      throw new Error('Token da Casa dos Dados não configurado.')

    const { data: openaiConfig } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'openai_config')
      .maybeSingle()

    const openaiKey: string =
      (openaiConfig?.value as any)?.api_key ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''

    // ── Carregar configurações padrão do Bitrix24 ──────────────────────────
    const { data: bitrixDefaultsRow } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'bitrix24_defaults')
      .maybeSingle()

    const bitrixDefaults = (bitrixDefaultsRow?.value as any) || {}
    const defaultEntityType: string = bitrixDefaults.entity_type || 'LEAD'
    const defaultStageId: string = bitrixDefaults.stage_id || ''
    const defaultPipelineId: string =
      bitrixDefaults.kanban_id || bitrixDefaults.pipeline_id || ''

    const bitrixBaseUrl = await getBitrixWebhookUrl(supabaseAdmin)
    const rateLimiterUrl = `${supabaseUrl}/functions/v1/bitrix-rate-limiter`
    const callBitrix = makeBitrixCaller(
      rateLimiterUrl,
      bitrixBaseUrl,
      serviceRoleKey,
    )

    const executions: any[] = []

    // ── Loop de execução por campanha ───────────────────────────────────────
    for (const config of configs) {
      const { data: execucao, error: execError } = await supabaseAdmin
        .from('execucoes_automacao')
        .insert({ automacao_config_id: config.id, status: 'executando' })
        .select()
        .single()

      if (execError || !execucao) {
        console.error(
          `Falha ao criar execução para config ${config.id}:`,
          execError,
        )
        continue
      }

      const execId = execucao.id
      let leadsEncontrados = 0
      let leadsNovos = 0
      let leadsDuplicados = 0
      let leadsEnviadosBitrix = 0

      // Resolver stage_id e pipeline_id para esta campanha
      const stageId = config.bitrix_stage_id || defaultStageId || null
      const pipelineId = config.bitrix_pipeline_id || defaultPipelineId || null

      // Calcular a página da Casa dos Dados com base nas execuções concluídas:
      // run 1 → page 1, run 2 → page 2, etc. — garante que cada rodada
      // busca empresas novas e não repete o mesmo lote anterior.
      const { count: runsConcluidos } = await supabaseAdmin
        .from('execucoes_automacao')
        .select('*', { count: 'exact', head: true })
        .eq('automacao_config_id', config.id)
        .eq('status', 'concluido')

      const paginaAtual = (runsConcluidos || 0) + 1
      console.log(
        `Campanha "${config.nome}" — buscando página ${paginaAtual} (${runsConcluidos} execuções concluídas anteriores)`,
      )

      try {
        const rawLeads = await searchCasaDados(
          config.cnaes,
          config.ufs,
          config.portes,
          config.municipios,
          config.limite_por_execucao,
          casaDadosKey,
          paginaAtual,
        )

        leadsEncontrados = rawLeads.length

        for (const empresa of rawLeads) {
          const lead = mapEmpresa(empresa)
          if (!lead.cnpj) continue

          const cleanCnpj = lead.cnpj.replace(/\D/g, '')

          // ── Dedup 1: já é cliente ativo no Bitrix ───────────────────────
          const { data: existingClient } = await supabaseAdmin
            .from('bitrix_clients_zion')
            .select('id')
            .eq('cnpj', cleanCnpj)
            .maybeSingle()

          if (existingClient) {
            leadsDuplicados++
            continue
          }

          // ── Dedup 2: já foi enviado manualmente pela prospecção ──────────
          // Verifica leads_salvos que já têm bitrix_id (enviados pelo fluxo manual)
          const { data: existingSaved } = await supabaseAdmin
            .from('leads_salvos')
            .select('id')
            .eq('cnpj', cleanCnpj)
            .not('bitrix_id', 'is', null)
            .maybeSingle()

          if (existingSaved) {
            leadsDuplicados++
            continue
          }

          // ── Dedup 3: já está nesta campanha (constraint UNIQUE) ──────────
          const { data: existingInCampaign } = await supabaseAdmin
            .from('leads_automacao_pendentes')
            .select('id')
            .eq('cnpj', lead.cnpj)
            .eq('automacao_config_id', config.id)
            .maybeSingle()

          if (existingInCampaign) {
            leadsDuplicados++
            continue
          }

          // ── Gerar abordagem IA ───────────────────────────────────────────
          let sugestaoAbordagem: string | null = null
          if (openaiKey) {
            try {
              sugestaoAbordagem = await generateApproach(
                lead,
                config.contexto_ia,
                openaiKey,
              )
            } catch (aiErr) {
              console.warn(`IA falhou para ${lead.cnpj}:`, aiErr)
            }
          }

          // ── Criar/encontrar empresa no Bitrix24 ──────────────────────────
          let companyId: number | null = null
          try {
            companyId = await findOrCreateBitrixCompany(lead, callBitrix)
          } catch (companyErr: any) {
            console.warn(
              `Empresa Bitrix falhou para ${lead.cnpj}:`,
              companyErr.message,
            )
          }

          // ── Criar contatos dos sócios e vincular à empresa ───────────────
          let contactIds: number[] = []
          if (companyId && lead.socios && lead.socios.length > 0) {
            try {
              contactIds = await createSocioContacts(
                lead,
                companyId,
                callBitrix,
              )
            } catch (contactErr: any) {
              console.warn(
                `Contatos de sócios falharam para ${lead.cnpj}:`,
                contactErr.message,
              )
            }
          }

          // ── Criar entidade (Lead ou Deal) no Bitrix24 ────────────────────
          let bitrixEntityId: string | null = null
          let status = 'pendente'

          try {
            bitrixEntityId = await createBitrixEntity(
              lead,
              companyId,
              contactIds,
              stageId,
              pipelineId,
              defaultEntityType,
              sugestaoAbordagem,
              config.nome,
              callBitrix,
            )
            status = 'enviado_bitrix'
            leadsEnviadosBitrix++
          } catch (bitrixErr: any) {
            console.error(`Bitrix falhou para ${lead.cnpj}:`, bitrixErr.message)
            status = 'erro_envio'
          }

          // ── Salvar na fila ───────────────────────────────────────────────
          const { error: insertErr } = await supabaseAdmin
            .from('leads_automacao_pendentes')
            .insert({
              automacao_config_id: config.id,
              execucao_id: execId,
              cnpj: lead.cnpj,
              razao_social: lead.razao_social,
              cnae_principal: lead.cnae_principal,
              municipio: lead.municipio,
              uf: lead.uf,
              porte: lead.porte,
              email: lead.email,
              telefone: lead.telefone,
              dados_completos: lead.dados_completos,
              sugestao_abordagem: sugestaoAbordagem,
              status,
              bitrix_lead_id: bitrixEntityId,
            })

          if (insertErr) {
            if (insertErr.code === '23505') {
              leadsDuplicados++
              if (status === 'enviado_bitrix') leadsEnviadosBitrix--
            } else {
              console.error(`Erro ao salvar lead ${lead.cnpj}:`, insertErr)
            }
          } else {
            leadsNovos++
          }
        }

        // ── Fechar log de execução ──────────────────────────────────────────
        await supabaseAdmin
          .from('execucoes_automacao')
          .update({
            finalizado_em: new Date().toISOString(),
            status: 'concluido',
            leads_encontrados: leadsEncontrados,
            leads_novos: leadsNovos,
            leads_duplicados: leadsDuplicados,
            leads_enviados_bitrix: leadsEnviadosBitrix,
          })
          .eq('id', execId)

        // ── Notificação no grupo Bitrix ─────────────────────────────────────
        if (config.bitrix_notification_group_id && leadsNovos > 0) {
          const agora = new Date().toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          })
          const msg = [
            `[Automação SDR — ${config.nome}]`,
            `Execução concluída: ${agora}`,
            ``,
            `Novos leads enviados ao Bitrix: ${leadsEnviadosBitrix}`,
            leadsNovos - leadsEnviadosBitrix > 0
              ? `Leads com erro de envio: ${leadsNovos - leadsEnviadosBitrix}`
              : '',
            `Duplicatas ignoradas: ${leadsDuplicados}`,
            `Total encontrado na busca: ${leadsEncontrados}`,
            ``,
            `Os leads estão no Bitrix aguardando abordagem do time SDR.`,
          ]
            .filter((l) => l !== undefined)
            .join('\n')

          try {
            await notifyBitrixGroup(
              config.bitrix_notification_group_id,
              msg,
              callBitrix,
            )
          } catch (notifyErr) {
            console.warn('Falha ao enviar notificação Bitrix:', notifyErr)
          }
        }

        executions.push({
          config_id: config.id,
          config_nome: config.nome,
          execucao_id: execId,
          status: 'concluido',
          leads_encontrados: leadsEncontrados,
          leads_novos: leadsNovos,
          leads_duplicados: leadsDuplicados,
          leads_enviados_bitrix: leadsEnviadosBitrix,
        })
      } catch (execErr: any) {
        const msg = execErr.message || 'Erro desconhecido'

        await supabaseAdmin
          .from('execucoes_automacao')
          .update({
            finalizado_em: new Date().toISOString(),
            status: 'erro',
            erro_mensagem: msg,
            leads_encontrados: leadsEncontrados,
            leads_novos: leadsNovos,
            leads_duplicados: leadsDuplicados,
            leads_enviados_bitrix: leadsEnviadosBitrix,
          })
          .eq('id', execId)

        executions.push({
          config_id: config.id,
          config_nome: config.nome,
          execucao_id: execId,
          status: 'erro',
          erro: msg,
        })
      }
    }

    return new Response(JSON.stringify({ success: true, executions }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('run-automation-search fatal error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
