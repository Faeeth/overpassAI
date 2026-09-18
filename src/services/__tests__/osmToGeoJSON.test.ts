/**
 * Overpass JSON to GeoJSON.
 *
 * The fixtures are shaped like real responses, including the parts that trip
 * up naive converters: nodes that exist only to give a way its shape, ways
 * that are closed but are not areas, and multipolygons whose members arrive
 * unordered and arbitrarily reversed.
 */

import { describe, expect, it } from 'vitest'

import { featureTags, osmToGeoJSON, type OverpassResponse } from '../osmToGeoJSON'

function response(elements: unknown[]): OverpassResponse {
  return { version: 0.6, elements: elements as never }
}

describe('nodes', () => {
  it('turns a tagged node into a point', () => {
    const { geojson, stats } = osmToGeoJSON(
      response([{ type: 'node', id: 1, lat: 50.1, lon: 7.2, tags: { amenity: 'cafe' } }]),
    )

    expect(stats.nodes).toBe(1)
    expect(geojson.features[0].geometry).toEqual({ type: 'Point', coordinates: [7.2, 50.1] })
    expect(geojson.features[0].properties?.['@id']).toBe('node/1')
    expect(geojson.features[0].properties?.['@type']).toBe('node')
  })

  it('leaves out untagged nodes that only shape a way', () => {
    // `out body; >;` returns the way's nodes so the geometry can be built.
    // Emitting them as results would bury two real answers under hundreds of
    // meaningless points.
    const { geojson } = osmToGeoJSON(
      response([
        { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
        { type: 'node', id: 1, lat: 50.1, lon: 7.2 },
        { type: 'node', id: 2, lat: 50.2, lon: 7.3 },
        { type: 'node', id: 3, lat: 50.3, lon: 7.4 },
      ]),
    )

    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].properties?.['@type']).toBe('way')
  })

  it('keeps a tagged node that also shapes a way', () => {
    const { geojson } = osmToGeoJSON(
      response([
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
        { type: 'node', id: 1, lat: 50.1, lon: 7.2, tags: { highway: 'crossing' } },
        { type: 'node', id: 2, lat: 50.2, lon: 7.3 },
      ]),
    )

    expect(geojson.features.map((f) => f.properties?.['@id']).sort()).toEqual(['node/1', 'way/10'])
  })

  it('records a tagged node with no position as unplaced rather than dropping it', () => {
    const { geojson, unplaced, stats } = osmToGeoJSON(
      response([{ type: 'node', id: 1, tags: { amenity: 'cafe' } }]),
    )

    expect(geojson.features).toHaveLength(0)
    expect(unplaced).toHaveLength(1)
    expect(stats.withoutGeometry).toBe(1)
  })
})

describe('ways', () => {
  it('uses out geom coordinates when present', () => {
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'way',
          id: 10,
          tags: { highway: 'residential' },
          geometry: [
            { lat: 50.1, lon: 7.2 },
            { lat: 50.2, lon: 7.3 },
          ],
        },
      ]),
    )

    expect(geojson.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [7.2, 50.1],
        [7.3, 50.2],
      ],
    })
  })

  it('treats a closed way with an area tag as a polygon', () => {
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'way',
          id: 10,
          tags: { building: 'yes' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ]),
    )

    expect(geojson.features[0].geometry.type).toBe('Polygon')
  })

  it('keeps a closed way with a linear tag as a line', () => {
    // A roundabout is closed and is emphatically not an area.
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'way',
          id: 10,
          tags: { highway: 'residential', junction: 'roundabout' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ]),
    )

    expect(geojson.features[0].geometry.type).toBe('LineString')
  })

  it('honours area=no on a way that would otherwise be an area', () => {
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'way',
          id: 10,
          tags: { natural: 'water', area: 'no' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ]),
    )

    expect(geojson.features[0].geometry.type).toBe('LineString')
  })

  it('keeps a linear value of an area key as a line', () => {
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'way',
          id: 10,
          tags: { waterway: 'river' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ]),
    )

    expect(geojson.features[0].geometry.type).toBe('LineString')
  })

  it('falls back to the centre when out center was used', () => {
    const { geojson } = osmToGeoJSON(
      response([
        { type: 'way', id: 10, tags: { building: 'yes' }, center: { lat: 50.1, lon: 7.2 } },
      ]),
    )

    expect(geojson.features[0].geometry).toEqual({ type: 'Point', coordinates: [7.2, 50.1] })
  })
})

describe('relations', () => {
  it('stitches multipolygon members into rings whatever their order or direction', () => {
    // Real multipolygon members come back unordered and arbitrarily reversed.
    // Concatenating them naively produces a self-crossing shape.
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'relation',
          id: 20,
          tags: { type: 'multipolygon', natural: 'water' },
          members: [
            {
              type: 'way',
              ref: 1,
              role: 'outer',
              geometry: [
                { lat: 1, lon: 1 },
                { lat: 0, lon: 1 },
              ],
            },
            {
              type: 'way',
              ref: 2,
              role: 'outer',
              geometry: [
                { lat: 0, lon: 0 },
                { lat: 0, lon: 1 },
              ],
            },
            {
              type: 'way',
              ref: 3,
              role: 'outer',
              geometry: [
                { lat: 0, lon: 0 },
                { lat: 1, lon: 1 },
              ],
            },
          ],
        },
      ]),
    )

    const geometry = geojson.features[0].geometry
    expect(geometry.type).toBe('Polygon')
    if (geometry.type !== 'Polygon') return

    const ring = geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring).toHaveLength(4)
  })

  it('nests an inner ring inside the outer ring that contains it', () => {
    const square = (size: number, offset = 0) => [
      { lat: offset, lon: offset },
      { lat: offset, lon: offset + size },
      { lat: offset + size, lon: offset + size },
      { lat: offset + size, lon: offset },
      { lat: offset, lon: offset },
    ]

    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'relation',
          id: 20,
          tags: { type: 'multipolygon', building: 'yes' },
          members: [
            { type: 'way', ref: 1, role: 'outer', geometry: square(10) },
            { type: 'way', ref: 2, role: 'inner', geometry: square(2, 4) },
          ],
        },
      ]),
    )

    const geometry = geojson.features[0].geometry
    expect(geometry.type).toBe('Polygon')
    if (geometry.type !== 'Polygon') return
    expect(geometry.coordinates).toHaveLength(2)
  })

  it('draws a route relation as lines', () => {
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'relation',
          id: 20,
          tags: { type: 'route', route: 'bus' },
          members: [
            {
              type: 'way',
              ref: 1,
              role: '',
              geometry: [
                { lat: 0, lon: 0 },
                { lat: 1, lon: 1 },
              ],
            },
            {
              type: 'way',
              ref: 2,
              role: '',
              geometry: [
                { lat: 2, lon: 2 },
                { lat: 3, lon: 3 },
              ],
            },
          ],
        },
      ]),
    )

    expect(geojson.features[0].geometry.type).toBe('MultiLineString')
  })
})

describe('properties', () => {
  it('keeps edit metadata when out meta was used', () => {
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'node',
          id: 1,
          lat: 0,
          lon: 0,
          tags: { amenity: 'cafe' },
          version: 3,
          timestamp: '2024-05-01T10:00:00Z',
          user: 'mapper',
          uid: 42,
          changeset: 9,
        },
      ]),
    )

    expect(geojson.features[0].properties?.['@meta']).toMatchObject({
      version: 3,
      user: 'mapper',
    })
  })

  it('separates OSM tags from the properties we add', () => {
    const { geojson } = osmToGeoJSON(
      response([
        { type: 'node', id: 1, lat: 0, lon: 0, tags: { amenity: 'cafe', name: 'Chez Paul' } },
      ]),
    )

    expect(featureTags(geojson.features[0])).toEqual({ amenity: 'cafe', name: 'Chez Paul' })
  })
})

describe('edge cases', () => {
  it('handles an empty response', () => {
    const { geojson, stats } = osmToGeoJSON(response([]))
    expect(geojson.features).toHaveLength(0)
    expect(stats.total).toBe(0)
  })

  it('handles a response with no elements field at all', () => {
    const { geojson } = osmToGeoJSON({ version: 0.6 })
    expect(geojson.features).toHaveLength(0)
  })

  it('skips null entries inside a geometry array', () => {
    // Overpass writes null for nodes outside the requested bbox.
    const { geojson } = osmToGeoJSON(
      response([
        {
          type: 'way',
          id: 10,
          tags: { highway: 'residential' },
          geometry: [{ lat: 0, lon: 0 }, null, { lat: 1, lon: 1 }],
        },
      ]),
    )

    const geometry = geojson.features[0].geometry
    expect(geometry.type).toBe('LineString')
    if (geometry.type !== 'LineString') return
    expect(geometry.coordinates).toHaveLength(2)
  })

  it('counts each element kind separately', () => {
    const { stats } = osmToGeoJSON(
      response([
        { type: 'node', id: 1, lat: 0, lon: 0, tags: { a: 'b' } },
        {
          type: 'way',
          id: 2,
          tags: { a: 'b' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 1 },
          ],
        },
        {
          type: 'relation',
          id: 3,
          tags: { type: 'route' },
          members: [
            {
              type: 'way',
              ref: 2,
              role: '',
              geometry: [
                { lat: 0, lon: 0 },
                { lat: 1, lon: 1 },
              ],
            },
          ],
        },
      ]),
    )

    expect(stats).toMatchObject({ nodes: 1, ways: 1, relations: 1, total: 3 })
  })
})
