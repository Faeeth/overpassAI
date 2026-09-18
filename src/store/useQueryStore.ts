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

import type { OverpassQuery, Statement } from '../core/ast'
import { parse, type ParseError } from '../core/parser'
import { print } from '../core/printer'

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

  setSource: (source: string) => void
  updateAst: (recipe: (draft: OverpassQuery) => void) => void
  setStatements: (statements: Statement[]) => void
  setName: (name: string) => void
  /** Replaces everything, e.g. from a permalink or a project file. */
  load: (source: string, options?: { name?: string; ast?: OverpassQuery }) => void
  reset: () => void
}

function fromSource(source: string): Pick<QueryState, 'source' | 'ast' | 'parseErrors'> {
  const { query, errors } = parse(source)
  return { source, ast: query, parseErrors: errors }
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
    set({ ast: draft, source: print(draft), parseErrors: [], origin: 'blocks' })
  },

  setStatements: (statements) => {
    get().updateAst((draft) => {
      draft.statements = statements
    })
  },

  setName: (name) => set({ name }),

  load: (source, options = {}) => {
    const parsed = fromSource(source)
    set({
      ...parsed,
      // A project file carries its tree, which preserves labels and muted
      // blocks exactly as they were saved.
      ast: options.ast ?? parsed.ast,
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
