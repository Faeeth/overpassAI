/**
 * Hostile and malformed input.
 *
 * Everything here arrives from somewhere the app does not control: a pasted
 * query, a shared link, a dropped file, a localStorage entry from an older
 * version or another tab. None of it may take the page down, because the user
 * has no way to recover from a blank screen except losing their work.
 */

import { describe, expect, it } from 'vitest'

import { compile } from '../compile'
import { parse } from '../parser'
import { print } from '../printer'
import { validate } from '../validate'
import { decodeHash } from '../../features/permalink'
import { parseProjectJson } from '../../features/exporters/project'
import * as library from '../../features/library'
import { osmToGeoJSON } from '../../services/osmToGeoJSON'

const NASTY_QUERIES = [
  '',
  ' ',
  '\n\n\n',
  ';',
  ';;;;;;',
  '((((((((((',
  '))))))))))',
  '[[[[[[',
  ']]]]]]',
  '{{{{{{',
  '[out:',
  '[out:json',
  'node[',
  'node["',
  'node["a"',
  'node["a"=',
  '"unterminated string',
  "'unterminated string",
  '/* unterminated comment',
  '// just a comment',
  'out',
  'out;',
  '->.a;',
  '.;',
  '..;',
  'node.;',
  '(;)',
  '( - );',
  'foreach();',
  'foreach(',
  'node(around:);',
  'node(id:);',
  'node(poly:);',
  'node(if:);',
  'node[~"("~"("];',
  'node["a"~"[unclosed"];',
  '[out:csv()];out;',
  '[out:csv(];out;',
  `${String.fromCharCode(0)}${String.fromCharCode(1)}${String.fromCharCode(2)}`,
  'node["éèà"="中文"];out;',
  'node["a"="\\\\"];out;',
  'node' + '['.repeat(200) + ']'.repeat(200) + ';',
  '('.repeat(200) + ')'.repeat(200) + ';',
  'a'.repeat(100_000),
  '[out:json];'.repeat(1000),
]

describe('the parser survives anything', () => {
  for (const [index, source] of NASTY_QUERIES.entries()) {
    it(`case ${index}: ${JSON.stringify(source.slice(0, 40))}`, () => {
      expect(() => parse(source)).not.toThrow()

      const { query } = parse(source)
      expect(() => print(query)).not.toThrow()
      expect(() => validate(query)).not.toThrow()
    })
  }

  it('reparses its own output for every one of them', () => {
    // Whatever the parser made of a broken query, printing it must produce
    // something the parser can read again, or the two views deadlock.
    for (const source of NASTY_QUERIES) {
      const once = print(parse(source).query)
      expect(() => parse(once)).not.toThrow()
      const twice = print(parse(once).query)
      expect(twice, `unstable for ${JSON.stringify(source.slice(0, 40))}`).toBe(once)
    }
  })

  it('finishes quickly even on pathological nesting', () => {
    const start = performance.now()
    parse('('.repeat(2000) + ')'.repeat(2000) + ';')
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('compilation survives anything the parser produced', () => {
  const ctx = {
    viewport: { south: 1, west: 2, north: 3, east: 4 },
    geocodeArea: async () => ({ areaId: 1, displayName: 'x' }),
  }

  it('either compiles or refuses, but never throws something unexpected', async () => {
    for (const source of NASTY_QUERIES) {
      const { query } = parse(source)
      try {
        await compile(query, ctx)
      } catch (err) {
        // A CompileError is the designed outcome; anything else is a bug.
        expect(err).toBeInstanceOf(Error)
      }
    }
  })
})

describe('shared links', () => {
  const NASTY_HASHES = [
    '',
    '#',
    '#q=',
    '#q=!!!not-base64!!!',
    '#q=AAAA',
    '#q=' + 'A'.repeat(10_000),
    '#map=nonsense',
    '#q=abc&map=1/2',
    '#q=abc&map=a/b/c',
    '#query=%7B%7D',
    '#q=%E0%A4%A',
    '#' + '&'.repeat(1000),
  ]

  for (const hash of NASTY_HASHES) {
    it(`does not throw on ${JSON.stringify(hash.slice(0, 30))}`, () => {
      expect(() => decodeHash(hash)).not.toThrow()
    })
  }

  it('returns a usable query or nothing, never a half-decoded one', () => {
    for (const hash of NASTY_HASHES) {
      const state = decodeHash(hash)
      if (state) expect(typeof state.query).toBe('string')
    }
  })
})

describe('dropped files', () => {
  const NASTY_FILES = [
    '',
    'not json',
    '{}',
    '[]',
    'null',
    '{"format":"overpassai.project"}',
    '{"format":"overpassai.project","version":1}',
    '{"format":"wrong","source":"out;"}',
    '{"type":"FeatureCollection","features":[]}',
    '{"format":"overpassai.project","version":1,"source":"out;","result":"not an object"}',
    '{"format":"overpassai.project","version":1,"source":"out;","view":"nonsense"}',
  ]

  for (const [index, text] of NASTY_FILES.entries()) {
    it(`case ${index} either opens or explains itself`, () => {
      try {
        const project = parseProjectJson(text)
        expect(typeof project.source).toBe('string')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message.length).toBeGreaterThan(10)
      }
    })
  }
})

describe('a corrupted library', () => {
  it('reads as empty rather than throwing', () => {
    localStorage.setItem('overpassai.library.v1', 'not json at all')
    expect(library.list()).toEqual([])
  })

  it('ignores entries that are not queries', () => {
    localStorage.setItem(
      'overpassai.library.v1',
      JSON.stringify([{ id: 'a', source: 'out;' }, null, 42, { nope: true }]),
    )
    expect(library.list()).toHaveLength(1)
  })

  it('refuses an import that is not a library, with an explanation', () => {
    for (const text of ['', 'null', '{}', '[]', '{"format":"other"}']) {
      expect(() => library.importLibrary(text)).toThrow(library.LibraryError)
    }
  })
})

describe('malformed server responses', () => {
  const NASTY_RESPONSES: unknown[] = [
    {},
    { elements: null },
    { elements: 'nope' },
    { elements: [null, undefined, 42, 'x'] },
    { elements: [{ type: 'node' }] },
    { elements: [{ type: 'node', id: 1 }] },
    { elements: [{ type: 'way', id: 1, nodes: [99] }] },
    { elements: [{ type: 'way', id: 1, geometry: [] }] },
    { elements: [{ type: 'way', id: 1, geometry: [null, null] }] },
    { elements: [{ type: 'relation', id: 1, members: [] }] },
    { elements: [{ type: 'relation', id: 1, tags: { type: 'multipolygon' }, members: null }] },
    { elements: [{ type: 'unknown', id: 1 }] },
  ]

  for (const [index, response] of NASTY_RESPONSES.entries()) {
    it(`case ${index} converts without throwing`, () => {
      expect(() => osmToGeoJSON(response as never)).not.toThrow()
      const { geojson } = osmToGeoJSON(response as never)
      expect(geojson.type).toBe('FeatureCollection')
      expect(Array.isArray(geojson.features)).toBe(true)
    })
  }

  it('never emits a feature without geometry', () => {
    for (const response of NASTY_RESPONSES) {
      const { geojson } = osmToGeoJSON(response as never)
      for (const feature of geojson.features) {
        expect(feature.geometry, 'a feature was emitted with no geometry').toBeTruthy()
      }
    }
  })
})
