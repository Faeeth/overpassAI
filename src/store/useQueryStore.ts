/**
 * The query, in both of its forms.
 *
 * The AST is authoritative and the text is derived from it, except while the
 * user is typing, when the text is authoritative and the AST is derived from
 * it. `origin` records which way round it currently is, so the text editor can
 * avoid stomping on the caret when a block edit rewrites the source underneath
 * it.
 */

import { create } from 'zustand'

import type { NodeId, OverpassQuery, Statement } from '../core/ast'
import { parse, type ParseError } from '../core/parser'
import { printWithLines } from '../core/printer'
import { validate, type ValidationResult } from '../core/validate'

export const STARTER_QUERY = `[out:json][timeout:25];
// Search inside a named place
{{geocodeArea:Lyon}}->.searchArea;
// Find the features
nwr["amenity"="restaurant"](area.searchArea);
// Return them with their geometry
out geom 1000;`

export type EditOrigin = 'text' | 'blocks' | 'external'

interface QueryState {
  /** Overpass QL as shown in the text editor. */
  source: string
  ast: OverpassQuery
  parseErrors: ParseError[]
  /** Which view produced the current state. */
  origin: EditOrigin
  /** Bumped on every external load, so editors know to reset. */
  revision: number
  /** Name used for saving and for export file names. */
  name: string
  /**
   * Problems with the current tree.
   *
   * Derived state, computed once per change rather than per component.
   * Validating inside each block looked harmless and meant walking the whole
   * tree once per block on every render.
   */
  validation: ValidationResult
  /**
   * The source line each block sits on.
   *
   * Written by whichever side last produced the text, so the views can point
   * at each other: a problem in the text names its block, and a block can
   * reveal itself in the text.
   */
  lines: Record<NodeId, number>

  setSource: (source: string) => void
  updateAst: (recipe: (draft: OverpassQuery) => void) => void
  setStatements: (statements: Statement[]) => void
  setName: (name: string) => void
  /** Replaces everything, e.g. from a permalink or a project file. */
  load: (source: string, options?: { name?: string; ast?: OverpassQuery }) => void
  reset: () => void
}

function fromSource(source: string): Pick<
  QueryState,
  'source' | 'ast' | 'parseErrors' | 'validation' | 'lines'
> {
  const { query, errors, lines } = parse(source)
  return { source, ast: query, parseErrors: errors, validation: validate(query), lines }
}

export const useQueryStore = create<QueryState>((set, get) => ({
  ...fromSource(STARTER_QUERY),
  origin: 'external',
  revision: 0,
  name: 'Untitled query',

  setSource: (source) => {
    if (source === get().source) return
    set({ ...fromSource(source), origin: 'text' })
  },

  updateAst: (recipe) => {
    // structuredClone keeps the store immutable without an immer dependency.
    // Queries are small enough that copying the whole tree per keystroke is
    // cheaper than the machinery to avoid it.
    const draft = structuredClone(get().ast)
    recipe(draft)
    const printed = printWithLines(draft)
    set({
      ast: draft,
      source: printed.text,
      lines: printed.lines,
      parseErrors: [],
      validation: validate(draft),
      origin: 'blocks',
    })
  },

  setStatements: (statements) => {
    get().updateAst((draft) => {
      draft.statements = statements
    })
  },

  setName: (name) => set({ name }),

  load: (source, options = {}) => {
    const parsed = fromSource(source)
    // A project file carries its tree, which preserves labels and muted
    // blocks exactly as they were saved.
    const ast = options.ast ?? parsed.ast
    // A stored tree has ids of its own, so the lines have to come from
    // printing it rather than from parsing the text beside it.
    const printed = options.ast ? printWithLines(ast) : null
    set({
      ...parsed,
      ast,
      lines: printed?.lines ?? parsed.lines,
      validation: validate(ast),
      name: options.name ?? get().name,
      origin: 'external',
      revision: get().revision + 1,
    })
  },

  reset: () => {
    set({
      ...fromSource(STARTER_QUERY),
      name: 'Untitled query',
      origin: 'external',
      revision: get().revision + 1,
    })
  },
}))

/** True when the query text cannot currently be turned into blocks. */
export function hasBlockingErrors(errors: ParseError[]): boolean {
  return errors.length > 0
}
