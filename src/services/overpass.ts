/**
 * Overpass API client.
 *
 * No API key and no proxy: every public instance sends
 * `Access-Control-Allow-Origin: *`, so the browser talks to it directly.
 *
 * The awkward part is error reporting. Overpass answers a malformed query with
 * HTTP 200 and an HTML page, or with a JSON body carrying a `remark` field, so
 * the status code alone tells you almost nothing. `readError` handles all three
 * shapes and turns them into something worth showing a user.
 */

export interface OverpassEndpoint {
  id: string
  label: string
  url: string
  /** Shown in the picker so people can pick a server near them. */
  note: string
}

export const ENDPOINTS: OverpassEndpoint[] = [
  {
    id: 'de',
    label: 'overpass-api.de',
    url: 'https://overpass-api.de/api/interpreter',
    note: 'Main instance, Germany',
  },
  {
    id: 'kumi',
    label: 'Kumi Systems',
    url: 'https://overpass.kumi.systems/api/interpreter',
    note: 'Fast mirror, Austria',
  },
  {
    id: 'coffee',
    label: 'private.coffee',
    url: 'https://overpass.private.coffee/api/interpreter',
    note: 'Community mirror',
  },
  {
    id: 'osmch',
    label: 'osm.ch',
    url: 'https://overpass.osm.ch/api/interpreter',
    note: 'Switzerland',
  },
]

export const DEFAULT_ENDPOINT = ENDPOINTS[0]

export interface RunOptions {
  endpoint?: string
  signal?: AbortSignal
}

export interface RunResult {
  /** Parsed body for JSON queries, raw text for CSV. */
  data: unknown
  /** Raw response text, kept for the "server response" panel. */
  text: string
  contentType: string
  /** Round-trip time in milliseconds. */
  durationMs: number
}

export type OverpassErrorKind =
  | 'syntax'
  | 'timeout'
  | 'memory'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'aborted'

export class OverpassError extends Error {
  readonly kind: OverpassErrorKind
  /** Line numbers the server complained about, when it says. */
  readonly lines: number[]
  /** What the user can do about it. */
  readonly hint?: string

  constructor(
    message: string,
    kind: OverpassErrorKind,
    options: { lines?: number[]; hint?: string } = {},
  ) {
    super(message)
    this.name = 'OverpassError'
    this.kind = kind
    this.lines = options.lines ?? []
    this.hint = options.hint
  }
}

export async function runQuery(query: string, options: RunOptions = {}): Promise<RunResult> {
  const url = options.endpoint ?? DEFAULT_ENDPOINT.url
  const started = performance.now()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      // Sending the query as a form field rather than a raw body keeps the
      // request a CORS "simple request", avoiding a preflight round trip.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }).toString(),
      signal: options.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new OverpassError('Query cancelled.', 'aborted')
    }
    throw new OverpassError(
      'Could not reach the Overpass server.',
      'network',
      { hint: 'Check your connection, or try another server from the picker.' },
    )
  }

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const durationMs = performance.now() - started

  if (!response.ok) throw readError(response.status, text)

  // A 200 can still carry a failure, either as HTML or as a JSON remark.
  if (contentType.includes('text/html') || /^\s*</.test(text)) {
    throw readError(response.status, text)
  }

  if (contentType.includes('json')) {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new OverpassError('The server returned a malformed JSON body.', 'server')
    }
    const remark = (data as { remark?: string }).remark
    if (remark) throw fromRemark(remark)
    return { data, text, contentType, durationMs }
  }

  return { data: text, text, contentType, durationMs }
}

/** Builds a typed error from an HTTP status and a response body. */
function readError(status: number, body: string): OverpassError {
  const messages = extractMessages(body)
  const joined = messages.join(' ')

  if (status === 429) {
    return new OverpassError(
      'Too many requests: your query slots on this server are busy.',
      'rate-limit',
      { hint: 'Wait a few seconds, or switch to another server.' },
    )
  }

  if (status === 504 || /timed out|timeout/i.test(joined)) {
    return new OverpassError(
      messages[0] ?? 'The query took too long and the server gave up.',
      'timeout',
      { hint: 'Raise the timeout, shrink the search area, or add more filters.' },
    )
  }

  if (/out of memory|maxsize/i.test(joined)) {
    return new OverpassError(
      messages[0] ?? 'The query needed more memory than the server allows.',
      'memory',
      { hint: 'Narrow the area or restrict the query to fewer element types.' },
    )
  }

  if (messages.length) {
    return new OverpassError(messages.join('\n'), 'syntax', { lines: extractLines(joined) })
  }

  return new OverpassError(`The server replied with HTTP ${status}.`, 'server')
}

function fromRemark(remark: string): OverpassError {
  if (/timed out/i.test(remark)) {
    return new OverpassError(remark, 'timeout', {
      hint: 'Raise the timeout, shrink the search area, or add more filters.',
    })
  }
  if (/out of memory/i.test(remark)) {
    return new OverpassError(remark, 'memory', {
      hint: 'Narrow the area or restrict the query to fewer element types.',
    })
  }
  return new OverpassError(remark, 'server')
}

/**
 * Pulls the human-readable parts out of an Overpass HTML error page.
 *
 * The page is a short document whose useful content sits in `<p>` elements
 * prefixed with "Error:". Parsing it with DOMParser rather than a regex avoids
 * tripping over the entity-encoded query fragments it echoes back.
 */
function extractMessages(body: string): string[] {
  if (!/^\s*</.test(body)) {
    const trimmed = body.trim()
    return trimmed ? [trimmed.slice(0, 500)] : []
  }

  try {
    const doc = new DOMParser().parseFromString(body, 'text/html')
    const messages: string[] = []
    for (const p of Array.from(doc.querySelectorAll('p'))) {
      const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      if (/^error/i.test(text) || /line \d+/i.test(text)) {
        messages.push(text.replace(/^Error:\s*/i, ''))
      }
    }
    if (messages.length) return messages

    const fallback = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
    return fallback ? [fallback.slice(0, 500)] : []
  } catch {
    return [body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)]
  }
}

function extractLines(text: string): number[] {
  const lines = new Set<number>()
  for (const match of text.matchAll(/line (\d+)/gi)) {
    const value = Number(match[1])
    if (Number.isFinite(value)) lines.add(value)
  }
  return [...lines].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

export interface ServerStatus {
  /** Queries this client may still start right now. */
  availableSlots: number
  /** Epoch seconds at which the next slot frees up. */
  nextSlotAt: number | null
  runningQueries: number
}

/**
 * Reads the `/api/status` endpoint so the UI can say why a run is queued.
 * Returns `null` when the server does not expose it or the format changes.
 */
export async function fetchStatus(endpointUrl: string): Promise<ServerStatus | null> {
  const statusUrl = endpointUrl.replace(/\/interpreter\/?$/, '/status')
  try {
    const response = await fetch(statusUrl)
    if (!response.ok) return null
    const text = await response.text()

    const slots = /(\d+) slots available now/.exec(text)
    const running = /(\d+) queries? running/.exec(text)
    const waits = [...text.matchAll(/in (\d+) seconds/g)].map((m) => Number(m[1]))

    return {
      availableSlots: slots ? Number(slots[1]) : 0,
      nextSlotAt: waits.length ? Date.now() / 1000 + Math.min(...waits) : null,
      runningQueries: running ? Number(running[1]) : 0,
    }
  } catch {
    return null
  }
}
