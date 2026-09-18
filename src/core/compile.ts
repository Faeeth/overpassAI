/**
 * Turns the user-facing AST into a query the Overpass server will accept.
 *
 * The editor keeps convenience shortcuts in the tree because they are what the
 * block editor exposes: "inside the current map view" and "inside a place
 * called Lyon" are the two things people actually want. Neither exists in
 * Overpass QL, so they are expanded here, immediately before sending:
 *
 *  - `{{bbox}}`               becomes the map viewport as an explicit bbox
 *  - `{{geocodeArea:Lyon}}`   becomes `area(id:3600120965)`, via the geocoder
 *  - muted blocks             are removed entirely
 */

import type { BBox, OverpassQuery, Statement } from './ast'
import { newId } from './factory'
import { print } from './printer'

export interface GeocodeResult {
  areaId: number
  displayName: string
}

export interface CompileContext {
  /** Current map viewport, substituted for every `{{bbox}}`. */
  viewport?: BBox
  /** Resolves a place name to an OSM area id. */
  geocodeArea: (query: string) => Promise<GeocodeResult>
}

export interface CompiledQuery {
  /** Overpass QL, ready to POST. */
  source: string
  /** Places resolved while compiling, so the UI can show what was matched. */
  geocoded: Array<GeocodeResult & { query: string }>
  /** Non-fatal problems worth surfacing next to the run button. */
  warnings: string[]
}

export class CompileError extends Error {}

export async function compile(
  query: OverpassQuery,
  ctx: CompileContext,
): Promise<CompiledQuery> {
  const warnings: string[] = []
  const geocoded: CompiledQuery['geocoded'] = []

  // Resolve every distinct place name once, in parallel, before rewriting.
  const names = new Set<string>()
  forEachStatement(query.statements, (stmt) => {
    if (stmt.kind === 'geocodeArea' && !stmt.disabled && stmt.query.trim()) {
      names.add(stmt.query.trim())
    }
  })

  const areas = new Map<string, GeocodeResult>()
  await Promise.all(
    [...names].map(async (name) => {
      const result = await ctx.geocodeArea(name)
      areas.set(name, result)
      geocoded.push({ query: name, ...result })
    }),
  )

  const statements = rewrite(query.statements)
  if (!statements.length) {
    throw new CompileError('The query is empty. Add at least one block.')
  }
  if (!hasOutput(statements)) {
    warnings.push('No "out" block: the server will return nothing.')
  }

  return {
    source: print({ settings: query.settings, statements }),
    geocoded,
    warnings,
  }

  function rewrite(list: Statement[]): Statement[] {
    const out: Statement[] = []

    for (const stmt of list) {
      if (stmt.disabled) continue

      switch (stmt.kind) {
        case 'geocodeArea': {
          const name = stmt.query.trim()
          if (!name) {
            warnings.push('A place block has no name and was skipped.')
            continue
          }
          const area = areas.get(name)
          if (!area) {
            throw new CompileError(`Could not find a place called "${name}".`)
          }
          out.push({
            kind: 'query',
            id: newId(),
            type: 'area',
            inputSets: [],
            filters: [{ kind: 'ids', id: newId(), ids: [area.areaId] }],
            into: stmt.into,
            label: stmt.label ?? area.displayName,
          })
          continue
        }

        case 'query':
          out.push({ ...stmt, filters: stmt.filters.map(resolveFilter) })
          continue

        case 'union':
          out.push({ ...stmt, items: rewrite(stmt.items) })
          continue

        case 'foreach':
          out.push({ ...stmt, body: rewrite(stmt.body) })
          continue

        case 'difference': {
          const left = stmt.left ? rewrite([stmt.left])[0] ?? null : null
          const right = stmt.right ? rewrite([stmt.right])[0] ?? null : null
          if (!left || !right) {
            throw new CompileError('A difference block needs both of its two inputs.')
          }
          out.push({ ...stmt, left, right })
          continue
        }

        default:
          out.push(stmt)
      }
    }

    return out
  }

  function resolveFilter<T extends { kind: string }>(filter: T): T {
    if (filter.kind !== 'bbox') return filter
    const bboxFilter = filter as unknown as { bbox: BBox | null }
    if (bboxFilter.bbox) return filter
    if (!ctx.viewport) {
      throw new CompileError(
        'A block uses the current map view, but the map has no position yet.',
      )
    }
    return { ...filter, bbox: ctx.viewport }
  }
}

/** Depth-first walk over a statement list, including container children. */
export function forEachStatement(
  statements: Statement[],
  visit: (stmt: Statement) => void,
): void {
  for (const stmt of statements) {
    visit(stmt)
    switch (stmt.kind) {
      case 'union':
        forEachStatement(stmt.items, visit)
        break
      case 'foreach':
        forEachStatement(stmt.body, visit)
        break
      case 'difference':
        forEachStatement([stmt.left, stmt.right].filter((s) => s !== null), visit)
        break
      default:
        break
    }
  }
}

function hasOutput(statements: Statement[]): boolean {
  let found = false
  forEachStatement(statements, (stmt) => {
    if (stmt.kind === 'out') found = true
    if (stmt.kind === 'raw' && /\bout\b/.test(stmt.text)) found = true
  })
  return found
}
