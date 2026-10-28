import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const start = Date.now()
  const services: Record<
    string,
    { status: string; latency_ms?: number; error?: string }
  > = {}

  try {
    const dbStart = Date.now()
    await supabase.from('profiles').select('id').limit(1)
    services.database = { status: 'ok', latency_ms: Date.now() - dbStart }
  } catch (e) {
    services.database = { status: 'error', error: String(e) }
  }

  try {
    await supabase.storage.listBuckets()
    services.storage = { status: 'ok' }
  } catch (e) {
    services.storage = { status: 'error', error: String(e) }
  }

  const { data: bitrixLogs } = await supabase
    .from('bitrix_api_logs')
    .select('status_code')
    .gte('criado_em', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .order('criado_em', { ascending: false })
    .limit(10)

  const bitrixTotal = bitrixLogs?.length ?? 0
  const bitrixErrors =
    bitrixLogs?.filter((l: { status_code: number }) => l.status_code >= 400)
      .length ?? 0
  services.bitrix24 = {
    status:
      bitrixTotal === 0
        ? 'idle'
        : bitrixErrors / bitrixTotal > 0.3
          ? 'degraded'
          : 'ok',
  }

  let version = 'unknown'
  try {
    const pkgJson = JSON.parse(
      await Deno.readTextFile('/home/deno/functions/../../../package.json'),
    )
    version = pkgJson.version ?? 'unknown'
  } catch {
    /* ignora */
  }

  let git_sha = 'unknown'
  try {
    git_sha = (
      await Deno.readTextFile('/home/deno/functions/../../../.git/HEAD')
    )
      .trim()
      .replace('ref: refs/heads/', '')
  } catch {
    /* ignora */
  }

  const allOk = Object.values(services).every(
    (s) => s.status === 'ok' || s.status === 'idle',
  )

  return new Response(
    JSON.stringify({
      status: allOk ? 'ok' : 'degraded',
      version,
      git_sha,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - start,
      services,
    }),
    {
      status: allOk ? 200 : 207,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
})
