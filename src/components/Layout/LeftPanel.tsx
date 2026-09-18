/**
 * The query panel: the same query, shown either as blocks or as text.
 *
 * Both views edit one AST, so switching between them is free and lossless.
 * The tab badge counts parse errors, because a broken query is the one thing
 * that makes the block view incomplete and the user needs to know which view
 * to go and fix it in.
 */

import { BlockEditor } from '../Blocks/BlockEditor'
import { TextEditor } from '../Editor/TextEditor'
import { Icon } from '../Common/Icon'
import { useQueryStore } from '../../store/useQueryStore'
import { useUiStore } from '../../store/useUiStore'
import { Welcome } from './Welcome'

export function LeftPanel({ open }: { open: boolean }) {
  const mode = useUiStore((state) => state.editorMode)
  const setMode = useUiStore((state) => state.setEditorMode)
  const parseErrors = useQueryStore((state) => state.parseErrors)
  const dismissed = useUiStore((state) => state.onboardingDismissed)

  return (
    <div className="panel" data-open={open || undefined}>
      <div className="panel__tabs" role="tablist" aria-label="Query view">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mode === 'blocks'}
          onClick={() => setMode('blocks')}
        >
          <Icon name="blocks" size={13} /> Blocks
        </button>

        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={mode === 'text'}
          onClick={() => setMode('text')}
        >
          <Icon name="code" size={13} /> Text
          {parseErrors.length ? (
            <span className="tab__badge" title={`${parseErrors.length} problems`}>
              {parseErrors.length}
            </span>
          ) : null}
        </button>
      </div>

      <div className="panel__scroll" role="tabpanel">
        {!dismissed ? <Welcome /> : null}
        {mode === 'blocks' ? <BlockEditor /> : <TextEditor />}
      </div>
    </div>
  )
}
