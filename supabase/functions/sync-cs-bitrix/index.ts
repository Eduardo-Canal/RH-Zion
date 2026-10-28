import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'
import { createBitrixClient } from '../_shared/bitrix-client.ts'
import { resolveAndCacheUsers } from '../_shared/resolve-bitrix-users.ts'

// Trunca a mensagem de erro (que já inclui a resposta/descrição real do
// Bitrix) pra não inchar o response nem logar payloads gigantes.
function truncar(msg: string, max = 200): string {
  const s = msg || 'Erro desconhecido'
  return s.length > max ? s.slice(0, max) + '…' : s
}

// Chaves em `settings` pro cursor de retomada e pro watermark incremental da
// fase de deals (Prompt 122) — sem migration nova, settings já é jsonb livre.
const CURSOR_KEY = 'cs_sync_cursor'
const WATERMARK_KEY = 'cs_deals_synced_at'
const CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000 // cursor mais velho que isso é descartado, recomeça do zero

// Sincroniza funis/estágios/negócios do Bitrix CRM para crm_categories/crm_stages/
// crm_deals — usado pela tela CS COM (módulo Auditoria). Reaproveita o webhook de
// CRM que o Órbita já tem (settings.bitrix24_webhook_url), o mesmo usado por
// create-deal-bitrix/fetch-bitrix-clients-zion — não precisa de webhook novo.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Token ausente' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const {
      data: { user: userData },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !userData) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const baseUrl = await getBitrixWebhookUrl(supabaseAdmin)
    const { callBitrix, callBitrixAllPages, callBitrixPagedEach } =
      createBitrixClient(supabaseUrl, serviceRoleKey, baseUrl)

    const syncStart = new Date().toISOString()

    // 1. crm.category.list → crm_categories
    const catRes = await callBitrix('crm.category.list', { entityTypeId: 2 })
    const categories = (catRes as any)?.categories || catRes || []
    for (const cat of categories) {
      await supabaseAdmin
        .from('crm_categories')
        .upsert(
          {
            id: String(cat.id),
            name: cat.name || '',
            entity_type_id: '2',
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
    }

    // 2. crm.status.list (DEAL_STAGE geral + por categoria) → crm_stages
    const stageEntityIds = [
      'DEAL_STAGE',
      ...categories.map((c: any) => `DEAL_STAGE_${c.id}`),
    ]
    let stagesSynced = 0
    for (const entityId of stageEntityIds) {
      const stages = await callBitrixAllPages('crm.status.list', {
        filter: { ENTITY_ID: entityId },
      })
      for (const s of stages as any[]) {
        await supabaseAdmin.from('crm_stages').upsert(
          {
            id: String(s.STATUS_ID),
            name: s.NAME || '',
            semantic: s.SEMANTICS || null,
            entity_id: entityId,
            sort: parseInt(s.SORT) || 0,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
        stagesSynced++
      }
    }

    // 3. crm.deal.list → crm_deals, gravado PÁGINA A PÁGINA em LOTE (1 upsert
    // por página, não 1 por negócio — o upsert individual era o que causava o
    // timeout de wall-clock, ver diagnóstico do Prompt 120: ~10s de overhead
    // de escrita por página de 50 negócios). Três modos, decididos pelo estado
    // em `settings` ANTES de começar:
    //   - 'resume': existe cursor válido (< 24h) → retoma de cursor.start.
    //   - 'incremental': sem cursor, mas existe watermark → filtra por
    //     >=DATE_MODIFY (margem de 10min, mesmo padrão do Sprint).
    //   - 'full': nem cursor nem watermark → do zero, sem filtro.
    // O cursor é salvo em `settings` depois de CADA página bem-sucedida —
    // se a invocação morrer no meio, a próxima retoma dali em vez de do zero.
    const [{ data: cursorRow }, { data: watermarkRow }] = await Promise.all([
      supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', CURSOR_KEY)
        .maybeSingle(),
      supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', WATERMARK_KEY)
        .maybeSingle(),
    ])

    let cursor = cursorRow?.value as {
      start: number
      startedAt: string
      mode: 'full' | 'incremental'
      filter: Record<string, unknown>
    } | null
    if (cursor && (cursor.mode === undefined || cursor.filter === undefined)) {
      cursor = null // formato antigo (sem mode/filter, Prompt 122) — inválido, recomeça do zero
    }
    if (
      cursor?.startedAt &&
      Date.now() - new Date(cursor.startedAt).getTime() > CURSOR_MAX_AGE_MS
    ) {
      cursor = null // cursor obsoleto (>24h) — recomeça do zero
    }
    const watermark = (watermarkRow?.value as string | null) || null

    let mode: 'full' | 'resume' | 'incremental' = 'full'
    let cursorMode: 'full' | 'incremental' = 'full' // modo de ORIGEM gravado no cursor — sobrevive a vários "resume" em cadeia
    let dealFilter: Record<string, unknown> = {}
    let startAt = 0
    if (cursor) {
      mode = 'resume'
      cursorMode = cursor.mode
      startAt = cursor.start
      dealFilter = cursor.filter // reaplica EXATAMENTE o filtro salvo no cursor, não recalcula
    } else if (watermark) {
      mode = 'incremental'
      cursorMode = 'incremental'
      dealFilter['>=DATE_MODIFY'] = watermark
    }
    const cursorStartedAt = cursor?.startedAt ?? new Date().toISOString()

    const dealIds: string[] = []
    const assignedByIds = new Set<string>()
    let dealsSynced = 0
    let dealsOk = false
    let dealsTruncated = false
    let dealsErro: string | undefined
    let pagesProcessed = 0
    let lastCursorStart = startAt
    try {
      const { truncated } = await callBitrixPagedEach(
        'crm.deal.list',
        {
          filter: dealFilter,
          select: [
            'ID',
            'TITLE',
            'CATEGORY_ID',
            'OPPORTUNITY',
            'CURRENCY_ID',
            'STAGE_ID',
            'STAGE_SEMANTIC_ID',
            'CLOSEDATE',
            'DATE_CREATE',
            'ASSIGNED_BY_ID',
            'UF_*',
          ],
        },
        async (chunk, meta) => {
          pagesProcessed++
          const rows = chunk.map((deal: any) => {
            const ufFields: Record<string, unknown> = {}
            Object.keys(deal).forEach((k) => {
              if (k.startsWith('UF_')) ufFields[k] = deal[k]
            })
            const assignedById = deal.ASSIGNED_BY_ID
              ? String(deal.ASSIGNED_BY_ID)
              : null
            if (assignedById) assignedByIds.add(assignedById)
            return {
              id: String(deal.ID),
              title: deal.TITLE || '',
              category_id: String(deal.CATEGORY_ID || '0'),
              opportunity: parseFloat(deal.OPPORTUNITY) || 0,
              currency_id: deal.CURRENCY_ID || 'BRL',
              stage_id: deal.STAGE_ID || '',
              stage_semantic_id: deal.STAGE_SEMANTIC_ID || null,
              close_date: deal.CLOSEDATE || null,
              date_create: deal.DATE_CREATE || null,
              assigned_by_id: assignedById,
              uf_fields: ufFields,
              synced_at: new Date().toISOString(),
            }
          })
          if (rows.length) {
            const { error } = await supabaseAdmin
              .from('crm_deals')
              .upsert(rows, { onConflict: 'id' })
            if (!error) {
              dealsSynced += rows.length
              dealIds.push(...rows.map((r) => r.id))
            }
          }
          // Persiste o cursor depois de cada página (com mode/filter da
          // ORIGEM, não recalculados) — se a invocação morrer logo em
          // seguida, a próxima retoma exatamente daqui com o mesmo filtro.
          if (meta.next !== null) {
            lastCursorStart = meta.next
            await supabaseAdmin
              .from('settings')
              .upsert(
                {
                  key: CURSOR_KEY,
                  value: {
                    start: meta.next,
                    startedAt: cursorStartedAt,
                    mode: cursorMode,
                    filter: dealFilter,
                  },
                },
                { onConflict: 'key' },
              )
          }
        },
        { startAt },
      )

      if (truncated) {
        // Atingiu o teto de páginas DESSA invocação (callBitrixPagedEach) —
        // NÃO é conclusão. O cursor já foi gravado apontando pra próxima
        // página (dentro do callback acima); aqui só evitamos tratar isso
        // como sucesso: sem watermark novo, sem apagar cursor, sem DELETE.
        dealsTruncated = true
        dealsErro =
          'Atingiu o teto de páginas desta invocação — cursor mantido, clique em Sincronizar novamente para continuar.'
      } else {
        dealsOk = true
        // Sync completo — não há mais nada pra retomar.
        await supabaseAdmin.from('settings').delete().eq('key', CURSOR_KEY)
        // Watermark ANCORADO no início da varredura (cursorStartedAt), não na
        // conclusão — uma varredura pode levar várias invocações, e um
        // negócio alterado nesse meio-tempo precisa continuar visível pro
        // próximo incremental. Margem de 10min sobre esse início (não sobre
        // "agora") cobre defasagem de relógio Supabase↔Bitrix.
        const novoWatermark = new Date(
          new Date(cursorStartedAt).getTime() - 10 * 60 * 1000,
        ).toISOString()
        await supabaseAdmin
          .from('settings')
          .upsert(
            { key: WATERMARK_KEY, value: novoWatermark },
            { onConflict: 'key' },
          )
      }
    } catch (e) {
      dealsErro = truncar((e as Error).message)
      console.warn('[sync-cs-bitrix] crm.deal.list falhou:', dealsErro)
    }

    // Nome de quem é responsável pelo negócio: objetivo secundário, no seu
    // próprio try/catch — falhar aqui não pode desfazer o sync de deals acima.
    // Usado pela tela CS Analytics (proposta/orçamento/recorrente por consultora).
    if (assignedByIds.size) {
      try {
        await resolveAndCacheUsers(supabaseAdmin, Array.from(assignedByIds))
      } catch (e: any) {
        console.warn(
          '[sync-cs-bitrix] resolução de nome (assigned_by) falhou, seguindo sem: ' +
            (e?.message ?? e),
        )
      }
    }

    // Remove negócios fantasma: só quando (a) o sync de deals terminou OK e
    // (b) essa invocação começou do ZERO (mode 'full') — nunca em 'resume' ou
    // 'incremental'. Um sync retomado de cursor só é "completo" na soma de
    // várias invocações, então não dá pra confiar que essa rodada sozinha
    // cobriu tudo; incremental por definição só olha uma fatia. Na dúvida,
    // comportamento conservador: não limpa.
    let deletedCount = 0
    let limpezaExecutada = false
    if (dealsOk && mode === 'full') {
      const { count } = await supabaseAdmin
        .from('crm_deals')
        .delete({ count: 'exact' })
        .lt('synced_at', syncStart)
      deletedCount = count ?? 0
      limpezaExecutada = true
    }

    const cursorFinal = dealsOk
      ? null
      : {
          start: lastCursorStart,
          startedAt: cursorStartedAt,
          mode: cursorMode,
          filter: dealFilter,
        }

    return new Response(
      JSON.stringify({
        success: dealsOk,
        mode,
        truncated: dealsTruncated,
        pagesProcessed,
        totalUpserted: dealsSynced,
        cursor: cursorFinal,
        sincronizados: {
          categories: categories.length,
          stages: stagesSynced,
          deals: dealsSynced,
        },
        ...(dealsOk ? {} : { parcial: dealsSynced, error: dealsErro }),
        deleted: deletedCount,
        limpezaExecutada,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
})
