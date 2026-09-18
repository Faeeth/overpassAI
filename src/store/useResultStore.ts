/**
 * Running a query, and everything that comes back from it.
 *
 * A run goes through three stages that can each fail differently, so they are
 * reported separately: compiling (a place name that matches nothing), the HTTP
 * exchange (a timeout, a busy server), and conversion (a response with no
 * geometry). Collapsing them into one "query failed" would hide the only part
 * the user can act on.
 */

import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'

import type { OverpassQuery } from '../core/ast'
import { CompileError, compile, type CompiledQuery } from '../core/compile'
import type { MapView } from '../features/permalink'
import { geocodeArea } from '../services/nominatim'
import { OverpassError, runQuery, type OverpassErrorKind } from '../services/overpass'
import { osmToGeoJSON, type ConversionStats, type OsmElement } from '../services/osmToGeoJSON'
import type { BBox } from '../core/ast'

export type RunStatus = 'idle' | 'compiling' | 'running' | 'done' | 'error'

export interface RunError {
  /** Which stage failed, so the UI can point at the right thing. */
  stage: 'compile' | 'request' | 'convert'
  message: string
  hint?: string
  /** Query lines the server complained about. */
  lines: number[]
  /** Why the request failed, which decides what the UI offers to do about it. */
  kind?: OverpassErrorKind
}

export interface ResultData {
  geojson: FeatureCollection
  stats: ConversionStats
  /** Tagged elements with no geometry, listed in the table but not mapped. */
  unplaced: OsmElement[]
  /** The query actually sent, after shortcut expansion. */
  compiledSource: string
  /** Raw response body, shown in the "response" tab. */
  raw: string
  /** Set when the response was CSV rather than JSON. */
  csv: string | null
  durationMs: number
  runAt: string
  endpoint: string
  geocoded: CompiledQuery['geocoded']
}

interface ResultState {
  status: RunStatus
  data: ResultData | null
  error: RunError | null
  /** Lets the run button cancel an in-flight request. */
  abort: AbortController | null

  run: (query: OverpassQuery, options: { endpoint: string; viewport?: BBox }) => Promise<void>
  cancel: () => void
  clear: () => void
  /** Restores a result from a project file without hitting the network. */
  restore: (data: ResultData) => void
}

export const useResultStore = create<ResultState>((set, get) => ({
  status: 'idle',
  data: null,
  error: null,
  abort: null,

  run: async (query, options) => {
    get().abort?.abort()
    const controller = new AbortController()
    set({ status: 'compiling', error: null, abort: controller })

    let compiled: CompiledQuery
    try {
      compiled = await compile(query, {
        viewport: options.viewport,
        geocodeArea,
      })
    } catch (err) {
      set({
        status: 'error',
        abort: null,
        error: {
          stage: 'compile',
          message: err instanceof CompileError || err instanceof Error
            ? err.message
            : 'Could not prepare the query.',
          lines: [],
        },
      })
      return
    }

    if (controller.signal.aborted) {
      set({ status: 'idle', abort: null })
      return
    }

    set({ status: 'running' })

    try {
      const response = await runQuery(compiled.source, {
        endpoint: options.endpoint,
        signal: controller.signal,
      })

      const isJson = response.contentType.includes('json')
      const converted = isJson
        ? osmToGeoJSON(response.data as never)
        : { geojson: emptyCollection(), stats: emptyStats(), unplaced: [] }

      set({
        status: 'done',
        abort: null,
        error: null,
        data: {
          geojson: converted.geojson,
          stats: converted.stats,
          unplaced: converted.unplaced,
          compiledSource: compiled.source,
          raw: response.text,
          csv: isJson ? null : response.text,
          durationMs: Math.round(response.durationMs),
          runAt: new Date().toISOString(),
          endpoint: options.endpoint,
          geocoded: compiled.geocoded,
        },
      })
    } catch (err) {
      if (err instanceof OverpassError && err.kind === 'aborted') {
        set({ status: 'idle', abort: null })
        return
      }

      set({
        status: 'error',
        abort: null,
        error: {
          stage: 'request',
          message: err instanceof Error ? err.message : 'The query failed.',
          hint: err instanceof OverpassError ? err.hint : undefined,
          lines: err instanceof OverpassError ? err.lines : [],
          kind: err instanceof OverpassError ? err.kind : undefined,
        },
      })
    }
  },

  cancel: () => {
    get().abort?.abort()
    set({ status: 'idle', abort: null })
  },

  clear: () => set({ status: 'idle', data: null, error: null }),

  restore: (data) => set({ status: 'done', data, error: null, abort: null }),
}))

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function emptyStats(): ConversionStats {
  return { nodes: 0, ways: 0, relations: 0, withoutGeometry: 0, total: 0 }
}

/** Bounding box of a result, for the "zoom to results" button. */
export function boundsOf(collection: FeatureCollection): BBox | null {
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  let seen = false

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lon, lat] = value as [number, number]
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
      seen = true
      return
    }
    for (const item of value) visit(item)
  }

  for (const feature of collection.features) {
    const geometry = feature.geometry
    if (!geometry) continue
    if (geometry.type === 'GeometryCollection') {
      for (const child of geometry.geometries) {
        visit((child as { coordinates?: unknown }).coordinates)
      }
      continue
    }
    visit(geometry.coordinates)
  }

  return seen ? { south, west, north, east } : null
}

/** A view that frames a result, used when a project file has no saved view. */
export function viewForBounds(bbox: BBox): MapView {
  const lat = (bbox.south + bbox.north) / 2
  const lon = (bbox.west + bbox.east) / 2
  const span = Math.max(bbox.north - bbox.south, (bbox.east - bbox.west) * 0.7, 1e-4)
  // 360 degrees spans the world at zoom 0, halving with each level.
  const zoom = Math.min(18, Math.max(2, Math.log2(360 / span) - 0.4))
  return { lat, lon, zoom }
}
