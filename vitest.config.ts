import { defineConfig } from 'vitest/config'

/**
 * Test config.
 *
 * `happy-dom` rather than a bare Node environment because a fair amount of
 * this code is browser code that has no business being mocked away: the
 * Overpass client reads HTML error pages with DOMParser, the exporters build
 * Blobs, and the library writes to localStorage. Testing those against stubs
 * would test the stubs.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
