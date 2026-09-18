/**
 * The text view of a query.
 *
 * The editor owns the document while it has focus, and mirrors the store when
 * it does not. Without that rule, every keystroke would round-trip through
 * parse and print and reset the caret to the top of the document.
 */

import { useEffect, useRef } from 'react'
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
  const setSource = useQueryStore((state) => state.setSource)

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
    const target = instance.state.doc.line(Math.min(line, instance.state.doc.lines))
    instance.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    })
    instance.focus()
  }

  return (
    <div className="editor">
      <div className="editor__surface" ref={host} />

      {parseErrors.length ? (
        <div className="editor__errors">
          {parseErrors.map((error, index) => (
            <button
              key={`${error.offset}-${index}`}
              type="button"
              className="editor__error"
              onClick={() => jumpTo(error.line)}
            >
              <span className="editor__error-pos">
                {error.line}:{error.column}
              </span>
              <span>{error.message}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
