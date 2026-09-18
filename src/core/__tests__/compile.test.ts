/**
 * The expansion step, which is the last thing to touch a query before it is
 * sent. A bug here produces text the user never wrote and cannot see in the
 * editor, so every corpus entry is compiled and the output is re-parsed: if
 * the compiler emits something our own parser rejects, the server certainly
 * will too.
 */

import { describe, expect, it } from 'vitest'

import { CompileError, compile } from '../compile'
import { makeStatement } from '../factory'
import { parse, parseQuery } from '../parser'
import { validate } from '../validate'
import { CORPUS } from './corpus'

const VIEWPORT = { south: 45.7, west: 4.8, north: 45.8, east: 4.9 }

const ctx = {
  viewport: VIEWPORT,
  geocodeArea: async (query: string) => ({
    areaId: 3_600_120_965,
    displayName: `${query}, France`,
  }),
}

describe('every corpus query compiles to valid Overpass QL', () => {
  for (const entry of CORPUS) {
    it(entry.name, async () => {
      const compiled = await compile(parseQuery(entry.query), ctx)

      // No shortcut may survive: the server has never heard of them.
      expect(compiled.source, 'a template survived compilation').not.toMatch(/\{\{|\}\}/)

      // Our parser is the stand-in for the server's grammar.
      const reparsed = parse(compiled.source)
      expect(reparsed.errors, `compiled to:\n${compiled.source}`).toEqual([])

      // And the result must still be a query worth sending.
      const checked = validate(reparsed.query)
      expect(
        checked.errors.map((e) => e.message),
        `compiled to:\n${compiled.source}`,
      ).toEqual([])
    })
  }
})

describe('shortcut expansion', () => {
  it('replaces the map view with the actual viewport', async () => {
    const compiled = await compile(parseQuery('[out:json];node["a"]({{bbox}});out;'), ctx)
    expect(compiled.source).toContain('(45.7,4.8,45.8,4.9)')
  })

  it('replaces a place with an area id and reports what it matched', async () => {
    const compiled = await compile(
      parseQuery('[out:json];{{geocodeArea:Lyon}}->.city;node(area.city);out;'),
      ctx,
    )
    expect(compiled.source).toContain('area(id:3600120965)->.city;')
    expect(compiled.geocoded).toEqual([
      { query: 'Lyon', areaId: 3600120965, displayName: 'Lyon, France' },
    ])
  })

  it('looks up each distinct place once, however often it appears', async () => {
    const calls: string[] = []
    await compile(
      parseQuery(
        '[out:json];{{geocodeArea:Lyon}}->.a;{{geocodeArea:Lyon}}->.b;{{geocodeArea:Paris}}->.c;node(area.a);out;',
      ),
      {
        ...ctx,
        geocodeArea: async (query) => {
          calls.push(query)
          return { areaId: 1, displayName: query }
        },
      },
    )
    expect(calls.sort()).toEqual(['Lyon', 'Paris'])
  })

  it('drops muted blocks entirely', async () => {
    const query = parseQuery('[out:json];node["a"](45,4,46,5);node["b"](45,4,46,5);out;')
    query.statements[0].disabled = true

    const compiled = await compile(query, ctx)
    expect(compiled.source).not.toContain('"a"')
    expect(compiled.source).toContain('"b"')
  })

  it('keeps a muted block out of geocoding too', async () => {
    const calls: string[] = []
    const query = parseQuery('[out:json];{{geocodeArea:Lyon}}->.a;node["x"](45,4,46,5);out;')
    query.statements[0].disabled = true

    await compile(query, {
      ...ctx,
      geocodeArea: async (name) => {
        calls.push(name)
        return { areaId: 1, displayName: name }
      },
    })
    expect(calls).toEqual([])
  })
})

describe('compilation refuses what it cannot express', () => {
  it('fails when the map view is needed but unknown', async () => {
    await expect(
      compile(parseQuery('[out:json];node["a"]({{bbox}});out;'), {
        geocodeArea: ctx.geocodeArea,
      }),
    ).rejects.toBeInstanceOf(CompileError)
  })

  it('fails when a place cannot be found', async () => {
    await expect(
      compile(parseQuery('[out:json];{{geocodeArea:Atlantis}}->.a;node(area.a);out;'), {
        ...ctx,
        geocodeArea: async () => {
          throw new Error('No place matches "Atlantis".')
        },
      }),
    ).rejects.toThrow(/Atlantis/)
  })

  it('fails on an empty query', async () => {
    await expect(
      compile({ settings: { format: 'json' }, statements: [] }, ctx),
    ).rejects.toBeInstanceOf(CompileError)
  })

  it('fails when a difference has lost one of its inputs', async () => {
    const diff = makeStatement('difference')
    if (diff.kind !== 'difference') throw new Error('expected a difference')
    diff.right = null

    await expect(
      compile({ settings: { format: 'json' }, statements: [diff, makeStatement('out')] }, ctx),
    ).rejects.toThrow(/both of its two inputs/)
  })
})

describe('compilation preserves meaning', () => {
  it('leaves an already explicit bbox alone', async () => {
    const compiled = await compile(parseQuery('[out:json];node["a"](1,2,3,4);out;'), ctx)
    expect(compiled.source).toContain('(1,2,3,4)')
  })

  it('keeps unmodelled statements verbatim', async () => {
    const compiled = await compile(
      parseQuery('[out:json];node["a"](45,4,46,5);make stat n=count(nodes);out;'),
      ctx,
    )
    expect(compiled.source).toContain('make stat n=count(nodes);')
  })

  it('keeps the settings prologue', async () => {
    const compiled = await compile(
      parseQuery('[out:json][timeout:180][maxsize:1073741824];node["a"](45,4,46,5);out;'),
      ctx,
    )
    expect(compiled.source).toContain('[timeout:180]')
    expect(compiled.source).toContain('[maxsize:1073741824]')
  })

  it('warns rather than fails when there is no output statement', async () => {
    const compiled = await compile(parseQuery('[out:json];node["a"](45,4,46,5);'), ctx)
    expect(compiled.warnings.join(' ')).toMatch(/return nothing/i)
  })
})
