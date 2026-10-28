import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import {
  getFieldsFor,
  type EntityType,
  type FieldDef,
} from '../_shared/bitrixFields.ts'

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  if (typeof v === 'string' && v.trim() === '') return true
  return false
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json()
    const entityType = body?.entity_type as EntityType
    const entityId = String(body?.entity_id ?? '').trim()

    if (
      !['contact', 'lead', 'company', 'deal'].includes(entityType) ||
      !/^\d+$/.test(entityId)
    ) {
      return jsonResp(400, {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'entity_type ou entity_id inválido',
      })
    }

    const bitrixBase = await getBitrixWebhookUrl(supabase)

    async function bitrixGet(
      method: string,
      params: Record<string, string>,
    ): Promise<any> {
      const url = new URL(bitrixBase + method + '.json')
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      const r = await fetch(url.toString())
      if (!r.ok) throw new Error(`Bitrix ${method} HTTP ${r.status}`)
      const json = await r.json()
      if (json.error)
        throw new Error(
          `Bitrix ${method}: ${json.error_description ?? json.error}`,
        )
      return json.result
    }

    // 1. Buscar entidade principal
    let entity: any
    try {
      entity = await bitrixGet(`crm.${entityType}.get`, { id: entityId })
    } catch (e: any) {
      if (
        e.message?.includes('Not found') ||
        e.message?.includes('not found')
      ) {
        return jsonResp(404, {
          ok: false,
          error: 'ENTITY_NOT_FOUND',
          message: e.message,
        })
      }
      return jsonResp(502, {
        ok: false,
        error: 'BITRIX_ERROR',
        message: e.message,
      })
    }

    if (!entity) {
      return jsonResp(404, {
        ok: false,
        error: 'ENTITY_NOT_FOUND',
        message: 'Entidade não encontrada',
      })
    }

    // 2. Filtrar campos definidos que têm valor
    const defs = getFieldsFor(entityType)
    const present: { def: FieldDef; raw: unknown }[] = []
    for (const def of defs) {
      const raw = entity[def.key]
      if (isEmpty(raw)) continue
      present.push({ def, raw })
    }

    // 3. Coletar IDs que precisam de resolução
    const enumNeeds = new Map<string, Set<string>>()
    const userIds = new Set<string>()

    for (const { def, raw } of present) {
      if (def.kind === 'enum') {
        const set = enumNeeds.get(def.key) ?? new Set<string>()
        set.add(String(raw))
        enumNeeds.set(def.key, set)
      } else if (def.kind === 'enum_multi') {
        const arr = Array.isArray(raw) ? raw : [raw]
        const set = enumNeeds.get(def.key) ?? new Set<string>()
        for (const v of arr) set.add(String(v))
        enumNeeds.set(def.key, set)
      } else if (def.kind === 'user') {
        userIds.add(String(raw))
      }
    }

    // 4. Resolver enums (cache → refresh se faltar)
    const enumLabels = new Map<string, Map<string, string>>()
    for (const [fieldName, ids] of enumNeeds) {
      const labels = await resolveEnumLabels(
        supabase,
        entityType,
        fieldName,
        ids,
        bitrixGet,
      )
      enumLabels.set(fieldName, labels)
    }

    // 5. Resolver users
    const userLabels = await resolveUserLabels(supabase, userIds, bitrixGet)

    // 6. Resolver company_ref (contact com COMPANY_ID)
    //    + buscar detalhes completos da empresa (para painel agregado v2C)
    let companyTitle: string | undefined
    let companyDetails: CompanyDetails | null = null
    const companyRef = present.find((p) => p.def.kind === 'company_ref')
    if (companyRef?.raw && entityType === 'contact') {
      // Só busca details para contato (empresa direta não precisa, é a própria entidade)
      try {
        companyDetails = await fetchCompanyDetails(
          supabase,
          bitrixGet,
          String(companyRef.raw),
        )
        if (companyDetails) {
          // Pega o TITLE dos fields da empresa para manter compatibilidade com `company_title`
          const titleField = companyDetails.fields.find(
            (f: any) => f.key === 'TITLE',
          )
          if (titleField) companyTitle = String(titleField.value)
        }
      } catch (e: any) {
        console.warn('[company-details] falha:', e.message)
      }
    } else if (companyRef?.raw) {
      // Fallback antigo: pega só o título
      try {
        const cmp = await bitrixGet('crm.company.get', {
          id: String(companyRef.raw),
        })
        companyTitle = cmp?.TITLE
      } catch (_) {
        /* não bloqueia */
      }
    }

    // 7. Montar resposta
    const fields = present
      .map(({ def, raw }) => {
        const base: Record<string, unknown> = {
          key: def.key,
          label: def.label,
          kind: def.kind,
          value: raw,
        }
        if (def.kind === 'enum') {
          base.resolved = enumLabels.get(def.key)?.get(String(raw)) ?? null
        } else if (def.kind === 'enum_multi') {
          const arr = Array.isArray(raw) ? raw : [raw]
          const m = enumLabels.get(def.key)
          base.resolved = arr.map((v) => m?.get(String(v)) ?? String(v))
        } else if (def.kind === 'user') {
          base.resolved = userLabels.get(String(raw)) ?? null
        } else if (def.kind === 'multifield') {
          base.value = (Array.isArray(raw) ? raw : []).map((m: any) => ({
            value: m?.VALUE ?? '',
            type: m?.VALUE_TYPE ?? '',
          }))
        }
        return base
      })
      .filter((f) =>
        f.kind === 'multifield' ? (f.value as any[]).length > 0 : true,
      )

    // 8. Buscar deals relacionados (parte 2A + 2C: inclui deals da empresa quando contato tem COMPANY_ID)
    let deals: Deal[] = []
    let not_converted = false

    if (entityType === 'lead') {
      not_converted = true
    } else {
      try {
        // Deals do contato/empresa/deal vinculado
        deals = await fetchRelatedDeals(
          supabase,
          bitrixGet,
          entityType,
          entityId,
        )

        // Se for contato com empresa, AGREGA deals da empresa também (sem duplicar)
        if (entityType === 'contact' && companyRef?.raw) {
          const companyId = String(companyRef.raw)
          try {
            const companyDeals = await fetchRelatedDeals(
              supabase,
              bitrixGet,
              'company',
              companyId,
            )
            // Deduplica por id (caso algum deal apareça em ambos)
            const existingIds = new Set(deals.map((d) => d.id))
            for (const cd of companyDeals) {
              if (!existingIds.has(cd.id)) {
                deals.push(cd)
              }
            }
          } catch (e: any) {
            console.warn('[deals] falha ao buscar deals da empresa:', e.message)
          }
        }
      } catch (e: any) {
        console.warn('[deals] falha ao buscar deals relacionados:', e.message)
      }
    }

    return jsonResp(200, {
      ok: true,
      entity_type: entityType,
      entity_id: Number(entityId),
      fields,
      company_title: companyTitle,
      company_details: companyDetails,
      deals,
      not_converted,
    })
  } catch (err: any) {
    console.error('[bitrix-get-entity-details] erro:', err.message)
    return jsonResp(500, { ok: false, error: 'INTERNAL', message: err.message })
  }
})

async function resolveEnumLabels(
  supabase: ReturnType<typeof createClient>,
  entityType: EntityType,
  fieldName: string,
  ids: Set<string>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
): Promise<Map<string, string>> {
  const { data: cached } = await supabase
    .from('bitrix_field_metadata')
    .select('item_id, item_label')
    .eq('kind', 'enum')
    .eq('entity_type', entityType)
    .eq('field_name', fieldName)
    .in('item_id', Array.from(ids))

  const map = new Map<string, string>()
  for (const row of cached ?? []) map.set(row.item_id, row.item_label)

  const missing = Array.from(ids).filter((id) => !map.has(id))
  if (missing.length === 0) return map

  try {
    const fieldsData = await bitrixGet(`crm.${entityType}.fields`, {})
    const fieldDef = fieldsData?.[fieldName]
    const items: Array<{ ID: string; VALUE: string }> = fieldDef?.items ?? []
    if (items.length === 0) return map

    const rows = items.map((it) => ({
      kind: 'enum',
      entity_type: entityType,
      field_name: fieldName,
      item_id: String(it.ID),
      item_label: String(it.VALUE),
    }))
    await supabase.from('bitrix_field_metadata').upsert(rows, {
      onConflict: 'kind,entity_type,field_name,item_id',
    })
    for (const it of items) map.set(String(it.ID), String(it.VALUE))
  } catch (e: any) {
    console.warn(
      `[resolveEnumLabels] ${entityType}.${fieldName} refresh falhou:`,
      e.message,
    )
  }
  return map
}

async function resolveUserLabels(
  supabase: ReturnType<typeof createClient>,
  ids: Set<string>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map()

  const { data: cached } = await supabase
    .from('bitrix_field_metadata')
    .select('item_id, item_label')
    .eq('kind', 'user')
    .in('item_id', Array.from(ids))

  const map = new Map<string, string>()
  for (const row of cached ?? []) map.set(row.item_id, row.item_label)

  const missing = Array.from(ids).filter((id) => !map.has(id))
  for (const userId of missing) {
    try {
      const u = await bitrixGet('user.get', { ID: userId })
      const first = Array.isArray(u) ? u[0] : u
      if (!first) continue
      const name =
        [first.NAME, first.LAST_NAME].filter(Boolean).join(' ').trim() ||
        `Usuário ${userId}`
      await supabase.from('bitrix_field_metadata').upsert(
        {
          kind: 'user',
          entity_type: 'user',
          field_name: 'user',
          item_id: userId,
          item_label: name,
        },
        { onConflict: 'kind,entity_type,field_name,item_id' },
      )
      map.set(userId, name)
    } catch (e: any) {
      console.warn(`[resolveUserLabels] user.get ${userId} falhou:`, e.message)
    }
  }
  return map
}

// ─── Company aggregation ────────────────────────────────────────────────────

interface CompanyDetails {
  entity_id: number
  fields: any[] // mesmo formato dos fields do contact (key, label, kind, value, resolved)
}

// Busca detalhes completos da empresa (não só o título) e retorna no mesmo formato dos fields do contato.
// Usa as mesmas funções de resolução de enums e users que já existem.
async function fetchCompanyDetails(
  supabase: ReturnType<typeof createClient>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
  companyId: string,
): Promise<CompanyDetails | null> {
  let companyEntity: any
  try {
    companyEntity = await bitrixGet('crm.company.get', { id: companyId })
  } catch (_) {
    return null
  }
  if (!companyEntity) return null

  // Mesma lógica do fluxo principal, mas aplicada à empresa
  const defs = getFieldsFor('company')
  const present: { def: FieldDef; raw: unknown }[] = []
  for (const def of defs) {
    const raw = companyEntity[def.key]
    if (isEmpty(raw)) continue
    present.push({ def, raw })
  }

  const enumNeeds = new Map<string, Set<string>>()
  const userIds = new Set<string>()

  for (const { def, raw } of present) {
    if (def.kind === 'enum') {
      const set = enumNeeds.get(def.key) ?? new Set<string>()
      set.add(String(raw))
      enumNeeds.set(def.key, set)
    } else if (def.kind === 'enum_multi') {
      const arr = Array.isArray(raw) ? raw : [raw]
      const set = enumNeeds.get(def.key) ?? new Set<string>()
      for (const v of arr) set.add(String(v))
      enumNeeds.set(def.key, set)
    } else if (def.kind === 'user') {
      userIds.add(String(raw))
    }
  }

  const enumLabels = new Map<string, Map<string, string>>()
  for (const [fieldName, ids] of enumNeeds) {
    const labels = await resolveEnumLabels(
      supabase,
      'company',
      fieldName,
      ids,
      bitrixGet,
    )
    enumLabels.set(fieldName, labels)
  }

  const userLabels = await resolveUserLabels(supabase, userIds, bitrixGet)

  const fields = present
    .map(({ def, raw }) => {
      const base: Record<string, unknown> = {
        key: def.key,
        label: def.label,
        kind: def.kind,
        value: raw,
      }
      if (def.kind === 'enum') {
        base.resolved = enumLabels.get(def.key)?.get(String(raw)) ?? null
      } else if (def.kind === 'enum_multi') {
        const arr = Array.isArray(raw) ? raw : [raw]
        const m = enumLabels.get(def.key)
        base.resolved = arr.map((v) => m?.get(String(v)) ?? String(v))
      } else if (def.kind === 'user') {
        base.resolved = userLabels.get(String(raw)) ?? null
      } else if (def.kind === 'multifield') {
        base.value = (Array.isArray(raw) ? raw : []).map((m: any) => ({
          value: m?.VALUE ?? '',
          type: m?.VALUE_TYPE ?? '',
        }))
      }
      return base
    })
    .filter((f) =>
      f.kind === 'multifield' ? (f.value as any[]).length > 0 : true,
    )

  return {
    entity_id: Number(companyId),
    fields,
  }
}

// ─── Deal helpers ───────────────────────────────────────────────────────────

interface Deal {
  id: number
  title: string
  stage_id: string
  stage_label: string | null
  category_id: string
  category_label: string | null
  opportunity: number | null
  currency_id: string | null
  assigned_by_id: string
  assigned_by_label: string | null
  date_create: string | null
  date_modify: string | null
  close_date: string | null
}

async function fetchRelatedDeals(
  supabase: ReturnType<typeof createClient>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
  entityType: EntityType | 'deal',
  entityId: string,
): Promise<Deal[]> {
  // Monta filtro conforme tipo de entidade
  const filter: Record<string, string> = { 'filter[CLOSED]': 'N' }

  if (entityType === 'contact') {
    filter['filter[CONTACT_ID]'] = entityId
  } else if (entityType === 'company') {
    filter['filter[COMPANY_ID]'] = entityId
  } else if (entityType === 'deal') {
    // Pega o próprio deal pra descobrir o CONTACT_ID, depois lista deals desse contato
    let ownDeal: any
    try {
      ownDeal = await bitrixGet('crm.deal.get', { id: entityId })
    } catch (_) {
      return [] // se o próprio deal não existe/erra, não tem como buscar relacionados
    }
    const contactId = ownDeal?.CONTACT_ID
    if (!contactId || contactId === '0') {
      // Deal sem contato associado — retorna só ele
      return await formatDeals(supabase, bitrixGet, [ownDeal])
    }
    filter['filter[CONTACT_ID]'] = String(contactId)
  } else {
    return []
  }

  // Campos a buscar
  const selectFields = [
    'ID',
    'TITLE',
    'STAGE_ID',
    'CATEGORY_ID',
    'OPPORTUNITY',
    'CURRENCY_ID',
    'ASSIGNED_BY_ID',
    'DATE_CREATE',
    'DATE_MODIFY',
    'CLOSEDATE',
    'CONTACT_ID',
  ]
  const selectParams: Record<string, string> = {}
  selectFields.forEach((f, i) => {
    selectParams[`select[${i}]`] = f
  })

  let rawDeals: any[] = []
  try {
    rawDeals = await bitrixGet('crm.deal.list', { ...filter, ...selectParams })
  } catch (e: any) {
    console.warn('[fetchRelatedDeals] crm.deal.list falhou:', e.message)
    return []
  }

  if (!Array.isArray(rawDeals) || rawDeals.length === 0) return []

  return await formatDeals(supabase, bitrixGet, rawDeals)
}

async function formatDeals(
  supabase: ReturnType<typeof createClient>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
  rawDeals: any[],
): Promise<Deal[]> {
  // Coletar IDs para resolver
  const stageIds = new Set<string>()
  const categoryIds = new Set<string>()
  const userIds = new Set<string>()

  for (const d of rawDeals) {
    if (d.STAGE_ID) stageIds.add(String(d.STAGE_ID))
    if (d.CATEGORY_ID) categoryIds.add(String(d.CATEGORY_ID))
    if (d.ASSIGNED_BY_ID) userIds.add(String(d.ASSIGNED_BY_ID))
  }

  // Resolver stages (cache em bitrix_field_metadata: entity_type='deal', field_name='STAGE_ID')
  // Passa categorias presentes para fazer chamadas DEAL_STAGE_{N} corretas por kanban
  const stageLabels = await resolveDealStages(
    supabase,
    bitrixGet,
    stageIds,
    categoryIds,
  )

  // Resolver categories (kanbans) — entity_type='deal', field_name='CATEGORY_ID'
  const categoryLabels = await resolveDealCategories(
    supabase,
    bitrixGet,
    categoryIds,
  )

  // Resolver users (já existe função)
  const userLabels = await resolveUserLabels(supabase, userIds, bitrixGet)

  return rawDeals.map(
    (d): Deal => ({
      id: Number(d.ID),
      title: String(d.TITLE ?? ''),
      stage_id: String(d.STAGE_ID ?? ''),
      stage_label: stageLabels.get(String(d.STAGE_ID)) ?? null,
      category_id: String(d.CATEGORY_ID ?? '0'),
      category_label: categoryLabels.get(String(d.CATEGORY_ID ?? '0')) ?? null,
      opportunity: d.OPPORTUNITY ? Number(d.OPPORTUNITY) : null,
      currency_id: d.CURRENCY_ID ? String(d.CURRENCY_ID) : null,
      assigned_by_id: String(d.ASSIGNED_BY_ID ?? ''),
      assigned_by_label: userLabels.get(String(d.ASSIGNED_BY_ID)) ?? null,
      date_create: d.DATE_CREATE ? String(d.DATE_CREATE) : null,
      date_modify: d.DATE_MODIFY ? String(d.DATE_MODIFY) : null,
      close_date: d.CLOSEDATE ? String(d.CLOSEDATE) : null,
    }),
  )
}

async function resolveDealStages(
  supabase: ReturnType<typeof createClient>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
  ids: Set<string>,
  categoryIds: Set<string>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map()

  const { data: cached } = await supabase
    .from('bitrix_field_metadata')
    .select('item_id, item_label')
    .eq('kind', 'enum')
    .eq('entity_type', 'deal')
    .eq('field_name', 'STAGE_ID')
    .in('item_id', Array.from(ids))

  const map = new Map<string, string>()
  for (const row of cached ?? []) map.set(row.item_id, row.item_label)

  const missing = Array.from(ids).filter((id) => !map.has(id))
  if (missing.length === 0) return map

  // Stages no Bitrix são por categoria:
  //   categoria 0 (padrão) → ENTITY_ID = DEAL_STAGE
  //   categoria N (outros) → ENTITY_ID = DEAL_STAGE_N
  // Iteramos pelas categorias presentes nos deals carregados.

  const rows: any[] = []

  for (const catId of categoryIds) {
    const entityIdFilter = catId === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${catId}`

    try {
      const stages = await bitrixGet('crm.status.list', {
        'filter[ENTITY_ID]': entityIdFilter,
      })
      if (!Array.isArray(stages)) continue

      for (const s of stages) {
        const sid = String(s.STATUS_ID)
        const label = String(s.NAME)
        map.set(sid, label)
        rows.push({
          kind: 'enum',
          entity_type: 'deal',
          field_name: 'STAGE_ID',
          item_id: sid,
          item_label: label,
        })
      }
    } catch (e: any) {
      console.warn(
        `[resolveDealStages] refresh falhou para ${entityIdFilter}:`,
        e.message,
      )
      // Continua para próximas categorias mesmo se uma falhar
    }
  }

  // Cachear todos (upsert idempotente)
  if (rows.length > 0) {
    await supabase.from('bitrix_field_metadata').upsert(rows, {
      onConflict: 'kind,entity_type,field_name,item_id',
    })
  }

  return map
}

async function resolveDealCategories(
  supabase: ReturnType<typeof createClient>,
  bitrixGet: (method: string, params: Record<string, string>) => Promise<any>,
  ids: Set<string>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map()

  const { data: cached } = await supabase
    .from('bitrix_field_metadata')
    .select('item_id, item_label')
    .eq('kind', 'enum')
    .eq('entity_type', 'deal')
    .eq('field_name', 'CATEGORY_ID')
    .in('item_id', Array.from(ids))

  const map = new Map<string, string>()
  for (const row of cached ?? []) map.set(row.item_id, row.item_label)

  const missing = Array.from(ids).filter((id) => !map.has(id))
  if (missing.length === 0) return map

  try {
    // Categoria 0 é a default — não vem em crm.dealcategory.list
    if (missing.includes('0') && !map.has('0')) {
      map.set('0', 'Geral')
      await supabase.from('bitrix_field_metadata').upsert(
        {
          kind: 'enum',
          entity_type: 'deal',
          field_name: 'CATEGORY_ID',
          item_id: '0',
          item_label: 'Geral',
        },
        { onConflict: 'kind,entity_type,field_name,item_id' },
      )
    }

    const cats = await bitrixGet('crm.dealcategory.list', {})
    if (!Array.isArray(cats)) return map

    const rows: any[] = []
    for (const c of cats) {
      const cid = String(c.ID)
      const label = String(c.NAME)
      map.set(cid, label)
      rows.push({
        kind: 'enum',
        entity_type: 'deal',
        field_name: 'CATEGORY_ID',
        item_id: cid,
        item_label: label,
      })
    }
    if (rows.length > 0) {
      await supabase.from('bitrix_field_metadata').upsert(rows, {
        onConflict: 'kind,entity_type,field_name,item_id',
      })
    }
  } catch (e: any) {
    console.warn('[resolveDealCategories] refresh falhou:', e.message)
  }

  return map
}
