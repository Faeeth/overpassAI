/**
 * Overpass QL support for CodeMirror.
 *
 * A stream tokeniser rather than a Lezer grammar: highlighting only needs to
 * know what kind of token it is looking at, and the real parse already happens
 * in `core/parser.ts`. Keeping one parser instead of two means the text view
 * and the block view can never disagree about what the query says.
 */

import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

import { suggestKeys, suggestValues, formatCount } from '../../services/taginfo'

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

const STATEMENT_KEYWORDS = new Set([
  'node', 'way', 'rel', 'relation', 'nwr', 'nw', 'nr', 'wr', 'area', 'derived',
  'out', 'foreach', 'is_in', 'make', 'convert', 'local', 'timeline', 'complete',
  'retro', 'compare', 'for', 'if', 'else',
])

const MODIFIER_KEYWORDS = new Set([
  'ids', 'skel', 'body', 'tags', 'meta', 'geom', 'bb', 'center', 'asc', 'qt', 'count',
])

const FILTER_KEYWORDS = new Set([
  'around', 'poly', 'id', 'uid', 'user', 'newer', 'changed', 'pivot', 'bbox',
  'n', 'w', 'r', 'bn', 'bw', 'br',
])

const SETTING_KEYWORDS = new Set(['timeout', 'maxsize', 'date', 'diff', 'adiff', 'csv', 'json', 'xml'])

interface TokenState {
  /** Inside a `[...]` filter, where a bare word is a tag key. */
  inBracket: boolean
}

export const overpassLanguage = StreamLanguage.define<TokenState>({
  name: 'overpassql',

  startState: () => ({ inBracket: false }),

  token(stream, state) {
    if (stream.eatSpace()) return null

    // Comments
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      while (!stream.eol()) {
        if (stream.match('*/')) break
        stream.next()
      }
      return 'comment'
    }

    // Overpass turbo style templates
    if (stream.match(/^\{\{[^}]*\}\}/)) return 'meta'

    // Strings
    const quote = stream.peek()
    if (quote === '"' || quote === "'") {
      stream.next()
      let escaped = false
      while (!stream.eol()) {
        const ch = stream.next()
        if (escaped) {
          escaped = false
          continue
        }
        if (ch === '\\') escaped = true
        else if (ch === quote) break
      }
      return 'string'
    }

    // Set references
    if (stream.match(/^\.[A-Za-z_][A-Za-z0-9_]*/)) return 'variableName'
    if (stream.match('->')) return 'operator'

    // Numbers
    if (stream.match(/^-?\d+(\.\d+)?/)) return 'number'

    // Brackets
    if (stream.match(/^[[\]]/)) {
      state.inBracket = stream.string[stream.pos - 1] === '['
      return 'bracket'
    }
    if (stream.match(/^[(){}]/)) return 'bracket'

    // Operators
    if (stream.match(/^(!=|!~|>>|<<|[=~<>!;,:-])/)) return 'operator'

    // Words
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_:]*/)
    if (word && word !== true) {
      const text = word[0]
      if (STATEMENT_KEYWORDS.has(text)) return 'keyword'
      if (MODIFIER_KEYWORDS.has(text)) return 'modifier'
      if (FILTER_KEYWORDS.has(text)) return 'operatorKeyword'
      if (SETTING_KEYWORDS.has(text)) return 'modifier'
      return state.inBracket ? 'propertyName' : 'variableName'
    }

    stream.next()
    return null
  },

  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
})

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

export const overpassHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '500' },
    { tag: tags.modifier, color: 'var(--syntax-keyword)' },
    { tag: tags.operatorKeyword, color: 'var(--syntax-operator)' },
    { tag: tags.string, color: 'var(--syntax-string)' },
    { tag: tags.number, color: 'var(--syntax-number)' },
    { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: tags.operator, color: 'var(--syntax-operator)' },
    { tag: tags.bracket, color: 'var(--syntax-bracket)' },
    { tag: tags.meta, color: 'var(--syntax-template)', fontWeight: '500' },
    { tag: tags.variableName, color: 'var(--syntax-set)' },
    { tag: tags.propertyName, color: 'var(--fg)' },
  ]),
)

/** Editor chrome that follows the app theme through CSS variables. */
export const overpassTheme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'var(--bg-input)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-panel)', color: 'var(--fg-faint)', border: 'none' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-raised)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-control)',
    boxShadow: 'var(--shadow-float)',
  },
  '.cm-tooltip-autocomplete ul li': { fontFamily: 'var(--font-mono)', fontSize: '12px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--fg)',
  },
  '.cm-completionDetail': { color: 'var(--fg-faint)', fontStyle: 'normal' },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--accent-wash)',
    color: 'inherit !important',
    outline: '1px solid var(--accent)',
  },
})

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const STATEMENT_COMPLETIONS = [
  { label: 'node', type: 'keyword', detail: 'points' },
  { label: 'way', type: 'keyword', detail: 'lines and areas' },
  { label: 'rel', type: 'keyword', detail: 'relations' },
  { label: 'nwr', type: 'keyword', detail: 'nodes, ways and relations' },
  { label: 'area', type: 'keyword', detail: 'areas' },
  { label: 'out', type: 'keyword', detail: 'return results' },
  { label: 'foreach', type: 'keyword', detail: 'loop over results' },
  { label: 'is_in', type: 'keyword', detail: 'areas covering a point' },
  { label: 'out geom', type: 'keyword', detail: 'return full geometry' },
  { label: 'out body', type: 'keyword', detail: 'return tags and members' },
  { label: 'out skel qt', type: 'keyword', detail: 'return geometry, fastest order' },
  { label: 'out center', type: 'keyword', detail: 'return one point per element' },
  { label: 'out meta', type: 'keyword', detail: 'return edit history too' },
  { label: '{{bbox}}', type: 'constant', detail: 'the current map view' },
  { label: '{{geocodeArea:}}', type: 'constant', detail: 'search inside a named place' },
  { label: '[out:json][timeout:25];', type: 'constant', detail: 'standard prologue' },
]

const FILTER_COMPLETIONS = [
  { label: 'area', type: 'function', detail: 'inside an area' },
  { label: 'around', type: 'function', detail: 'within a radius' },
  { label: 'poly', type: 'function', detail: 'inside a polygon' },
  { label: 'id', type: 'function', detail: 'by element id' },
  { label: 'user', type: 'function', detail: 'by mapper' },
  { label: 'uid', type: 'function', detail: 'by mapper id' },
  { label: 'newer', type: 'function', detail: 'changed since a date' },
  { label: 'changed', type: 'function', detail: 'changed in a window' },
  { label: 'pivot', type: 'function', detail: 'the element behind an area' },
  { label: 'if', type: 'function', detail: 'an Overpass condition' },
]

/**
 * Suggests statements, filters, and live tag keys and values from taginfo.
 *
 * Tag completion is what makes the text view usable without the wiki open in
 * another window, so it fires inside `[...]` on both sides of the operator.
 */
async function complete(context: CompletionContext): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)

  // Inside a tag filter, after the operator: complete the value for this key.
  const valueMatch = /\[\s*"?([\w:]+)"?\s*(=|!=|~|!~)\s*"?([^"\]]*)$/.exec(before)
  if (valueMatch) {
    const [, key, , typed] = valueMatch
    const values = await suggestValues(key, typed, 25).catch(() => [])
    if (!values.length) return null

    return {
      from: context.pos - typed.length,
      options: values.map((value) => ({
        label: value.value,
        type: 'text',
        detail: formatCount(value.count),
      })),
      validFor: /^[^"\]]*$/,
    }
  }

  // Inside a tag filter, before the operator: complete the key.
  const keyMatch = /\[\s*!?~?\s*"?([\w:]*)$/.exec(before)
  if (keyMatch) {
    const typed = keyMatch[1]
    const keys = await suggestKeys(typed, 25).catch(() => [])
    if (!keys.length) return null

    return {
      from: context.pos - typed.length,
      options: keys.map((key) => ({
        label: key.key,
        type: 'property',
        detail: formatCount(key.count),
      })),
      validFor: /^[\w:]*$/,
    }
  }

  // Inside a parenthesised filter.
  if (/\(\s*(\w*)$/.test(before) && /\]\s*\($|\w\s*\($/.test(before)) {
    const word = context.matchBefore(/\w*/)
    if (!word) return null
    return { from: word.from, options: FILTER_COMPLETIONS, validFor: /^\w*$/ }
  }

  const word = context.matchBefore(/[\w{[:]*/)
  if (!word || (word.from === word.to && !context.explicit)) return null

  return { from: word.from, options: STATEMENT_COMPLETIONS, validFor: /^[\w{[:]*$/ }
}

export const overpassCompletion = autocompletion({
  override: [complete],
  activateOnTyping: true,
  closeOnBlur: true,
  maxRenderedOptions: 30,
})
