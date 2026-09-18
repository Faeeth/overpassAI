import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Ships MapLibre's worker as a real asset.
 *
 * MapLibre resolves its worker with `new URL(`./${name}`, import.meta.url)`,
 * where `name` is computed at run time. Rollup cannot see through that, so it
 * emits no asset and the worker URL points at a file that does not exist. The
 * map still draws raster tiles, because those are decoded on the main thread,
 * but GeoJSON sources are tiled *in the worker* and silently render nothing:
 * no error, no failed request the page can see, just an empty result layer.
 *
 * Both files are needed and must stay siblings, because the worker imports the
 * shared chunk by relative path. `src/services/mapWorker.ts` points MapLibre at
 * the copy this plugin emits.
 */
function maplibreWorkerAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

  return {
    name: 'maplibre-worker-assets',
    apply: 'build',
    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          // An explicit name, not a hashed one: the worker imports its sibling
          // by the original file name.
          fileName: `maplibre/${name}`,
          source: readFileSync(require.resolve(`maplibre-gl/dist/${name}`), 'utf8'),
        })
      }
    },
  }
}

/**
 * Build config.
 *
 * `base` differs between dev and build on purpose. GitHub Pages serves a
 * project site from a subpath, but the registered OAuth redirect URI for
 * development is `http://127.0.0.1:5173/oauth-callback.html` at the root, so
 * the dev server has to stay at `/`. Both registered URIs then resolve from
 * `import.meta.env.BASE_URL` without any per-environment code.
 *
 * Set `BASE_PATH=/` when deploying somewhere that serves from the root, such
 * as Netlify or Cloudflare Pages.
 */
export default defineConfig(({ command, isPreview }) => ({
  // `vite preview` runs as a serve command but has to match what was built,
  // hence `isPreview` alongside the build check.
  base: command === 'build' || isPreview ? (process.env.BASE_PATH ?? '/overpassAI/') : '/',

  plugins: [react(), maplibreWorkerAssets()],

  // In dev, leaving MapLibre unbundled keeps `import.meta.url` pointing at its
  // own directory, where the worker file really is. Pre-bundling would rewrite
  // it into `.vite/deps/` and break the worker the same way the build does.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },

  server: {
    // Must be 127.0.0.1 rather than localhost: OpenStreetMap matches the
    // redirect URI exactly, and the two are different origins to it.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // MapLibre and CodeMirror are large and change rarely; splitting them
        // out keeps the app chunk small enough to cache usefully.
        manualChunks: (id: string) => {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre'
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/@lezer')) {
            return 'codemirror'
          }
          return undefined
        },
      },
    },
  },
}))
