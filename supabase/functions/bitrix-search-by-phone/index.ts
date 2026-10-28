import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { getBitrixWebhookUrl } from '../_shared/get-bitrix-url.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { conversation_id, phone } = await req.json()
    if (!conversation_id || !phone) {
      return new Response(
        JSON.stringify({ error: 'conversation_id e phone obrigatórios' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const bitrixBase = await getBitrixWebhookUrl(supabase)
    const rateLimiterUrl = `${supabaseUrl}/functions/v1/bitrix-rate-limiter`

    async function callBitrix(endpoint: string) {
      const res = await fetch(rateLimiterUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          endpoint: bitrixBase + endpoint,
          method: 'GET',
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.message || 'Bitrix call failed')
      return data.data
    }

    // 1. Buscar IDs nas 3 entidades em paralelo
    const [leadRes, contactRes, companyRes] = await Promise.all([
      callBitrix(
        `crm.duplicate.findbycomm.json?type=PHONE&values[]=${phone}&entity_type=LEAD`,
      ).catch((e) => ({ error: e.message })),
      callBitrix(
        `crm.duplicate.findbycomm.json?type=PHONE&values[]=${phone}&entity_type=CONTACT`,
      ).catch((e) => ({ error: e.message })),
      callBitrix(
        `crm.duplicate.findbycomm.json?type=PHONE&values[]=${phone}&entity_type=COMPANY`,
      ).catch((e) => ({ error: e.message })),
    ])

    const MAX_PER_TYPE = 5
    const leadIds: string[] = ((leadRes as any)?.result?.LEAD || [])
      .slice(0, MAX_PER_TYPE)
      .map(String)
    const contactIds: string[] = ((contactRes as any)?.result?.CONTACT || [])
      .slice(0, MAX_PER_TYPE)
      .map(String)
    const companyIds: string[] = ((companyRes as any)?.result?.COMPANY || [])
      .slice(0, MAX_PER_TYPE)
      .map(String)

    if ((leadRes as any)?.result?.LEAD?.length > MAX_PER_TYPE)
      console.warn(
        `[bitrix-search] LEAD truncado: ${(leadRes as any).result.LEAD.length} → ${MAX_PER_TYPE}`,
      )
    if ((contactRes as any)?.result?.CONTACT?.length > MAX_PER_TYPE)
      console.warn(
        `[bitrix-search] CONTACT truncado: ${(contactRes as any).result.CONTACT.length} → ${MAX_PER_TYPE}`,
      )
    if ((companyRes as any)?.result?.COMPANY?.length > MAX_PER_TYPE)
      console.warn(
        `[bitrix-search] COMPANY truncado: ${(companyRes as any).result.COMPANY.length} → ${MAX_PER_TYPE}`,
      )

    // 2. Buscar detalhes de cada ID encontrado em paralelo
    const detalheCalls: Promise<{
      type: string
      id: string
      data: any
    } | null>[] = []

    for (const id of leadIds) {
      detalheCalls.push(
        callBitrix(
          `crm.lead.get.json?id=${id}&select[]=ID&select[]=TITLE&select[]=NAME&select[]=LAST_NAME&select[]=COMPANY_TITLE`,
        )
          .then((r) => ({ type: 'lead', id, data: r?.result }))
          .catch(() => null),
      )
    }
    for (const id of contactIds) {
      detalheCalls.push(
        callBitrix(
          `crm.contact.get.json?id=${id}&select[]=ID&select[]=NAME&select[]=LAST_NAME&select[]=COMPANY_TITLE`,
        )
          .then((r) => ({ type: 'contact', id, data: r?.result }))
          .catch(() => null),
      )
    }
    for (const id of companyIds) {
      detalheCalls.push(
        callBitrix(`crm.company.get.json?id=${id}&select[]=ID&select[]=TITLE`)
          .then((r) => ({ type: 'company', id, data: r?.result }))
          .catch(() => null),
      )
    }

    const detalhes = (await Promise.all(detalheCalls)).filter(Boolean) as {
      type: string
      id: string
      data: any
    }[]

    // 3. Montar título legível para cada candidato
    const candidatos = detalhes.map((d) => {
      let title = ''
      if (d.type === 'lead') {
        title =
          d.data?.TITLE ||
          `${d.data?.NAME || ''} ${d.data?.LAST_NAME || ''}`.trim() ||
          `Lead #${d.id}`
      } else if (d.type === 'contact') {
        title =
          `${d.data?.NAME || ''} ${d.data?.LAST_NAME || ''}`.trim() ||
          `Contato #${d.id}`
      } else {
        title = d.data?.TITLE || `Empresa #${d.id}`
      }
      return {
        conversation_id,
        entity_type: d.type,
        entity_id: d.id,
        entity_title: title,
        entity_data: d.data,
      }
    })

    // 4. UPSERT — re-busca não duplica candidatos já existentes
    if (candidatos.length > 0) {
      const { error: upsertErr } = await supabase
        .from('whatsapp_bitrix_candidates')
        .upsert(candidatos, {
          onConflict: 'conversation_id,entity_type,entity_id',
        })
      if (upsertErr) {
        console.error('[bitrix-search] upsert error:', upsertErr.message)
      }
    }

    return new Response(
      JSON.stringify({ success: true, total: candidatos.length, candidatos }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err: any) {
    console.error('[bitrix-search] erro:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
