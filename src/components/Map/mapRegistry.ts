/**
 * Access to the live map instance from outside the map component.
 *
 * Exactly one thing needs it: expanding `{{bbox}}` to the visible extent when
 * a query runs. Threading a ref through the component tree for that one read
 * would be more plumbing than the problem deserves, and a module-level handle
 * is honest about there being a single map.
 */

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
