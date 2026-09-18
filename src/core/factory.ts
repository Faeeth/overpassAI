/**
 * Constructors for AST nodes.
 *
 * Every node needs a unique, stable id. Ids live only in memory: they are the
 * React keys and drag and drop handles for the block editor, and are never
 * emitted to the query text.
 */

import type {
  Filter,
  FilterKind,
  NodeId,
  OutStatement,
  QueryStatement,
  QueryType,
  Statement,
  StatementKind,
  UnionStatement,
} from './ast'

let counter = 0

/** Fresh id, monotonically increasing within the session. */
export function newId(): NodeId {
  counter += 1
  return `n${counter.toString(36)}`
}

/** Deep copy of a subtree with brand new ids, for duplicating a block. */
export function cloneWithNewIds<T extends Statement | Filter>(node: T): T {
  const copy = structuredClone(node) as T
  reassignIds(copy as unknown as Record<string, unknown>)
  return copy
}

function reassignIds(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) reassignIds(item)
    return
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.id === 'string' && typeof obj.kind === 'string') obj.id = newId()
    for (const key of Object.keys(obj)) {
      if (key !== 'id') reassignIds(obj[key])
    }
  }
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export function makeQuery(type: QueryType = 'nwr'): QueryStatement {
  return { kind: 'query', id: newId(), type, inputSets: [], filters: [] }
}

export function makeUnion(items: Statement[] = []): UnionStatement {
  return { kind: 'union', id: newId(), items }
}

export function makeOut(): OutStatement {
  return { kind: 'out', id: newId(), verbosity: 'body', geometry: 'geom' }
}

export function makeStatement(kind: StatementKind): Statement {
  switch (kind) {
    case 'query':
      return makeQuery()
    case 'union':
      return makeUnion([makeQuery('node'), makeQuery('way')])
    case 'difference':
      return {
        kind: 'difference',
        id: newId(),
        left: makeQuery('nwr'),
        right: makeQuery('nwr'),
      }
    case 'recurse':
      return { kind: 'recurse', id: newId(), op: '>' }
    case 'out':
      return makeOut()
    case 'foreach':
      return { kind: 'foreach', id: newId(), body: [makeOut()] }
    case 'isin':
      return { kind: 'isin', id: newId() }
    case 'setref':
      return { kind: 'setref', id: newId(), set: '_' }
    case 'geocodeArea':
      return { kind: 'geocodeArea', id: newId(), query: '', into: 'searchArea' }
    case 'raw':
      return { kind: 'raw', id: newId(), text: ';' }
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export function makeTagFilter(key = '', value = ''): Filter {
  return {
    kind: 'tag',
    id: newId(),
    keyMatch: 'exact',
    key,
    op: value ? 'eq' : 'exists',
    value: value || undefined,
  }
}

export function makeFilter(kind: FilterKind): Filter {
  switch (kind) {
    case 'tag':
      return makeTagFilter()
    case 'bbox':
      return { kind: 'bbox', id: newId(), bbox: null }
    case 'area':
      return { kind: 'area', id: newId(), set: 'searchArea' }
    case 'around':
      return { kind: 'around', id: newId(), radius: 500, points: [] }
    case 'poly':
      return { kind: 'poly', id: newId(), points: '' }
    case 'ids':
      return { kind: 'ids', id: newId(), ids: [] }
    case 'recurse':
      return { kind: 'recurse', id: newId(), role: 'w' }
    case 'user':
      return { kind: 'user', id: newId(), users: [] }
    case 'uid':
      return { kind: 'uid', id: newId(), uids: [] }
    case 'newer':
      return { kind: 'newer', id: newId(), date: new Date().toISOString() }
    case 'changed':
      return { kind: 'changed', id: newId(), from: new Date().toISOString() }
    case 'pivot':
      return { kind: 'pivot', id: newId(), set: 'searchArea' }
    case 'if':
      return { kind: 'if', id: newId(), expr: '' }
    case 'raw':
      return { kind: 'raw', id: newId(), text: '' }
  }
}
