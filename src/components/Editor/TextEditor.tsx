/**
 * The text view of a query.
 *
 * The editor owns the document while it has focus, and mirrors the store when
 * it does not. Without that rule, every keystroke would round-trip through
 * parse and print and reset the caret to the top of the document.
 */

import { useEffect, useMemo, useRef } from 'react'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'

import { useQueryStore } from '../../store/useQueryStore'
import { useUiStore } from '../../store/useUiStore'
import {
  overpassCompletion,
  overpassHighlighting,
  overpassLanguage,
  overpassTheme,
} from './overpassLanguage'

export function TextEditor() {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  const source = useQueryStore((state) => state.source)
  const parseErrors = useQueryStore((state) => state.parseErrors)
  const validation = useQueryStore((state) => state.validation)
  const blockLines = useQueryStore((state) => state.lines)
  const setSource = useQueryStore((state) => state.setSource)
  const revealAt = useUiStore((state) => state.revealLine)
  const clearReveal = useUiStore((state) => state.revealInText)

  /**
   * Everything wrong with the query, in one list.
   *
   * Parse errors say the text cannot be read; validation issues say it reads
   * fine but will not run. Both point at a line, so they belong together
   * rather than in two places the user has to know to check.
   */
  const problems = useMemo(() => {
    const fromText = parseErrors.map((error) => ({
      line: error.line,
      column: error.column,
      message: error.message,
      severity: 'error' as const,
    }))

    const fromBlocks = validation.issues
      .filter((issue) => issue.statementId && blockLines[issue.statementId])
      .map((issue) => ({
        line: blockLines[issue.statementId],
        column: 1,
        message: issue.fix ? `${issue.message} ${issue.fix}` : issue.message,
        severity: issue.severity,
      }))

    return [...fromText, ...fromBlocks].sort((a, b) => a.line - b.line)
  }, [parseErrors, validation, blockLines])

  // Create the editor once; its content is synced by the effect below.
  useEffect(() => {
    if (!host.current) return

    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: useQueryStore.getState().source,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          rectangularSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          overpassLanguage,
          overpassHighlighting,
          overpassTheme,
          overpassCompletion,
          EditorView.lineWrapping,
          placeholder('Write Overpass QL here, or build the query with blocks.'),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            setSource(update.state.doc.toString())
          }),
        ],
      }),
    })

    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
  }, [setSource])

  // Mirror store changes that did not come from typing here.
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    if (instance.hasFocus) return

    const current = instance.state.doc.toString()
    if (current === source) return

    instance.dispatch({
      changes: { from: 0, to: current.length, insert: source },
    })
  }, [source])

  const jumpTo = (line: number) => {
    const instance = view.current
    if (!instance) return
    const target = instance.state.doc.line(Math.max(1, Math.min(line, instance.state.doc.lines)))
    instance.dispatch({
      selection: { anchor: target.from, head: target.to },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    })
    instance.focus()
  }

  // A block asked to be shown here. The editor may have only just mounted,
  // since it is loaded on demand, so this runs after the doc is in place.
  useEffect(() => {
    if (revealAt === null) return
    const timer = window.setTimeout(() => {
      jumpTo(revealAt)
      clearReveal(null)
    }, 60)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealAt])

  return (
    <div className="editor">
      <div className="editor__surface" ref={host} />

      {problems.length ? (
        <div className="editor__errors">
          {problems.map((problem, index) => (
            <button
              key={`${problem.line}-${index}`}
              type="button"
              className={`editor__error editor__error--${problem.severity}`}
              onClick={() => jumpTo(problem.line)}
            >
              <span className="editor__error-pos">
                {problem.line}:{problem.column}
              </span>
              <span>{problem.message}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
