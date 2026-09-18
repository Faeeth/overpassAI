/**
 * Basemap definitions.
 *
 * All raster, all reachable without an API key, which is what keeps the app
 * fully static. CARTO's basemaps are deliberately absent: they now stamp
 * "API KEY REQUIRED" across keyless tiles.
 *
 * The default is a grey canvas rather than the full-colour OSM rendering, and
 * that is the same decision as the magenta result colour: a basemap here is
 * context, not content. A quiet base lets a thousand result points stay
 * readable; a loud one turns them into noise. Full-detail OSM is one click
 * away for when you need to see what is actually mapped.
 *
 * Attribution is not optional under any of these providers' terms, and is
 * rendered by the map's attribution control.
 */

import type { StyleSpecification } from 'maplibre-gl'

import type { BasemapId } from '../../store/useUiStore'

interface BasemapSpec {
  id: BasemapId
  label: string
  description: string
  tiles: string[]
  attribution: string
  maxzoom: number
  /** True when the tiles are dark enough to need light UI over them. */
  dark: boolean
}

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

const ESRI_CANVAS_ATTRIBUTION = `Esri, HERE, Garmin, &copy; ${OSM_ATTRIBUTION}`

export const BASEMAPS: BasemapSpec[] = [
  {
    id: 'gray-light',
    label: 'Light canvas',
    description: 'Quiet grey base, so results carry the map',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ESRI_CANVAS_ATTRIBUTION,
    maxzoom: 16,
    dark: false,
  },
  {
    id: 'gray-dark',
    label: 'Dark canvas',
    description: 'The same, for dark rooms',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: ESRI_CANVAS_ATTRIBUTION,
    maxzoom: 16,
    dark: true,
  },
  {
    id: 'osm',
    label: 'OSM standard',
    description: 'Full detail, to see what is really mapped',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: OSM_ATTRIBUTION,
    maxzoom: 19,
    dark: false,
  },
  {
    id: 'satellite',
    label: 'Satellite',
    description: 'Aerial imagery, to check against the ground',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Esri, Maxar, Earthstar Geographics and the GIS User Community',
    maxzoom: 19,
    dark: true,
  },
]

export function basemapSpec(id: BasemapId): BasemapSpec {
  return BASEMAPS.find((map) => map.id === id) ?? BASEMAPS[0]
}

/**
 * Minimal MapLibre style wrapping a raster tile source.
 *
 * The grey canvases stop at zoom 16, so `maxzoom` lets MapLibre keep
 * over-zooming the last available tile instead of showing blank space when a
 * user zooms to a single building.
 */
export function basemapStyle(id: BasemapId): StyleSpecification {
  const spec = basemapSpec(id)

  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: spec.tiles,
        tileSize: 256,
        maxzoom: spec.maxzoom,
        attribution: spec.attribution,
      },
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: { 'raster-opacity': 1 },
      },
    ],
  }
}
