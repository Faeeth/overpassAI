/**
 * The whole run pipeline, against a stand-in server.
 *
 * This is the path a user actually exercises: blocks or text, to a validated
 * tree, to expanded Overpass QL, to a request, to GeoJSON on the map. Each
 * piece has its own unit tests; these check that they fit together, and in
 * particular that nothing invalid ever reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeFilter, makeQuery, makeStatement } from '../../core/factory'
import { parseQuery } from '../../core/parser'
import {
  busyDispatcherResponse,
  csvResponse,
  jsonResponse,
  mockOverpass,
  parseErrorResponse,
  timeoutRemarkResponse,
  type MockServer,
} from '../../services/__tests__/mockOverpass'
import { useResultStore } from '../useResultStore'

vi.mock('../../services/nominatim', () => ({
  geocodeArea: vi.fn(async (query: string) => {
    if (query === 'Nowhereville') throw new Error(`No place matches "${query}".`)
    return { areaId: 3_600_120_965, displayName: `${query}, France` }
  }),
  search: vi.fn(async () => []),
}))

const ENDPOINT = 'https://example.test/api/interpreter'
const VIEWPORT = { south: 45.7, west: 4.8, north: 45.8, east: 4.9 }

let server: MockServer

beforeEach(() => {
  server = mockOverpass()
  useResultStore.setState({ status: 'idle', data: null, error: null, abort: null })
})

afterEach(() => {
  server.restore()
})

function run(source: string) {
  return useResultStore.getState().run(parseQuery(source), {
    endpoint: ENDPOINT,
    viewport: VIEWPORT,
  })
}

const SAMPLE_ELEMENTS = [
  { type: 'node', id: 1, lat: 45.75, lon: 4.85, tags: { amenity: 'cafe', name: 'Chez Paul' } },
  { type: 'node', id: 2, lat: 45.76, lon: 4.86, tags: { amenity: 'cafe' } },
]

describe('a query that works', () => {
  it('sends it and maps the result', async () => {
    server.reply(jsonResponse(SAMPLE_ELEMENTS))

    await run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')

    const state = useResultStore.getState()
    expect(state.status).toBe('done')
    expect(state.error).toBeNull()
    expect(state.data?.geojson.features).toHaveLength(2)
    expect(state.data?.stats.nodes).toBe(2)
    expect(state.data?.geojson.features[0].properties?.name).toBe('Chez Paul')
  })

  it('keeps the query it actually sent, for the "sent query" tab', async () => {
    server.reply(jsonResponse([]))

    await run('[out:json];node["amenity"="cafe"]({{bbox}});out;')

    const sent = server.requests[0].query
    expect(sent).not.toContain('{{bbox}}')
    expect(sent).toContain('45.7,4.8,45.8,4.9')
    expect(useResultStore.getState().data?.compiledSource).toBe(sent)
  })

  it('expands a geocoded place into an area id', async () => {
    server.reply(jsonResponse([]))

    await run('[out:json];{{geocodeArea:Lyon}}->.a;node["amenity"](area.a);out;')

    const sent = server.requests[0].query
    expect(sent).not.toContain('geocodeArea')
    expect(sent).toContain('area(id:3600120965)->.a;')
    expect(useResultStore.getState().data?.geocoded[0].displayName).toBe('Lyon, France')
  })

  it('leaves muted blocks out of what is sent', async () => {
    server.reply(jsonResponse([]))

    const query = parseQuery(
      '[out:json];node["amenity"="bar"](45.7,4.8,45.8,4.9);node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;',
    )
    query.statements[0].disabled = true

    await useResultStore.getState().run(query, { endpoint: ENDPOINT, viewport: VIEWPORT })

    expect(server.requests[0].query).not.toContain('bar')
    expect(server.requests[0].query).toContain('cafe')
  })

  it('handles a CSV response without pretending it is geometry', async () => {
    server.reply(csvResponse())

    await run('[out:csv("name")];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')

    const state = useResultStore.getState()
    expect(state.status).toBe('done')
    expect(state.data?.csv).toContain('Cafe Central')
    expect(state.data?.geojson.features).toHaveLength(0)
  })
})

describe('nothing invalid reaches the network', () => {
  it('refuses a block with an empty tag key', async () => {
    const query = makeQuery('nwr')
    query.filters.push(makeFilter('tag'))

    await useResultStore.getState().run(
      { settings: { format: 'json', timeout: 25 }, statements: [query, makeStatement('out')] },
      { endpoint: ENDPOINT, viewport: VIEWPORT },
    )

    const state = useResultStore.getState()
    expect(server.requests).toHaveLength(0)
    expect(state.error?.stage).toBe('validate')
    expect(state.error?.issues?.[0].message).toMatch(/no key/i)
  })

  it('refuses an id filter with no ids', async () => {
    const query = makeQuery('nwr')
    query.filters.push(makeFilter('ids'))

    await useResultStore.getState().run(
      { settings: { format: 'json', timeout: 25 }, statements: [query, makeStatement('out')] },
      { endpoint: ENDPOINT, viewport: VIEWPORT },
    )

    expect(server.requests).toHaveLength(0)
    expect(useResultStore.getState().error?.stage).toBe('validate')
  })

  it('refuses a query with no output block', async () => {
    await run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);')

    expect(server.requests).toHaveLength(0)
    expect(useResultStore.getState().error?.issues?.[0].message).toMatch(/no output block/i)
  })

  it('refuses a reference to a set nothing creates', async () => {
    await run('[out:json];node.nosuchset["amenity"];out;')

    expect(server.requests).toHaveLength(0)
    expect(useResultStore.getState().error?.issues?.[0].message).toMatch(/nothing creates/i)
  })

  it('names every block that needs attention when there are several', async () => {
    const a = makeQuery('nwr')
    a.filters.push(makeFilter('tag'))
    const b = makeQuery('nwr')
    b.filters.push(makeFilter('ids'))

    await useResultStore.getState().run(
      { settings: { format: 'json', timeout: 25 }, statements: [a, b, makeStatement('out')] },
      { endpoint: ENDPOINT, viewport: VIEWPORT },
    )

    const error = useResultStore.getState().error
    expect(error?.issues).toHaveLength(2)
    expect(error?.message).toMatch(/2 blocks need attention/)
    expect(new Set(error?.issues?.map((i) => i.statementId))).toEqual(new Set([a.id, b.id]))
  })

  it('still runs a query that only has warnings', async () => {
    server.reply(jsonResponse([]))

    // No area constraint: a warning, because it is legal and occasionally
    // deliberate, but not something to refuse.
    await run('[out:json];node["amenity"="cafe"];out;')

    expect(server.requests).toHaveLength(1)
    expect(useResultStore.getState().status).toBe('done')
  })
})

describe('failures surface with the stage that failed', () => {
  it('reports a server parse error with the lines it named', async () => {
    server.reply(parseErrorResponse(3))

    await run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')

    const error = useResultStore.getState().error
    expect(error?.stage).toBe('request')
    expect(error?.kind).toBe('syntax')
    expect(error?.lines).toEqual([3])
  })

  it('reports a timeout so the panel can offer to raise it', async () => {
    server.reply(timeoutRemarkResponse())

    await run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')

    expect(useResultStore.getState().error?.kind).toBe('timeout')
  })

  it('reports a busy server so the panel can offer another one', async () => {
    server.reply(busyDispatcherResponse())

    await run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')

    expect(useResultStore.getState().error?.kind).toBe('timeout')
  })

  it('reports a place that cannot be found, without sending anything', async () => {
    await run('[out:json];{{geocodeArea:Nowhereville}}->.a;node(area.a);out;')

    const state = useResultStore.getState()
    expect(server.requests).toHaveLength(0)
    expect(state.error?.stage).toBe('compile')
    expect(state.error?.message).toMatch(/Nowhereville/)
  })

  it('reports a map-view query when the map has no position yet', async () => {
    await useResultStore
      .getState()
      .run(parseQuery('[out:json];node["amenity"]({{bbox}});out;'), { endpoint: ENDPOINT })

    const state = useResultStore.getState()
    expect(server.requests).toHaveLength(0)
    expect(state.error?.stage).toBe('compile')
    expect(state.error?.message).toMatch(/map has no position/i)
  })
})

describe('cancelling', () => {
  it('leaves no error behind when the user stops a run', async () => {
    server.reply({ ...jsonResponse([]), delayMs: 300 })

    const pending = run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')
    await vi.waitFor(() => expect(useResultStore.getState().status).toBe('running'))
    useResultStore.getState().cancel()
    await pending

    const state = useResultStore.getState()
    expect(state.status).toBe('idle')
    expect(state.error).toBeNull()
  })

  it('a second run supersedes the first', async () => {
    server.reply({ ...jsonResponse([]), delayMs: 200 })
    server.reply(jsonResponse(SAMPLE_ELEMENTS))

    const first = run('[out:json];node["amenity"="bar"](45.7,4.8,45.8,4.9);out;')
    await vi.waitFor(() => expect(useResultStore.getState().status).toBe('running'))
    const second = run('[out:json];node["amenity"="cafe"](45.7,4.8,45.8,4.9);out;')

    await Promise.all([first, second])

    const state = useResultStore.getState()
    expect(state.status).toBe('done')
    expect(state.data?.geojson.features).toHaveLength(2)
  })
})
