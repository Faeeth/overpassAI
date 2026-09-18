/**
 * Syntax oracle: checks our output against a real Overpass server.
 *
 * Our parser is a stand-in for the grammar, and a stand-in can be wrong in the
 * same direction twice: if the printer emits something invalid and the parser
 * happily reads it back, the round-trip tests pass and the server still
 * rejects the query. Only the real implementation settles it.
 *
 * This is deliberately *not* part of `npm test`. It needs the network, it is
 * slow on purpose so as not to hammer a free public service, and a busy server
 * would make the suite flaky. Run it on demand:
 *
 *     npm run test:live
 *
 * Anything it finds should become an offline test in `src/core/__tests__`.
 */

import { describe, expect, it } from 'vitest'

import { compile } from '../src/core/compile'
import { parseQuery } from '../src/core/parser'
import { CORPUS } from '../src/core/__tests__/corpus'

const ENDPOINT = process.env.OVERPASS_ENDPOINT ?? 'https://overpass-api.de/api/interpreter'

/**
 * Polite spacing between requests to a free, shared service.
 *
 * Do not lower this. Running the corpus at 2.5 second intervals was enough to
 * get this client blocked by overpass-api.de for over ten minutes. If the main
 * instance refuses you, point `OVERPASS_ENDPOINT` at a mirror such as
 * https://overpass.osm.ch/api/interpreter and come back later.
 */
const GAP_MS = Number(process.env.OVERPASS_GAP_MS ?? 6000)

const ctx = {
  // A tiny viewport, so a query that reaches the server costs it almost
  // nothing: we are testing the grammar, not the data.
  viewport: { south: 50.7466, west: 7.1536, north: 50.7476, east: 7.1546 },
  geocodeArea: async (query: string) => ({
    areaId: 3_600_062_761,
    displayName: `${query} (fixed for the oracle)`,
  }),
}

/**
 * overpass-api.de answers 406 to clients that do not identify themselves, so
 * a bare Node fetch never reaches the interpreter at all. The usage policy
 * asks for an identifying User-Agent anyway.
 */
const USER_AGENT = 'OverpassAI-syntax-oracle/1.0 (https://github.com/Faeeth/overpassAI)'

interface Verdict {
  /** Set when the server rejected the query's syntax, which is our bug. */
  syntaxError?: string
  /** Set when the server accepted it but could not finish, which is not. */
  runtimeNote?: string
}

/** Thrown when the oracle cannot get a usable answer, so it never reports a false pass. */
class OracleUnavailable extends Error {}

let lastCall = 0

async function ask(query: string): Promise<Verdict> {
  const wait = GAP_MS - (Date.now() - lastCall)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastCall = Date.now()

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Accept: '*/*',
    },
    body: new URLSearchParams({ data: query }).toString(),
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''

  // A parse or static error is the server telling us our grammar is wrong.
  const complaint = /(parse error|static error|Unknown type|unexpected)[^<\n]*/i.exec(text)
  if (complaint) return { syntaxError: complaint[0].trim() }

  // These mean the query was understood and then ran out of road, which says
  // nothing about the syntax.
  if (/timed out|out of memory|too busy|Dispatcher_Client/i.test(text)) {
    return { runtimeNote: 'server was busy or the query was too heavy' }
  }

  // A `[out:csv(...)]` query answers in CSV, and an `[out:xml]` one in XML.
  // Both mean the query parsed.
  if (/csv|xml/.test(contentType) && !/<html/i.test(text)) return {}

  // Anything else non-JSON means the oracle never got to judge the query.
  // Reporting that as a pass would be worse than useless: it would be a green
  // suite that checks nothing.
  if (!/^\s*[[{]/.test(text)) {
    throw new OracleUnavailable(
      `${ENDPOINT} replied HTTP ${response.status} with a body the oracle cannot read. ` +
        `First 200 characters:\n${text.slice(0, 200)}`,
    )
  }

  return {}
}

/** Confirms the oracle is reachable and can tell good syntax from bad. */
async function selfTest(): Promise<void> {
  const good = await ask('[out:json][timeout:5];node(1);out ids;')
  if (good.syntaxError) {
    throw new OracleUnavailable(`the oracle called a valid query invalid: ${good.syntaxError}`)
  }

  const bad = await ask('[out:json][timeout:5];node[;out;')
  if (!bad.syntaxError) {
    throw new OracleUnavailable(
      'the oracle accepted a query with a deliberate syntax error, so it is not judging anything',
    )
  }
}

describe('the real server accepts what we emit', () => {
  // Without this, an unreachable or filtering server would turn the whole
  // suite green while judging nothing at all.
  it('the oracle is reachable and can tell valid from invalid', async () => {
    await selfTest()
  }, 60_000)

  for (const entry of CORPUS) {
    it(
      entry.name,
      async () => {
        const compiled = await compile(parseQuery(entry.query), ctx)
        const verdict = await ask(compiled.source)

        if (verdict.runtimeNote) {
          console.log(`   (${entry.name}: ${verdict.runtimeNote})`)
        }

        expect(
          verdict.syntaxError ?? null,
          `the server rejected the syntax of:\n${compiled.source}`,
        ).toBeNull()
      },
      60_000,
    )
  }
})
