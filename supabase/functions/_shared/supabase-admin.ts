/**
 * Minimal PostgREST admin client — zero external imports.
 * Drop-in replacement for createClient(url, serviceRoleKey) when used inside edge functions.
 */

function getEnv() {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  return { url, key }
}

function baseHeaders(key: string, extra: Record<string, string> = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

class QueryBuilder {
  private _table: string
  private _filters: string[] = []
  private _select = '*'
  private _url: string
  private _key: string

  constructor(table: string, url: string, key: string) {
    this._table = table
    this._url = url
    this._key = key
  }

  select(cols: string) {
    this._select = cols
    return this
  }

  eq(col: string, val: string | number) {
    this._filters.push(`${col}=eq.${encodeURIComponent(String(val))}`)
    return this
  }

  not(col: string, op: string, val: string | null) {
    if (val === null) this._filters.push(`${col}=not.is.null`)
    else
      this._filters.push(`${col}=not.${op}.${encodeURIComponent(String(val))}`)
    return this
  }

  order(col: string, opts: { ascending?: boolean } = {}) {
    this._filters.push(
      `order=${col}.${opts.ascending === false ? 'desc' : 'asc'}`,
    )
    return this
  }

  limit(n: number) {
    this._filters.push(`limit=${n}`)
    return this
  }

  private _qs() {
    const parts = [...this._filters]
    if (
      this._select !== '*' ||
      !this._filters.some((f) => f.startsWith('select='))
    ) {
      parts.push(`select=${encodeURIComponent(this._select)}`)
    }
    return parts.length ? `?${parts.join('&')}` : ''
  }

  async list(): Promise<{ data: any[]; error: any }> {
    const url = `${this._url}/rest/v1/${this._table}${this._qs()}`
    const res = await fetch(url, {
      headers: baseHeaders(this._key, { Prefer: 'count=none' }),
    })
    if (!res.ok) return { data: [], error: await res.json().catch(() => ({})) }
    const arr = await res.json().catch(() => [])
    return { data: Array.isArray(arr) ? arr : [], error: null }
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    const url = `${this._url}/rest/v1/${this._table}${this._qs()}&limit=1`
    const res = await fetch(url, {
      headers: baseHeaders(this._key, { Prefer: 'count=none' }),
    })
    if (!res.ok)
      return { data: null, error: await res.json().catch(() => ({})) }
    const arr = await res.json().catch(() => [])
    return {
      data: Array.isArray(arr) ? (arr[0] ?? null) : (arr ?? null),
      error: null,
    }
  }

  // alias for chained queries that don't call maybeSingle
  get then() {
    return undefined
  }

  async insert(body: object | object[]): Promise<{ data: any; error: any }> {
    const url = `${this._url}/rest/v1/${this._table}`
    const res = await fetch(url, {
      method: 'POST',
      headers: baseHeaders(this._key, { Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    })
    if (!res.ok)
      return { data: null, error: await res.json().catch(() => ({})) }
    return { data: await res.json().catch(() => null), error: null }
  }

  async update(body: object): Promise<{ data: any; error: any }> {
    const url = `${this._url}/rest/v1/${this._table}${this._qs()}`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: baseHeaders(this._key, { Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    })
    if (!res.ok)
      return { data: null, error: await res.json().catch(() => ({})) }
    return { data: await res.json().catch(() => null), error: null }
  }

  async delete(): Promise<{ data: any; error: any }> {
    const url = `${this._url}/rest/v1/${this._table}${this._qs()}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: baseHeaders(this._key, { Prefer: 'return=representation' }),
    })
    if (!res.ok)
      return { data: null, error: await res.json().catch(() => ({})) }
    return { data: await res.json().catch(() => null), error: null }
  }

  async upsert(
    body: object,
    opts: { onConflict?: string } = {},
  ): Promise<{ data: any; error: any }> {
    const prefer = opts.onConflict
      ? `resolution=merge-duplicates,return=representation`
      : `return=representation`
    const url = opts.onConflict
      ? `${this._url}/rest/v1/${this._table}?on_conflict=${encodeURIComponent(opts.onConflict)}`
      : `${this._url}/rest/v1/${this._table}`
    const res = await fetch(url, {
      method: 'POST',
      headers: baseHeaders(this._key, { Prefer: prefer }),
      body: JSON.stringify(body),
    })
    if (!res.ok)
      return { data: null, error: await res.json().catch(() => ({})) }
    return { data: await res.json().catch(() => null), error: null }
  }
}

class AdminClient {
  private _url: string
  private _key: string

  constructor(url: string, key: string) {
    this._url = url
    this._key = key
  }

  from(table: string) {
    return new QueryBuilder(table, this._url, this._key)
  }
}

export function createSupabaseAdmin(): AdminClient {
  const { url, key } = getEnv()
  return new AdminClient(url, key)
}
