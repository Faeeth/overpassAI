/**
 * Access to the live map instance from outside the map component.
 *
 * Exactly one thing needs it: expanding `{{bbox}}` to the visible extent when
 * a query runs. Threading a ref through the component tree for that one read
 * would be more plumbing than the problem deserves, and a module-level handle
 * is honest about there being a single map.
 */

import type { Feature } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'

import type { BBox } from '../../core/ast'

let instance: MapLibreMap | null = null

declare global {
  interface Window {
    /**
     * The live map, for debugging and for the smoke test.
     *
     * Deliberately present in production builds: it exposes nothing the page
     * does not already control, and it is the only way to assert from outside
     * that result layers are actually painting. A silently empty GeoJSON layer
     * looks identical to a query that matched nothing.
     */
    __mapForTests?: MapLibreMap | null
  }
}

export function setMapInstance(map: MapLibreMap | null): void {
  instance = map
  window.__mapForTests = map
}

export function getMapInstance(): MapLibreMap | null {
  return instance
}

/** The visible extent, as the bbox a `{{bbox}}` filter expands to. */
export function currentViewportBBox(): BBox | undefined {
  if (!instance) return undefined
  const bounds = instance.getBounds()
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  }
}

/**
 * Centres the map on a feature without changing the zoom.
 *
 * Selecting a result in the table is how people find it on the map, so the map
 * has to go there: highlighting something off-screen is no help at all. The
 * zoom is left alone because the user chose it.
 */
export function flyToFeature(feature: Feature | null): void {
  if (!instance || !feature?.geometry) return

  const centre = centroidOf(feature)
  if (!centre) return

  instance.easeTo({ center: centre, duration: 400 })
}

/** Centre of a feature's extent, which works for a point and an area alike. */
function centroidOf(feature: Feature): [number, number] | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let seen = false

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lon, lat] = value as [number, number]
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      seen = true
      return
    }
    for (const item of value) visit(item)
  }

  const geometry = feature.geometry
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) visit((child as { coordinates?: unknown }).coordinates)
  } else {
    visit(geometry.coordinates)
  }

  return seen ? [(minLon + maxLon) / 2, (minLat + maxLat) / 2] : null
}
