/**
 * Converts an Overpass JSON response to GeoJSON.
 *
 * Written in-house rather than pulled from a package: the only published
 * option drags in an XML parser we have no use for, and doing it here lets the
 * output carry exactly the properties the inspector, the table and the
 * exporters expect.
 *
 * Properties follow the convention QGIS and JOSM users already know: OSM tags
 * sit at the top level, and everything we add is prefixed with `@`.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

// ---------------------------------------------------------------------------
// Overpass JSON shapes
// ---------------------------------------------------------------------------

export interface OsmMeta {
  version?: number
  timestamp?: string
  changeset?: number
  user?: string
  uid?: number
}

export interface LatLon {
  lat: number
  lon: number
}

export interface OsmElement extends OsmMeta {
  type: 'node' | 'way' | 'relation' | 'area' | 'count'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  members?: OsmMember[]
  tags?: Record<string, string>
  /** Present with `out geom`. */
  geometry?: Array<LatLon | null>
  /** Present with `out center`. */
  center?: LatLon
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
}

export interface OsmMember {
  type: 'node' | 'way' | 'relation'
  ref: number
  role: string
  lat?: number
  lon?: number
  geometry?: Array<LatLon | null>
}

export interface OverpassResponse {
  version?: number
  generator?: string
  osm3s?: { timestamp_osm_base?: string; copyright?: string }
  elements?: OsmElement[]
  remark?: string
}

export interface ConversionStats {
  nodes: number
  ways: number
  relations: number
  /** Elements that carried tags but no usable geometry. */
  withoutGeometry: number
  total: number
}

export interface ConversionResult {
  geojson: FeatureCollection
  stats: ConversionStats
  /** Tagged elements we could not place on the map, still listed in the table. */
  unplaced: OsmElement[]
}

// ---------------------------------------------------------------------------
// Area heuristics
// ---------------------------------------------------------------------------

/** Keys whose presence makes a closed way an area by default. */
const AREA_KEYS = new Set([
  'aeroway', 'amenity', 'area:highway', 'boundary', 'building', 'building:part',
  'craft', 'geological', 'healthcare', 'historic', 'indoor', 'landuse',
  'leisure', 'man_made', 'military', 'natural', 'office', 'place', 'power',
  'public_transport', 'room', 'ruins', 'shop', 'sport', 'tourism', 'waterway',
])

/** Values that stay linear even though their key is usually an area key. */
const LINEAR_VALUES: Record<string, Set<string>> = {
  natural: new Set(['coastline', 'cliff', 'ridge', 'arete', 'tree_row', 'valley']),
  man_made: new Set(['pipeline', 'embankment', 'breakwater', 'groyne', 'cutline']),
  waterway: new Set(['river', 'stream', 'ditch', 'drain', 'canal', 'weir']),
  power: new Set(['line', 'minor_line', 'cable']),
  aeroway: new Set(['runway', 'taxiway']),
  boundary: new Set([]),
}

function isAreaWay(tags: Record<string, string> | undefined, closed: boolean): boolean {
  if (!closed) return false
  if (!tags) return false
  if (tags.area === 'no') return false
  if (tags.area === 'yes') return true

  for (const [key, value] of Object.entries(tags)) {
    if (!AREA_KEYS.has(key)) continue
    if (LINEAR_VALUES[key]?.has(value)) continue
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export function osmToGeoJSON(response: OverpassResponse): ConversionResult {
  const elements = response.elements ?? []

  const nodes = new Map<number, OsmElement>()
  const ways = new Map<number, OsmElement>()
  const relations: OsmElement[] = []

  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, el)
    else if (el.type === 'way') ways.set(el.id, el)
    else if (el.type === 'relation') relations.push(el)
  }

  // Nodes that only exist to give a way its shape are not results in their
  // own right, so they are not emitted as points.
  const structural = new Set<number>()
  for (const way of ways.values()) {
    for (const ref of way.nodes ?? []) structural.add(ref)
  }
  for (const rel of relations) {
    for (const member of rel.members ?? []) {
      if (member.type === 'way') {
        const way = ways.get(member.ref)
        for (const ref of way?.nodes ?? []) structural.add(ref)
      }
    }
  }

  const features: Feature[] = []
  const unplaced: OsmElement[] = []
  const stats: ConversionStats = {
    nodes: 0,
    ways: 0,
    relations: 0,
    withoutGeometry: 0,
    total: 0,
  }

  for (const node of nodes.values()) {
    const tagged = hasTags(node)
    if (!tagged && structural.has(node.id)) continue
    if (node.lat === undefined || node.lon === undefined) {
      if (tagged) {
        unplaced.push(node)
        stats.withoutGeometry += 1
      }
      continue
    }
    features.push(makeFeature(node, { type: 'Point', coordinates: [node.lon, node.lat] }))
    stats.nodes += 1
  }

  for (const way of ways.values()) {
    const coords = wayCoordinates(way, nodes)
    if (coords.length < 2) {
      const centre = centreOf(way)
      if (centre) {
        features.push(makeFeature(way, { type: 'Point', coordinates: centre }))
        stats.ways += 1
      } else if (hasTags(way)) {
        unplaced.push(way)
        stats.withoutGeometry += 1
      }
      continue
    }

    const closed = isClosed(coords)
    const geometry: Geometry =
      closed && isAreaWay(way.tags, closed)
        ? { type: 'Polygon', coordinates: [coords] }
        : { type: 'LineString', coordinates: coords }

    features.push(makeFeature(way, geometry))
    stats.ways += 1
  }

  for (const rel of relations) {
    const geometry = relationGeometry(rel, ways, nodes)
    if (!geometry) {
      const centre = centreOf(rel)
      if (centre) {
        features.push(makeFeature(rel, { type: 'Point', coordinates: centre }))
        stats.relations += 1
      } else if (hasTags(rel)) {
        unplaced.push(rel)
        stats.withoutGeometry += 1
      }
      continue
    }
    features.push(makeFeature(rel, geometry))
    stats.relations += 1
  }

  stats.total = features.length + stats.withoutGeometry

  return {
    geojson: { type: 'FeatureCollection', features },
    stats,
    unplaced,
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function hasTags(el: OsmElement): boolean {
  return !!el.tags && Object.keys(el.tags).length > 0
}

function centreOf(el: OsmElement): Position | null {
  if (el.center) return [el.center.lon, el.center.lat]
  if (el.bounds) {
    return [
      (el.bounds.minlon + el.bounds.maxlon) / 2,
      (el.bounds.minlat + el.bounds.maxlat) / 2,
    ]
  }
  return null
}

function wayCoordinates(way: OsmElement, nodes: Map<number, OsmElement>): Position[] {
  if (way.geometry) {
    return way.geometry
      .filter((p): p is LatLon => p !== null && p !== undefined)
      .map((p) => [p.lon, p.lat] as Position)
  }
  const out: Position[] = []
  for (const ref of way.nodes ?? []) {
    const node = nodes.get(ref)
    if (node?.lat !== undefined && node.lon !== undefined) out.push([node.lon, node.lat])
  }
  return out
}

function isClosed(coords: Position[]): boolean {
  if (coords.length < 4) return false
  const [ax, ay] = coords[0]
  const [bx, by] = coords[coords.length - 1]
  return ax === bx && ay === by
}

function memberCoordinates(
  member: OsmMember,
  ways: Map<number, OsmElement>,
  nodes: Map<number, OsmElement>,
): Position[] {
  if (member.geometry) {
    return member.geometry
      .filter((p): p is LatLon => p !== null && p !== undefined)
      .map((p) => [p.lon, p.lat] as Position)
  }
  const way = ways.get(member.ref)
  return way ? wayCoordinates(way, nodes) : []
}

function relationGeometry(
  rel: OsmElement,
  ways: Map<number, OsmElement>,
  nodes: Map<number, OsmElement>,
): Geometry | null {
  const members = rel.members ?? []
  if (!members.length) return null

  const type = rel.tags?.type
  const isMultipolygon = type === 'multipolygon' || type === 'boundary'

  if (isMultipolygon) {
    const outer = stitchRings(
      members
        .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === ''))
        .map((m) => memberCoordinates(m, ways, nodes)),
    )
    const inner = stitchRings(
      members
        .filter((m) => m.type === 'way' && m.role === 'inner')
        .map((m) => memberCoordinates(m, ways, nodes)),
    )

    if (outer.length) return assemblePolygons(outer, inner)
  }

  // Any other relation: draw whatever line and point members it has.
  const lines = members
    .filter((m) => m.type === 'way')
    .map((m) => memberCoordinates(m, ways, nodes))
    .filter((c) => c.length >= 2)

  if (lines.length === 1) return { type: 'LineString', coordinates: lines[0] }
  if (lines.length > 1) return { type: 'MultiLineString', coordinates: lines }

  const points = members
    .filter((m) => m.lat !== undefined && m.lon !== undefined)
    .map((m) => [m.lon as number, m.lat as number] as Position)

  if (points.length === 1) return { type: 'Point', coordinates: points[0] }
  if (points.length > 1) return { type: 'MultiPoint', coordinates: points }

  return null
}

/**
 * Joins way fragments end to end into closed rings.
 *
 * Multipolygon members arrive as unordered, arbitrarily directed fragments, so
 * a naive concatenation produces self-crossing garbage. Each fragment is
 * appended, reversed if needed, until the ring closes.
 */
function stitchRings(fragments: Position[][]): Position[][] {
  const pending = fragments.filter((f) => f.length >= 2).map((f) => [...f])
  const rings: Position[][] = []

  while (pending.length) {
    let ring = pending.shift() as Position[]

    let extended = true
    while (extended && !isClosed(ring)) {
      extended = false
      for (let i = 0; i < pending.length; i++) {
        const candidate = pending[i]
        const tail = ring[ring.length - 1]
        const head = ring[0]

        if (samePoint(tail, candidate[0])) {
          ring = ring.concat(candidate.slice(1))
        } else if (samePoint(tail, candidate[candidate.length - 1])) {
          ring = ring.concat([...candidate].reverse().slice(1))
        } else if (samePoint(head, candidate[candidate.length - 1])) {
          ring = candidate.slice(0, -1).concat(ring)
        } else if (samePoint(head, candidate[0])) {
          ring = [...candidate].reverse().slice(0, -1).concat(ring)
        } else {
          continue
        }

        pending.splice(i, 1)
        extended = true
        break
      }
    }

    if (ring.length >= 4) {
      if (!isClosed(ring)) ring.push(ring[0])
      rings.push(ring)
    }
  }

  return rings
}

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

/** Nests each inner ring inside the outer ring that contains it. */
function assemblePolygons(outer: Position[][], inner: Position[][]): Geometry {
  const polygons: Position[][][] = outer.map((ring) => [ring])

  for (const hole of inner) {
    const probe = hole[0]
    const index = polygons.findIndex((poly) => pointInRing(probe, poly[0]))
    if (index >= 0) polygons[index].push(hole)
    else polygons.push([hole])
  }

  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] }
  return { type: 'MultiPolygon', coordinates: polygons }
}

/** Ray casting point-in-polygon, used only to match holes to their shell. */
function pointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }

  return inside
}

// ---------------------------------------------------------------------------
// Feature assembly
// ---------------------------------------------------------------------------

function makeFeature(el: OsmElement, geometry: Geometry): Feature {
  const properties: Record<string, unknown> = { ...el.tags }

  properties['@id'] = `${el.type}/${el.id}`
  properties['@type'] = el.type
  properties['@osmId'] = el.id

  if (el.version !== undefined) {
    properties['@meta'] = {
      version: el.version,
      timestamp: el.timestamp,
      changeset: el.changeset,
      user: el.user,
      uid: el.uid,
    }
  }

  return {
    type: 'Feature',
    id: `${el.type}/${el.id}`,
    geometry,
    properties,
  }
}

/** The OSM tags of a feature, without the properties we added. */
export function featureTags(feature: Feature): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(feature.properties ?? {})) {
    if (key.startsWith('@')) continue
    out[key] = String(value)
  }
  return out
}
