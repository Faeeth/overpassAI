/**
 * How each statement kind presents itself as a block.
 *
 * The role decides the colour of the block's left edge, which works like a map
 * legend: scope narrows where to look, select picks features, combine joins or
 * subtracts sets, output decides what comes back. A twelve-block query is then
 * readable at a glance without reading any of the text.
 */

import type { Statement, StatementKind } from '../../core/ast'

export type BlockRole = 'scope' | 'select' | 'combine' | 'output' | 'raw'

export interface BlockMeta {
  role: BlockRole
  /** Shown on the block header. */
  title: string
  /** Shown in the "add block" menu. */
  menuTitle: string
  description: string
}

const META: Record<StatementKind, BlockMeta> = {
  geocodeArea: {
    role: 'scope',
    title: 'Place',
    menuTitle: 'Place',
    description: 'Search inside a town, region or country, found by name.',
  },
  query: {
    role: 'select',
    title: 'Find',
    menuTitle: 'Find features',
    description: 'Pick elements by their tags, location and metadata.',
  },
  union: {
    role: 'combine',
    title: 'Any of',
    menuTitle: 'Any of',
    description: 'Collect everything matched by the blocks inside it.',
  },
  difference: {
    role: 'combine',
    title: 'Except',
    menuTitle: 'Except',
    description: 'Take one set and remove another from it.',
  },
  recurse: {
    role: 'combine',
    title: 'Expand',
    menuTitle: 'Expand',
    description: 'Pull in the parts of what you found, or what contains it.',
  },
  foreach: {
    role: 'combine',
    title: 'For each',
    menuTitle: 'For each',
    description: 'Run the blocks inside once per element found so far.',
  },
  setref: {
    role: 'combine',
    title: 'Use set',
    menuTitle: 'Use a saved set',
    description: 'Bring a named set back into the flow.',
  },
  isin: {
    role: 'scope',
    title: 'Areas at point',
    menuTitle: 'Areas at a point',
    description: 'Find every area covering a coordinate.',
  },
  out: {
    role: 'output',
    title: 'Output',
    menuTitle: 'Output',
    description: 'Decide what the server sends back, and how much of it.',
  },
  raw: {
    role: 'raw',
    title: 'Advanced',
    menuTitle: 'Raw Overpass QL',
    description: 'Write Overpass QL directly, for anything the blocks do not cover.',
  },
}

export function metaFor(stmt: Statement): BlockMeta {
  // An area query is scoping, not selecting, even though it is the same node
  // kind: showing it in the select colour would misread the query's shape.
  if (stmt.kind === 'query' && stmt.type === 'area') {
    return { ...META.query, role: 'scope', title: 'Area' }
  }
  return META[stmt.kind]
}

export function metaForKind(kind: StatementKind): BlockMeta {
  return META[kind]
}

/** Order of the "add block" menu: the common things first. */
export const ADD_MENU_ORDER: StatementKind[] = [
  'query',
  'geocodeArea',
  'union',
  'difference',
  'out',
  'recurse',
  'foreach',
  'setref',
  'isin',
  'raw',
]

// ---------------------------------------------------------------------------
// Vocabulary shown in the pickers
// ---------------------------------------------------------------------------

export const QUERY_TYPE_LABELS: Array<{ value: string; label: string }> = [
  { value: 'nwr', label: 'Anything' },
  { value: 'node', label: 'Points' },
  { value: 'way', label: 'Lines and areas' },
  { value: 'rel', label: 'Relations' },
  { value: 'nw', label: 'Points and lines' },
  { value: 'nr', label: 'Points and relations' },
  { value: 'wr', label: 'Lines and relations' },
  { value: 'area', label: 'Areas' },
]

export const TAG_OP_LABELS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'eq', label: 'is', hint: 'key equals value' },
  { value: 'neq', label: 'is not', hint: 'key differs from value' },
  { value: 'exists', label: 'exists', hint: 'key is present, any value' },
  { value: 'missing', label: 'is absent', hint: 'key is not present' },
  { value: 'like', label: 'matches', hint: 'value matches a regular expression' },
  { value: 'notlike', label: 'does not match', hint: 'value fails a regular expression' },
]

export const FILTER_MENU: Array<{ kind: string; label: string; description: string }> = [
  { kind: 'tag', label: 'Tag', description: 'Match a key and value, like amenity=cafe.' },
  { kind: 'area', label: 'In area', description: 'Restrict to a place found earlier.' },
  { kind: 'bbox', label: 'In map view', description: 'Restrict to what the map currently shows.' },
  { kind: 'around', label: 'Near', description: 'Within a radius of a point or an earlier result.' },
  { kind: 'ids', label: 'By id', description: 'Fetch specific OSM elements.' },
  { kind: 'recurse', label: 'Related to', description: 'Members of, or parents of, an earlier set.' },
  { kind: 'poly', label: 'In polygon', description: 'Inside a hand-written list of coordinates.' },
  { kind: 'user', label: 'Edited by', description: 'Last touched by a given mapper.' },
  { kind: 'newer', label: 'Changed since', description: 'Edited after a date.' },
  { kind: 'pivot', label: 'Outline of area', description: 'The element an area was built from.' },
  { kind: 'if', label: 'Condition', description: 'An Overpass expression, for advanced filtering.' },
]

export const RECURSE_ROLE_LABELS: Array<{ value: string; label: string }> = [
  { value: 'n', label: 'nodes of' },
  { value: 'w', label: 'ways of' },
  { value: 'r', label: 'relations of' },
  { value: 'bn', label: 'containing the nodes of' },
  { value: 'bw', label: 'containing the ways of' },
  { value: 'br', label: 'containing the relations of' },
]

export const RECURSE_OP_LABELS: Array<{ value: string; label: string }> = [
  { value: '>', label: 'add the parts of what I found' },
  { value: '<', label: 'add what contains what I found' },
  { value: '>>', label: 'add all parts, following every level' },
  { value: '<<', label: 'add all containers, following every level' },
]

export const OUT_VERBOSITY_LABELS: Array<{ value: string; label: string }> = [
  { value: 'body', label: 'Tags and members' },
  { value: 'tags', label: 'Tags only' },
  { value: 'skel', label: 'Geometry only' },
  { value: 'ids', label: 'Ids only' },
  { value: 'meta', label: 'Everything, with edit history' },
]

export const OUT_GEOMETRY_LABELS: Array<{ value: string; label: string }> = [
  { value: 'geom', label: 'Full geometry' },
  { value: 'center', label: 'Centre point only' },
  { value: 'bb', label: 'Bounding box only' },
  { value: '', label: 'No geometry' },
]
