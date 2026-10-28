import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

// Sincroniza respostas de NPS de uma planilha Google Sheets pública (CSV/GViz)
// para nps_responses. Porta fiel de services/sheets.js + rota /sync/nps do
// projeto original do Everton — sheetId/gid não são segredo (planilha pública),
// por isso não passam pelo padrão settings+get-*-url usado no Bitrix/OpenAI.

function buildCsvUrl(sheetId: string, gid: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}
function buildGvizUrl(sheetId: string, gid: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?gid=${gid}&headers=1`
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar planilha`)
  return res.text()
}

async function fetchSheetViaGviz(
  sheetId: string,
  gid: string,
): Promise<Record<string, string>[]> {
  const res = await fetch(buildGvizUrl(sheetId, gid))
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar planilha via GViz`)
  const text = await res.text()
  const match = text.match(
    /google\.visualization\.Query\.setResponse\((.+)\);?$/s,
  )
  if (!match) throw new Error('Resposta GViz inválida')
  const data = JSON.parse(match[1])
  if (!data.table) throw new Error('Formato GViz sem tabela')

  const cols = data.table.cols || []
  const rows = data.table.rows || []
  const headers = cols.map((col: any) =>
    String(col.label || col.id || '').trim(),
  )

  return rows.map((row: any) => {
    const cells = (row.c || []).map((cell: any) => {
      if (!cell) return ''
      if (cell.f != null && cell.f !== '') return String(cell.f)
      if (cell.v == null) return ''
      return String(cell.v)
    })
    const obj: Record<string, string> = {}
    headers.forEach((h: string, idx: number) => {
      obj[h] = cells[idx] !== undefined ? cells[idx] : ''
    })
    return obj
  })
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  const separator = line.includes(';') ? ';' : ','
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === separator && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0])
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = splitCsvLine(lines[i])
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = values[idx] !== undefined ? values[idx] : ''
    })
    rows.push(obj)
  }
  return rows
}

function normalizeLabel(label: string): string {
  return String(label || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

const CLIENT_KEYS = [
  'cliente',
  'nome',
  'nome do cliente',
  'client',
  'name',
  '1. cliente',
]
const SUPPORT_KEYS = [
  '5.1 atendimento do suporte tecnico',
  '5 1 atendimento do suporte tecnico',
  '5 1 atendimento suporte tecnico',
  'suporte',
  'suporte tecnico',
  'nota suporte',
]
const CS_KEYS = [
  '5.2  atendimento do customer success',
  '5.2 atendimento do customer success',
  '5 2 atendimento do customer success',
  '5 2 atendimento customer success',
  'customer success',
  'cs',
  'nota cs',
]
const OVERALL_KEYS = [
  '5 3 o quanto voce recomendaria a zion logtec',
  '5.3 atendimento zion como um todo',
  '5 3 atendimento zion como um todo',
  '5 3 zion como um todo',
  'zion geral',
  'nota geral',
  'geral',
]
const DATE_KEYS = [
  'carimbo de data hora',
  'timestamp',
  'data',
  'date',
  'data de referencia',
]

function findColumn(headers: string[], candidates: string[]): string | null {
  const headersLower = headers.map((h) => h.toLowerCase().trim())
  for (const candidate of candidates) {
    const idx = headersLower.findIndex((h) => h === candidate.toLowerCase())
    if (idx !== -1) return headers[idx]
  }
  const normalizedHeaders = headers.map((h) => normalizeLabel(h))
  for (const candidate of candidates) {
    const idx = normalizedHeaders.findIndex(
      (h) => h === candidate || h.includes(candidate) || candidate.includes(h),
    )
    if (idx !== -1) return headers[idx]
  }
  return null
}

function parseScore(raw: any): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const str = String(raw).trim().replace(/\s/g, '').replace(',', '.')
  const num = parseFloat(str)
  return isNaN(num) ? null : num
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  const partsWithTime = raw.match(
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\s+(\d{1,2}):(\d{1,2}):?(\d{1,2})?/,
  )
  if (partsWithTime) {
    const [, d, m, y, h, min, s = '0'] = partsWithTime
    const year = y.length === 2 ? '20' + y : y
    const date = new Date(
      `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min.padStart(2, '0')}:${s.padStart(2, '0')}`,
    )
    if (!isNaN(date.getTime())) return date.toISOString()
  }
  const parts = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
  if (parts) {
    const [, d, m, y] = parts
    const year = y.length === 2 ? '20' + y : y
    const date = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  const date = new Date(raw)
  if (!isNaN(date.getTime())) return date.toISOString()
  return null
}

function parseNpsRowsFromObjects(
  rawRows: Record<string, string>[],
  sheetConfig: string,
) {
  if (!rawRows.length) return []
  const headers = Object.keys(rawRows[0])
  const clientCol = findColumn(headers, CLIENT_KEYS)
  const supportCol = findColumn(headers, SUPPORT_KEYS)
  const csCol = findColumn(headers, CS_KEYS)
  const overallCol = findColumn(headers, OVERALL_KEYS)
  const dateCol = findColumn(headers, DATE_KEYS)

  const commentStartKeywords = [
    'sempre',
    'porém',
    'encontra',
    'proatividade',
    'seriam',
    'reforçou',
    'destacando',
    'chamado',
    'precisa',
    'aumentar',
    'melhorias',
    'oportunidades',
    'prazo',
  ]

  return rawRows
    .map((row, idx) => {
      const client = clientCol ? (row[clientCol] || '').trim() : ''
      if (!client) return null

      const supportScore = parseScore(supportCol ? row[supportCol] : null)
      const csScore = parseScore(csCol ? row[csCol] : null)
      const overallScore = parseScore(overallCol ? row[overallCol] : null)
      const refRaw = dateCol ? row[dateCol] : ''
      const refDate = parseDate(refRaw)

      const hasValidScore =
        typeof supportScore === 'number' ||
        typeof csScore === 'number' ||
        typeof overallScore === 'number'
      if (!hasValidScore) return null

      const clientLower = client.toLowerCase()
      const isComment =
        client.length > 60 &&
        commentStartKeywords.some((k) => clientLower.startsWith(k))
      if (isComment) return null

      const rawFields: Record<string, string> = {}
      headers.forEach((h) => {
        rawFields[h] = row[h] || ''
      })

      return {
        sheet_config: sheetConfig,
        client,
        reference_date: refDate,
        reference_raw: refRaw,
        support_score: supportScore,
        cs_score: csScore,
        overall_score: overallScore,
        raw_fields: rawFields,
        source_index: idx,
      }
    })
    .filter(Boolean)
}

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

    const { csvUrl, sheetId, gid } = await req.json().catch(() => ({}))
    if (!csvUrl && !sheetId) {
      return new Response(
        JSON.stringify({ error: 'Forneça csvUrl ou sheetId+gid.' }),
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    const configKey = csvUrl || `${sheetId}:${gid || '0'}`

    let rawRows: Record<string, string>[] = []
    let usedMethod = ''
    if (sheetId) {
      try {
        rawRows = await fetchSheetViaGviz(sheetId, gid || '0')
        usedMethod = 'GViz'
      } catch {
        usedMethod = 'CSV fallback'
        const csvText = await fetchCsv(
          csvUrl || buildCsvUrl(sheetId, gid || '0'),
        )
        rawRows = parseCsv(csvText)
      }
    } else {
      usedMethod = 'CSV'
      rawRows = parseCsv(await fetchCsv(csvUrl))
    }

    const parsed = parseNpsRowsFromObjects(rawRows, configKey) as any[]

    await supabaseAdmin
      .from('nps_responses')
      .delete()
      .eq('sheet_config', configKey)

    let count = 0
    const chunkSize = 500
    for (let i = 0; i < parsed.length; i += chunkSize) {
      const chunk = parsed
        .slice(i, i + chunkSize)
        .map((r) => ({ ...r, synced_at: new Date().toISOString() }))
      const { error } = await supabaseAdmin.from('nps_responses').insert(chunk)
      if (error) throw error
      count += chunk.length
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: count,
        configKey,
        method: usedMethod,
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
