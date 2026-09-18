import { describe, expect, it } from 'vitest'

import type { OverpassQuery, Statement } from '../ast'
import { parse } from '../parser'
import { print } from '../printer'

/**
 * Ids are allocated per parse, so two structurally identical trees never
 * compare equal by value. This strips them, which is exactly the equality the
 * editor cares about: the blocks a user sees, not their React keys.
 */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (key === 'id') continue
      if (val === undefined) continue
      out[key] = stripIds(val)
    }
    return out
  }
  return value
}

/** Asserts that printing then reparsing yields the same tree. */
function expectStable(source: string): OverpassQuery {
  const first = parse(source)
  expect(first.errors, `unexpected parse errors in:\n${source}`).toEqual([])

  const printed = print(first.query)
  const second = parse(printed)
  expect(second.errors, `reparsing our own output failed:\n${printed}`).toEqual([])
  expect(stripIds(second.query), `round-trip diverged:\n${printed}`).toEqual(
    stripIds(first.query),
  )
  return first.query
}

describe('settings', () => {
  it('reads the standard prologue', () => {
    const q = expectStable('[out:json][timeout:25];node["amenity"="bar"];out body;')
    expect(q.settings.format).toBe('json')
    expect(q.settings.timeout).toBe(25)
  })

  it('reads a global bbox and an attic date', () => {
    const q = expectStable(
      '[out:xml][timeout:90][bbox:48.8,2.2,48.9,2.4][date:"2024-01-01T00:00:00Z"];out;',
    )
    expect(q.settings.format).toBe('xml')
    expect(q.settings.bbox).toEqual({ south: 48.8, west: 2.2, north: 48.9, east: 2.4 })
    expect(q.settings.date).toBe('2024-01-01T00:00:00Z')
  })

  it('reads a csv output spec', () => {
    const q = expectStable('[out:csv("name","amenity";true;",")];node["amenity"];out;')
    expect(q.settings.csv).toEqual({
      fields: ['name', 'amenity'],
      header: true,
      separator: ',',
    })
  })

  it('keeps unknown settings verbatim', () => {
    const q = expectStable('[out:json][diff:"2020-01-01T00:00:00Z"];out;')
    expect(q.settings.diff).toEqual({ from: '2020-01-01T00:00:00Z', to: undefined })
  })
})

describe('tag filters', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['["amenity"]', { op: 'exists', key: 'amenity' }],
    ['[!"amenity"]', { op: 'missing', key: 'amenity' }],
    ['["amenity"="bar"]', { op: 'eq', key: 'amenity', value: 'bar' }],
    ['["amenity"!="bar"]', { op: 'neq', key: 'amenity', value: 'bar' }],
    ['["name"~"^Le"]', { op: 'like', key: 'name', value: '^Le' }],
    ['["name"!~"^Le"]', { op: 'notlike', key: 'name', value: '^Le' }],
    ['["name"~"cafe",i]', { op: 'like', value: 'cafe', caseInsensitive: true }],
    ['[~"^addr:"~"."]', { keyMatch: 'regex', key: '^addr:', op: 'like', value: '.' }],
  ]

  for (const [filter, expected] of cases) {
    it(`parses ${filter}`, () => {
      const q = expectStable(`node${filter};out;`)
      const stmt = q.statements[0]
      expect(stmt.kind).toBe('query')
      if (stmt.kind !== 'query') return
      expect(stmt.filters).toHaveLength(1)
      expect(stmt.filters[0]).toMatchObject(expected)
    })
  }

  it('accepts unquoted keys and values', () => {
    const q = expectStable('node[amenity=bar];out;')
    const stmt = q.statements[0]
    if (stmt.kind !== 'query') throw new Error('expected a query statement')
    expect(stmt.filters[0]).toMatchObject({ key: 'amenity', value: 'bar', op: 'eq' })
  })
})

describe('spatial filters', () => {
  it('parses a bbox', () => {
    const q = expectStable('node(48.8,2.2,48.9,2.4);out;')
    const stmt = q.statements[0]
    if (stmt.kind !== 'query') throw new Error('expected a query statement')
    expect(stmt.filters[0]).toMatchObject({
      kind: 'bbox',
      bbox: { south: 48.8, west: 2.2, north: 48.9, east: 2.4 },
    })
  })

  it('parses the viewport shortcut', () => {
    const q = expectStable('node({{bbox}});out;')
    const stmt = q.statements[0]
    if (stmt.kind !== 'query') throw new Error('expected a query statement')
    expect(stmt.filters[0]).toMatchObject({ kind: 'bbox', bbox: null })
  })

  it('parses area, around, poly and pivot', () => {
    const q = expectStable(
      'node(area.city);way(around:250);rel(around.stops:100,48.8,2.3);node(poly:"48.8 2.2 48.9 2.4");node(pivot.city);out;',
    )
    const filters = q.statements.map((s) => (s.kind === 'query' ? s.filters[0] : null))
    expect(filters[0]).toMatchObject({ kind: 'area', set: 'city' })
    expect(filters[1]).toMatchObject({ kind: 'around', radius: 250, points: [] })
    expect(filters[2]).toMatchObject({ kind: 'around', radius: 100, set: 'stops', points: [48.8, 2.3] })
    expect(filters[3]).toMatchObject({ kind: 'poly', points: '48.8 2.2 48.9 2.4' })
    expect(filters[4]).toMatchObject({ kind: 'pivot', set: 'city' })
  })

  it('parses an area referenced by id', () => {
    const q = expectStable('node(area:3600007444);out;')
    const stmt = q.statements[0]
    if (stmt.kind !== 'query') throw new Error('expected a query statement')
    expect(stmt.filters[0]).toMatchObject({ kind: 'area', areaId: 3600007444 })
  })
})

describe('metadata filters', () => {
  it('parses ids, user, uid, newer and changed', () => {
    const q = expectStable(
      'node(id:1,2,3);node(user:"alice");node(uid:42);node(newer:"2024-01-01T00:00:00Z");node(changed:"2024-01-01T00:00:00Z","2024-06-01T00:00:00Z");out;',
    )
    const filters = q.statements.map((s) => (s.kind === 'query' ? s.filters[0] : null))
    expect(filters[0]).toMatchObject({ kind: 'ids', ids: [1, 2, 3] })
    expect(filters[1]).toMatchObject({ kind: 'user', users: ['alice'] })
    expect(filters[2]).toMatchObject({ kind: 'uid', uids: [42] })
    expect(filters[3]).toMatchObject({ kind: 'newer' })
    expect(filters[4]).toMatchObject({ kind: 'changed', to: '2024-06-01T00:00:00Z' })
  })

  it('parses recursion filters with a member role', () => {
    const q = expectStable('node(w.routes);way(bn);rel(bw.parts);node(r:"stop");out;')
    const filters = q.statements.map((s) => (s.kind === 'query' ? s.filters[0] : null))
    expect(filters[0]).toMatchObject({ kind: 'recurse', role: 'w', set: 'routes' })
    expect(filters[1]).toMatchObject({ kind: 'recurse', role: 'bn' })
    expect(filters[2]).toMatchObject({ kind: 'recurse', role: 'bw', set: 'parts' })
    expect(filters[3]).toMatchObject({ kind: 'recurse', role: 'r', memberRole: 'stop' })
  })

  it('keeps an if filter as an opaque expression', () => {
    const q = expectStable('node(if:count_tags() > 5);out;')
    const stmt = q.statements[0]
    if (stmt.kind !== 'query') throw new Error('expected a query statement')
    expect(stmt.filters[0]).toMatchObject({ kind: 'if', expr: 'count_tags() > 5' })
  })
})

describe('statements', () => {
  it('parses a union', () => {
    const q = expectStable('(node["a"];way["a"];);out;')
    expect(q.statements[0].kind).toBe('union')
    const union = q.statements[0]
    if (union.kind !== 'union') return
    expect(union.items).toHaveLength(2)
  })

  it('parses a difference', () => {
    const q = expectStable('(node["a"]; - node["b"];);out;')
    const diff = q.statements[0]
    expect(diff.kind).toBe('difference')
    if (diff.kind !== 'difference') return
    expect(diff.left).toMatchObject({ kind: 'query' })
    expect(diff.right).toMatchObject({ kind: 'query' })
  })

  it('parses nested unions inside a difference', () => {
    const q = expectStable('(node["a"];way["a"]; - node["b"];way["b"];)->.result;out;')
    const diff = q.statements[0]
    if (diff.kind !== 'difference') throw new Error('expected a difference')
    expect(diff.into).toBe('result')
    expect(diff.left).toMatchObject({ kind: 'union' })
    expect(diff.right).toMatchObject({ kind: 'union' })
  })

  it('parses input and output sets', () => {
    const q = expectStable('node["a"]->.first;way.first["b"]->.second;.second out body;')
    expect(q.statements[0]).toMatchObject({ into: 'first' })
    expect(q.statements[1]).toMatchObject({ inputSets: ['first'], into: 'second' })
    expect(q.statements[2]).toMatchObject({ kind: 'out', from: 'second', verbosity: 'body' })
  })

  it('parses every recursion operator', () => {
    const q = expectStable('>;<;>>;<<;.a >->.b;out;')
    expect(q.statements.slice(0, 4).map((s) => (s.kind === 'recurse' ? s.op : null))).toEqual([
      '>',
      '<',
      '>>',
      '<<',
    ])
    expect(q.statements[4]).toMatchObject({ kind: 'recurse', from: 'a', into: 'b' })
  })

  it('parses out modifiers in any order', () => {
    const q = expectStable('out meta center qt 500;')
    expect(q.statements[0]).toMatchObject({
      kind: 'out',
      verbosity: 'meta',
      geometry: 'center',
      sort: 'qt',
      limit: 500,
    })
  })

  it('parses foreach with a body', () => {
    const q = expectStable('way["building"]->.w;.w foreach(out body;>;out skel qt;);')
    const loop = q.statements[1]
    expect(loop.kind).toBe('foreach')
    if (loop.kind !== 'foreach') return
    expect(loop.from).toBe('w')
    expect(loop.body).toHaveLength(3)
  })

  it('parses is_in', () => {
    const q = expectStable('is_in(48.85,2.35)->.areas;.areas out;')
    expect(q.statements[0]).toMatchObject({ kind: 'isin', lat: 48.85, lon: 2.35, into: 'areas' })
  })

  it('parses a bare set reference', () => {
    const q = expectStable('node["a"]->.a;(.a;.a;);out;')
    const union = q.statements[1]
    if (union.kind !== 'union') throw new Error('expected a union')
    expect(union.items[0]).toMatchObject({ kind: 'setref', set: 'a' })
  })
})

describe('shortcuts', () => {
  it('parses a geocoded area', () => {
    const q = expectStable('{{geocodeArea:Lyon}}->.searchArea;node(area.searchArea);out;')
    expect(q.statements[0]).toMatchObject({
      kind: 'geocodeArea',
      query: 'Lyon',
      into: 'searchArea',
    })
  })

  it('treats nominatimArea as a geocoded area', () => {
    const q = expectStable('{{nominatimArea:Berlin}}->.a;out;')
    expect(q.statements[0]).toMatchObject({ kind: 'geocodeArea', query: 'Berlin' })
  })
})

describe('lossless fallbacks', () => {
  it('keeps an unmodelled statement verbatim', () => {
    const source = '[out:json];make stat count=count(nodes);out;'
    const q = expectStable(source)
    expect(q.statements[0]).toMatchObject({ kind: 'raw' })
    expect(print(q)).toContain('make stat count=count(nodes);')
  })

  it('keeps an unmodelled filter verbatim', () => {
    const q = expectStable('node["a"](nonsense:1);out;')
    const stmt = q.statements[0]
    if (stmt.kind !== 'query') throw new Error('expected a query statement')
    expect(stmt.filters[1]).toMatchObject({ kind: 'raw', text: '(nonsense:1)' })
  })

  it('reports a position for a missing bracket', () => {
    const result = parse('node["amenity"="bar";out;')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].line).toBe(1)
  })

  it('never throws on arbitrary input', () => {
    const samples = ['', ';;;', '((((', '[out:', 'node[', '"unterminated', '/* open']
    for (const sample of samples) {
      expect(() => parse(sample)).not.toThrow()
    }
  })
})

describe('labels and muting', () => {
  it('turns a leading comment into a block label', () => {
    const q = expectStable('// all the bars\nnode["amenity"="bar"];\nout;')
    expect(q.statements[0].label).toBe('all the bars')
  })

  it('round-trips a muted block', () => {
    const source = print({
      settings: { format: 'json', timeout: 25 },
      statements: [
        { kind: 'query', id: 'x', type: 'node', inputSets: [], filters: [], disabled: true },
        { kind: 'out', id: 'y' },
      ] as Statement[],
    })
    expect(source).toContain('/*@off')

    const reparsed = parse(source)
    expect(reparsed.errors).toEqual([])
    expect(reparsed.query.statements[0].disabled).toBe(true)
    expect(reparsed.query.statements[1].kind).toBe('out')
  })
})

describe('real world queries', () => {
  it('handles a typical overpass turbo query', () => {
    const q = expectStable(`
[out:json][timeout:25];
// fetch the area
{{geocodeArea:Lyon}}->.searchArea;
(
  node["amenity"="restaurant"](area.searchArea);
  way["amenity"="restaurant"](area.searchArea);
  relation["amenity"="restaurant"](area.searchArea);
);
out body;
>;
out skel qt;
`)
    expect(q.statements).toHaveLength(5)
    expect(q.statements[0].kind).toBe('geocodeArea')
    expect(q.statements[1].kind).toBe('union')
  })

  it('handles a query combining sets, recursion and a difference', () => {
    const q = expectStable(`
[out:json][timeout:60];
area["name"="Paris"]["admin_level"="8"]->.paris;
way["highway"="cycleway"](area.paris)->.cycle;
(
  .cycle;
  - way.cycle["access"="private"];
)->.public;
.public out geom 2000;
`)
    expect(q.statements).toHaveLength(4)
    expect(q.statements[2].kind).toBe('difference')
  })
})
