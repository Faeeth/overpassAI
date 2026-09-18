/**
 * Overpass QL source to {@link OverpassQuery}.
 *
 * This is a hand-written recursive descent parser over a character scanner.
 * Two properties matter more than completeness:
 *
 *  - **It never throws.** Every statement and filter is attempted inside a
 *    backtracking `attempt()`; on failure the source text is captured verbatim
 *    into a `raw` node. A construct the block editor cannot render is shown as
 *    an "advanced" block rather than silently dropped, so switching between the
 *    text and block views is always safe.
 *  - **Errors are positioned.** Unbalanced brackets and missing semicolons are
 *    reported with a line and column so CodeMirror can underline them.
 */

import {
  defaultSettings,
  type CsvConfig,
  type Filter,
  type OutStatement,
  type OverpassQuery,
  type QueryType,
  type RecurseRole,
  type Settings,
  type Statement,
  type TagOp,
} from './ast'
import { newId } from './factory'
import { DISABLED_CLOSE, DISABLED_OPEN } from './printer'

export interface ParseError {
  message: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
  offset: number
}

export interface ParseResult {
  query: OverpassQuery
  errors: ParseError[]
}

/** Thrown internally to unwind to the nearest `attempt()`. Never escapes `parse`. */
class ParseFail extends Error {}

/** Transient marker for the right operand of a difference, stripped before returning. */
const MINUS = Symbol('minus')

const QUERY_TYPES: Record<string, QueryType> = {
  node: 'node',
  way: 'way',
  rel: 'rel',
  relation: 'rel',
  nwr: 'nwr',
  nw: 'nw',
  nr: 'nr',
  wr: 'wr',
  area: 'area',
  derived: 'derived',
}

const RECURSE_ROLES = new Set<string>(['n', 'w', 'r', 'bn', 'bw', 'br'])
const OUT_VERBOSITY = new Set(['ids', 'skel', 'body', 'tags', 'meta'])
const OUT_GEOMETRY = new Set(['geom', 'bb', 'center'])
const OUT_SORT = new Set(['asc', 'qt'])

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

class Scanner {
  pos = 0
  readonly src: string

  constructor(src: string) {
    this.src = src
  }

  get eof(): boolean {
    return this.pos >= this.src.length
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? ''
  }

  startsWith(text: string): boolean {
    return this.src.startsWith(text, this.pos)
  }

  advance(count = 1): void {
    this.pos += count
  }

  /** Consumes `text` if present, reporting whether it matched. */
  eat(text: string): boolean {
    if (!this.startsWith(text)) return false
    this.pos += text.length
    return true
  }

  /**
   * Skips whitespace and comments.
   *
   * Line comments are pushed to `comments` so the statement parser can turn
   * them into block labels. The muted-block marker is deliberately left in
   * place: it is structure, not trivia.
   */
  skipTrivia(comments?: string[]): void {
    for (;;) {
      while (!this.eof && /\s/.test(this.peek())) this.advance()

      if (this.startsWith('//')) {
        const start = this.pos + 2
        while (!this.eof && this.peek() !== '\n') this.advance()
        comments?.push(this.src.slice(start, this.pos).trim())
        continue
      }

      if (this.startsWith(DISABLED_OPEN)) return

      if (this.startsWith('/*')) {
        this.advance(2)
        while (!this.eof && !this.startsWith('*/')) this.advance()
        this.advance(2)
        continue
      }

      return
    }
  }

  lineCol(offset: number): { line: number; column: number } {
    let line = 1
    let lineStart = 0
    for (let i = 0; i < offset && i < this.src.length; i++) {
      if (this.src[i] === '\n') {
        line += 1
        lineStart = i + 1
      }
    }
    return { line, column: offset - lineStart + 1 }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parse(src: string): ParseResult {
  const sc = new Scanner(src)
  const errors: ParseError[] = []

  const fail = (message: string, offset = sc.pos): never => {
    throw new ParseFail(`${message}@${offset}`)
  }

  const report = (message: string, offset: number): void => {
    if (errors.length >= 25) return
    const { line, column } = sc.lineCol(offset)
    errors.push({ message, line, column, offset })
  }

  /** Runs `fn`, restoring the scanner position if it fails. */
  function attempt<T>(fn: () => T): T | null {
    const saved = sc.pos
    try {
      return fn()
    } catch (err) {
      if (err instanceof ParseFail) {
        sc.pos = saved
        return null
      }
      throw err
    }
  }

  // -- primitives ----------------------------------------------------------

  function expect(text: string, what = text): void {
    sc.skipTrivia()
    if (!sc.eat(text)) fail(`expected ${what}`)
  }

  function readIdent(): string {
    sc.skipTrivia()
    const start = sc.pos
    if (!/[A-Za-z_]/.test(sc.peek())) fail('expected an identifier')
    while (!sc.eof && /[A-Za-z0-9_]/.test(sc.peek())) sc.advance()
    return sc.src.slice(start, sc.pos)
  }

  function readNumber(): number {
    sc.skipTrivia()
    const start = sc.pos
    if (sc.peek() === '-' || sc.peek() === '+') sc.advance()
    while (!sc.eof && /[0-9]/.test(sc.peek())) sc.advance()
    if (sc.peek() === '.') {
      sc.advance()
      while (!sc.eof && /[0-9]/.test(sc.peek())) sc.advance()
    }
    if (/[eE]/.test(sc.peek())) {
      const save = sc.pos
      sc.advance()
      if (sc.peek() === '-' || sc.peek() === '+') sc.advance()
      if (/[0-9]/.test(sc.peek())) {
        while (!sc.eof && /[0-9]/.test(sc.peek())) sc.advance()
      } else {
        sc.pos = save
      }
    }
    const text = sc.src.slice(start, sc.pos)
    const value = Number(text)
    if (text === '' || Number.isNaN(value)) fail('expected a number', start)
    return value
  }

  function readQuoted(): string {
    const quote = sc.peek()
    if (quote !== '"' && quote !== "'") fail('expected a quoted string')
    sc.advance()
    let out = ''
    while (!sc.eof && sc.peek() !== quote) {
      if (sc.peek() === '\\') {
        sc.advance()
        const esc = sc.peek()
        sc.advance()
        switch (esc) {
          case 'n':
            out += '\n'
            break
          case 't':
            out += '\t'
            break
          default:
            out += esc
        }
        continue
      }
      out += sc.peek()
      sc.advance()
    }
    if (sc.eof) fail('unterminated string')
    sc.advance()
    return out
  }

  /** A tag key or value: quoted, or a bare word as Overpass also allows. */
  function readAtom(): string {
    sc.skipTrivia()
    if (sc.peek() === '"' || sc.peek() === "'") return readQuoted()
    const start = sc.pos
    while (!sc.eof && /[A-Za-z0-9_:.\-*]/.test(sc.peek())) sc.advance()
    if (sc.pos === start) fail('expected a key or value')
    return sc.src.slice(start, sc.pos)
  }

  /**
   * Reads a balanced `(...)` or `[...]` run starting at the current position,
   * skipping over nested brackets and string literals.
   */
  function readBalanced(): string {
    const open = sc.peek()
    const close = open === '(' ? ')' : open === '[' ? ']' : ''
    if (!close) fail('expected an opening bracket')
    const start = sc.pos
    let depth = 0
    while (!sc.eof) {
      const ch = sc.peek()
      if (ch === '"' || ch === "'") {
        readQuoted()
        continue
      }
      if (ch === open) depth += 1
      else if (ch === close) {
        depth -= 1
        if (depth === 0) {
          sc.advance()
          return sc.src.slice(start, sc.pos)
        }
      }
      sc.advance()
    }
    fail('unbalanced brackets', start)
    return ''
  }

  /**
   * Consumes source up to and including the semicolon that closes the current
   * statement, ignoring semicolons nested in brackets or strings. Used by the
   * `raw` fallback.
   */
  function readToSemicolon(): string {
    const start = sc.pos
    let depth = 0
    while (!sc.eof) {
      const ch = sc.peek()
      if (ch === '"' || ch === "'") {
        // This is the last-resort path, so an unterminated string must not
        // throw: swallow the rest of the source instead.
        const quoteAt = sc.pos
        if (attempt(readQuoted) === null) {
          report('unterminated string', quoteAt)
          sc.pos = sc.src.length
          break
        }
        continue
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break
        depth -= 1
      } else if (ch === ';' && depth === 0) {
        sc.advance()
        return sc.src.slice(start, sc.pos)
      }
      sc.advance()
    }
    return sc.src.slice(start, sc.pos)
  }

  // -- settings ------------------------------------------------------------

  function parseSettings(): Settings {
    const settings: Settings = defaultSettings()
    delete settings.timeout
    const extras: string[] = []

    sc.skipTrivia()
    while (sc.peek() === '[') {
      const group = readBalanced()
      applySetting(settings, group.slice(1, -1), extras)
      sc.skipTrivia()
    }

    if (!sc.eat(';')) report('missing ";" after the query settings', sc.pos)
    if (extras.length) settings.extras = extras
    return settings
  }

  function applySetting(settings: Settings, body: string, extras: string[]): void {
    const colon = body.indexOf(':')
    const name = (colon < 0 ? body : body.slice(0, colon)).trim()
    const value = colon < 0 ? '' : body.slice(colon + 1).trim()

    switch (name) {
      case 'out':
        if (value.startsWith('csv')) {
          settings.format = 'csv'
          settings.csv = parseCsvConfig(value)
        } else if (value === 'xml' || value === 'json') {
          settings.format = value
        } else {
          extras.push(`[${body}]`)
        }
        return
      case 'timeout':
        settings.timeout = Number(value)
        return
      case 'maxsize':
        settings.maxsize = Number(value)
        return
      case 'bbox': {
        const n = value.split(',').map(Number)
        if (n.length === 4 && n.every((v) => !Number.isNaN(v))) {
          settings.bbox = { south: n[0], west: n[1], north: n[2], east: n[3] }
        } else {
          extras.push(`[${body}]`)
        }
        return
      }
      case 'date':
        settings.date = unquote(value)
        return
      case 'diff':
      case 'adiff': {
        const parts = splitTopLevel(value, ',').map((p) => unquote(p.trim()))
        const range = { from: parts[0] ?? '', to: parts[1] }
        if (name === 'diff') settings.diff = range
        else settings.adiff = range
        return
      }
      default:
        extras.push(`[${body}]`)
    }
  }

  function parseCsvConfig(value: string): CsvConfig {
    const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
    const parts = splitTopLevel(inner, ';')
    const fields = splitTopLevel(parts[0] ?? '', ',')
      .map((f) => unquote(f.trim()))
      .filter(Boolean)
    return {
      fields,
      header: (parts[1] ?? 'true').trim() !== 'false',
      separator: parts[2] !== undefined ? unquote(parts[2].trim()) : '\t',
    }
  }

  // -- statements ----------------------------------------------------------

  /**
   * `seed` carries comments already consumed by the caller, so a comment
   * sitting above the settings prologue still becomes the first block label.
   */
  function parseStatements(closer: ')' | null, seed: string[] = []): Statement[] {
    const out: Statement[] = []
    let pendingMinus = false
    let carry = seed

    for (;;) {
      const comments = carry
      carry = []
      sc.skipTrivia(comments)

      if (sc.eof) {
        if (comments.length) out.push(rawComment(comments))
        if (closer) report(`missing "${closer}"`, sc.pos)
        return out
      }

      if (closer && sc.peek() === closer) {
        if (comments.length) out.push(rawComment(comments))
        return out
      }

      if (sc.startsWith(DISABLED_OPEN)) {
        sc.advance(DISABLED_OPEN.length)
        const muted = parseMutedBlock()
        for (const stmt of muted) stmt.disabled = true
        if (comments.length && muted[0]) muted[0].label = comments.join(' ')
        out.push(...muted)
        continue
      }

      if (closer && sc.peek() === '-') {
        sc.advance()
        pendingMinus = true
        continue
      }

      const before = sc.pos
      const stmt = parseStatement()
      if (sc.pos === before) {
        // Nothing consumed: skip a character so the loop always terminates.
        report('unexpected character', sc.pos)
        sc.advance()
        continue
      }

      if (comments.length) stmt.label = comments.join(' ')
      if (pendingMinus) {
        // Marks where the difference operator was seen. Non-enumerable so it
        // never reaches structuredClone, JSON or a React render.
        Object.defineProperty(stmt, MINUS, { value: true, enumerable: false })
        pendingMinus = false
      }
      out.push(stmt)
    }
  }

  function parseMutedBlock(): Statement[] {
    const start = sc.pos
    const end = sc.src.indexOf(DISABLED_CLOSE, start)
    if (end < 0) {
      report('unterminated muted block', start)
      sc.pos = sc.src.length
      return [{ kind: 'raw', id: newId(), text: sc.src.slice(start).trim() }]
    }
    const inner = sc.src.slice(start, end)
    const nested = parse(inner)
    sc.pos = end + DISABLED_CLOSE.length
    return nested.query.statements
  }

  function rawComment(comments: string[]): Statement {
    return {
      kind: 'raw',
      id: newId(),
      text: comments.map((c) => `// ${c}`).join('\n'),
    }
  }

  function parseStatement(): Statement {
    const typed = attempt(parseTypedStatement)
    if (typed) return typed
    // Unmodelled but well-delimited syntax is kept verbatim rather than lost.
    return { kind: 'raw', id: newId(), text: readToSemicolon().trim() }
  }

  function parseTypedStatement(): Statement {
    sc.skipTrivia()
    const ch = sc.peek()

    if (ch === '(') return parseGroup()
    if (ch === '{') return parseTemplate()
    if (ch === '>' || ch === '<') return parseRecurse(undefined)
    if (ch === '.') return parseSetPrefixed()

    const word = readIdent()

    if (word === 'out') return finishOut(undefined)
    if (word === 'foreach') return finishForeach(undefined)
    if (word === 'is_in') return finishIsIn(undefined)

    const type = QUERY_TYPES[word]
    if (!type) fail(`unknown statement "${word}"`)
    return finishQuery(type)
  }

  /** `.setName` followed by whatever statement consumes it as input. */
  function parseSetPrefixed(): Statement {
    sc.advance() // '.'
    const set = readIdent()
    sc.skipTrivia()

    if (sc.peek() === '>' || sc.peek() === '<') return parseRecurse(set)
    if (sc.peek() === ';' || sc.startsWith('->')) {
      const into = parseInto()
      expectSemicolon()
      return { kind: 'setref', id: newId(), set, into }
    }

    const word = readIdent()
    if (word === 'out') return finishOut(set)
    if (word === 'foreach') return finishForeach(set)
    if (word === 'is_in') return finishIsIn(set)
    fail(`unexpected "${word}" after set .${set}`)
    return null as never
  }

  function parseRecurse(from: string | undefined): Statement {
    let op: '>' | '<' | '>>' | '<<'
    if (sc.eat('>>')) op = '>>'
    else if (sc.eat('<<')) op = '<<'
    else if (sc.eat('>')) op = '>'
    else if (sc.eat('<')) op = '<'
    else {
      fail('expected a recursion operator')
      return null as never
    }
    const into = parseInto()
    expectSemicolon()
    return { kind: 'recurse', id: newId(), op, from, into }
  }

  function finishQuery(type: QueryType): Statement {
    const inputSets: string[] = []
    while (sc.peek() === '.') {
      sc.advance()
      inputSets.push(readIdent())
    }

    const filters: Filter[] = []
    for (;;) {
      sc.skipTrivia()
      if (sc.startsWith('->')) break
      const ch = sc.peek()
      if (ch !== '[' && ch !== '(') break
      filters.push(parseFilter())
    }

    const into = parseInto()
    expectSemicolon()
    return { kind: 'query', id: newId(), type, inputSets, filters, into }
  }

  function finishOut(from: string | undefined): Statement {
    const stmt: OutStatement = { kind: 'out', id: newId(), from }
    for (;;) {
      sc.skipTrivia()
      if (sc.peek() === ';') break
      if (sc.eof) fail('unterminated out statement')

      if (/[0-9]/.test(sc.peek())) {
        stmt.limit = readNumber()
        continue
      }
      const word = readIdent()
      if (OUT_VERBOSITY.has(word)) stmt.verbosity = word as never
      else if (OUT_GEOMETRY.has(word)) stmt.geometry = word as never
      else if (OUT_SORT.has(word)) stmt.sort = word as never
      else fail(`unknown out modifier "${word}"`)
    }
    expectSemicolon()
    return stmt
  }

  function finishForeach(from: string | undefined): Statement {
    const into = parseInto()
    expect('(', '"(" after foreach')
    const body = parseStatements(')')
    expect(')')
    expectSemicolon()
    return { kind: 'foreach', id: newId(), from, into, body }
  }

  function finishIsIn(from: string | undefined): Statement {
    let lat: number | undefined
    let lon: number | undefined
    sc.skipTrivia()
    if (sc.peek() === '(') {
      sc.advance()
      lat = readNumber()
      expect(',')
      lon = readNumber()
      expect(')')
    }
    const into = parseInto()
    expectSemicolon()
    return { kind: 'isin', id: newId(), from, lat, lon, into }
  }

  /** `( a; b; )` or `( a; - b; )`. */
  function parseGroup(): Statement {
    sc.advance() // '('
    const items = parseStatements(')')
    expect(')')
    const into = parseInto()
    expectSemicolon()

    const minusAt = items.findIndex((s) => MINUS in s)
    if (minusAt <= 0) {
      return { kind: 'union', id: newId(), items, into }
    }

    const before = items.slice(0, minusAt)
    const after = items.slice(minusAt)
    return {
      kind: 'difference',
      id: newId(),
      left: before.length === 1 ? before[0] : { kind: 'union', id: newId(), items: before },
      right: after.length === 1 ? after[0] : { kind: 'union', id: newId(), items: after },
      into,
    }
  }

  /** `{{geocodeArea:Lyon}}` and other `{{...}}` shortcuts. */
  function parseTemplate(): Statement {
    const start = sc.pos
    if (!sc.eat('{{')) fail('expected a template')
    const end = sc.src.indexOf('}}', sc.pos)
    if (end < 0) fail('unterminated template', start)
    const body = sc.src.slice(sc.pos, end)
    sc.pos = end + 2

    const colon = body.indexOf(':')
    const name = (colon < 0 ? body : body.slice(0, colon)).trim()
    const arg = colon < 0 ? '' : body.slice(colon + 1).trim()

    if (name === 'geocodeArea' || name === 'nominatimArea') {
      const into = parseInto()
      expectSemicolon()
      return { kind: 'geocodeArea', id: newId(), query: arg, into }
    }

    sc.pos = start
    return { kind: 'raw', id: newId(), text: readToSemicolon().trim() }
  }

  function parseInto(): string | undefined {
    sc.skipTrivia()
    if (!sc.eat('->')) return undefined
    sc.skipTrivia()
    if (!sc.eat('.')) fail('expected "." after "->"')
    return readIdent()
  }

  function expectSemicolon(): void {
    sc.skipTrivia()
    if (!sc.eat(';')) fail('missing ";"')
  }

  // -- filters -------------------------------------------------------------

  function parseFilter(): Filter {
    const start = sc.pos
    const typed = attempt(() => (sc.peek() === '[' ? parseTagFilter() : parseParenFilter()))
    if (typed) return typed

    sc.pos = start
    const text = attempt(readBalanced)
    if (text === null) {
      report('unbalanced filter brackets', start)
      sc.pos = sc.src.length
      return { kind: 'raw', id: newId(), text: sc.src.slice(start) }
    }
    return { kind: 'raw', id: newId(), text }
  }

  function parseTagFilter(): Filter {
    expect('[')
    sc.skipTrivia()

    if (sc.peek() === '!' && sc.peek(1) !== '=' && sc.peek(1) !== '~') {
      sc.advance()
      const key = readAtom()
      expect(']')
      return { kind: 'tag', id: newId(), keyMatch: 'exact', key, op: 'missing' }
    }

    let keyMatch: 'exact' | 'regex' = 'exact'
    if (sc.peek() === '~') {
      sc.advance()
      keyMatch = 'regex'
    }
    const key = readAtom()
    sc.skipTrivia()

    let op: TagOp
    if (sc.eat('!=')) op = 'neq'
    else if (sc.eat('!~')) op = 'notlike'
    else if (sc.eat('=')) op = 'eq'
    else if (sc.eat('~')) op = 'like'
    else if (sc.peek() === ']') {
      sc.advance()
      return { kind: 'tag', id: newId(), keyMatch, key, op: 'exists' }
    } else {
      fail('expected a comparison operator')
      return null as never
    }

    const value = readAtom()
    sc.skipTrivia()

    let caseInsensitive: true | undefined
    if (sc.eat(',')) {
      sc.skipTrivia()
      if (!sc.eat('i')) fail('expected "i" after "," in a tag filter')
      caseInsensitive = true
    }
    expect(']')
    return { kind: 'tag', id: newId(), keyMatch, key, op, value, caseInsensitive }
  }

  function parseParenFilter(): Filter {
    expect('(')
    sc.skipTrivia()

    if (sc.startsWith('{{bbox}}')) {
      sc.advance('{{bbox}}'.length)
      expect(')')
      return { kind: 'bbox', id: newId(), bbox: null }
    }

    if (/[0-9+\-.]/.test(sc.peek())) {
      const numbers = [readNumber()]
      sc.skipTrivia()
      while (sc.eat(',')) numbers.push(readNumber())
      expect(')')
      if (numbers.length === 4) {
        const [south, west, north, east] = numbers
        return { kind: 'bbox', id: newId(), bbox: { south, west, north, east } }
      }
      return { kind: 'ids', id: newId(), ids: numbers }
    }

    const word = readIdent()

    switch (word) {
      case 'area': {
        let set: string | undefined
        let areaId: number | undefined
        if (sc.eat('.')) set = readIdent()
        else if (sc.eat(':')) areaId = readNumber()
        expect(')')
        return { kind: 'area', id: newId(), set, areaId }
      }

      case 'around': {
        let set: string | undefined
        if (sc.eat('.')) set = readIdent()
        expect(':')
        const radius = readNumber()
        const points: number[] = []
        sc.skipTrivia()
        while (sc.eat(',')) points.push(readNumber())
        expect(')')
        return { kind: 'around', id: newId(), radius, set, points }
      }

      case 'poly': {
        expect(':')
        sc.skipTrivia()
        const points = readQuoted()
        expect(')')
        return { kind: 'poly', id: newId(), points }
      }

      case 'id': {
        expect(':')
        const ids = [readNumber()]
        sc.skipTrivia()
        while (sc.eat(',')) ids.push(readNumber())
        expect(')')
        return { kind: 'ids', id: newId(), ids }
      }

      case 'uid': {
        expect(':')
        const uids = [readNumber()]
        sc.skipTrivia()
        while (sc.eat(',')) uids.push(readNumber())
        expect(')')
        return { kind: 'uid', id: newId(), uids }
      }

      case 'user': {
        expect(':')
        sc.skipTrivia()
        const users = [readAtom()]
        sc.skipTrivia()
        while (sc.eat(',')) {
          sc.skipTrivia()
          users.push(readAtom())
        }
        expect(')')
        return { kind: 'user', id: newId(), users }
      }

      case 'newer': {
        expect(':')
        sc.skipTrivia()
        const date = readAtom()
        expect(')')
        return { kind: 'newer', id: newId(), date }
      }

      case 'changed': {
        sc.skipTrivia()
        if (sc.eat(')')) {
          return { kind: 'changed', id: newId(), from: '' }
        }
        expect(':')
        sc.skipTrivia()
        const from = readAtom()
        let to: string | undefined
        sc.skipTrivia()
        if (sc.eat(',')) {
          sc.skipTrivia()
          to = readAtom()
        }
        expect(')')
        return { kind: 'changed', id: newId(), from, to }
      }

      case 'pivot': {
        let set: string | undefined
        if (sc.eat('.')) set = readIdent()
        expect(')')
        return { kind: 'pivot', id: newId(), set }
      }

      case 'if': {
        expect(':')
        const start = sc.pos
        let depth = 0
        while (!sc.eof) {
          const ch = sc.peek()
          if (ch === '"' || ch === "'") {
            readQuoted()
            continue
          }
          if (ch === '(') depth += 1
          else if (ch === ')') {
            if (depth === 0) break
            depth -= 1
          }
          sc.advance()
        }
        const expr = sc.src.slice(start, sc.pos).trim()
        expect(')')
        return { kind: 'if', id: newId(), expr }
      }

      default: {
        if (!RECURSE_ROLES.has(word)) fail(`unknown filter "${word}"`)
        let set: string | undefined
        let memberRole: string | undefined
        if (sc.eat('.')) set = readIdent()
        sc.skipTrivia()
        if (sc.eat(':')) {
          sc.skipTrivia()
          memberRole = readAtom()
        }
        expect(')')
        return { kind: 'recurse', id: newId(), role: word as RecurseRole, set, memberRole }
      }
    }
  }

  // -- run -----------------------------------------------------------------

  const lead: string[] = []
  sc.skipTrivia(lead)

  let settings = defaultSettings()
  if (sc.peek() === '[') {
    // A malformed prologue must not abort the whole parse: fall back to the
    // defaults and let the statement loop capture the text as a raw block.
    const parsed = attempt(parseSettings)
    if (parsed) settings = parsed
    else report('could not read the query settings', sc.pos)
  }

  const statements = parseStatements(null, lead)
  return { query: { settings, statements }, errors }
}

// ---------------------------------------------------------------------------
// Helpers shared with the settings parser
// ---------------------------------------------------------------------------

function unquote(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
      return trimmed.slice(1, -1).replace(/\\(.)/g, '$1')
    }
  }
  return trimmed
}

/** Splits on `sep`, ignoring separators inside quotes or brackets. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') {
        current += ch + (text[i + 1] ?? '')
        i += 1
        continue
      }
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1

    if (ch === sep && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

/** Convenience wrapper for callers that only need the tree. */
export function parseQuery(src: string): OverpassQuery {
  return parse(src).query
}
