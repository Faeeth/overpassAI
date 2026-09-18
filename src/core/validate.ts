/**
 * Checks a query before it is sent.
 *
 * The parser is deliberately permissive, because half-typed text has to stay
 * editable. That leaves a gap the block editor falls straight into: a freshly
 * added filter has empty fields, prints as `node[""]` or `node(id:)`, and the
 * first thing the user hears about it is a parse error from a server in
 * Germany. The server is a terrible place to learn that a field is blank.
 *
 * So validation is a separate pass over the tree, run before every send and
 * shown live against the blocks. It reports two severities:
 *
 *  - `error`   the query cannot work, and the run is refused
 *  - `warning` the query will run but probably not do what was meant, most
 *              often because nothing constrains it to an area
 *
 * Every issue carries the id of the block it belongs to, so the UI can point
 * at the offending block rather than describing it.
 */

import type { Filter, OverpassQuery, Statement } from './ast'
import { forEachStatement } from './compile'

export type Severity = 'error' | 'warning'

export interface ValidationIssue {
  severity: Severity
  /** The block this is about. */
  statementId: string
  /** Set when the problem is on one filter inside that block. */
  filterId?: string
  /** What is wrong, in the user's terms. */
  message: string
  /** What to do about it. */
  fix?: string
}

export interface ValidationResult {
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** True when the query can be sent. */
  ok: boolean
}

/** The implicit set every statement writes to and reads from. */
const DEFAULT_SET = '_'

export function validate(query: OverpassQuery): ValidationResult {
  const issues: ValidationIssue[] = []

  const add = (issue: ValidationIssue) => issues.push(issue)

  // ---------------------------------------------------------------------
  // Set names
  // ---------------------------------------------------------------------

  // Sets in Overpass are global and evaluated in order, so a name used before
  // it is written is a different problem from one never written at all: the
  // first is usually a reordered block, the second a typo or a deleted block.
  const definedAt = new Map<string, number>()
  let position = 0

  forEachStatement(query.statements, (stmt) => {
    position += 1
    if ('into' in stmt && stmt.into && !definedAt.has(stmt.into)) {
      definedAt.set(stmt.into, position)
    }
  })

  position = 0

  const checkSet = (
    name: string | undefined,
    stmt: Statement,
    what: string,
    filterId?: string,
  ): void => {
    if (!name || name === DEFAULT_SET) return

    const definedPosition = definedAt.get(name)

    if (definedPosition === undefined) {
      add({
        severity: 'error',
        statementId: stmt.id,
        filterId,
        message: `${what} uses the set "${name}", which nothing creates.`,
        fix: `Add a block that saves its result as "${name}", or point this at another set.`,
      })
      return
    }

    if (definedPosition > position) {
      add({
        severity: 'error',
        statementId: stmt.id,
        filterId,
        message: `${what} uses the set "${name}" before the block that creates it.`,
        fix: 'Move the block that creates it above this one.',
      })
    }
  }

  // ---------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------

  forEachStatement(query.statements, (stmt) => {
    position += 1
    if (stmt.disabled) return

    switch (stmt.kind) {
      case 'query': {
        for (const set of stmt.inputSets) checkSet(set, stmt, 'This block')
        for (const filter of stmt.filters) checkFilter(filter, stmt)

        if (!stmt.filters.length && !stmt.inputSets.length) {
          add({
            severity: 'warning',
            statementId: stmt.id,
            message: 'This block has no filters, so it matches every element on the planet.',
            fix: 'Add a tag filter and something that limits the area.',
          })
        } else if (!isBounded(stmt)) {
          add({
            severity: 'warning',
            statementId: stmt.id,
            message: 'Nothing limits this block to an area, so it searches the whole planet.',
            fix: 'Add "In area", "In map view" or "Near", or use an earlier result as input.',
          })
        }
        break
      }

      case 'geocodeArea':
        if (!stmt.query.trim()) {
          add({
            severity: 'error',
            statementId: stmt.id,
            message: 'This place block has no name in it.',
            fix: 'Type a town, region or country and pick one of the suggestions.',
          })
        }
        if (!stmt.into) {
          add({
            severity: 'warning',
            statementId: stmt.id,
            message: 'This place is not saved under a name, so no other block can use it.',
            fix: 'Give it a name, then select that name in an "In area" filter.',
          })
        }
        break

      case 'setref':
        checkSet(stmt.set, stmt, 'This block')
        break

      case 'recurse':
        checkSet(stmt.from, stmt, 'This block')
        break

      case 'out':
        checkSet(stmt.from, stmt, 'This output block')
        break

      case 'isin':
        checkSet(stmt.from, stmt, 'This block')
        if ((stmt.lat === undefined) !== (stmt.lon === undefined)) {
          add({
            severity: 'error',
            statementId: stmt.id,
            message: 'This block has only one of latitude and longitude.',
            fix: 'Fill both, or clear both to use the previous result instead.',
          })
        }
        break

      case 'union':
        if (!stmt.items.length) {
          add({
            severity: 'error',
            statementId: stmt.id,
            message: 'This "Any of" block is empty.',
            fix: 'Add at least one block inside it, or delete it.',
          })
        }
        break

      case 'difference':
        if (!stmt.left || !stmt.right) {
          add({
            severity: 'error',
            statementId: stmt.id,
            message: 'This "Except" block needs both of its two inputs.',
            fix: 'Fill the empty slot, or delete the block.',
          })
        }
        break

      case 'foreach':
        checkSet(stmt.from, stmt, 'This loop')
        if (!stmt.body.length) {
          add({
            severity: 'warning',
            statementId: stmt.id,
            message: 'This loop has no blocks inside it, so it does nothing.',
          })
        }
        break

      case 'raw': {
        const text = stmt.text.trim()
        if (!text || text === ';') {
          add({
            severity: 'error',
            statementId: stmt.id,
            message: 'This advanced block is empty.',
            fix: 'Write some Overpass QL in it, or delete it.',
          })
        }
        break
      }
    }
  })

  // ---------------------------------------------------------------------
  // The query as a whole
  // ---------------------------------------------------------------------

  const live = query.statements.filter((stmt) => !stmt.disabled)

  if (!live.length) {
    add({
      severity: 'error',
      statementId: '',
      message: 'The query is empty.',
      fix: 'Add a block, or pick a feature from the catalogue.',
    })
  } else if (!hasOutput(query)) {
    add({
      severity: 'error',
      statementId: live[live.length - 1].id,
      message: 'Nothing is returned: the query has no output block.',
      fix: 'Add an Output block at the end.',
    })
  }

  const timeout = query.settings.timeout
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    add({
      severity: 'error',
      statementId: '',
      message: 'The timeout has to be a positive number of seconds.',
      fix: 'Set it back to 25 in the Settings block.',
    })
  }

  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')

  return { issues, errors, warnings, ok: errors.length === 0 }

  // ---------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------

  function checkFilter(filter: Filter, stmt: Statement): void {
    const fail = (message: string, fix?: string) =>
      add({ severity: 'error', statementId: stmt.id, filterId: filter.id, message, fix })

    const warn = (message: string, fix?: string) =>
      add({ severity: 'warning', statementId: stmt.id, filterId: filter.id, message, fix })

    switch (filter.kind) {
      case 'tag': {
        if (!filter.key.trim()) {
          fail('A tag filter has no key.', 'Type a key such as "amenity", or remove the filter.')
          return
        }

        const needsValue = filter.op !== 'exists' && filter.op !== 'missing'
        if (needsValue && !(filter.value ?? '').length) {
          // An empty value is legal and matches elements tagged with an empty
          // string, which is almost never what someone means.
          warn(
            `"${filter.key}" is being compared with an empty value.`,
            'Type a value, or switch the comparison to "exists".',
          )
        }

        if (filter.op === 'like' || filter.op === 'notlike') {
          const pattern = filter.value ?? ''
          try {
            new RegExp(pattern)
          } catch {
            fail(
              `"${pattern}" is not a valid regular expression.`,
              'Check the brackets and escapes, or switch the comparison to "is".',
            )
          }
        }

        if (filter.keyMatch === 'regex') {
          try {
            new RegExp(filter.key)
          } catch {
            fail(`"${filter.key}" is not a valid regular expression for a key.`)
          }
        }
        break
      }

      case 'ids':
        if (!filter.ids.length) {
          fail('The id filter has no ids in it.', 'Type one or more OSM ids, separated by commas.')
        }
        break

      case 'user':
        if (!filter.users.length || filter.users.every((u) => !u.trim())) {
          fail('The "edited by" filter has no user name in it.')
        }
        break

      case 'uid':
        if (!filter.uids.length) {
          fail('The user id filter has no ids in it.')
        }
        break

      case 'poly': {
        const parts = filter.points.trim().split(/\s+/).filter(Boolean)
        if (!parts.length) {
          fail('The polygon filter has no coordinates.', 'List them as "lat lon lat lon".')
        } else if (parts.length % 2 !== 0) {
          fail(
            'The polygon has an odd number of numbers, so one coordinate is incomplete.',
            'Coordinates go in pairs: "lat lon lat lon".',
          )
        } else if (parts.length < 6) {
          fail('A polygon needs at least three points.')
        } else if (parts.some((part) => !Number.isFinite(Number(part)))) {
          fail('The polygon contains something that is not a number.')
        }
        break
      }

      case 'if':
        if (!filter.expr.trim()) {
          fail('The condition is empty.', 'Write an Overpass expression, such as count_tags() > 5.')
        }
        break

      case 'around':
        if (!Number.isFinite(filter.radius) || filter.radius <= 0) {
          fail('The radius has to be a positive number of metres.')
        }
        if (filter.points.length % 2 !== 0) {
          fail('The centre point is missing its longitude.')
        }
        checkSet(filter.set, stmt, 'The "Near" filter', filter.id)
        if (!filter.set && !filter.points.length && !hasPrecedingResult(stmt)) {
          fail(
            '"Near" has nothing to be near: no coordinates, and no earlier result to measure from.',
            'Type a latitude and longitude, or pick a saved set.',
          )
        }
        break

      case 'area':
        if (filter.areaId === undefined) {
          if (!filter.set) {
            warn(
              'This searches inside the most recent area, which may not be the one you meant.',
              'Pick a named area instead.',
            )
          } else {
            checkSet(filter.set, stmt, 'The "In area" filter', filter.id)
          }
        }
        break

      case 'pivot':
        checkSet(filter.set, stmt, 'The "Outline of area" filter', filter.id)
        break

      case 'bbox':
        if (filter.bbox) {
          const { south, west, north, east } = filter.bbox
          if (![south, west, north, east].every(Number.isFinite)) {
            fail('The bounding box contains something that is not a number.')
          } else if (south >= north) {
            fail('The bounding box has its south edge above its north edge.')
          } else if (west >= east) {
            fail('The bounding box has its west edge right of its east edge.')
          }
        }
        break

      case 'newer':
        if (!filter.date.trim()) fail('The "changed since" filter has no date.')
        break

      case 'changed':
        if (!filter.from.trim()) fail('The "changed between" filter has no start date.')
        break

      case 'recurse':
        checkSet(filter.set, stmt, 'The "related to" filter', filter.id)
        break

      case 'raw':
        if (!filter.text.trim()) {
          fail('An advanced filter is empty.', 'Write the filter, or remove it.')
        }
        break
    }
  }

  /** True when something limits the statement to a region or a set of ids. */
  function isBounded(stmt: Extract<Statement, { kind: 'query' }>): boolean {
    if (stmt.inputSets.length) return true
    return stmt.filters.some((filter) =>
      ['bbox', 'area', 'around', 'poly', 'ids', 'recurse', 'pivot', 'uid', 'user'].includes(
        filter.kind,
      ),
    )
  }

  /** True when some earlier statement leaves a result in the default set. */
  function hasPrecedingResult(stmt: Statement): boolean {
    let seen = false
    let found = false

    forEachStatement(query.statements, (candidate) => {
      if (candidate.id === stmt.id) {
        seen = true
        return
      }
      if (!seen && !candidate.disabled && producesElements(candidate)) found = true
    })

    return found
  }
}

function producesElements(stmt: Statement): boolean {
  return (
    stmt.kind === 'query' ||
    stmt.kind === 'union' ||
    stmt.kind === 'difference' ||
    stmt.kind === 'recurse' ||
    stmt.kind === 'setref' ||
    stmt.kind === 'isin'
  )
}

function hasOutput(query: OverpassQuery): boolean {
  let found = false
  forEachStatement(query.statements, (stmt) => {
    if (stmt.disabled) return
    if (stmt.kind === 'out') found = true
    if (stmt.kind === 'raw' && /\bout\b/.test(withoutComments(stmt.text))) found = true
  })
  return found
}

/**
 * Source text with its comments removed.
 *
 * Used before looking for keywords in a raw block, so a note like
 * "find out more later" is not mistaken for an `out` statement.
 */
export function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/** The issues that belong to one block, for the marker on it. */
export function issuesFor(result: ValidationResult, statementId: string): ValidationIssue[] {
  return result.issues.filter((issue) => issue.statementId === statementId)
}

/** The worst severity present among a set of issues, or null if there are none. */
export function worstSeverity(issues: ValidationIssue[]): Severity | null {
  if (issues.some((issue) => issue.severity === 'error')) return 'error'
  if (issues.length) return 'warning'
  return null
}
