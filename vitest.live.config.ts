import { defineConfig } from 'vitest/config'

/**
 * Config for the live syntax oracle, which talks to a real Overpass server.
 *
 * Kept apart from `vitest.config.ts` so `npm test` stays offline, fast and
 * deterministic. See `scripts/syntax-oracle.test.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One request at a time: this is someone else's free service.
    fileParallelism: false,
    maxConcurrency: 1,
  },
})
