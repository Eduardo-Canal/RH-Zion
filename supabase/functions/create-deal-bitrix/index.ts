import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

// Detecta celular pelo dígito após o DDD (padrão brasileiro)
// Ex: (27) 95244949 → digits=2795244949 → digits[2]='9' → celular
function isCelular(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  if (digits.length >= 10) return digits[2] === '9'
  return digits[0] === '9'
}

function phoneType(phone: string): string {
  return isCelular(phone) ? 'MOBILE' : 'WORK'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json().catch(() => ({}))
    const {
      lead_id,
      company_id,
      kanban_id,
      stage_id,
      lead_data,
      _simulate_test,
    } = payload

    // Detectar se é Lead ou Deal baseado na configuração
    const { data: settingsData } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'bitrix24_defaults')
      .maybeSingle()

    const entityType = (settingsData?.value as any)?.entity_type || 'DEAL'
    const isLeadEntity = entityType === 'LEAD'
    console.log(
      'Entity type:',
      entityType,
      'kanban_id:',
      kanban_id,
      'stage_id:',
      stage_id,
    )

    if (!kanban_id || !stage_id) {
      return new Response(
        JSON.stringify({ error: 'Kanban e Fase são obrigatórios.' }),
        {
          status: 200,
          headers: corsHeaders,
        },
      )
    }

    let leadData = lead_data || {}

    // Busca dados da empresa no Supabase (CNPJ, Razão Social, Contatos)
    if (
      lead_id &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        lead_id,
      )
    ) {
      const { data: dbLead } = await supabaseAdmin
        .from('leads_salvos')
        .select('*')
        .eq('id', lead_id)
        .single()

      if (dbLead) {
        leadData = { ...leadData, ...dbLead }
      }
    }

    if (!leadData && !_simulate_test) {
      return new Response(
        JSON.stringify({ error: 'Dados do lead não encontrados.' }),
        {
          status: 200,
          headers: corsHeaders,
        },
      )
    }

    // Suporte para Teste com um lead fictício
    if (_simulate_test) {
      // Simula o registro de logs com sucesso e retorna a resposta mockada
      await supabaseAdmin.from('leads_bitrix_sync').insert({
        lead_id:
          lead_id &&
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            lead_id,
          )
            ? lead_id
            : null,
        company_id: company_id || 888888,
        deal_id: 999999,
        kanban_id: kanban_id,
        stage_id: stage_id,
        status: 'SUCESSO',
        user_id: leadData?.user_id || null,
      })

      return new Response(
        JSON.stringify({
          success: true,
          status: 'SUCESSO',
          deal_id: 999999,
          company_id: company_id || 888888,
          message:
            'Simulação de integração bem-sucedida. Autenticação validada e payload estruturado.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // --- MONTAR CONTEXTO COMPLETO PARA O BITRIX (DADOS DO LEAD + IA) ---
    const parseJsonSafe = (val: any) => {
      if (!val) return 'Não especificado'
      try {
        if (typeof val === 'string') {
          const parsed = JSON.parse(val)
          if (Array.isArray(parsed)) return parsed.join('\n- ')
          return val
        }
        if (Array.isArray(val)) return val.join('\n- ')
        return JSON.stringify(val)
      } catch {
        return String(val)
      }
    }

    // Montar socios do lead
    const sociosArray: any[] = []
    let sociosText = ''
    if (leadData.socios) {
      try {
        const socios =
          typeof leadData.socios === 'string'
            ? JSON.parse(leadData.socios)
            : leadData.socios
        if (Array.isArray(socios) && socios.length > 0) {
          socios.forEach((s: any) => sociosArray.push(s))
          sociosText = socios
            .map((s: any) => {
              const nome = s.nome || s.name || 'N/A'
              const qual = s.qualificacao || s.qual || ''
              const faixa = s.faixa_etaria || ''
              const entrada = s.data_entrada || ''
              return `${nome}${qual ? ' (' + qual + ')' : ''}${faixa ? ' — ' + faixa : ''}${entrada ? ' — Entrada: ' + entrada : ''}`
            })
            .join('\n- ')
        }
      } catch {
        /* ignore */
      }
    }

    // Dados da pesquisa do lead (Casa dos Dados)
    const leadInfoContext = `
[b]DADOS DA PESQUISA (LEAD FINDER ZION)[/b]

[b]Razão Social:[/b] ${leadData.razao_social || 'N/A'}
[b]CNPJ:[/b] ${leadData.cnpj || 'N/A'}
[b]CNAE Principal:[/b] ${leadData.cnae_principal || leadData.cnae_fiscal_principal || 'N/A'}
[b]Porte:[/b] ${leadData.porte || 'N/A'}
[b]Situação:[/b] ${leadData.situacao || leadData.situacao_cadastral || 'N/A'}
[b]Capital Social:[/b] ${leadData.capital_social ? 'R$ ' + Number(leadData.capital_social).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : 'N/A'}
[b]Data de Abertura:[/b] ${leadData.data_abertura || 'N/A'}
[b]Município/UF:[/b] ${leadData.municipio || ''} - ${leadData.uf || ''}
[b]E-mail:[/b] ${leadData.email || 'N/A'}
[b]Telefone:[/b] ${leadData.telefone || 'N/A'}
${sociosText ? `\n[b]Sócios:[/b]\n- ${sociosText}` : ''}
`.trim()

    // Abordagem IA
    let approachContext = ''
    if (
      lead_id &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        lead_id,
      )
    ) {
      const { data: approach } = await supabaseAdmin
        .from('lead_abordagens_comerciais')
        .select('*')
        .eq('lead_id', lead_id)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (approach) {
        approachContext = `

[b]INTELIGÊNCIA COMERCIAL (IA)[/b]

[b]Dores Principais:[/b]
- ${parseJsonSafe(approach.dores_principais)}

[b]Personas Decisoras:[/b]
- ${parseJsonSafe(approach.personas_decisoras)}

[b]Argumentos de Venda:[/b]
- ${parseJsonSafe(approach.argumentos_venda)}

[b]Próximos Passos:[/b]
- ${parseJsonSafe(approach.proximos_passos)}

[b]Abordagem Sugerida:[/b]
${approach.abordagem_gerada || 'N/A'}
`.trim()
      }
    }

    // Contexto completo = dados do lead + abordagem IA
    const fullContext = [leadInfoContext, approachContext]
      .filter(Boolean)
      .join('\n\n')

    const baseUrl = await getBitrixWebhookUrl(supabaseAdmin)
    const rateLimiterUrl = `${supabaseUrl}/functions/v1/bitrix-rate-limiter`

    // Implementa retry logic com até 3 tentativas em caso de falha (Resiliência)
    async function callBitrix(
      endpoint: string,
      method: string = 'GET',
      body?: any,
    ) {
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
              endpoint: baseUrl + endpoint,
              method,
              headers: { 'Content-Type': 'application/json' },
              body,
            }),
          })
          const data = await res.json()
          if (!res.ok || !data.success) {
            const errMsg = data.message || data.error || 'Bitrix API error'
            // Lê o tempo exato do rate limiter e aguarda
            if (res.status === 429 || errMsg.includes('Rate limit')) {
              const match = errMsg.match(/em (\d+) segundos/)
              if (match && match[1]) {
                const waitSecs = parseInt(match[1], 10)
                if (waitSecs <= 60) {
                  delay = waitSecs * 1000
                }
              }
            }
            const err = new Error(errMsg) as any
            err.response = data
            throw err
          }
          // Bitrix pode retornar HTTP 200 com corpo de erro (ex: QUERY_LIMIT_EXCEEDED)
          const responseBody = data.data
          if (responseBody?.error) {
            const bitrixErrMsg =
              responseBody.error_description || responseBody.error
            const err = new Error(`Bitrix: ${bitrixErrMsg}`) as any
            err.response = responseBody
            // Rate limit do Bitrix: adiciona delay fixo antes de tentar novamente
            if (
              String(responseBody.error).includes('LIMIT') ||
              String(responseBody.error).includes('QUOTA')
            ) {
              delay = Math.max(delay, 10000) // mínimo 10s ao detectar rate limit do Bitrix
            }
            throw err
          }
          return responseBody
        } catch (error: any) {
          if (attempt > maxRetries) {
            await supabaseAdmin.from('bitrix_api_logs').insert({
              endpoint: baseUrl + endpoint,
              method,
              status_code: 500,
              error_message: error.message,
              request_body: body,
            })
            throw error
          }
          await new Promise((resolve) => setTimeout(resolve, delay))
          delay *= 2
          attempt++
        }
      }
    }

    let finalCompanyId = company_id

    if (!finalCompanyId) {
      const cleanCnpj = leadData.cnpj ? leadData.cnpj.replace(/\D/g, '') : ''
      const razaoSocial = leadData.razao_social || 'Empresa Sem Nome'

      if (cleanCnpj) {
        // Buscar por CNPJ formatado no campo correto (UF_CRM_6241B0B267ED3)
        const cnpjBusca =
          cleanCnpj.length === 14
            ? `${cleanCnpj.slice(0, 2)}.${cleanCnpj.slice(2, 5)}.${cleanCnpj.slice(5, 8)}/${cleanCnpj.slice(8, 12)}-${cleanCnpj.slice(12)}`
            : cleanCnpj
        const searchRes = await callBitrix(
          `crm.company.list.json?filter[UF_CRM_6241B0B267ED3]=${encodeURIComponent(cnpjBusca)}&select[]=ID`,
        )
        if (searchRes?.result && searchRes.result.length > 0) {
          finalCompanyId = parseInt(searchRes.result[0].ID)
        }
      }

      if (!finalCompanyId) {
        // Formatar CNPJ com mascara XX.XXX.XXX/XXXX-XX (formato usado pelo Bitrix)
        const formatCnpj = (cnpj: string) => {
          const c = cnpj.replace(/\D/g, '')
          if (c.length !== 14) return c
          return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
        }

        const cnpjFormatado = cleanCnpj ? formatCnpj(cleanCnpj) : ''

        // Montar todos os telefones (celular → MOBILE, fixo → WORK)
        const phonesForBitrix: any[] = []
        if (
          Array.isArray(leadData.telefones_detalhados) &&
          leadData.telefones_detalhados.length > 0
        ) {
          for (const t of leadData.telefones_detalhados) {
            phonesForBitrix.push({
              VALUE: t.numero,
              VALUE_TYPE: phoneType(t.numero),
            })
          }
        } else if (leadData.telefone) {
          for (const num of leadData.telefone.split(' / ')) {
            const n = num.replace(' [cel]', '').trim()
            if (n) phonesForBitrix.push({ VALUE: n, VALUE_TYPE: phoneType(n) })
          }
        }

        // Montar todos os emails
        const emailsForBitrix: any[] = []
        if (
          Array.isArray(leadData.emails_detalhados) &&
          leadData.emails_detalhados.length > 0
        ) {
          for (const e of leadData.emails_detalhados) {
            emailsForBitrix.push({ VALUE: e.email, VALUE_TYPE: 'WORK' })
          }
        } else if (leadData.email) {
          for (const em of leadData.email.split(' / ')) {
            if (em.trim())
              emailsForBitrix.push({ VALUE: em.trim(), VALUE_TYPE: 'WORK' })
          }
        }

        const companyFields: any = {
          TITLE: razaoSocial,
          ADDRESS_CITY: leadData.municipio || '',
          ADDRESS_PROVINCE: leadData.uf || '',
        }

        if (leadData.cep) companyFields.ADDRESS_POSTAL_CODE = leadData.cep

        // CNPJ
        if (cnpjFormatado) {
          companyFields.UF_CRM_6241B0B267ED3 = cnpjFormatado
          companyFields.UF_CRM_1742992784 = cnpjFormatado
        }

        if (phonesForBitrix.length > 0) companyFields.PHONE = phonesForBitrix
        if (emailsForBitrix.length > 0) companyFields.EMAIL = emailsForBitrix

        // CNAE
        const cnae =
          leadData.cnae_principal || leadData.cnae_fiscal_principal || ''
        if (cnae) companyFields.UF_CRM_1771423651 = cnae

        // Nome Fantasia
        if (leadData.nome_fantasia)
          companyFields.UF_CRM_1742990673 = leadData.nome_fantasia

        // Situação cadastral
        const situacao = leadData.situacao || leadData.situacao_cadastral || ''
        if (situacao) {
          companyFields.UF_CRM_1742990227 = situacao
          companyFields.UF_CRM_1742990271 = situacao
        }

        // Porte
        if (leadData.porte) companyFields.UF_CRM_1742990347 = leadData.porte

        // Capital Social
        if (leadData.capital_social)
          companyFields.REVENUE = leadData.capital_social

        // Data de Abertura
        if (leadData.data_abertura)
          companyFields.UF_CRM_1742990450 = leadData.data_abertura

        console.log(
          'Creating company with fields:',
          JSON.stringify(companyFields).slice(0, 500),
        )
        const createRes = await callBitrix(`crm.company.add.json`, 'POST', {
          fields: companyFields,
        })
        finalCompanyId = parseInt(createRes?.result)
      }

      if (
        finalCompanyId &&
        lead_id &&
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          lead_id,
        )
      ) {
        await supabaseAdmin
          .from('leads_salvos')
          .update({ bitrix_id: finalCompanyId.toString() })
          .eq('id', lead_id)
      }
    }

    // ── R5: helpers de dedup de contato ────────────────────────────────────
    // Normaliza telefone pra dígitos puros (E.164 sem o +)
    function normalizePhone(raw: string): string {
      return String(raw || '').replace(/\D/g, '')
    }

    // Similaridade simples de nome (Levenshtein normalizado). Usada como
    // fallback quando o telefone do contato não bate (estratégia 2).
    function nameSimilarity(a: string, b: string): number {
      const norm = (s: string) =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
      const s1 = norm(a)
      const s2 = norm(b)
      if (!s1 || !s2) return 0
      if (s1 === s2) return 100
      const longer = s1.length >= s2.length ? s1 : s2
      const shorter = s1.length >= s2.length ? s2 : s1
      const costs: number[] = []
      for (let i = 0; i <= longer.length; i++) {
        let lastValue = i
        for (let j = 0; j <= shorter.length; j++) {
          if (i === 0) costs[j] = j
          else if (j > 0) {
            let newValue = costs[j - 1]
            if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
              newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
            }
            costs[j - 1] = lastValue
            lastValue = newValue
          }
        }
        if (i > 0) costs[shorter.length] = lastValue
      }
      return ((longer.length - costs[shorter.length]) / longer.length) * 100
    }

    // Tenta achar Contato existente vinculado à companyId. Estratégia dupla:
    // 1) crm.duplicate.findbycomm por PHONE → confere COMPANY_ID
    // 2) crm.company.contact.items.get → similaridade de nome ≥85%
    async function findContactInCompany(
      nome: string,
      telefone: string,
      companyId: number,
    ): Promise<number | null> {
      const phoneClean = normalizePhone(telefone)

      // Estratégia 1: dedup nativo do Bitrix por telefone
      if (phoneClean) {
        try {
          const findRes = await callBitrix(
            `crm.duplicate.findbycomm.json?type=PHONE&entity_type=CONTACT&values[]=${phoneClean}`,
          )
          const ids: any[] = findRes?.result?.CONTACT || []
          for (const id of ids.slice(0, 5)) {
            try {
              const getRes = await callBitrix(
                `crm.contact.get.json?id=${id}&select[]=ID&select[]=COMPANY_ID`,
              )
              if (parseInt(getRes?.result?.COMPANY_ID) === companyId) {
                return parseInt(id)
              }
            } catch {
              /* segue */
            }
          }
        } catch (e: any) {
          console.warn('[R5] findbycomm falhou:', e.message)
        }
      }

      // Estratégia 2: lista contatos da empresa e bate nome
      if (nome) {
        try {
          const listRes = await callBitrix(
            `crm.company.contact.items.get.json?id=${companyId}`,
          )
          const items: any[] = listRes?.result || []
          for (const item of items) {
            const contactId = parseInt(item.CONTACT_ID)
            if (!contactId) continue
            try {
              const getRes = await callBitrix(
                `crm.contact.get.json?id=${contactId}&select[]=ID&select[]=NAME&select[]=LAST_NAME`,
              )
              const fullName =
                `${getRes?.result?.NAME || ''} ${getRes?.result?.LAST_NAME || ''}`.trim()
              if (fullName && nameSimilarity(fullName, nome) >= 85) {
                return contactId
              }
            } catch {
              /* segue */
            }
          }
        } catch (e: any) {
          console.warn('[R5] company.contact.items.get falhou:', e.message)
        }
      }

      return null
    }

    // ── R5: Montar lista de "candidatos a contato" ──────────────────────────
    // 1) Sócios da Casa dos Dados (fluxo Prospecção)
    // 2) Fallback: contato_principal vindo do Wizard (fluxo Co-Piloto)
    type ContactCandidate = {
      nome: string
      cargo: string
      telefone: string
      email: string
      faixa_etaria?: string
      origem: 'socio' | 'wizard'
    }

    const contactCandidates: ContactCandidate[] = []

    if (sociosArray.length > 0) {
      for (const socio of sociosArray) {
        if (socio.tipo && socio.tipo !== 'Pessoa Física') continue
        const nomeCompleto: string = socio.nome || ''
        if (!nomeCompleto) continue

        // Telefone/email fallback da empresa (sócios não têm contato individual da API)
        let tel = ''
        if (leadData.telefones_detalhados?.[0]) {
          tel = leadData.telefones_detalhados[0].numero
        } else if (leadData.telefone) {
          tel = leadData.telefone.split(' / ')[0].replace(' [cel]', '').trim()
        }
        let mail = ''
        if (leadData.emails_detalhados?.[0]) {
          mail = leadData.emails_detalhados[0].email
        } else if (leadData.email) {
          mail = leadData.email.split(' / ')[0].trim()
        }

        contactCandidates.push({
          nome: nomeCompleto,
          cargo: socio.qualificacao || 'Sócio',
          telefone: tel,
          email: mail,
          faixa_etaria: socio.faixa_etaria || undefined,
          origem: 'socio',
        })
      }
    }

    // R4 hotfix: sempre adicionar contato_principal se vier no payload.
    // Antes era condicional (só quando socios vazio), o que ignorava o contato
    // real digitado no Wizard quando o CNPJ enriquecido trazia sócios da empresa.
    // Agora ambos são processados; o R5 (findContactInCompany) dedupa naturalmente
    // se houver duplicata entre contato_principal e algum sócio.
    if (leadData.contato_principal?.nome) {
      const cp = leadData.contato_principal
      // Evita duplicata literal: se algum socio já tem o mesmo nome+telefone,
      // o R5 vai detectar via similaridade no findContactInCompany. Não precisa
      // pré-filtrar aqui.
      contactCandidates.push({
        nome: cp.nome,
        cargo: cp.cargo || 'Contato',
        telefone: cp.telefone || '',
        email: cp.email || '',
        origem: 'wizard',
      })
    }

    // ── R5: Processar candidatos (dedup → create se necessário) ─────────────
    const contactIds: number[] = []
    let contactsCreated = 0
    let contactsReused = 0

    if (finalCompanyId && contactCandidates.length > 0) {
      for (const cand of contactCandidates) {
        try {
          // 1. Tenta achar existente
          const existingId = await findContactInCompany(
            cand.nome,
            cand.telefone,
            finalCompanyId,
          )
          if (existingId) {
            contactIds.push(existingId)
            contactsReused++
            console.log(
              `[R5] Contato reusado: id=${existingId}, nome="${cand.nome}", origem=${cand.origem}`,
            )
            continue
          }

          // 2. Não achou — cria novo
          const partes = cand.nome.trim().split(/\s+/)
          const firstName = partes[0] || cand.nome
          const lastName = partes.slice(1).join(' ') || ''

          const contactFields: any = {
            NAME: firstName,
            LAST_NAME: lastName,
            POST: cand.cargo,
            COMPANY_ID: finalCompanyId,
            SOURCE_ID: 'B24_APPLICATION',
            OPENED: 'Y',
          }

          if (cand.telefone) {
            contactFields.PHONE = [
              { VALUE: cand.telefone, VALUE_TYPE: phoneType(cand.telefone) },
            ]
          }
          if (cand.email) {
            contactFields.EMAIL = [{ VALUE: cand.email, VALUE_TYPE: 'WORK' }]
          }
          if (cand.faixa_etaria) {
            contactFields.UF_CRM_CONTACT_FAIXA_ETARIA = cand.faixa_etaria
          }

          const contactRes = await callBitrix('crm.contact.add.json', 'POST', {
            fields: contactFields,
          })
          const newId = contactRes?.result ? parseInt(contactRes.result) : null
          if (newId) {
            contactIds.push(newId)
            contactsCreated++
            console.log(
              `[R5] Contato criado: id=${newId}, nome="${cand.nome}", origem=${cand.origem}`,
            )
            // Vincular à empresa (necessário pq dedup futura vai consultar COMPANY_ID)
            await callBitrix('crm.company.contact.add.json', 'POST', {
              id: finalCompanyId,
              fields: {
                CONTACT_ID: newId,
                IS_PRIMARY: contactIds.length === 1 ? 'Y' : 'N',
              },
            })
          }
        } catch (contactErr: any) {
          console.warn(
            `[R5] Falha ao processar contato ${cand.nome}:`,
            contactErr.message,
          )
        }
      }
    }

    // Resultado consolidado de dedup de contato (pra auditoria)
    let contactAction: 'created' | 'reused' | 'none' | 'mixed'
    if (contactCandidates.length === 0) contactAction = 'none'
    else if (contactsCreated > 0 && contactsReused > 0) contactAction = 'mixed'
    else if (contactsCreated > 0) contactAction = 'created'
    else if (contactsReused > 0) contactAction = 'reused'
    else contactAction = 'none'

    // Monta o TITLE padronizado: [RAZAO SOCIAL] Projeto MLW {ANO}
    const razaoSocial = leadData?.razao_social || 'Lead'
    const anoAtual = new Date().getFullYear()
    const tituloFormatado = `[${razaoSocial}] Projeto MLW ${anoAtual}`

    // Extrair CNPJ limpo
    const cleanCnpjLead = leadData?.cnpj
      ? String(leadData.cnpj).replace(/\D/g, '')
      : ''

    // Cria Lead ou Deal no Bitrix24 dependendo da configuração
    let bitrixEndpoint: string
    let entityBody: any
    let leadAction: 'created' | 'reused' | 'n/a' = isLeadEntity
      ? 'created'
      : 'n/a'
    let reusedLeadId: number | null = null // se reusou, pula crm.lead.add

    if (isLeadEntity) {
      // ── R5: DEDUP DE LEAD POR CNPJ ─────────────────────────────────────────
      // Busca Lead aberto (STATUS_SEMANTIC_ID=P exclui CONVERTED=S e JUNK=F)
      // com mesmo CNPJ. Se achar, reusa. Senão, cria.
      if (cleanCnpjLead) {
        try {
          const leadSearchEndpoint =
            `crm.lead.list.json` +
            `?filter[UF_CRM_LEAD_1644319583429]=${encodeURIComponent(cleanCnpjLead)}` +
            `&filter[STATUS_SEMANTIC_ID]=P` +
            `&select[]=ID&select[]=TITLE&select[]=STATUS_ID&select[]=DATE_CREATE` +
            `&order[DATE_CREATE]=DESC`
          const leadSearchRes = await callBitrix(leadSearchEndpoint)
          const leadsEncontrados = leadSearchRes?.result || []
          if (leadsEncontrados.length > 0) {
            reusedLeadId = parseInt(leadsEncontrados[0].ID)
            leadAction = 'reused'
            console.log(
              `[R5] Lead aberto reusado: id=${reusedLeadId}, title="${leadsEncontrados[0].TITLE}", cnpj=${cleanCnpjLead}` +
                (leadsEncontrados.length > 1
                  ? ` (havia ${leadsEncontrados.length} abertos — pegou o mais recente)`
                  : ''),
            )
          }
        } catch (searchErr: any) {
          console.warn(
            '[R5] Falha na dedup de Lead, vai criar novo:',
            searchErr.message,
          )
        }
      }

      // Criar LEAD no Bitrix24 (só se não reusou)
      bitrixEndpoint = 'crm.lead.add.json'
      const fields: any = {
        TITLE: tituloFormatado,
        STATUS_ID: stage_id,
        COMPANY_TITLE: razaoSocial,
        COMPANY_ID: finalCompanyId,
        OPENED: 'Y',
        SOURCE_ID: 'B24_APPLICATION',
        ADDRESS_CITY: leadData?.municipio || '',
        ADDRESS_PROVINCE: leadData?.uf || '',
        UTM_SOURCE: 'Lead Finder Zion',
      }

      // Contatos
      if (leadData?.email) {
        fields.EMAIL = [{ VALUE: leadData.email, VALUE_TYPE: 'WORK' }]
      }
      if (leadData?.telefone) {
        fields.PHONE = [{ VALUE: leadData.telefone, VALUE_TYPE: 'WORK' }]
      }

      // CNPJ (campo customizado texto)
      if (cleanCnpjLead) {
        fields.UF_CRM_LEAD_1644319583429 = cleanCnpjLead
      }

      // Abordagem da IA direto no campo COMMENTS do lead
      if (fullContext) {
        fields.COMMENTS = fullContext
      }

      entityBody = { fields }
    } else {
      // Criar DEAL no Bitrix24
      bitrixEndpoint = 'crm.deal.add.json'
      entityBody = {
        fields: {
          TITLE: tituloFormatado,
          CATEGORY_ID: kanban_id,
          STAGE_ID: stage_id,
          COMPANY_ID: finalCompanyId,
          OPENED: 'Y',
          COMMENTS: fullContext,
        },
      }
    }

    console.log(
      'Creating entity via:',
      bitrixEndpoint,
      JSON.stringify(entityBody).slice(0, 500),
    )

    let dealRes
    try {
      // R5: se reusou Lead, pula crm.lead.add e usa o ID encontrado
      let returnedDealId: number | null = null
      if (reusedLeadId) {
        returnedDealId = reusedLeadId
        console.log(
          `[R5] Pulando crm.lead.add, usando Lead reusado id=${reusedLeadId}`,
        )
      } else {
        dealRes = await callBitrix(bitrixEndpoint, 'POST', entityBody)
        returnedDealId = dealRes?.result ? parseInt(dealRes.result) : null
      }

      // Vincular contatos dos sócios ao Deal/Lead
      if (returnedDealId && contactIds.length > 0) {
        const linkEndpoint = isLeadEntity
          ? 'crm.lead.contact.add.json'
          : 'crm.deal.contact.add.json'
        const entityKey = isLeadEntity ? 'id' : 'id'
        for (const contactId of contactIds) {
          try {
            await callBitrix(linkEndpoint, 'POST', {
              [entityKey]: returnedDealId,
              fields: { CONTACT_ID: contactId },
            })
          } catch (linkErr: any) {
            console.warn(
              `Falha ao vincular contato ${contactId} ao deal ${returnedDealId}:`,
              linkErr.message,
            )
          }
        }
      }

      // Adicionar abordagem como COMENTÁRIO no Lead/Deal criado
      if (returnedDealId && fullContext) {
        try {
          // ENTITY_TYPE_ID: 1=Lead, 2=Deal, 3=Contact, 4=Company
          const entityTypeId = isLeadEntity ? 1 : 2
          await callBitrix('crm.timeline.comment.add.json', 'POST', {
            fields: {
              ENTITY_ID: returnedDealId,
              ENTITY_TYPE_ID: entityTypeId,
              COMMENT: fullContext,
            },
          })
          console.log(
            'Comentário de abordagem adicionado com sucesso ao entity',
            entityTypeId,
            returnedDealId,
          )
        } catch (commentErr: any) {
          console.warn('Falha ao adicionar comentário:', commentErr.message)
          // Fallback: tentar atualizar o campo COMMENTS diretamente
          // Nota R5: em modo reusado, NÃO sobrescreve COMMENTS (perde histórico).
          // Só faz fallback se foi Lead recém-criado.
          if (!reusedLeadId) {
            try {
              const updateEndpoint = isLeadEntity
                ? 'crm.lead.update.json'
                : 'crm.deal.update.json'
              await callBitrix(updateEndpoint, 'POST', {
                id: returnedDealId,
                fields: { COMMENTS: fullContext },
              })
              console.log('Comentário adicionado via update do campo COMMENTS')
            } catch (updateErr: any) {
              console.warn(
                'Fallback COMMENTS também falhou:',
                updateErr.message,
              )
            }
          }
        }
      }

      // Registra o deal_id retornado na tabela 'leads_bitrix_sync' para auditoria com response e timestamp
      if (
        lead_id &&
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          lead_id,
        )
      ) {
        await supabaseAdmin.from('leads_bitrix_sync').insert({
          lead_id: lead_id,
          company_id: finalCompanyId,
          deal_id: returnedDealId,
          kanban_id: kanban_id,
          stage_id: stage_id,
          status: 'SUCESSO',
          user_id: leadData?.user_id || null,
          lead_action: leadAction, // R5
          contact_action: contactAction, // R5
        })
      }

      // Retorna deal_id e status da operação
      return new Response(
        JSON.stringify({
          success: true,
          status: 'SUCESSO',
          deal_id: returnedDealId,
          company_id: finalCompanyId,
          approach_included: !!fullContext,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    } catch (dealError: any) {
      // Captura e auditoria correta em caso de falha no envio do Negócio, incluindo raw response error
      const errorLog = dealError.stack || dealError.message || String(dealError)

      if (
        lead_id &&
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          lead_id,
        )
      ) {
        await supabaseAdmin.from('leads_bitrix_sync').insert({
          lead_id: lead_id,
          company_id: finalCompanyId,
          kanban_id: kanban_id,
          stage_id: stage_id,
          status: 'ERRO',
          error_message: dealError.message,
          error_log: errorLog,
          user_id: leadData?.user_id || null,
          lead_action: leadAction, // R5: registra mesmo em erro
          contact_action: contactAction, // R5: registra mesmo em erro
        })
      }
      throw dealError
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, status: 'ERRO', error: error.message }),
      {
        status: 200,
        headers: corsHeaders,
      },
    )
  }
})
