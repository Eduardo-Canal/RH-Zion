/**
 * Monta o system prompt estruturado a partir das configurações de contexto IA.
 * Importado por generate-commercial-approach e test-openai-prompt.
 */

interface CompanyProfile {
  nome?: string
  setor?: string
  proposta_valor?: string
  diferenciais?: string[]
  cases_sucesso?: string[]
  anos_mercado?: string
}

interface ProductFeature {
  nome?: string
  descricao?: string
  beneficio?: string
}

interface ProductSpecs {
  nome_produto?: string
  features?: ProductFeature[]
  casos_uso?: string[]
  segmentos_alvo?: string[]
}

interface Persona {
  cargo?: string
  nivel_decisao?: string
  dores?: string[]
  motivacoes?: string[]
  objecoes_comuns?: string[]
}

interface PersonasConfig {
  personas?: Persona[]
}

interface ApproachRules {
  tom?: string
  comprimento?: string
  estilo_cta?: string
  canais_preferidos?: string[]
  idioma?: string
  instrucoes_adicionais?: string
}

export interface AiContextConfigs {
  company?: CompanyProfile
  product?: ProductSpecs
  personas?: PersonasConfig
  rules?: ApproachRules
}

/**
 * Converte as 4 configurações em um system prompt rico.
 */
export function buildAiPrompt(configs: AiContextConfigs): string {
  const { company, product, personas, rules } = configs
  const lines: string[] = []

  // ─── Identidade ─────────────────────────────────────────
  if (company?.nome) {
    lines.push('IDENTIDADE:')
    lines.push(
      `Você é um especialista em vendas B2B da ${company.nome}${company.anos_mercado ? `, empresa com ${company.anos_mercado} anos` : ''} no mercado de ${company.setor || 'tecnologia'}.`,
    )
    if (company.proposta_valor)
      lines.push(`Proposta de valor: ${company.proposta_valor}`)
    if (company.diferenciais?.length)
      lines.push(`Diferenciais: ${company.diferenciais.join(', ')}`)
    if (company.cases_sucesso?.length)
      lines.push(`Cases de sucesso: ${company.cases_sucesso.join(', ')}`)
  }

  // ─── Produto ────────────────────────────────────────────
  if (product?.nome_produto) {
    lines.push('')
    lines.push(`PRODUTO - ${product.nome_produto}:`)
    if (product.features?.length) {
      lines.push('Funcionalidades:')
      for (const f of product.features) {
        if (f.nome) {
          lines.push(
            `- ${f.nome}${f.descricao ? ': ' + f.descricao : ''}${f.beneficio ? ' (Benefício: ' + f.beneficio + ')' : ''}`,
          )
        }
      }
    }
    if (product.segmentos_alvo?.length)
      lines.push(`Segmentos-alvo: ${product.segmentos_alvo.join(', ')}`)
    if (product.casos_uso?.length)
      lines.push(`Casos de uso: ${product.casos_uso.join(', ')}`)
  }

  // ─── Personas ───────────────────────────────────────────
  if (personas?.personas?.length) {
    lines.push('')
    lines.push('PERSONAS-ALVO:')
    for (const p of personas.personas) {
      if (p.cargo) {
        lines.push(`\nCargo: ${p.cargo} (${p.nivel_decisao || 'Tático'})`)
        if (p.dores?.length) lines.push(`Dores: ${p.dores.join(', ')}`)
        if (p.motivacoes?.length)
          lines.push(`Motivações: ${p.motivacoes.join(', ')}`)
        if (p.objecoes_comuns?.length)
          lines.push(`Objeções comuns: ${p.objecoes_comuns.join(', ')}`)
      }
    }
  }

  // ─── Regras ─────────────────────────────────────────────
  if (rules) {
    lines.push('')
    lines.push('REGRAS DE GERAÇÃO:')
    const parts: string[] = []
    if (rules.tom) parts.push(`Tom: ${rules.tom}`)
    if (rules.comprimento) parts.push(`Comprimento: ${rules.comprimento}`)
    if (rules.estilo_cta) parts.push(`CTA: ${rules.estilo_cta}`)
    if (parts.length) lines.push(parts.join(' | '))
    if (rules.canais_preferidos?.length)
      lines.push(`Canais preferidos: ${rules.canais_preferidos.join(', ')}`)
    if (rules.instrucoes_adicionais)
      lines.push(`\nInstruções adicionais: ${rules.instrucoes_adicionais}`)
  }

  return lines.join('\n')
}

/**
 * Versão LEVE do prompt: só identidade da empresa + regras de tom.
 * Usada onde o contexto completo (produto/personas) seria excessivo,
 * como na saudação curta de feira.
 */
export function buildAiPromptLeve(configs: AiContextConfigs): string {
  const { company, rules } = configs
  const lines: string[] = []
  if (company?.nome) {
    lines.push(
      `Você representa a ${company.nome}${company.setor ? `, do setor de ${company.setor}` : ''}.`,
    )
    if (company.proposta_valor)
      lines.push(`Proposta de valor: ${company.proposta_valor}`)
  }
  if (rules?.tom) lines.push(`Tom de comunicação: ${rules.tom}`)
  if (rules?.idioma) lines.push(`Idioma: ${rules.idioma}`)
  if (rules?.instrucoes_adicionais)
    lines.push(`Instruções: ${rules.instrucoes_adicionais}`)
  return lines.join('\n')
}

/**
 * Busca as 4 chaves de contexto IA da tabela settings em uma única query.
 */
export async function fetchAiConfigs(
  supabaseAdmin: any,
): Promise<AiContextConfigs> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', [
      'ai_company_profile',
      'ai_product_specs',
      'ai_personas',
      'ai_approach_rules',
    ])

  const configs: AiContextConfigs = {}

  if (data) {
    for (const row of data) {
      switch (row.key) {
        case 'ai_company_profile':
          configs.company = row.value as CompanyProfile
          break
        case 'ai_product_specs':
          configs.product = row.value as ProductSpecs
          break
        case 'ai_personas':
          configs.personas = row.value as PersonasConfig
          break
        case 'ai_approach_rules':
          configs.rules = row.value as ApproachRules
          break
      }
    }
  }

  return configs
}
