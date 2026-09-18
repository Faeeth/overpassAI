/**
 * The drawer under the map: how many results, and what they are.
 *
 * Failures land here rather than in a toast, because a failed Overpass query
 * almost always needs the user to do something specific, and the thing to do
 * has to stay on screen while they do it.
 */

import { useCallback, useRef } from 'react'

import { runCurrentQuery } from '../../features/session'
import { ENDPOINTS } from '../../services/overpass'
import { useQueryStore } from '../../store/useQueryStore'
import { useResultStore } from '../../store/useResultStore'
import { useUiStore, type ResultTab } from '../../store/useUiStore'
import { Icon } from '../Common/Icon'
import { ResultTable } from './ResultTable'

const TABS: Array<{ id: ResultTab; label: string }> = [
  { id: 'table', label: 'Table' },
  { id: 'raw', label: 'Response' },
  { id: 'query', label: 'Sent query' },
]

export function ResultsPanel() {
  const status = useResultStore((state) => state.status)
  const data = useResultStore((state) => state.data)
  const error = useResultStore((state) => state.error)

  const open = useUiStore((state) => state.resultsOpen)
  const setOpen = useUiStore((state) => state.setResultsOpen)
  const height = useUiStore((state) => state.resultsHeight)
  const setHeight = useUiStore((state) => state.setResultsHeight)
  const tab = useUiStore((state) => state.resultTab)
  const setTab = useUiStore((state) => state.setResultTab)

  const dragging = useRef(false)

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragging.current = true
      const startY = event.clientY
      const startHeight = height
      const element = event.currentTarget
      element.setPointerCapture(event.pointerId)
      element.dataset.dragging = 'true'

      const onMove = (move: PointerEvent) => {
        if (!dragging.current) return
        setHeight(startHeight + (startY - move.clientY))
      }
      const onUp = () => {
        dragging.current = false
        delete element.dataset.dragging
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [height, setHeight],
  )

  return (
    <section
      className={open ? 'results' : 'results results--collapsed'}
      style={open ? { height } : undefined}
      id="results-region"
      aria-label="Results"
      tabIndex={-1}
    >
      {open ? (
        <div
          className="resizer resizer--horizontal"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the results panel"
          aria-valuenow={Math.round(height)}
          aria-valuemin={120}
          aria-valuemax={720}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') setHeight(height + 16)
            if (event.key === 'ArrowDown') setHeight(height - 16)
          }}
        />
      ) : null}

      <div className="results__bar">
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--small"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Hide results' : 'Show results'}
          aria-expanded={open}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-up'} size={13} />
        </button>

        <Summary />

        {open ? (
          <div className="results__tabs" role="tablist" aria-label="Result view">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="results__body">
          {error ? <ErrorReport /> : null}

          {!error && status === 'idle' && !data ? (
            <div className="results__message">
              <h3>Nothing run yet</h3>
              <p>
                Build a query with blocks or write it as text, then press Run. Results appear
                here and on the map.
              </p>
            </div>
          ) : null}

          {!error && (status === 'running' || status === 'compiling') ? (
            <div className="results__message">
              <h3>{status === 'compiling' ? 'Preparing the query' : 'Waiting for the server'}</h3>
              <p>
                {status === 'compiling'
                  ? 'Looking up the places the query refers to.'
                  : 'Overpass is working. Large areas and loose filters take longer.'}
              </p>
            </div>
          ) : null}

          {!error && data && status === 'done' ? <ResultBody tab={tab} /> : null}
        </div>
      ) : null}
    </section>
  )
}

function Summary() {
  const status = useResultStore((state) => state.status)
  const data = useResultStore((state) => state.data)
  const error = useResultStore((state) => state.error)

  if (error) {
    return (
      <div className="results__summary" role="status" aria-live="polite">
        <span style={{ color: 'var(--danger)' }}>Query failed</span>
      </div>
    )
  }

  if (status === 'running' || status === 'compiling') {
    return (
      <div className="results__summary">
        <span className="btn__spinner" style={{ color: 'var(--accent)' }} />
        <span className="muted">{status === 'compiling' ? 'Preparing' : 'Running'}</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="results__summary" role="status" aria-live="polite">
        <span className="muted">Results</span>
      </div>
    )
  }

  const { stats, durationMs } = data
  const parts = [
    stats.nodes ? `${stats.nodes.toLocaleString()} points` : null,
    stats.ways ? `${stats.ways.toLocaleString()} lines and areas` : null,
    stats.relations ? `${stats.relations.toLocaleString()} relations` : null,
  ].filter(Boolean)

  return (
    <div className="results__summary" role="status" aria-live="polite">
      <span className="results__count">{stats.total.toLocaleString()}</span>
      <span>{stats.total === 1 ? 'result' : 'results'}</span>
      {parts.length ? <span className="results__meta">{parts.join(', ')}</span> : null}
      {/* Where it searched, which is not always where the map is looking:
          adding a feature reuses the query's existing place. */}
      {data.geocoded.length ? (
        <span className="results__meta" title={data.geocoded[0].displayName}>
          in {shortPlace(data.geocoded[0].displayName)}
        </span>
      ) : null}
      <span className="results__meta">in {(durationMs / 1000).toFixed(2)} s</span>
      {stats.withoutGeometry ? (
        <span className="results__meta">
          {stats.withoutGeometry.toLocaleString()} without geometry
        </span>
      ) : null}
    </div>
  )
}

function ResultBody({ tab }: { tab: ResultTab }) {
  const data = useResultStore((state) => state.data)
  if (!data) return null

  if (tab === 'raw') {
    return <pre className="results__raw">{prettyJson(data.raw)}</pre>
  }

  if (tab === 'query') {
    return (
      <>
        {data.geocoded.length ? (
          <div className="results__hint" style={{ margin: 'var(--space-3)' }}>
            {data.geocoded.map((place) => (
              <div key={place.query}>
                <span className="mono">{place.query}</span> resolved to {place.displayName}
              </div>
            ))}
          </div>
        ) : null}
        <pre className="results__raw">{data.compiledSource}</pre>
      </>
    )
  }

  if (data.csv !== null) {
    return <pre className="results__raw">{data.csv}</pre>
  }

  return <ResultTable collection={data.geojson} />
}

/**
 * A failed query, with the specific things worth trying next.
 *
 * Overpass instances go busy often enough that "the server is overloaded" is a
 * routine outcome, not an exceptional one. Telling someone to raise the timeout
 * or switch servers and leaving them to find the controls is the difference
 * between a dead end and a two-second detour, so the remedies are buttons.
 */
function ErrorReport() {
  const error = useResultStore((state) => state.error)
  const setTab = useUiStore((state) => state.setResultTab)
  const endpointUrl = useUiStore((state) => state.endpointUrl)
  const setEndpointUrl = useUiStore((state) => state.setEndpointUrl)
  const setEditorMode = useUiStore((state) => state.setEditorMode)
  const selectBlock = useUiStore((state) => state.selectBlock)
  const timeout = useQueryStore((state) => state.ast.settings.timeout ?? 25)
  const updateAst = useQueryStore((state) => state.updateAst)

  if (!error) return null

  const serverIsBusy =
    error.kind === 'timeout' || error.kind === 'rate-limit' || error.kind === 'server'
  const nextEndpoint =
    ENDPOINTS[(ENDPOINTS.findIndex((e) => e.url === endpointUrl) + 1) % ENDPOINTS.length]

  const retryElsewhere = () => {
    setEndpointUrl(nextEndpoint.url)
    // Let the store settle before the run reads the new endpoint.
    window.setTimeout(runCurrentQuery, 0)
  }

  const raiseTimeout = () => {
    updateAst((draft) => {
      draft.settings.timeout = Math.min(600, Math.max(60, timeout * 4))
    })
    window.setTimeout(runCurrentQuery, 0)
  }

  // With a list of issues, repeating the first one as a summary just says the
  // same thing twice; the list carries the detail and the fix.
  const listed = error.issues?.length ? error.issues : null

  return (
    <div className="results__message results__message--error">
      <h3>{titleFor(error.stage)}</h3>
      {listed ? null : <p>{error.message}</p>}

      {!listed && error.hint ? <div className="results__hint">{error.hint}</div> : null}

      {error.lines.length ? (
        <div className="results__hint">
          The server pointed at line {error.lines.join(', ')} of the sent query. Open the
          &ldquo;Sent query&rdquo; tab to see it with the shortcuts expanded.
        </div>
      ) : null}

      {listed ? (
        <ul className="issues">
          {listed.map((issue, index) => (
            <li className="issue" key={`${issue.statementId}-${index}`}>
              <button
                type="button"
                className="issue__jump"
                onClick={() => {
                  setEditorMode('blocks')
                  selectBlock(issue.statementId)
                }}
              >
                {issue.message}
              </button>
              {issue.fix ? <span className="issue__fix">{issue.fix}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="row" style={{ marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
        {serverIsBusy ? (
          <button type="button" className="btn btn--small btn--primary" onClick={retryElsewhere}>
            Try {nextEndpoint.label} instead
          </button>
        ) : null}

        {error.kind === 'timeout' ? (
          <button type="button" className="btn btn--small" onClick={raiseTimeout}>
            Give it {Math.min(600, Math.max(60, timeout * 4))} s and retry
          </button>
        ) : null}

        {error.stage === 'validate' ? null : (
          <button type="button" className="btn btn--small" onClick={() => setTab('query')}>
            Show the sent query
          </button>
        )}
      </div>
    </div>
  )
}

function titleFor(stage: 'validate' | 'compile' | 'request' | 'convert'): string {
  switch (stage) {
    case 'validate':
      return 'This query is not ready to run'
    case 'compile':
      return 'The query could not be prepared'
    case 'convert':
      return 'The response could not be read'
    default:
      return 'The server rejected the query'
  }
}

/** The first couple of parts of a Nominatim display name, which is the bit people recognise. */
export function shortPlace(displayName: string): string {
  return displayName.split(',').slice(0, 2).map((p) => p.trim()).join(', ')
}

/** Pretty-prints a JSON body, leaving anything else untouched. */
function prettyJson(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
