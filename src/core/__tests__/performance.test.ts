/**
 * Performance guards.
 *
 * Not benchmarks to admire: budgets that fail when something turns quadratic.
 * The numbers are deliberately loose, several times what the code needs on a
 * slow machine, so they catch an algorithmic regression rather than a noisy
 * afternoon. A failure here means the shape of the work changed, not that a
 * machine was busy.
 */

import { describe, expect, it } from 'vitest'

import { parse } from '../parser'
import { print } from '../printer'
import { validate } from '../validate'
import { osmToGeoJSON, type OsmElement } from '../../services/osmToGeoJSON'

function elapsed(label: string, work: () => void): number {
  const start = performance.now()
  work()
  const ms = performance.now() - start
  console.log(`   ${label}: ${ms.toFixed(0)} ms`)
  return ms
}

/** A query with `count` filtered statements inside a union. */
function bigQuery(count: number): string {
  const lines = ['[out:json][timeout:25];', 'area(id:3600120965)->.a;', '(']
  for (let i = 0; i < count; i++) {
    lines.push(`  node["amenity"="kind${i}"]["name"~"^A"](area.a);`)
  }
  lines.push(');', 'out geom;')
  return lines.join('\n')
}

describe('the query language scales with the query', () => {
  it('parses a 500-statement query quickly', () => {
    const source = bigQuery(500)
    const ms = elapsed('parse 500 statements', () => {
      const result = parse(source)
      expect(result.errors).toEqual([])
    })
    expect(ms).toBeLessThan(500)
  })

  it('prints a 500-statement query quickly', () => {
    const query = parse(bigQuery(500)).query
    const ms = elapsed('print 500 statements', () => print(query))
    expect(ms).toBeLessThan(200)
  })

  it('validates a 500-statement query quickly', () => {
    // Validation runs on every keystroke in the block editor, so it is the
    // one that has to stay cheap.
    const query = parse(bigQuery(500)).query
    const ms = elapsed('validate 500 statements', () => validate(query))
    expect(ms).toBeLessThan(200)
  })

  it('does not degrade quadratically as the query grows', () => {
    const small = parse(bigQuery(100)).query
    const large = parse(bigQuery(400)).query

    const t1 = elapsed('validate 100', () => validate(small))
    const t2 = elapsed('validate 400', () => validate(large))

    // Four times the work should not cost anywhere near sixteen times the
    // time. The floor keeps a sub-millisecond run from failing on noise.
    expect(t2).toBeLessThan(Math.max(t1 * 8, 60))
  })
})

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function manyNodes(count: number): OsmElement[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'node' as const,
    id: i + 1,
    lat: 45 + (i % 1000) / 10_000,
    lon: 4 + (i % 997) / 10_000,
    tags: { amenity: 'bench', name: `Bench ${i}`, material: 'wood' },
  }))
}

/** A multipolygon whose rings arrive as unordered, reversed fragments. */
function shreddedMultipolygon(fragments: number): OsmElement[] {
  const members = []
  for (let i = 0; i < fragments; i++) {
    const a = { lat: Math.cos((i / fragments) * 2 * Math.PI), lon: Math.sin((i / fragments) * 2 * Math.PI) }
    const b = {
      lat: Math.cos(((i + 1) / fragments) * 2 * Math.PI),
      lon: Math.sin(((i + 1) / fragments) * 2 * Math.PI),
    }
    // Reverse every other fragment, as real member ways are.
    members.push({
      type: 'way' as const,
      ref: i + 1,
      role: 'outer',
      geometry: i % 2 === 0 ? [a, b] : [b, a],
    })
  }

  // Shuffle deterministically, since members come back in no useful order.
  for (let i = members.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1)
    ;[members[i], members[j]] = [members[j], members[i]]
  }

  return [
    { type: 'relation', id: 1, tags: { type: 'multipolygon', natural: 'water' }, members },
  ]
}

describe('results scale with the response', () => {
  it('converts 20 000 nodes quickly', () => {
    const elements = manyNodes(20_000)
    const ms = elapsed('convert 20k nodes', () => {
      const { stats } = osmToGeoJSON({ elements })
      expect(stats.nodes).toBe(20_000)
    })
    expect(ms).toBeLessThan(2000)
  })

  it('converts 50 000 nodes without falling over', () => {
    const elements = manyNodes(50_000)
    const ms = elapsed('convert 50k nodes', () => {
      const { geojson } = osmToGeoJSON({ elements })
      expect(geojson.features).toHaveLength(50_000)
    })
    expect(ms).toBeLessThan(5000)
  })

  it('stitches a 2 000-fragment multipolygon without going quadratic', () => {
    // Ring assembly is the one genuinely fiddly algorithm in the converter,
    // and a country boundary really does arrive in thousands of pieces.
    const elements = shreddedMultipolygon(2000)
    const ms = elapsed('stitch 2000 fragments', () => {
      const { geojson } = osmToGeoJSON({ elements })
      expect(geojson.features).toHaveLength(1)
      expect(geojson.features[0].geometry.type).toBe('Polygon')
    })
    expect(ms).toBeLessThan(2000)
  })

  it('stitching grows roughly linearly with the number of fragments', () => {
    const t1 = elapsed('stitch 500', () => osmToGeoJSON({ elements: shreddedMultipolygon(500) }))
    const t2 = elapsed('stitch 2000', () => osmToGeoJSON({ elements: shreddedMultipolygon(2000) }))
    expect(t2).toBeLessThan(Math.max(t1 * 10, 100))
  })
})
