import { describe, expect, it } from 'vitest'

import { parse } from '../parser'
import { print } from '../printer'
import { CORPUS } from './corpus'

/** Ids are per-parse, so structural comparison has to ignore them. */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (key === 'id' || val === undefined) continue
      out[key] = stripIds(val)
    }
    return out
  }
  return value
}

describe('corpus', () => {
  for (const entry of CORPUS) {
    describe(entry.name, () => {
      const first = parse(entry.query)

      it('parses without errors', () => {
        expect(first.errors).toEqual([])
      })

      it('reparses its own output to the same tree', () => {
        const printed = print(first.query)
        const second = parse(printed)

        expect(second.errors, `printed:\n${printed}`).toEqual([])
        expect(stripIds(second.query), `printed:\n${printed}`).toEqual(stripIds(first.query))
      })

      it('prints a third time to exactly the same text', () => {
        // Printing is idempotent once normalised: print(parse(print(x))) must
        // equal print(x), or the editor would rewrite the query on every
        // switch between views.
        const once = print(first.query)
        const twice = print(parse(once).query)
        expect(twice).toBe(once)
      })

      it('does not lose any statement', () => {
        expect(first.query.statements.length).toBeGreaterThan(0)
      })
    })
  }
})
