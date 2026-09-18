/**
 * CSV export: one row per element, one column per tag encountered.
 *
 * Tag columns are ordered by how many features carry them, so the columns that
 * describe most of the result land on the left instead of being buried behind
 * a tag three features use.
 */

import type { Feature, FeatureCollection, Position } from 'geojson'

const FIXED_COLUMNS = ['@id', '@type', '@osmId', '@lon', '@lat'] as const

export function toCsv(collection: FeatureCollection, separator = ','): string {
  const features = collection.features
  if (!features.length) return FIXED_COLUMNS.join(separator)

  const frequency = new Map<string, number>()
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      if (key.startsWith('@')) continue
      frequency.set(key, (frequency.get(key) ?? 0) + 1)
    }
  }

  const tagColumns = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)

  const header = [...FIXED_COLUMNS, ...tagColumns]
  const rows = [header.map((h) => escapeCell(h, separator)).join(separator)]

  for (const feature of features) {
    const props = feature.properties ?? {}
    const [lon, lat] = representativePoint(feature)

    const cells = [
      String(props['@id'] ?? ''),
      String(props['@type'] ?? ''),
      String(props['@osmId'] ?? ''),
      lon === null ? '' : String(lon),
      lat === null ? '' : String(lat),
      ...tagColumns.map((key) => (props[key] === undefined ? '' : String(props[key]))),
    ]

    rows.push(cells.map((cell) => escapeCell(cell, separator)).join(separator))
  }

  return rows.join('\r\n')
}

/**
 * Leading characters a spreadsheet reads as the start of a formula.
 *
 * `-` is deliberately absent. Excel does treat `-1+1` as a formula, but
 * negative numbers are everywhere in OSM data (`ele=-5`, `layer=-1`), and
 * mangling every one of those to defuse a case that does not occur in practice
 * would be the worse trade.
 */
const FORMULA_STARTERS = new Set(['=', '+', '@', '\t', '\r'])

/**
 * Quotes a cell when it contains a separator, a quote or a newline, and
 * defuses anything a spreadsheet would run as a formula.
 *
 * Tag values are written by strangers, and a CSV export is opened in Excel or
 * Sheets more often than anywhere else. A value of `=HYPERLINK(...)` is a
 * working attack there, so it gets a leading apostrophe: the standard
 * mitigation, visible in the cell, and understood by importers.
 */
function escapeCell(value: string, separator: string): string {
  if (!value) return ''

  // Our own column names start with `@` and are not user content, so they are
  // left as they are; anything else that looks like a formula is defused.
  const ours = (FIXED_COLUMNS as readonly string[]).includes(value)
  const safe = !ours && FORMULA_STARTERS.has(value[0]) ? `'${value}` : value

  if (safe.includes(separator) || /["\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

/**
 * A single lon/lat for a feature: its point, or the centroid of its bounding
 * box for anything with extent. Spreadsheets need one coordinate per row.
 */
export function representativePoint(feature: Feature): [number | null, number | null] {
  const coords = collectPositions(feature)
  if (!coords.length) return [null, null]

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  return [round((minLon + maxLon) / 2), round((minLat + maxLat) / 2)]
}

function round(value: number): number {
  return Number(value.toFixed(7))
}

export function collectPositions(feature: Feature): Position[] {
  const out: Position[] = []

  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      out.push(value as Position)
      return
    }
    for (const item of value) walk(item)
  }

  const geometry = feature.geometry
  if (!geometry) return out
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) walk((child as { coordinates?: unknown }).coordinates)
    return out
  }

  walk(geometry.coordinates)
  return out
}
