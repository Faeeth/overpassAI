/**
 * Renders an {@link OverpassQuery} back to Overpass QL source.
 *
 * The printer is the "blocks to text" half of the round-trip. It is paired
 * with the parser in `parser.ts`, and `__tests__/roundtrip.test.ts` asserts
 * that `parse(print(ast))` is structurally identical to `ast`.
 */

import type {
  BBox,
  Filter,
  OverpassQuery,
  Settings,
  Statement,
  TagFilter,
} from './ast'

export interface PrintOptions {
  /** Spaces per indentation level. */
  indent?: number
}

const DEFAULT_INDENT = 2

/** Marker wrapping muted blocks, so they survive a print/parse round-trip. */
export const DISABLED_OPEN = '/*@off'
export const DISABLED_CLOSE = '@off*/'

export function print(query: OverpassQuery, options: PrintOptions = {}): string {
  const indent = options.indent ?? DEFAULT_INDENT
  const lines: string[] = []

  const settings = printSettings(query.settings)
  if (settings) lines.push(settings)

  for (const stmt of query.statements) {
    lines.push(...printStatement(stmt, 0, indent))
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function printSettings(s: Settings): string {
  const parts: string[] = []

  if (s.format === 'csv' && s.csv) {
    const fields = s.csv.fields.map((f) => quote(f)).join(',')
    const tail =
      s.csv.header && s.csv.separator === '\t'
        ? ''
        : `; ${s.csv.header ? 'true' : 'false'}; ${quote(s.csv.separator)}`
    parts.push(`[out:csv(${fields}${tail})]`)
  } else if (s.format !== 'json') {
    parts.push(`[out:${s.format}]`)
  } else {
    parts.push('[out:json]')
  }

  if (s.timeout !== undefined) parts.push(`[timeout:${num(s.timeout)}]`)
  if (s.maxsize !== undefined) parts.push(`[maxsize:${num(s.maxsize)}]`)
  if (s.bbox) parts.push(`[bbox:${bboxStr(s.bbox)}]`)
  if (s.date) parts.push(`[date:${quote(s.date)}]`)
  if (s.diff) {
    parts.push(
      s.diff.to
        ? `[diff:${quote(s.diff.from)},${quote(s.diff.to)}]`
        : `[diff:${quote(s.diff.from)}]`,
    )
  }
  if (s.adiff) {
    parts.push(
      s.adiff.to
        ? `[adiff:${quote(s.adiff.from)},${quote(s.adiff.to)}]`
        : `[adiff:${quote(s.adiff.from)}]`,
    )
  }
  for (const extra of s.extras ?? []) parts.push(extra)

  return parts.length ? `${parts.join('')};` : ''
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function printStatement(stmt: Statement, depth: number, indent: number): string[] {
  const pad = ' '.repeat(depth * indent)
  const lines: string[] = []

  if (stmt.label) lines.push(`${pad}// ${stmt.label}`)

  const body = statementLines(stmt, depth, indent)

  if (stmt.disabled) {
    // Muted blocks round-trip through a marked block comment rather than being
    // dropped, so toggling a block off and on again is lossless.
    return [`${pad}${DISABLED_OPEN}`, ...body, `${pad}${DISABLED_CLOSE}`]
  }

  lines.push(...body)
  return lines
}

function statementLines(stmt: Statement, depth: number, indent: number): string[] {
  const pad = ' '.repeat(depth * indent)

  switch (stmt.kind) {
    case 'query': {
      const sets = stmt.inputSets.map((s) => `.${s}`).join('')
      const filters = stmt.filters.map(printFilter).join('')
      return [`${pad}${stmt.type}${sets}${filters}${into(stmt.into)};`]
    }

    case 'setref':
      return [`${pad}.${stmt.set}${into(stmt.into)};`]

    case 'geocodeArea':
      return [`${pad}{{geocodeArea:${stmt.query}}}${into(stmt.into)};`]

    case 'recurse':
      return [`${pad}${from(stmt.from)}${stmt.op}${into(stmt.into)};`]

    case 'out': {
      const parts = ['out']
      if (stmt.verbosity) parts.push(stmt.verbosity)
      if (stmt.geometry) parts.push(stmt.geometry)
      if (stmt.sort) parts.push(stmt.sort)
      if (stmt.limit !== undefined) parts.push(num(stmt.limit))
      return [`${pad}${from(stmt.from)}${parts.join(' ')};`]
    }

    case 'isin': {
      const coords =
        stmt.lat !== undefined && stmt.lon !== undefined
          ? `(${num(stmt.lat)},${num(stmt.lon)})`
          : ''
      return [`${pad}${from(stmt.from)}is_in${coords}${into(stmt.into)};`]
    }

    case 'union': {
      const inner = stmt.items.flatMap((s) => printStatement(s, depth + 1, indent))
      if (!inner.length) return [`${pad}(${into(stmt.into)});`]
      return [`${pad}(`, ...inner, `${pad})${into(stmt.into)};`]
    }

    case 'difference': {
      const lines = [`${pad}(`]
      if (stmt.left) lines.push(...printStatement(stmt.left, depth + 1, indent))
      if (stmt.right) {
        const right = printStatement(stmt.right, depth + 1, indent)
        // The minus belongs to the first source line of the right operand.
        const firstCode = right.findIndex((l) => !l.trimStart().startsWith('//'))
        if (firstCode >= 0) {
          const line = right[firstCode]
          const lead = line.length - line.trimStart().length
          right[firstCode] = `${line.slice(0, Math.max(0, lead - 2))}- ${line.trimStart()}`
        }
        lines.push(...right)
      }
      lines.push(`${pad})${into(stmt.into)};`)
      return lines
    }

    case 'foreach': {
      const inner = stmt.body.flatMap((s) => printStatement(s, depth + 1, indent))
      const head = `${pad}${from(stmt.from)}foreach${into(stmt.into)}(`
      if (!inner.length) return [`${head});`]
      return [head, ...inner, `${pad});`]
    }

    case 'raw':
      return stmt.text.split('\n').map((l) => `${pad}${l}`)
  }
}

function into(set?: string): string {
  return set ? `->.${set}` : ''
}

function from(set?: string): string {
  return set ? `.${set} ` : ''
}

/**
 * One-line rendering of a statement, for the summary a collapsed block shows.
 *
 * Labels are dropped: the block already displays them, and repeating them in
 * the summary wastes the little horizontal room a panel has.
 */
export function summarize(stmt: Statement): string {
  return statementLines({ ...stmt, label: undefined }, 0, 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export function printFilter(f: Filter): string {
  switch (f.kind) {
    case 'tag':
      return printTagFilter(f)

    case 'bbox':
      return f.bbox ? `(${bboxStr(f.bbox)})` : '({{bbox}})'

    case 'area':
      if (f.areaId !== undefined) return `(area:${num(f.areaId)})`
      return f.set ? `(area.${f.set})` : '(area)'

    case 'around': {
      const set = f.set ? `.${f.set}` : ''
      const pts = f.points.length ? `,${f.points.map(num).join(',')}` : ''
      return `(around${set}:${num(f.radius)}${pts})`
    }

    case 'poly':
      return `(poly:${quote(f.points)})`

    case 'ids':
      return `(id:${f.ids.map(num).join(',')})`

    case 'recurse': {
      const set = f.set ? `.${f.set}` : ''
      const role = f.memberRole !== undefined ? `:${quote(f.memberRole)}` : ''
      return `(${f.role}${set}${role})`
    }

    case 'user':
      return `(user:${f.users.map(quote).join(',')})`

    case 'uid':
      return `(uid:${f.uids.map(num).join(',')})`

    case 'newer':
      return `(newer:${quote(f.date)})`

    case 'changed':
      return f.to
        ? `(changed:${quote(f.from)},${quote(f.to)})`
        : `(changed:${quote(f.from)})`

    case 'pivot':
      return f.set ? `(pivot.${f.set})` : '(pivot)'

    case 'if':
      return `(if:${f.expr})`

    case 'raw':
      return f.text
  }
}

function printTagFilter(f: TagFilter): string {
  const ci = f.caseInsensitive ? ',i' : ''
  const key = f.keyMatch === 'regex' ? `~${quote(f.key)}` : quote(f.key)

  switch (f.op) {
    case 'exists':
      return `[${key}]`
    case 'missing':
      return `[!${quote(f.key)}]`
    case 'eq':
      return `[${key}=${quote(f.value ?? '')}${ci}]`
    case 'neq':
      return `[${key}!=${quote(f.value ?? '')}${ci}]`
    case 'like':
      return `[${key}~${quote(f.value ?? '')}${ci}]`
    case 'notlike':
      return `[${key}!~${quote(f.value ?? '')}${ci}]`
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Quotes a string for Overpass QL, escaping backslashes and double quotes. */
export function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Formats a number without exponent notation or a trailing `.0`. */
export function num(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(7)))
}

export function bboxStr(b: BBox): string {
  return `${num(b.south)},${num(b.west)},${num(b.north)},${num(b.east)}`
}
