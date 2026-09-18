import { afterEach, describe, expect, it, vi } from 'vitest'

import { OverpassError, runQuery } from '../overpass'
import {
  busyDispatcherResponse,
  csvResponse,
  jsonResponse,
  memoryRemarkResponse,
  mockOverpass,
  parseErrorResponse,
  rateLimitedResponse,
  timeoutRemarkResponse,
  type MockServer,
} from './mockOverpass'

let server: MockServer

afterEach(() => {
  server?.restore()
})

function start(): MockServer {
  server = mockOverpass()
  return server
}

const QUERY = '[out:json];node["amenity"="cafe"](50,7,51,8);out;'

describe('sending a query', () => {
  it('posts the query as a form field', async () => {
    const mock = start()
    mock.reply(jsonResponse([]))

    await runQuery(QUERY, { endpoint: 'https://example.test/api/interpreter' })

    expect(mock.requests).toHaveLength(1)
    expect(mock.requests[0].url).toBe('https://example.test/api/interpreter')
    // Sent as a form field rather than a raw body, which keeps the request a
    // CORS simple request and avoids a preflight round trip.
    expect(mock.requests[0].query).toBe(QUERY)
  })

  it('returns parsed JSON and timing', async () => {
    const mock = start()
    mock.reply(jsonResponse([{ type: 'node', id: 1, lat: 50.1, lon: 7.1, tags: { amenity: 'cafe' } }]))

    const result = await runQuery(QUERY)

    expect(result.contentType).toContain('json')
    expect((result.data as { elements: unknown[] }).elements).toHaveLength(1)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes CSV through untouched', async () => {
    const mock = start()
    mock.reply(csvResponse())

    const result = await runQuery(QUERY)

    expect(result.contentType).toContain('csv')
    expect(result.data).toContain('Cafe Central')
  })
})

describe('failures are classified, not lumped together', () => {
  it('reads a parse error out of an HTML page returned with status 200', async () => {
    const mock = start()
    mock.reply(parseErrorResponse(2, "']' expected"))

    // The status says 200 and the body is HTML. Trusting the status here is
    // what makes a syntax error look like an empty result.
    const error = await runQuery(QUERY).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(OverpassError)
    expect((error as OverpassError).kind).toBe('syntax')
    expect((error as OverpassError).message).toContain('parse error')
    expect((error as OverpassError).lines).toEqual([2])
  })

  it('reports several complained-about lines', async () => {
    const mock = start()
    mock.reply({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><p>Error: line 3: parse error</p><p>Error: line 7: parse error</p></body></html>',
    })

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.lines).toEqual([3, 7])
  })

  it('classifies a timeout remark', async () => {
    const mock = start()
    mock.reply(timeoutRemarkResponse())

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.kind).toBe('timeout')
    expect(error.hint).toMatch(/timeout|area|filters/i)
  })

  it('classifies an out-of-memory remark', async () => {
    const mock = start()
    mock.reply(memoryRemarkResponse())

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.kind).toBe('memory')
  })

  it('classifies a busy dispatcher as a timeout, not a generic failure', async () => {
    const mock = start()
    mock.reply(busyDispatcherResponse())

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.kind).toBe('timeout')
    expect(error.message).toMatch(/too busy/i)
  })

  it('classifies rate limiting', async () => {
    const mock = start()
    mock.reply(rateLimitedResponse())

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.kind).toBe('rate-limit')
    expect(error.hint).toMatch(/wait|another server/i)
  })

  it('reports an unreachable server as a network problem', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.kind).toBe('network')
    expect(error.hint).toMatch(/connection|another server/i)

    spy.mockRestore()
  })

  it('reports malformed JSON rather than throwing a SyntaxError', async () => {
    const mock = start()
    mock.reply({ body: '{not json' })

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error).toBeInstanceOf(OverpassError)
    expect(error.kind).toBe('server')
  })

  it('surfaces a plain-text error body', async () => {
    const mock = start()
    mock.reply({ status: 400, contentType: 'text/plain', body: 'line 1: parse error: bad token' })

    const error = (await runQuery(QUERY).catch((e: unknown) => e)) as OverpassError
    expect(error.message).toContain('parse error')
  })
})

describe('cancellation', () => {
  it('reports an aborted request distinctly, so it is not shown as a failure', async () => {
    const mock = start()
    mock.reply({ ...jsonResponse([]), delayMs: 500 })

    const controller = new AbortController()
    const pending = runQuery(QUERY, { signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()

    const error = (await pending) as OverpassError
    expect(error.kind).toBe('aborted')
  })
})
