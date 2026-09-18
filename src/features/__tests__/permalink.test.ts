import { beforeEach, describe, expect, it } from 'vitest'

import * as library from '../library'
import { compress, decodeHash, decompress, encodeHash, readCurrentHash } from '../permalink'

const QUERY = `[out:json][timeout:25];
{{geocodeArea:Lyon}}->.searchArea;
nwr["amenity"="restaurant"](area.searchArea);
out geom 1000;`

describe('compression', () => {
  it('round-trips a query exactly', () => {
    expect(decompress(compress(QUERY))).toBe(QUERY)
  })

  it('round-trips non-ASCII text', () => {
    const text = 'node["name"="Zurich Hauptbahnhof"]["name:zh"="Su Li Shi"];'
    expect(decompress(compress(text))).toBe(text)
  })

  it('round-trips a long query without corruption', () => {
    const long = QUERY.repeat(400)
    expect(decompress(compress(long))).toBe(long)
  })

  it('is shorter than percent-encoding for a typical query', () => {
    expect(compress(QUERY).length).toBeLessThan(encodeURIComponent(QUERY).length)
  })

  it('produces URL-safe output', () => {
    expect(compress(QUERY)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('hash encoding', () => {
  it('carries the query and the map position', () => {
    const hash = encodeHash({ query: QUERY, view: { lat: 45.76, lon: 4.83, zoom: 12.5 } })
    const decoded = decodeHash(hash)

    expect(decoded?.query).toBe(QUERY)
    expect(decoded?.view?.lat).toBeCloseTo(45.76, 4)
    expect(decoded?.view?.zoom).toBeCloseTo(12.5, 2)
  })

  it('leaves the map fragment readable rather than percent-encoded', () => {
    const hash = encodeHash({ query: 'out;', view: { lat: 1, lon: 2, zoom: 3 } })
    expect(hash).toContain('map=3.00/1.00000/2.00000')
  })

  it('carries the chosen server and the autorun flag', () => {
    const decoded = decodeHash(encodeHash({ query: 'out;', endpoint: 'kumi', autorun: true }))
    expect(decoded?.endpoint).toBe('kumi')
    expect(decoded?.autorun).toBe(true)
  })

  it('never carries results', () => {
    // Results go in the project file. A link stays short, the recipient gets
    // fresh data, and nothing from a session ends up in someone's history.
    const hash = encodeHash({ query: QUERY })
    expect(hash).not.toMatch(/FeatureCollection|coordinates/)
  })

  it('accepts a hand-written, plainly encoded link', () => {
    const decoded = decodeHash(`#q=${encodeURIComponent('[out:json];node["a"];out;')}`)
    expect(decoded?.query).toBe('[out:json];node["a"];out;')
  })

  it('returns null for an empty or unrelated hash', () => {
    expect(decodeHash('')).toBeNull()
    expect(decodeHash('#map=12/1/2')).toBeNull()
  })

  it('ignores a malformed map fragment rather than failing', () => {
    const decoded = decodeHash(`q=${compress('out;')}&map=broken`)
    expect(decoded?.query).toBe('out;')
    expect(decoded?.view).toBeUndefined()
  })

  it('reads the hash off the current location', () => {
    window.location.hash = `#q=${compress('out;')}`
    expect(readCurrentHash()?.query).toBe('out;')
    window.location.hash = ''
  })
})

describe('the local library', () => {
  beforeEach(() => {
    library.clear()
  })

  it('saves and lists a query', () => {
    const saved = library.save({ name: 'Cafes', source: QUERY })
    expect(library.list()).toHaveLength(1)
    expect(library.get(saved.id)?.source).toBe(QUERY)
  })

  it('updates in place rather than duplicating', () => {
    const saved = library.save({ name: 'Cafes', source: 'a' })
    library.save({ id: saved.id, name: 'Cafes', source: 'b' })

    expect(library.list()).toHaveLength(1)
    expect(library.get(saved.id)?.source).toBe('b')
  })

  it('keeps the original creation date when updating', () => {
    const saved = library.save({ name: 'Cafes', source: 'a' })
    const updated = library.save({ id: saved.id, name: 'Cafes', source: 'b' })
    expect(updated.createdAt).toBe(saved.createdAt)
  })

  it('names an untitled query rather than saving a blank', () => {
    expect(library.save({ name: '   ', source: 'x' }).name).toBe('Untitled query')
  })

  it('removes and renames', () => {
    const saved = library.save({ name: 'Cafes', source: 'x' })
    library.rename(saved.id, 'Bars')
    expect(library.get(saved.id)?.name).toBe('Bars')

    library.remove(saved.id)
    expect(library.list()).toHaveLength(0)
  })

  it('exports and reimports without creating duplicates', () => {
    library.save({ name: 'A', source: 'a' })
    library.save({ name: 'B', source: 'b' })
    const exported = library.exportLibrary()

    const result = library.importLibrary(exported)
    expect(result).toEqual({ added: 0, updated: 0 })
    expect(library.list()).toHaveLength(2)
  })

  it('merges entries from another browser', () => {
    library.save({ name: 'A', source: 'a' })
    const other = JSON.stringify({
      format: 'overpassai.library',
      version: 1,
      exportedAt: new Date().toISOString(),
      queries: [
        {
          id: 'from-elsewhere',
          name: 'C',
          source: 'c',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    })

    expect(library.importLibrary(other)).toEqual({ added: 1, updated: 0 })
    expect(library.list()).toHaveLength(2)
  })

  it('keeps the newer copy when both sides changed', () => {
    const saved = library.save({ name: 'A', source: 'local' })
    const older = JSON.stringify({
      format: 'overpassai.library',
      version: 1,
      exportedAt: '2020-01-01T00:00:00Z',
      queries: [{ ...saved, source: 'stale', updatedAt: '2020-01-01T00:00:00Z' }],
    })

    library.importLibrary(older)
    expect(library.get(saved.id)?.source).toBe('local')
  })

  it('rejects a file that is not a library', () => {
    expect(() => library.importLibrary('{"type":"FeatureCollection"}')).toThrow(
      library.LibraryError,
    )
  })

  it('lists the most recently touched first', () => {
    const a = library.save({ name: 'A', source: 'a' })
    library.save({ name: 'B', source: 'b' })
    library.save({ id: a.id, name: 'A', source: 'a2' })

    expect(library.list()[0].id).toBe(a.id)
  })
})
