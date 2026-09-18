/**
 * Structural edits on the statement tree.
 *
 * Every function here mutates a draft the caller already owns, which the store
 * produces with `structuredClone`. Keeping the mutations in one place means
 * the block editor never reaches into the tree itself, and drag and drop
 * between containers is a `detach` followed by an `insertAt`.
 */

import type { OverpassQuery, Statement } from './ast'

/** Where a statement sits: `null` parent means the top level. */
export interface Location {
  parentId: string | null
  /** For a difference, which of its two slots. */
  slot?: 'left' | 'right'
  index: number
}

/** The child list a container holds, or null if the statement is not one. */
export function childListOf(stmt: Statement): Statement[] | null {
  if (stmt.kind === 'union') return stmt.items
  if (stmt.kind === 'foreach') return stmt.body
  return null
}

export function findStatement(query: OverpassQuery, id: string): Statement | null {
  let found: Statement | null = null

  walk(query.statements, (stmt) => {
    if (stmt.id === id) {
      found = stmt
      return false
    }
    return true
  })

  return found
}

/** Depth-first walk; return false from `visit` to stop descending. */
export function walk(
  statements: Statement[],
  visit: (stmt: Statement) => boolean | void,
): void {
  for (const stmt of statements) {
    if (visit(stmt) === false) return
    const children = childListOf(stmt)
    if (children) {
      walk(children, visit)
      continue
    }
    if (stmt.kind === 'difference') {
      const slots = [stmt.left, stmt.right].filter((s): s is Statement => s !== null)
      walk(slots, visit)
    }
  }
}

export function locate(query: OverpassQuery, id: string): Location | null {
  return search(query.statements, null)

  function search(list: Statement[], parentId: string | null): Location | null {
    for (const [index, stmt] of list.entries()) {
      if (stmt.id === id) return { parentId, index }

      const children = childListOf(stmt)
      if (children) {
        const nested = search(children, stmt.id)
        if (nested) return nested
        continue
      }

      if (stmt.kind === 'difference') {
        if (stmt.left?.id === id) return { parentId: stmt.id, slot: 'left', index: 0 }
        if (stmt.right?.id === id) return { parentId: stmt.id, slot: 'right', index: 0 }
        for (const [slot, child] of [
          ['left', stmt.left],
          ['right', stmt.right],
        ] as const) {
          if (!child) continue
          const nested = search([child], stmt.id)
          if (nested && nested.parentId === stmt.id) {
            return { parentId: stmt.id, slot, index: 0 }
          }
          if (nested) return nested
        }
      }
    }
    return null
  }
}

/** The mutable list a location points into, or null for a difference slot. */
export function listAt(query: OverpassQuery, parentId: string | null): Statement[] | null {
  if (parentId === null) return query.statements
  const parent = findStatement(query, parentId)
  return parent ? childListOf(parent) : null
}

/** Removes a statement, returning it so it can be reinserted elsewhere. */
export function detach(query: OverpassQuery, id: string): Statement | null {
  const location = locate(query, id)
  if (!location) return null

  if (location.slot) {
    const parent = findStatement(query, location.parentId as string)
    if (parent?.kind !== 'difference') return null
    const removed = parent[location.slot]
    parent[location.slot] = null
    return removed
  }

  const list = listAt(query, location.parentId)
  if (!list) return null
  return list.splice(location.index, 1)[0] ?? null
}

export function insertAt(
  query: OverpassQuery,
  parentId: string | null,
  index: number,
  stmt: Statement,
): boolean {
  const list = listAt(query, parentId)
  if (!list) return false
  list.splice(Math.max(0, Math.min(index, list.length)), 0, stmt)
  return true
}

export function setSlot(
  query: OverpassQuery,
  differenceId: string,
  slot: 'left' | 'right',
  stmt: Statement | null,
): boolean {
  const parent = findStatement(query, differenceId)
  if (parent?.kind !== 'difference') return false
  parent[slot] = stmt
  return true
}

/**
 * Moves a statement to a new parent and index.
 *
 * Refuses to move a container into itself, which would detach the subtree from
 * the tree and lose it.
 */
export function move(
  query: OverpassQuery,
  id: string,
  parentId: string | null,
  index: number,
): boolean {
  if (parentId !== null && (parentId === id || isDescendant(query, id, parentId))) {
    return false
  }

  const from = locate(query, id)
  if (!from) return false

  const stmt = detach(query, id)
  if (!stmt) return false

  // Removing an earlier sibling shifts the target index down by one.
  const adjusted =
    from.parentId === parentId && !from.slot && from.index < index ? index - 1 : index

  if (!insertAt(query, parentId, adjusted, stmt)) {
    // Put it back rather than dropping it on the floor.
    insertAt(query, from.parentId, from.index, stmt)
    return false
  }
  return true
}

/** True when `candidateId` sits anywhere inside the subtree rooted at `id`. */
export function isDescendant(query: OverpassQuery, id: string, candidateId: string): boolean {
  const root = findStatement(query, id)
  if (!root) return false

  let found = false
  const children = childListOf(root)
  const branches = children ?? (root.kind === 'difference'
    ? [root.left, root.right].filter((s): s is Statement => s !== null)
    : [])

  walk(branches, (stmt) => {
    if (stmt.id === candidateId) {
      found = true
      return false
    }
    return true
  })

  return found
}

/** Replaces a statement in place, keeping its position. */
export function replace(query: OverpassQuery, id: string, next: Statement): boolean {
  const location = locate(query, id)
  if (!location) return false

  if (location.slot) {
    return setSlot(query, location.parentId as string, location.slot, next)
  }

  const list = listAt(query, location.parentId)
  if (!list) return false
  list[location.index] = next
  return true
}

/** Every set name the query defines, for the "input set" pickers. */
export function definedSets(query: OverpassQuery): string[] {
  const names = new Set<string>()
  walk(query.statements, (stmt) => {
    if ('into' in stmt && stmt.into) names.add(stmt.into)
  })
  return [...names].sort()
}

/** A name that does not collide with any set the query already defines. */
export function uniqueSetName(query: OverpassQuery, base = 'result'): string {
  const taken = new Set(definedSets(query))
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}${Date.now()}`
}
