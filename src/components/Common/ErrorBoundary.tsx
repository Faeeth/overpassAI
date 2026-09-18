/**
 * Last line of defence against a blank page.
 *
 * A thrown render is the one failure the rest of the app cannot report, and a
 * white screen tells the user nothing and loses whatever they were writing.
 * This keeps the query recoverable: it is in the address bar already, and the
 * panel offers to copy it out before anything is reloaded.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  /** Component stack, which says which part failed. */
  where: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, where: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep it in the console too: the panel is for the user, this is for
    // whoever they send the screenshot to.
    console.error('OverpassAI crashed while rendering', error, info.componentStack)
    this.setState({ where: info.componentStack ?? null })
  }

  private copyQuery = (): void => {
    // The query lives in the location hash, so it is recoverable even now.
    void navigator.clipboard.writeText(window.location.href).catch(() => {
      /* clipboard refused; the address bar still holds it */
    })
  }

  render(): ReactNode {
    const { error, where } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash" role="alert">
        <div className="crash__card">
          <h1>Something in the page stopped working</h1>
          <p>
            Your query is safe: it is encoded in this page&rsquo;s address, so copying the link
            keeps it. Reloading should bring everything back.
          </p>

          <pre className="crash__detail">{error.message}</pre>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
              Reload the page
            </button>
            <button type="button" className="btn" onClick={this.copyQuery}>
              Copy the link to my query
            </button>
            <a
              className="btn"
              href="https://github.com/Faeeth/overpassAI/issues/new"
              target="_blank"
              rel="noreferrer"
            >
              Report this
            </a>
          </div>

          {where ? (
            <details className="crash__stack">
              <summary>Technical detail</summary>
              <pre>{where.trim()}</pre>
            </details>
          ) : null}
        </div>
      </div>
    )
  }
}
