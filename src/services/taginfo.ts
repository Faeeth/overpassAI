/**
 * taginfo client, powering tag autocompletion.
 *
 * This is the piece that makes the block editor usable without already knowing
 * the OSM tagging vocabulary: instead of typing `amenity=restaurant` from
 * memory, you type "rest" and see the real values with how often each is used.
 *
 * Free, no key, CORS enabled. Responses are cached for the session and
 * in-flight requests are shared, so holding a key down does not fan out into
 * one request per keystroke.
 */

const BASE = 'https://taginfo.openstreetmap.org/api/4'

export interface KeySuggestion {
  key: string
  /** Number of objects in the OSM database using this key. */
  count: number
  /** True when the key is documented on the OSM wiki. */
  inWiki: boolean
  description?: string
}

export interface ValueSuggestion {
  value: string
  count: number
  /** Share of this key's uses that carry this value, between 0 and 1. */
  fraction: number
  description?: string
}

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

const cache = new Map<string, unknown>()
const inFlight = new Map<string, Promise<unknown>>()

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const cacheKey = url.toString()

  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached as T

  const pending = inFlight.get(cacheKey)
  if (pending) return pending as Promise<T>

  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`taginfo replied with HTTP ${response.status}`)
      const data = (await response.json()) as T
      cache.set(cacheKey, data)
      return data
    })
    .finally(() => {
      inFlight.delete(cacheKey)
    })

  inFlight.set(cacheKey, request)
  return request
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

interface KeyRow {
  key: string
  count_all: number
  in_wiki: boolean
}

/**
 * Keys matching `query`, most used first.
 *
 * An empty query returns the globally most common keys, which is what the
 * dropdown shows before the user types anything.
 */
export async function suggestKeys(query: string, limit = 15): Promise<KeySuggestion[]> {
  const data = await get<{ data?: KeyRow[] }>('/keys/all', {
    query: query.trim(),
    page: '1',
    rp: String(limit),
    sortname: 'count_all',
    sortorder: 'desc',
    filter: 'in_wiki',
  })

  return (data.data ?? []).map((row) => ({
    key: row.key,
    count: row.count_all,
    inWiki: row.in_wiki,
  }))
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

interface ValueRow {
  value: string
  count: number
  fraction: number
  description?: string
}

/** Values seen for `key`, most used first, optionally filtered by `query`. */
export async function suggestValues(
  key: string,
  query = '',
  limit = 20,
): Promise<ValueSuggestion[]> {
  if (!key.trim()) return []

  const data = await get<{ data?: ValueRow[] }>('/key/values', {
    key: key.trim(),
    query: query.trim(),
    page: '1',
    rp: String(limit),
    sortname: 'count',
    sortorder: 'desc',
  })

  return (data.data ?? []).map((row) => ({
    value: row.value,
    count: row.count,
    fraction: row.fraction,
    description: row.description || undefined,
  }))
}

// ---------------------------------------------------------------------------
// Key documentation, shown in the block editor tooltip
// ---------------------------------------------------------------------------

interface WikiRow {
  lang: string
  description?: string
  image?: { title?: string }
}

/** One-line wiki description for a key, or null when undocumented. */
export async function describeKey(key: string): Promise<string | null> {
  if (!key.trim()) return null
  try {
    const data = await get<{ data?: WikiRow[] }>('/key/wiki_pages', { key: key.trim() })
    const rows = data.data ?? []
    const english = rows.find((row) => row.lang === 'en' && row.description)
    return english?.description ?? rows.find((row) => row.description)?.description ?? null
  } catch {
    return null
  }
}

/** Formats a raw usage count as a compact, readable figure. */
export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(count)
}
