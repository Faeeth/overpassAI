/**
 * Nominatim geocoding.
 *
 * No key required, but the usage policy caps clients at one request per second
 * and forbids bulk lookups, so every call goes through a serial queue and a
 * permanent in-session cache. A browser cannot set `User-Agent`, which the
 * policy acknowledges: the `Referer` the browser sends identifies the app.
 */

const BASE = 'https://nominatim.openstreetmap.org'
const MIN_INTERVAL_MS = 1100

export interface Place {
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  displayName: string
  /** Short leading part of the display name, for compact UI. */
  name: string
  lat: number
  lon: number
  /** south, west, north, east */
  bbox: [number, number, number, number]
  category: string
  type: string
  /** Overpass area id, or null for places that have no area (plain nodes). */
  areaId: number | null
}

export class GeocodeError extends Error {}

// ---------------------------------------------------------------------------
// Serial, rate-limited request queue
// ---------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve()
let lastCallAt = 0

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastCallAt = Date.now()
    return task()
  })
  // Keep the chain alive even when a task rejects.
  chain = run.catch(() => undefined)
  return run
}

// ---------------------------------------------------------------------------
// Area ids
// ---------------------------------------------------------------------------

/**
 * Overpass derives area ids from OSM ids: relations are offset by 3.6e9 and
 * ways by 2.4e9. Nodes have no area, so they cannot be searched inside.
 */
export function toAreaId(osmType: Place['osmType'], osmId: number): number | null {
  if (osmType === 'relation') return 3_600_000_000 + osmId
  if (osmType === 'way') return 2_400_000_000 + osmId
  return null
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface NominatimRow {
  osm_type?: string
  osm_id?: number
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  boundingbox?: string[]
  category?: string
  class?: string
  type?: string
}

const searchCache = new Map<string, Place[]>()

export async function search(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<Place[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const limit = options.limit ?? 8
  const cacheKey = `${limit}:${trimmed.toLowerCase()}`
  const cached = searchCache.get(cacheKey)
  if (cached) return cached

  const url = new URL(`${BASE}/search`)
  url.searchParams.set('q', trimmed)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('addressdetails', '0')

  const rows = await enqueue(async () => {
    const response = await fetch(url, { signal: options.signal })
    if (!response.ok) {
      throw new GeocodeError(`The geocoder replied with HTTP ${response.status}.`)
    }
    return (await response.json()) as NominatimRow[]
  })

  const places = rows.map(toPlace).filter((p): p is Place => p !== null)
  searchCache.set(cacheKey, places)
  return places
}

function toPlace(row: NominatimRow): Place | null {
  const osmType = row.osm_type
  if (osmType !== 'node' && osmType !== 'way' && osmType !== 'relation') return null
  if (row.osm_id === undefined) return null

  const box = (row.boundingbox ?? []).map(Number)
  const displayName = row.display_name ?? row.name ?? 'Unnamed place'

  return {
    osmType,
    osmId: row.osm_id,
    displayName,
    name: displayName.split(',')[0].trim(),
    lat: Number(row.lat ?? 0),
    lon: Number(row.lon ?? 0),
    // Nominatim orders the box as south, north, west, east.
    bbox:
      box.length === 4
        ? [box[0], box[2], box[1], box[3]]
        : [Number(row.lat ?? 0), Number(row.lon ?? 0), Number(row.lat ?? 0), Number(row.lon ?? 0)],
    category: row.category ?? row.class ?? '',
    type: row.type ?? '',
    areaId: toAreaId(osmType, row.osm_id),
  }
}

// ---------------------------------------------------------------------------
// Area resolution, used by the query compiler
// ---------------------------------------------------------------------------

const areaCache = new Map<string, { areaId: number; displayName: string }>()

/**
 * Resolves a place name to an Overpass area id.
 *
 * Prefers the first result that actually has an area: a search for a city
 * often returns its centre node before its boundary relation, and only the
 * relation can be searched inside.
 */
export async function geocodeArea(
  query: string,
): Promise<{ areaId: number; displayName: string }> {
  const key = query.trim().toLowerCase()
  const cached = areaCache.get(key)
  if (cached) return cached

  const results = await search(query, { limit: 10 })
  if (!results.length) {
    throw new GeocodeError(`No place matches "${query}".`)
  }

  const withArea = results.find((place) => place.areaId !== null)
  if (!withArea || withArea.areaId === null) {
    throw new GeocodeError(
      `"${query}" matches a point, not an area. Try a town, district or country name.`,
    )
  }

  const resolved = { areaId: withArea.areaId, displayName: withArea.displayName }
  areaCache.set(key, resolved)
  return resolved
}

/** Everything resolved so far, so the UI can show what a place block matched. */
export function cachedArea(query: string): { areaId: number; displayName: string } | undefined {
  return areaCache.get(query.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Reverse geocoding, used by the map inspector
// ---------------------------------------------------------------------------

export async function reverse(lat: number, lon: number): Promise<Place | null> {
  const url = new URL(`${BASE}/reverse`)
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('format', 'jsonv2')

  const row = await enqueue(async () => {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as NominatimRow
  })

  return row ? toPlace(row) : null
}
