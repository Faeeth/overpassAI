/**
 * A stand-in Overpass server.
 *
 * Deliberately a `fetch` stub rather than a container: the point of these
 * tests is the *shapes* Overpass answers with, and those are fixed strings.
 * Running the real thing would make the suite slow, non-deterministic and
 * dependent on someone else's uptime, while testing nothing extra. The real
 * server is still used as a syntax oracle, but by `scripts/validate-syntax.mjs`
 * on demand, not by the test run.
 *
 * The error bodies here are copied from real responses, including the HTML
 * page Overpass returns with HTTP 200 for a query it could not parse, which is
 * the single most misleading thing about the API.
 */

import { vi } from 'vitest'

export interface MockResponse {
  status?: number
  contentType?: string
  body: string
  /** Milliseconds to wait before answering, for cancellation tests. */
  delayMs?: number
}

export interface RecordedRequest {
  url: string
  /** The query, pulled back out of the form body. */
  query: string
}

export interface MockServer {
  /** Every request the client made, in order. */
  requests: RecordedRequest[]
  /** Queues one response; the next request takes the next queued reply. */
  reply: (response: MockResponse) => void
  /** Answers every request with this until told otherwise. */
  always: (response: MockResponse) => void
  restore: () => void
}

/** Installs the stub over global fetch and returns the handle to drive it. */
export function mockOverpass(): MockServer {
  const requests: RecordedRequest[] = []
  const queue: MockResponse[] = []
  let standing: MockResponse | null = null

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = typeof init?.body === 'string' ? init.body : ''
    const query = new URLSearchParams(body).get('data') ?? ''
    requests.push({ url, query })

    const next = queue.shift() ?? standing
    if (!next) {
      throw new Error(`mock Overpass had no reply queued for:\n${query}`)
    }

    if (next.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, next.delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    }

    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    return new Response(next.body, {
      status: next.status ?? 200,
      headers: { 'content-type': next.contentType ?? 'application/json' },
    })
  }

  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(impl as typeof fetch)

  return {
    requests,
    reply: (response) => queue.push(response),
    always: (response) => {
      standing = response
    },
    restore: () => spy.mockRestore(),
  }
}

// ---------------------------------------------------------------------------
// Canned responses
// ---------------------------------------------------------------------------

/** A successful JSON answer holding the given elements. */
export function jsonResponse(elements: unknown[]): MockResponse {
  return {
    body: JSON.stringify({
      version: 0.6,
      generator: 'Overpass API 0.7.62',
      osm3s: { timestamp_osm_base: '2026-09-18T00:00:00Z' },
      elements,
    }),
  }
}

/**
 * The HTML page Overpass returns for a query it cannot parse.
 *
 * Note the status: 200. Trusting the status code here is the mistake that
 * makes a syntax error look like an empty result.
 */
export function parseErrorResponse(line = 2, detail = "']' expected"): MockResponse {
  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<?xml version="1.0" encoding="UTF-8" ?>
<osm-derived>
<note>The data included in this document is from www.openstreetmap.org.</note>
<html>
<body>
<p>Error: line ${line}: parse error: ${detail} </p>
<p>Error: line ${line}: parse error: Unknown type "&quot;&quot;" </p>
</body>
</html>
</osm-derived>`,
  }
}

/** The JSON body Overpass returns when a query exceeds its timeout. */
export function timeoutRemarkResponse(): MockResponse {
  return {
    body: JSON.stringify({
      version: 0.6,
      generator: 'Overpass API 0.7.62',
      elements: [],
      remark: 'runtime error: Query timed out in "query" at line 3 after 26 seconds.',
    }),
  }
}

/** The JSON body Overpass returns when a query exhausts its memory budget. */
export function memoryRemarkResponse(): MockResponse {
  return {
    body: JSON.stringify({
      version: 0.6,
      elements: [],
      remark:
        'runtime error: Query run out of memory in "recurse" at line 4 using about 2048 MB of RAM.',
    }),
  }
}

/** The dispatcher page returned when every query slot is taken. */
export function busyDispatcherResponse(): MockResponse {
  return {
    status: 504,
    contentType: 'text/html',
    body: `<html><body>
<p>Error: runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.</p>
</body></html>`,
  }
}

/** The response when the client has used all its slots. */
export function rateLimitedResponse(): MockResponse {
  return {
    status: 429,
    contentType: 'text/html',
    body: '<html><body><p>Error: too many requests</p></body></html>',
  }
}

/** A CSV answer, for the non-JSON output path. */
export function csvResponse(): MockResponse {
  return {
    contentType: 'text/csv; charset=utf-8',
    body: 'name\tamenity\nCafe Central\tcafe\nLe Pain Quotidien\tcafe\n',
  }
}
