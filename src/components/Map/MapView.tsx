/**
 * The map.
 *
 * Results are drawn in the chart magenta the whole app is keyed to: it is the
 * one colour that stays legible over beige buildings, green landuse, blue
 * water and satellite imagery alike, which is the entire reason hydrographers
 * settled on it for chart overlays.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Map as MapLibreMap,
  ScaleControl,
  type FilterSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { BBox } from '../../core/ast'
import { boundsOf } from '../../store/useResultStore'
import { useResultStore } from '../../store/useResultStore'
import { useUiStore } from '../../store/useUiStore'
import { Icon } from '../Common/Icon'
import { Menu, MenuItem, MenuLabel } from '../Common/Menu'
import { toast } from '../Common/Toast'
import { configureMapWorker } from '../../services/mapWorker'
import { BASEMAPS, basemapStyle } from './basemaps'
import { setMapInstance } from './mapRegistry'

const SOURCE_ID = 'results'
const EMPTY = { type: 'FeatureCollection' as const, features: [] }

/** Chart magenta for results, and a warm yellow for the selected one. */
const RESULT_COLOR = '#ff2d8a'
const SELECTED_COLOR = '#ffd000'

/**
 * An id no feature can hold, so a layer filtered on it draws nothing.
 * Real ids always look like `node/240109189`.
 */
const NO_ID = '__no_selection__'

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  /** Set once the style has loaded, so layer work never races it. */
  const ready = useRef(false)

  const basemap = useUiStore((state) => state.basemap)
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const selectFeature = useUiStore((state) => state.selectFeature)
  const selectedId = useUiStore((state) => state.selectedFeatureId)

  const data = useResultStore((state) => state.data)

  // -- Create -------------------------------------------------------------

  useEffect(() => {
    if (!container.current) return
    configureMapWorker()

    const instance = new MapLibreMap({
      container: container.current,
      style: basemapStyle(useUiStore.getState().basemap),
      center: [view.lon, view.lat],
      zoom: view.zoom,
      attributionControl: { compact: true },
      // Overpass results are flat data; tilting adds nothing and makes the
      // viewport-to-bbox conversion lie.
      pitchWithRotate: false,
      dragRotate: false,
      maxZoom: 21,
    })

    // MapLibre's own geolocate control lands in the same corner as this app's
    // controls and ends up underneath them, leaving 3px of it clickable. The
    // button below does the one thing anyone wants from it, in the same style
    // as everything else on the map.
    instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')

    instance.on('load', () => {
      ready.current = true
      installResultLayers(instance)
      const current = useResultStore.getState().data
      if (current) {
        ;(instance.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(
          current.geojson,
        )
      }
    })

    const syncView = () => {
      const centre = instance.getCenter()
      setView({ lat: centre.lat, lon: centre.lng, zoom: instance.getZoom() })
    }
    instance.on('moveend', syncView)

    instance.on('click', (event) => {
      const hits = instance.queryRenderedFeatures(event.point, {
        layers: ['results-fill', 'results-line', 'results-point'],
      })
      selectFeature(hits.length ? featureKey(hits[0]) : null)
    })

    instance.on('mousemove', (event) => {
      const hits = instance.queryRenderedFeatures(event.point, {
        layers: ['results-fill', 'results-line', 'results-point'],
      })
      instance.getCanvas().style.cursor = hits.length ? 'pointer' : ''
    })

    map.current = instance
    setMapInstance(instance)

    return () => {
      ready.current = false
      setMapInstance(null)
      instance.remove()
      map.current = null
    }
    // Deliberately created once: view and basemap changes are applied by the
    // effects below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- Basemap ------------------------------------------------------------

  useEffect(() => {
    const instance = map.current
    if (!instance) return

    ready.current = false
    instance.setStyle(basemapStyle(basemap))
    instance.once('styledata', () => {
      ready.current = true
      installResultLayers(instance)
      const current = useResultStore.getState().data
      ;(instance.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(
        current?.geojson ?? EMPTY,
      )
    })
  }, [basemap])

  // -- Results ------------------------------------------------------------

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready.current) return

    const source = instance.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(data?.geojson ?? EMPTY)
  }, [data])

  // Frame new results, unless the query was already scoped to the map view.
  useEffect(() => {
    const instance = map.current
    if (!instance || !data) return
    if (data.compiledSource.includes('{{bbox}}')) return

    const bounds = boundsOf(data.geojson)
    if (!bounds) return
    instance.fitBounds(toLngLatBounds(bounds), { padding: 60, maxZoom: 17, duration: 400 })
  }, [data])

  // -- Selection ----------------------------------------------------------

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready.current) return

    const filter: FilterSpecification = selectedId
      ? ['==', ['get', '@id'], selectedId]
      : ['==', ['get', '@id'], NO_ID]

    for (const layer of ['results-selected-line', 'results-selected-point']) {
      if (instance.getLayer(layer)) instance.setFilter(layer, filter)
    }
  }, [selectedId, data])

  // -- Controls -----------------------------------------------------------

  const [locating, setLocating] = useState(false)

  const goToMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('This browser does not offer a location.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        map.current?.easeTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: Math.max(map.current.getZoom(), 14),
          duration: 600,
        })
      },
      (error) => {
        setLocating(false)
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Location is blocked for this site. Allow it in the address bar to use this.'
            : 'Could not work out where you are.',
        )
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [])

  const zoomToResults = useCallback(() => {
    const instance = map.current
    if (!instance || !data) return
    const bounds = boundsOf(data.geojson)
    if (!bounds) return
    instance.fitBounds(toLngLatBounds(bounds), { padding: 60, maxZoom: 17 })
  }, [data])

  return (
    <>
      <div className="map" ref={container} />

      <div className="map__overlay map__controls">
        <div className="map__control-group">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => map.current?.zoomIn()}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Icon name="zoom-in" />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => map.current?.zoomOut()}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Icon name="zoom-out" />
          </button>
        </div>

        <div className="map__control-group">
          <button
            type="button"
            className="btn btn--icon"
            onClick={goToMyLocation}
            disabled={locating}
            aria-label="Go to my location"
            title="Go to my location"
          >
            {locating ? <span className="btn__spinner" /> : <Icon name="pin" />}
          </button>

          <button
            type="button"
            className="btn btn--icon"
            onClick={zoomToResults}
            disabled={!data?.geojson.features.length}
            aria-label="Zoom to results"
            title="Zoom to results"
          >
            <Icon name="target" />
          </button>

          <Menu
            triggerClassName="btn btn--icon"
            triggerLabel="Choose a basemap"
            trigger={<Icon name="layers" />}
            align="end"
          >
            {(close) => (
              <>
                <MenuLabel>Basemap</MenuLabel>
                {BASEMAPS.map((entry) => (
                  <MenuItem
                    key={entry.id}
                    onClick={() => {
                      useUiStore.getState().setBasemap(entry.id)
                      close()
                    }}
                    icon={
                      entry.id === basemap ? (
                        <Icon name="check" size={13} />
                      ) : (
                        <span style={{ width: 13 }} />
                      )
                    }
                  >
                    <span title={entry.description}>{entry.label}</span>
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        </div>
      </div>

      <div className="map__overlay map__status">
        <span className="map__scale">
          {view.lat.toFixed(4)}, {view.lon.toFixed(4)} &middot; z{view.zoom.toFixed(1)}
        </span>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * Adds the result layers, bottom to top: fills, then outlines, then points,
 * then the selection highlight. Drawing points last keeps a single node
 * findable when it sits on top of a large polygon.
 */
function installResultLayers(map: MapLibreMap): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY })
  }

  const add = (layer: LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer)
  }

  add({
    id: 'results-fill',
    type: 'fill',
    source: SOURCE_ID,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: { 'fill-color': RESULT_COLOR, 'fill-opacity': 0.18 },
  })

  add({
    id: 'results-line',
    type: 'line',
    source: SOURCE_ID,
    filter: [
      'in',
      ['geometry-type'],
      ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': RESULT_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 16, 3],
      'line-opacity': 0.95,
    },
  })

  add({
    id: 'results-point',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
    paint: {
      'circle-color': RESULT_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 7],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.95,
    },
  })

  add({
    id: 'results-selected-line',
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', '@id'], NO_ID],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': SELECTED_COLOR, 'line-width': 4, 'line-opacity': 1 },
  })

  add({
    id: 'results-selected-point',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', '@id'], NO_ID],
    paint: {
      'circle-color': SELECTED_COLOR,
      'circle-radius': 9,
      'circle-stroke-color': '#000000',
      'circle-stroke-width': 1.5,
    },
  })
}

function featureKey(feature: MapGeoJSONFeature): string | null {
  const id = feature.properties?.['@id']
  return typeof id === 'string' ? id : null
}

function toLngLatBounds(bbox: BBox): LngLatBoundsLike {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
  ]
}
