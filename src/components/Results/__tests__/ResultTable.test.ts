/**
 * Column selection and sorting.
 *
 * Both are pure functions on the feature list, so they are tested directly
 * rather than through a rendered table: the interesting behaviour is which
 * columns are chosen and where empty values end up, not the markup.
 */

import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'

import { pickColumns, sortFeatures } from '../tableColumns'

function feature(properties: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { '@id': `node/${properties.id ?? 1}`, '@type': 'node', ...properties },
  }
}

describe('choosing columns', () => {
  it('orders by how many rows carry the tag', () => {
    const features = [
      feature({ amenity: 'cafe', cuisine: 'italian' }),
      feature({ amenity: 'cafe' }),
      feature({ amenity: 'bar' }),
    ]
    expect(pickColumns(features)).toEqual(['amenity', 'cuisine'])
  })

  it('puts name first even when a technical tag is commoner', () => {
    const features = [
      feature({ amenity: 'cafe', name: 'A' }),
      feature({ amenity: 'cafe' }),
      feature({ amenity: 'cafe' }),
    ]
    expect(pickColumns(features)[0]).toBe('name')
  })

  it('leaves out the properties we added ourselves', () => {
    expect(pickColumns([feature({ amenity: 'cafe' })])).toEqual(['amenity'])
  })

  it('caps the number of columns so the table stays readable', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 40; i++) many[`tag${i}`] = 'x'
    expect(pickColumns([feature(many)]).length).toBeLessThanOrEqual(8)
  })

  it('handles features with no properties at all', () => {
    const bare: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: null,
    }
    expect(pickColumns([bare])).toEqual([])
  })
})

describe('sorting', () => {
  const features = [
    feature({ id: 1, name: 'Charlie', height: '10' }),
    feature({ id: 2, name: 'alpha', height: '9' }),
    feature({ id: 3, name: 'Bravo' }),
  ]

  it('sorts text case-insensitively', () => {
    const sorted = sortFeatures(features, { column: 'name', direction: 'asc' })
    expect(sorted.map((f) => f.properties?.name)).toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  it('reverses on descending', () => {
    const sorted = sortFeatures(features, { column: 'name', direction: 'desc' })
    expect(sorted.map((f) => f.properties?.name)).toEqual(['Charlie', 'Bravo', 'alpha'])
  })

  it('compares numbers numerically, not as text', () => {
    // As text, "10" sorts before "9", which is the classic wrong answer.
    const sorted = sortFeatures(features, { column: 'height', direction: 'asc' })
    expect(sorted.map((f) => f.properties?.height)).toEqual(['9', '10', undefined])
  })

  it('sinks rows with no value, whichever way the sort runs', () => {
    // An absent value is absent, not smallest.
    const asc = sortFeatures(features, { column: 'height', direction: 'asc' })
    const desc = sortFeatures(features, { column: 'height', direction: 'desc' })

    expect(asc[asc.length - 1].properties?.id).toBe(3)
    expect(desc[desc.length - 1].properties?.id).toBe(3)
  })

  it('does not mutate the list it was given', () => {
    const original = [...features]
    sortFeatures(features, { column: 'name', direction: 'desc' })
    expect(features).toEqual(original)
  })

  it('sorts by the columns we add, such as the OSM id', () => {
    const sorted = sortFeatures(features, { column: '@id', direction: 'desc' })
    expect(sorted[0].properties?.['@id']).toBe('node/3')
  })
})
