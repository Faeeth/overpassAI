/**
 * The two-way binding between the text and the blocks.
 *
 * This is the claim the whole editor rests on, so it is checked at the level
 * the components use: a text edit must reach the tree, a tree edit must reach
 * the text, and neither may quietly lose what the other wrote.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { makeFilter, makeStatement } from '../../core/factory'
import { detach, move } from '../../core/mutate'
import { STARTER_QUERY, useQueryStore } from '../useQueryStore'

beforeEach(() => {
  useQueryStore.getState().reset()
})

describe('editing the text', () => {
  it('reaches the tree', () => {
    useQueryStore.getState().setSource('[out:json];node["amenity"="bar"](1,2,3,4);out;')

    const { ast, parseErrors, origin } = useQueryStore.getState()
    expect(parseErrors).toEqual([])
    expect(origin).toBe('text')
    expect(ast.statements[0]).toMatchObject({ kind: 'query', type: 'node' })
  })

  it('reports errors without discarding what could be read', () => {
    useQueryStore.getState().setSource('[out:json];node["amenity"="bar";out;')

    const { ast, parseErrors } = useQueryStore.getState()
    expect(parseErrors.length).toBeGreaterThan(0)
    expect(parseErrors[0].line).toBe(1)
    expect(ast.statements.length).toBeGreaterThan(0)
  })

  it('ignores a write that changes nothing', () => {
    const before = useQueryStore.getState()
    useQueryStore.getState().setSource(before.source)
    expect(useQueryStore.getState().ast).toBe(before.ast)
  })
})

describe('editing the tree', () => {
  it('reaches the text', () => {
    useQueryStore.getState().setSource('[out:json];node["amenity"="bar"](1,2,3,4);out;')
    useQueryStore.getState().updateAst((draft) => {
      const stmt = draft.statements[0]
      if (stmt.kind !== 'query') throw new Error('expected a query')
      const tag = stmt.filters[0]
      if (tag.kind !== 'tag') throw new Error('expected a tag filter')
      tag.value = 'cafe'
    })

    const { source, origin } = useQueryStore.getState()
    expect(source).toContain('"amenity"="cafe"')
    expect(source).not.toContain('bar')
    expect(origin).toBe('blocks')
  })

  it('does not mutate the previous tree, so React sees a change', () => {
    useQueryStore.getState().setSource('[out:json];node["a"](1,2,3,4);out;')
    const before = useQueryStore.getState().ast

    useQueryStore.getState().updateAst((draft) => {
      draft.statements.push(makeStatement('out'))
    })

    expect(useQueryStore.getState().ast).not.toBe(before)
    expect(before.statements).toHaveLength(2)
  })

  it('clears stale parse errors once the tree is edited', () => {
    useQueryStore.getState().setSource('[out:json];node["a";out;')
    expect(useQueryStore.getState().parseErrors.length).toBeGreaterThan(0)

    useQueryStore.getState().updateAst((draft) => {
      draft.statements = [makeStatement('out')]
    })
    expect(useQueryStore.getState().parseErrors).toEqual([])
  })
})

describe('a full round trip through both views', () => {
  it('survives text, then blocks, then text again', () => {
    const original = '[out:json][timeout:25];\nnode["amenity"="bar"](1,2,3,4);\nout geom;'
    useQueryStore.getState().setSource(original)

    useQueryStore.getState().updateAst((draft) => {
      const stmt = draft.statements[0]
      if (stmt.kind !== 'query') throw new Error('expected a query')
      stmt.filters.push(makeFilter('bbox'))
    })

    const printed = useQueryStore.getState().source
    expect(printed).toContain('{{bbox}}')

    // Reading it back must give the same tree, or the views have drifted.
    const treeAfterBlocks = useQueryStore.getState().ast
    useQueryStore.getState().setSource(printed)
    const treeAfterText = useQueryStore.getState().ast

    expect(strip(treeAfterText)).toEqual(strip(treeAfterBlocks))
  })

  it('keeps block order in step with statement order', () => {
    useQueryStore
      .getState()
      .setSource('[out:json];node["a"](1,2,3,4);node["b"](1,2,3,4);out;')

    const second = useQueryStore.getState().ast.statements[1].id
    useQueryStore.getState().updateAst((draft) => {
      move(draft, second, null, 0)
    })

    const source = useQueryStore.getState().source
    expect(source.indexOf('"b"')).toBeLessThan(source.indexOf('"a"'))
  })

  it('removing a block removes it from the text', () => {
    useQueryStore
      .getState()
      .setSource('[out:json];node["a"](1,2,3,4);node["b"](1,2,3,4);out;')

    const first = useQueryStore.getState().ast.statements[0].id
    useQueryStore.getState().updateAst((draft) => {
      detach(draft, first)
    })

    expect(useQueryStore.getState().source).not.toContain('"a"')
    expect(useQueryStore.getState().source).toContain('"b"')
  })
})

describe('loading from outside', () => {
  it('replaces everything and bumps the revision', () => {
    const before = useQueryStore.getState().revision
    useQueryStore.getState().load('[out:json];out;', { name: 'Shared' })

    const state = useQueryStore.getState()
    expect(state.name).toBe('Shared')
    expect(state.origin).toBe('external')
    expect(state.revision).toBe(before + 1)
  })

  it('prefers a stored tree, so notes and muted blocks survive a project file', () => {
    const query = { settings: { format: 'json' as const }, statements: [makeStatement('out')] }
    query.statements[0].label = 'hand written note'
    query.statements[0].disabled = true

    useQueryStore.getState().load('[out:json];out;', { ast: query })

    expect(useQueryStore.getState().ast.statements[0].label).toBe('hand written note')
    expect(useQueryStore.getState().ast.statements[0].disabled).toBe(true)
  })

  it('reset returns to the starter query', () => {
    useQueryStore.getState().setSource('[out:json];out;')
    useQueryStore.getState().reset()
    expect(useQueryStore.getState().source).toBe(STARTER_QUERY)
  })
})

describe('the starter query', () => {
  it('parses cleanly', () => {
    expect(useQueryStore.getState().parseErrors).toEqual([])
  })

  it('is made of the blocks it claims to demonstrate', () => {
    const kinds = useQueryStore.getState().ast.statements.map((s) => s.kind)
    expect(kinds).toEqual(['geocodeArea', 'query', 'out'])
  })
})

/** Structural comparison, ignoring the per-parse ids. */
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (key === 'id' || val === undefined) continue
      out[key] = strip(val)
    }
    return out
  }
  return value
}
