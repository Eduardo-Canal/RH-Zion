import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

function mapCasaDadosToResult(rawData: any) {
  // CNAE
  const rawCnae = rawData.cnae_fiscal_principal || rawData.atividade_principal
  let cnae = ''
  if (rawCnae) {
    if (typeof rawCnae === 'string') {
      cnae = rawCnae
    } else if (typeof rawCnae === 'object') {
      const codigo = rawCnae.codigo || rawCnae.code || ''
      const descricao = rawCnae.descricao || rawCnae.description || ''
      cnae =
        codigo && descricao
          ? `${codigo} - ${descricao}`
          : descricao || codigo || ''
    }
  }

  // Porte
  const rawPorte = rawData.porte_empresa || rawData.porte
  let porte = ''
  if (rawPorte) {
    if (typeof rawPorte === 'string') {
      porte = rawPorte
    } else if (typeof rawPorte === 'object') {
      porte =
        rawPorte.descricao || rawPorte.description || rawPorte.codigo || ''
    }
  }

  // Endereço — API v5 aninha em rawData.endereco
  const end = rawData.endereco || {}
  const partes = [
    rawData.logradouro || end.logradouro,
    rawData.numero || end.numero || 'S/N',
    rawData.complemento || end.complemento,
    rawData.bairro || end.bairro,
  ]
    .filter(Boolean)
    .join(', ')

  // Telefones — API v5 usa contato_telefonico: [{ddd, numero, tipo}]
  // Fallback: telefones (array) → telefone (string)
  const rawTelContato = rawData.contato_telefonico || rawData.contato_telefone
  const telefonesDetalhados: Array<{ numero: string; tipo: string }> = []

  if (Array.isArray(rawTelContato) && rawTelContato.length > 0) {
    for (const t of rawTelContato) {
      if (t.ddd && t.numero) {
        telefonesDetalhados.push({
          numero: `(${t.ddd}) ${t.numero}`,
          tipo: t.tipo || 'fixo',
        })
      } else if (t.completo) {
        telefonesDetalhados.push({ numero: t.completo, tipo: t.tipo || 'fixo' })
      }
    }
  } else if (Array.isArray(rawData.telefones) && rawData.telefones.length > 0) {
    for (const t of rawData.telefones) {
      const num = typeof t === 'string' ? t : t?.numero || ''
      if (num) telefonesDetalhados.push({ numero: num, tipo: 'fixo' })
    }
  } else if (rawData.telefone) {
    telefonesDetalhados.push({ numero: rawData.telefone, tipo: 'fixo' })
  }

  const telefone = telefonesDetalhados
    .map((t) => (t.tipo === 'celular' ? `${t.numero} [cel]` : t.numero))
    .join(' / ')

  // Emails — API v5 usa contato_email: [{email, valido}]
  const rawEmails = rawData.contato_email || rawData.emails
  const emailsDetalhados: Array<{ email: string; valido: boolean }> = []

  if (Array.isArray(rawEmails)) {
    for (const e of rawEmails) {
      if (typeof e === 'string' && e)
        emailsDetalhados.push({ email: e, valido: true })
      else if (e?.email)
        emailsDetalhados.push({ email: e.email, valido: e.valido !== false })
    }
  } else if (typeof rawData.email === 'string' && rawData.email) {
    emailsDetalhados.push({ email: rawData.email, valido: true })
  }

  const email = emailsDetalhados.map((e) => e.email).join(' / ')

  // Situação cadastral — API v5 retorna objeto {situacao_atual, motivo, data}
  const rawSit = rawData.situacao_cadastral
  const situacaoCadastral =
    typeof rawSit === 'object' && rawSit !== null
      ? rawSit.situacao_atual || ''
      : typeof rawSit === 'string'
        ? rawSit
        : ''

  // Sócios — API v5 usa quadro_societario (não socios)
  // Campos: qualificacao_socio (string), data_entrada_sociedade, faixa_etaria_descricao, identificador_socio
  // A API NÃO fornece email/telefone individual de sócios
  const rawSocios = rawData.quadro_societario || rawData.socios || []
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

  // Contatos principais: sócios Pessoa Física listados para o SDR
  // (A API não fornece contato individual — o SDR usa o telefone/email da empresa)
  const contatosPrincipais = socios
    .filter((s: any) => s.tipo === 'Pessoa Física' || !s.tipo)
    .map((s: any) => ({
      nome: s.nome,
      cargo: s.qualificacao || 'Sócio',
      faixa_etaria: s.faixa_etaria,
      email: null,
      telefone: null,
    }))

  return {
    razao_social: rawData.razao_social || '',
    nome_fantasia: rawData.nome_fantasia || '',
    cnae_fiscal_principal: cnae,
    municipio: rawData.municipio || end.municipio || '',
    uf: rawData.uf || end.uf || '',
    cep: rawData.cep || end.cep || '',
    porte,
    situacao_cadastral: situacaoCadastral,
    capital_social: rawData.capital_social ? Number(rawData.capital_social) : 0,
    data_abertura: rawData.data_inicio_atividade || rawData.data_abertura || '',
    email,
    telefone,
    telefones_detalhados: telefonesDetalhados,
    emails_detalhados: emailsDetalhados,
    endereco_completo: partes,
    socios,
    contatos_principais: contatosPrincipais,
    faturamento_anual: rawData.faturamento_estimado || null,
    numero_funcionarios:
      rawData.quantidade_funcionarios || rawData.faixa_funcionarios || null,
    score_credito: rawData.score_credito || rawData.score || null,
    dados_incompletos: false,
    fonte: 'casadosdados',
  }
}

function mapCnpjWsToResult(data: any) {
  const est = data.estabelecimento || {}
  const rua = [est.tipo_logradouro, est.logradouro].filter(Boolean).join(' ')
  const endereco_completo = [
    rua,
    est.numero || 'S/N',
    est.complemento,
    est.bairro,
  ]
    .filter(Boolean)
    .join(', ')

  const isCelular = (num: string) => num.startsWith('9') || num.length >= 9
  const telefonesWs: Array<{ numero: string; tipo: string }> = []
  if (est.ddd1 && est.telefone1) {
    telefonesWs.push({
      numero: `(${est.ddd1}) ${est.telefone1}`,
      tipo: isCelular(est.telefone1) ? 'celular' : 'fixo',
    })
  } else if (est.telefone1) {
    telefonesWs.push({
      numero: est.telefone1,
      tipo: isCelular(est.telefone1) ? 'celular' : 'fixo',
    })
  }
  if (est.ddd2 && est.telefone2) {
    telefonesWs.push({
      numero: `(${est.ddd2}) ${est.telefone2}`,
      tipo: isCelular(est.telefone2) ? 'celular' : 'fixo',
    })
  }
  const telefone = telefonesWs
    .map((t) => (t.tipo === 'celular' ? `${t.numero} [cel]` : t.numero))
    .join(' / ')

  const emailWs = est.email ? [{ email: est.email, valido: true }] : []

  return {
    razao_social: data.razao_social || '',
    nome_fantasia: est.nome_fantasia || data.nome_fantasia || '',
    cnae_fiscal_principal: est.atividade_principal
      ? `${est.atividade_principal.id} - ${est.atividade_principal.descricao}`
      : '',
    municipio: est.cidade?.nome || '',
    uf: est.estado?.sigla || '',
    cep: est.cep || '',
    porte: data.porte?.descricao || '',
    situacao_cadastral:
      est.situacao_cadastral === 'Ativa'
        ? 'Ativa'
        : est.situacao_cadastral || '',
    capital_social: data.capital_social ? Number(data.capital_social) : 0,
    data_abertura: est.data_inicio_atividade || '',
    email: est.email || '',
    telefone,
    telefones_detalhados: telefonesWs,
    emails_detalhados: emailWs,
    endereco_completo,
    socios: (data.socios || []).map((s: any) => ({
      nome: s.nome || s.razao_social || '',
      qualificacao: s.qualificacao_socio?.descricao || '',
      data_entrada: s.data_entrada || '',
      faixa_etaria: s.faixa_etaria || '',
      tipo: s.tipo || '',
      email: null,
      telefone: null,
    })),
    contatos_principais: (data.socios || [])
      .filter((s: any) => s.tipo === 'Pessoa Física' || !s.tipo)
      .map((s: any) => ({
        nome: s.nome || s.razao_social || '',
        cargo: s.qualificacao_socio?.descricao || 'Sócio',
        faixa_etaria: s.faixa_etaria || '',
        email: null,
        telefone: null,
      })),
    faturamento_anual: null,
    numero_funcionarios: null,
    score_credito: null,
    dados_incompletos: true,
    fonte: 'cnpjws',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const { cnpj } = payload

    if (!cnpj) {
      return new Response(JSON.stringify({ error: 'CNPJ não fornecido' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const cleanCnpj = cnpj.replace(/\D/g, '')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // 1. Check cache — only reuse if full enrichment (has razao_social)
    const now = new Date().toISOString()
    const { data: cached } = await supabaseAdmin
      .from('company_enriched_cache')
      .select('data')
      .eq('cnpj', cleanCnpj)
      .gt('expires_at', now)
      .maybeSingle()

    if (cached?.data?.razao_social) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // 2. Get Casa dos Dados API key
    let apiKey =
      Deno.env.get('CASA_DOS_DADOS_API_KEY') ||
      Deno.env.get('CASADOSDADOS_API_KEY')
    if (!apiKey) {
      const { data: config } = await supabaseAdmin
        .from('configuracoes_sistema')
        .select('casadosdados_api_token')
        .eq('id', 1)
        .maybeSingle()
      apiKey = config?.casadosdados_api_token?.trim() || ''
    }

    let result: any = null

    // 3. Try Casa dos Dados first
    if (apiKey) {
      try {
        const tokenRaw = apiKey.replace(/^Bearer\s+/i, '').trim()
        const res = await fetch(
          `https://api.casadosdados.com.br/v5/cnpj/${cleanCnpj}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'api-key': tokenRaw,
            },
          },
        )

        if (res.ok) {
          const rawData = await res.json()
          result = mapCasaDadosToResult(rawData)
        }
      } catch {
        // fall through to CNPJ.ws fallback
      }
    }

    // 4. Fallback to CNPJ.ws (free, Receita Federal data)
    if (!result) {
      try {
        const res = await fetch(`https://publica.cnpj.ws/cnpj/${cleanCnpj}`)
        if (res.ok) {
          const data = await res.json()
          result = mapCnpjWsToResult(data)
        }
      } catch {
        // both sources failed
      }
    }

    if (!result) {
      return new Response(
        JSON.stringify({ error: 'Falha ao buscar dados no provedor externo' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // 5. Cache only Casa dos Dados results (24h TTL)
    if (result.fonte === 'casadosdados') {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabaseAdmin
        .from('company_enriched_cache')
        .upsert(
          { cnpj: cleanCnpj, data: result, expires_at: expiresAt },
          { onConflict: 'cnpj' },
        )
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
