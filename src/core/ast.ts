/**
 * Typed representation of an Overpass QL query.
 *
 * Design notes
 * ------------
 * The AST is the single source of truth shared by the block editor and the
 * text editor. Two properties make that round-trip safe:
 *
 *  1. Every node carries a stable `id`, used as a React key and as a drag and
 *     drop handle. Ids are never emitted to the query text.
 *  2. Anything the parser does not model is preserved verbatim in a `raw`
 *     node instead of being dropped. A query can therefore always be parsed,
 *     shown as blocks and printed back without losing information, even when
 *     it uses a corner of the language the block editor has no UI for.
 */

export type NodeId = string

/** Geographic bounding box, in the (south, west, north, east) order used by Overpass. */
export interface BBox {
  south: number
  west: number
  north: number
  east: number
}

// ---------------------------------------------------------------------------
// Settings - the `[out:json][timeout:25];` prologue
// ---------------------------------------------------------------------------

export type OutputFormat = 'json' | 'xml' | 'csv'

export interface CsvConfig {
  /** Column list. `::id`, `::type`, `::lat`, `::lon`, `::count` are special. */
  fields: string[]
  header: boolean
  separator: string
}

export interface Settings {
  format: OutputFormat
  csv?: CsvConfig
  /** Server-side time budget in seconds. */
  timeout?: number
  /** Memory budget in bytes. */
  maxsize?: number
  /** Global bounding box, applied to every bare `(bbox)` filter. */
  bbox?: BBox
  /** Attic query: state of the database at this ISO date. */
  date?: string
  /** Difference between two dates. */
  diff?: { from: string; to?: string }
  /** Augmented difference between two dates. */
  adiff?: { from: string; to?: string }
  /** Settings recognised syntactically but not modelled, kept verbatim. */
  extras?: string[]
}

export function defaultSettings(): Settings {
  return { format: 'json', timeout: 25 }
}

// ---------------------------------------------------------------------------
// Filters - everything inside `[...]` and `(...)` after a query type
// ---------------------------------------------------------------------------

/** How the key side of a tag filter is interpreted. */
export type KeyMatch = 'exact' | 'regex'

/**
 * Comparison performed by a tag filter.
 *
 * `exists` and `missing` ignore `value`; `missing` is only expressible with an
 * exact key, as `[!"key"]`.
 */
export type TagOp = 'exists' | 'missing' | 'eq' | 'neq' | 'like' | 'notlike'

export interface TagFilter {
  kind: 'tag'
  id: NodeId
  keyMatch: KeyMatch
  key: string
  op: TagOp
  value?: string
  /** Emits the `,i` modifier, e.g. `["name"~"cafe",i]`. */
  caseInsensitive?: boolean
}

/** `(50.6,7.0,50.8,7.3)` - an explicit bounding box. */
export interface BBoxFilter {
  kind: 'bbox'
  id: NodeId
  /** `null` means "use the map viewport", written as the `{{bbox}}` shortcut. */
  bbox: BBox | null
}

/** `(area)`, `(area.searchArea)` or `(area:3600007444)`. */
export interface AreaFilter {
  kind: 'area'
  id: NodeId
  set?: string
  areaId?: number
}

/** `(around:500)`, `(around.pubs:500)` or `(around:500,50.6,7.0)`. */
export interface AroundFilter {
  kind: 'around'
  id: NodeId
  radius: number
  set?: string
  /** Flat list of lat/lon pairs; empty means "around the input set". */
  points: number[]
}

/** `(poly:"50.6 7.0 50.8 7.3")`. */
export interface PolyFilter {
  kind: 'poly'
  id: NodeId
  points: string
}

/** `(id:1,2,3)` or the shorthand `(1)`. */
export interface IdsFilter {
  kind: 'ids'
  id: NodeId
  ids: number[]
}

/**
 * Membership recursion.
 *
 * `n`, `w` and `r` walk down to members, `bn`, `bw` and `br` walk up to
 * parents. For example `way(bn.stops)` finds the ways containing any node of
 * the `stops` set.
 */
export type RecurseRole = 'n' | 'w' | 'r' | 'bn' | 'bw' | 'br'

export interface RecurseFilter {
  kind: 'recurse'
  id: NodeId
  role: RecurseRole
  set?: string
  /** Restricts the recursion to members having this relation role. */
  memberRole?: string
}

/** `(user:"alice","bob")`. */
export interface UserFilter {
  kind: 'user'
  id: NodeId
  users: string[]
}

/** `(uid:1234,5678)`. */
export interface UidFilter {
  kind: 'uid'
  id: NodeId
  uids: number[]
}

/** `(newer:"2024-01-01T00:00:00Z")`. */
export interface NewerFilter {
  kind: 'newer'
  id: NodeId
  date: string
}

/** `(changed:"2024-01-01T00:00:00Z","2024-06-01T00:00:00Z")`. */
export interface ChangedFilter {
  kind: 'changed'
  id: NodeId
  from: string
  to?: string
}

/** `(pivot.searchArea)` - the element an area was derived from. */
export interface PivotFilter {
  kind: 'pivot'
  id: NodeId
  set?: string
}

/** `(if: count_tags() > 5)` - an arbitrary evaluator expression. */
export interface IfFilter {
  kind: 'if'
  id: NodeId
  expr: string
}

/** Anything recognised as a filter but not modelled. */
export interface RawFilter {
  kind: 'raw'
  id: NodeId
  /** Full source text including the surrounding brackets. */
  text: string
}

export type Filter =
  | TagFilter
  | BBoxFilter
  | AreaFilter
  | AroundFilter
  | PolyFilter
  | IdsFilter
  | RecurseFilter
  | UserFilter
  | UidFilter
  | NewerFilter
  | ChangedFilter
  | PivotFilter
  | IfFilter
  | RawFilter

export type FilterKind = Filter['kind']

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type QueryType =
  | 'node'
  | 'way'
  | 'rel'
  | 'nwr'
  | 'nw'
  | 'nr'
  | 'wr'
  | 'area'
  | 'derived'

/** Fields shared by every statement, including the user-facing comment. */
interface StatementBase {
  id: NodeId
  /** Free-form note shown on the block and emitted as a `//` comment. */
  label?: string
  /** Blocks can be muted without being deleted; muted blocks are commented out. */
  disabled?: boolean
}

/** `node.a["amenity"="bar"](area.city)->.bars;` */
export interface QueryStatement extends StatementBase {
  kind: 'query'
  type: QueryType
  /** Input sets written between the type and the filters, e.g. `node.a.b`. */
  inputSets: string[]
  filters: Filter[]
  into?: string
}

/** `( ... ; ... ; )->.result;` */
export interface UnionStatement extends StatementBase {
  kind: 'union'
  items: Statement[]
  into?: string
}

/** `( ... ; - ... ; )->.result;` */
export interface DifferenceStatement extends StatementBase {
  kind: 'difference'
  left: Statement | null
  right: Statement | null
  into?: string
}

/** `>;` `<;` `>>;` `<<;`, optionally scoped to an input set. */
export interface RecurseStatement extends StatementBase {
  kind: 'recurse'
  op: '>' | '<' | '>>' | '<<'
  from?: string
  into?: string
}

export type OutVerbosity = 'ids' | 'skel' | 'body' | 'tags' | 'meta'
export type OutGeometry = 'geom' | 'bb' | 'center'

/** `out body geom qt 1000;` */
export interface OutStatement extends StatementBase {
  kind: 'out'
  from?: string
  verbosity?: OutVerbosity
  geometry?: OutGeometry
  sort?: 'asc' | 'qt'
  limit?: number
}

/** `foreach( ... );` */
export interface ForeachStatement extends StatementBase {
  kind: 'foreach'
  from?: string
  into?: string
  body: Statement[]
}

/** `is_in;` or `is_in(50.6,7.0)->.areas;` */
export interface IsInStatement extends StatementBase {
  kind: 'isin'
  from?: string
  lat?: number
  lon?: number
  into?: string
}

/** `.a;` or `.a->.b;` - passes a named set through. */
export interface SetRefStatement extends StatementBase {
  kind: 'setref'
  set: string
  into?: string
}

/**
 * `{{geocodeArea:Lyon}}->.searchArea;`
 *
 * Not part of Overpass QL itself: it is a shortcut, kept in the user-facing
 * source and expanded to a concrete `area(id:...)` by `compile.ts` just before
 * the query is sent. Keeping it in the AST is what lets the block editor offer
 * a plain "search inside a named place" block.
 */
export interface GeocodeAreaStatement extends StatementBase {
  kind: 'geocodeArea'
  /** Free-text place name handed to the geocoder. */
  query: string
  into?: string
}

/** Any statement that could be delimited but not modelled, kept verbatim. */
export interface RawStatement extends StatementBase {
  kind: 'raw'
  text: string
}

export type Statement =
  | QueryStatement
  | UnionStatement
  | DifferenceStatement
  | RecurseStatement
  | OutStatement
  | ForeachStatement
  | IsInStatement
  | SetRefStatement
  | GeocodeAreaStatement
  | RawStatement

export type StatementKind = Statement['kind']

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface OverpassQuery {
  settings: Settings
  statements: Statement[]
}

export function emptyQuery(): OverpassQuery {
  return { settings: defaultSettings(), statements: [] }
}

/** Child statements of a container statement, for generic traversal. */
export function childStatements(stmt: Statement): Statement[] {
  switch (stmt.kind) {
    case 'union':
      return stmt.items
    case 'foreach':
      return stmt.body
    case 'difference':
      return [stmt.left, stmt.right].filter((s): s is Statement => s !== null)
    default:
      return []
  }
}

/** True when the statement can contain other statements. */
export function isContainer(stmt: Statement): boolean {
  return stmt.kind === 'union' || stmt.kind === 'foreach' || stmt.kind === 'difference'
}
