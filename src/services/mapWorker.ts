/**
 * Points MapLibre at its worker.
 *
 * MapLibre builds the worker URL from `import.meta.url` at run time, which a
 * bundler cannot rewrite. In a production build the computed URL points at a
 * file that was never emitted, and the failure is silent in the worst way: the
 * basemap keeps drawing, because raster tiles are decoded on the main thread,
 * while every GeoJSON layer renders nothing at all.
 *
 * The `maplibreWorkerAssets` plugin in `vite.config.ts` emits the worker and
 * its shared chunk under `maplibre/`, and this sets the URL to match.
 *
 * In dev nothing is needed: MapLibre is excluded from dependency
 * pre-bundling, so its own resolution finds the file next to the module.
 */

import { setWorkerUrl } from 'maplibre-gl'

let configured = false

export function configureMapWorker(): void {
  if (configured || import.meta.env.DEV) return
  configured = true
  setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`)
}
