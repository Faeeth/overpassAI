/**
 * The top bar: name the query, run it, and everything that acts on the whole
 * session.
 *
 * Run is the only element allowed the accent colour, because it is the only
 * thing on this bar that costs anything to press.
 */

import { useEffect, useState } from 'react'

import { buildUrl } from '../../features/permalink'
import { runCurrentQuery } from '../../features/session'
import { ENDPOINTS } from '../../services/overpass'
import { useQueryStore } from '../../store/useQueryStore'
import { useResultStore } from '../../store/useResultStore'
import { useUiStore, type Theme } from '../../store/useUiStore'
import { BrandMark, Icon } from '../Common/Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../Common/Menu'
import { toast } from '../Common/Toast'
import { AccountButton } from './AccountButton'
import { ExportDialog } from './ExportDialog'
import { LibraryDialog } from './LibraryDialog'

export function TopBar() {
  const [exporting, setExporting] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const name = useQueryStore((state) => state.name)
  const setName = useQueryStore((state) => state.setName)
  const source = useQueryStore((state) => state.source)
  const reset = useQueryStore((state) => state.reset)

  const status = useResultStore((state) => state.status)
  const cancel = useResultStore((state) => state.cancel)

  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const endpointUrl = useUiStore((state) => state.endpointUrl)
  const setEndpointUrl = useUiStore((state) => state.setEndpointUrl)
  const view = useUiStore((state) => state.view)

  const busy = status === 'running' || status === 'compiling'

  // Ctrl/Cmd + Enter runs, matching every other query console.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        runCurrentQuery()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const share = () => {
    const url = buildUrl({ query: source, view })
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied. It carries the query, not the results.'))
      .catch(() => toast.error('The browser would not let the page copy the link'))
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <BrandMark className="topbar__mark" />
        OverpassAI
      </div>

      <input
        className="topbar__name"
        value={name}
        aria-label="Query name"
        onChange={(event) => setName(event.target.value)}
      />

      <div className="topbar__spacer" />

      <div className="topbar__group">
        {busy ? (
          <button type="button" className="btn btn--primary" onClick={cancel}>
            <Icon name="stop" size={11} /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={runCurrentQuery}
            title="Run the query (Ctrl+Enter)"
          >
            <Icon name="run" size={11} /> Run
          </button>
        )}

        <Menu
          triggerClassName="btn btn--ghost btn--icon"
          triggerLabel="Choose an Overpass server"
          trigger={<Icon name="settings" />}
          align="end"
        >
          {(close) => (
            <>
              <MenuLabel>Overpass server</MenuLabel>
              {ENDPOINTS.map((endpoint) => (
                <MenuItem
                  key={endpoint.id}
                  icon={
                    endpoint.url === endpointUrl ? (
                      <Icon name="check" size={13} />
                    ) : (
                      <span style={{ width: 13 }} />
                    )
                  }
                  onClick={() => {
                    setEndpointUrl(endpoint.url)
                    close()
                  }}
                >
                  <span title={endpoint.note}>{endpoint.label}</span>
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  const custom = window.prompt('Overpass interpreter URL', endpointUrl)
                  if (custom) setEndpointUrl(custom.trim())
                  close()
                }}
              >
                Use another server...
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      <div className="topbar__divider" />

      <div className="topbar__group">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={share}
          aria-label="Copy a shareable link"
          title="Copy a shareable link"
        >
          <Icon name="share" />
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => setExporting(true)}
          aria-label="Export"
          title="Export"
        >
          <Icon name="download" />
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => setLibraryOpen(true)}
          aria-label="Saved queries"
          title="Saved queries"
        >
          <Icon name="folder" />
        </button>

        <Menu
          triggerClassName="btn btn--ghost btn--icon"
          triggerLabel="More"
          trigger={<Icon name="menu" />}
          align="end"
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  reset()
                  close()
                }}
              >
                Start a new query
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Appearance</MenuLabel>
              {(
                [
                  ['system', 'Match the system'],
                  ['dark', 'Dark'],
                  ['light', 'Light'],
                ] as Array<[Theme, string]>
              ).map(([value, label]) => (
                <MenuItem
                  key={value}
                  icon={
                    theme === value ? (
                      <Icon name="check" size={13} />
                    ) : (
                      <span style={{ width: 13 }} />
                    )
                  }
                  onClick={() => {
                    setTheme(value)
                    close()
                  }}
                >
                  {label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                icon={<Icon name="external" size={13} />}
                onClick={() => {
                  window.open('https://wiki.openstreetmap.org/wiki/Overpass_API', '_blank')
                  close()
                }}
              >
                Overpass documentation
              </MenuItem>
              <MenuItem
                icon={<Icon name="external" size={13} />}
                onClick={() => {
                  window.open('https://taginfo.openstreetmap.org/', '_blank')
                  close()
                }}
              >
                Browse OSM tags
              </MenuItem>
            </>
          )}
        </Menu>

        <AccountButton />
      </div>

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      <LibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </header>
  )
}
