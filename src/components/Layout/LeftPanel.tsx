/**
 * The query panel: the same query, shown either as blocks or as text.
 *
 * Both views edit one AST, so switching between them is free and lossless.
 * The tab badges count problems, because the two views fail differently: the
 * text view can be unparseable, and the block view can be complete but not
 * runnable. Either way the badge says which tab to go and look at.
 */

import { Suspense, lazy, useCallback, useState } from 'react'

import { BlockEditor } from '../Blocks/BlockEditor'
import { Icon } from '../Common/Icon'
import { useQueryStore } from '../../store/useQueryStore'
import { useUiStore } from '../../store/useUiStore'
import { Welcome } from './Welcome'

/**
 * CodeMirror is 115 kB gzipped and the app opens on the block view, so most
 * first loads never need it. It is fetched when the text tab is opened, and
 * prefetched on hover so the switch still feels instant.
 */
const loadTextEditor = () =>
  import('../Editor/TextEditor').then((module) => ({ default: module.TextEditor }))

const TextEditor = lazy(loadTextEditor)

export function LeftPanel({ open }: { open: boolean }) {
  const mode = useUiStore((state) => state.editorMode)
  const setMode = useUiStore((state) => state.setEditorMode)
  const parseErrors = useQueryStore((state) => state.parseErrors)
  const validation = useQueryStore((state) => state.validation)
  const dismissed = useUiStore((state) => state.onboardingDismissed)

  const [prefetched, setPrefetched] = useState(false)
  const prefetch = useCallback(() => {
    if (prefetched) return
    setPrefetched(true)
    void loadTextEditor()
  }, [prefetched])

  const blockProblems = validation.errors.length

  return (
    <div
      className="panel"
      id="query-panel"
      data-open={open || undefined}
      role="region"
      aria-label="Query"
      tabIndex={-1}
    >
      <div className="panel__tabs" role="tablist" aria-label="Query view">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mode === 'blocks'}
          onClick={() => setMode('blocks')}
        >
          <Icon name="blocks" size={13} /> Blocks
          {blockProblems ? (
            <span
              className="tab__badge"
              title={`${blockProblems} ${blockProblems === 1 ? 'block needs' : 'blocks need'} attention`}
            >
              {blockProblems}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mode === 'text'}
          onClick={() => setMode('text')}
          onPointerEnter={prefetch}
          onFocus={prefetch}
        >
          <Icon name="code" size={13} /> Text
          {parseErrors.length ? (
            <span
              className="tab__badge"
              title={`${parseErrors.length} ${parseErrors.length === 1 ? 'problem' : 'problems'} in the query text`}
            >
              {parseErrors.length}
            </span>
          ) : null}
        </button>
      </div>

      <div className="panel__scroll" role="tabpanel">
        {!dismissed ? <Welcome /> : null}
        {mode === 'blocks' ? (
          <BlockEditor />
        ) : (
          <Suspense fallback={<div className="panel__loading">Loading the editor...</div>}>
            <TextEditor />
          </Suspense>
        )}
      </div>
    </div>
  )
}
