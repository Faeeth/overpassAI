/**
 * Application shell.
 *
 * Owns the three things that span the whole window: the theme, the permalink
 * in the address bar, and dropping a project file anywhere on the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { readProjectFile, ProjectFormatError } from './features/exporters/project'
import { readCurrentHash, updateHash } from './features/permalink'
import { openProjectFile, runCurrentQuery } from './features/session'
import { ENDPOINTS } from './services/overpass'
import { useQueryStore } from './store/useQueryStore'
import { useUiStore, resolveTheme } from './store/useUiStore'
import { Icon } from './components/Common/Icon'
import { ToastHost, toast } from './components/Common/Toast'
import { LeftPanel } from './components/Layout/LeftPanel'
import { MapView } from './components/Map/MapView'
import { Inspector } from './components/Results/Inspector'
import { ResultsPanel } from './components/Results/ResultsPanel'
import { TopBar } from './components/Toolbar/TopBar'

import './styles/theme.css'
import './styles/app.css'

export default function App() {
  useTheme()
  usePermalink()
  const dropping = useProjectDrop()

  const panelWidth = useUiStore((state) => state.panelWidth)
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <div className="shell" style={{ ['--panel-width' as string]: `${panelWidth}px` }}>
      <TopBar />

      <div className="shell__body">
        <LeftPanel open={panelOpen} />
        <PanelResizer />

        <div className="shell__map">
          <MapView />
          <Inspector />

          <button
            type="button"
            className="btn btn--icon map__overlay"
            style={{ top: 'var(--space-3)', left: 'var(--space-3)' }}
            onClick={() => setPanelOpen((value) => !value)}
            aria-label={panelOpen ? 'Hide the query panel' : 'Show the query panel'}
            data-narrow-only="true"
          >
            <Icon name="blocks" />
          </button>
        </div>
      </div>

      <ResultsPanel />
      <ToastHost />

      {dropping ? (
        <div className="dialog-drop" role="status">
          Drop to open the project
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function useTheme(): void {
  const theme = useUiStore((state) => state.theme)

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme)
    }
    apply()

    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

// ---------------------------------------------------------------------------
// Permalink
// ---------------------------------------------------------------------------

/**
 * Keeps the address bar in step with the query.
 *
 * Only the query and the map position go in the URL. Results never do: they
 * would bloat the link, go stale, and put someone's data in their history.
 */
function usePermalink(): void {
  const source = useQueryStore((state) => state.source)
  const view = useUiStore((state) => state.view)
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true

    const shared = readCurrentHash()
    if (!shared) return

    useQueryStore.getState().load(shared.query, { name: 'Shared query' })

    if (shared.view) useUiStore.getState().setView(shared.view)
    if (shared.endpoint) {
      const endpoint = ENDPOINTS.find((entry) => entry.id === shared.endpoint)
      if (endpoint) useUiStore.getState().setEndpointUrl(endpoint.url)
    }
    if (shared.autorun) {
      // Give the map a frame to size itself, so a {{bbox}} query sees a real
      // viewport rather than a zero-sized one.
      window.setTimeout(runCurrentQuery, 250)
    }
  }, [])

  useEffect(() => {
    if (!restored.current) return
    const timer = window.setTimeout(() => updateHash({ query: source, view }), 400)
    return () => window.clearTimeout(timer)
  }, [source, view])
}

// ---------------------------------------------------------------------------
// Drop a project file anywhere
// ---------------------------------------------------------------------------

function useProjectDrop(): boolean {
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  const open = useCallback(async (file: File) => {
    try {
      const project = await readProjectFile(file)
      openProjectFile(project)
      toast.success(`Opened "${project.name}"`)
    } catch (err) {
      toast.error(
        err instanceof ProjectFormatError ? err.message : 'That file could not be opened.',
      )
    }
  }, [])

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth.current += 1
      setActive(true)
    }
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      depth.current = 0
      setActive(false)
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      event.preventDefault()
      void open(file)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [open])

  return active
}

// ---------------------------------------------------------------------------
// Panel resizer
// ---------------------------------------------------------------------------

function PanelResizer() {
  const panelWidth = useUiStore((state) => state.panelWidth)
  const setPanelWidth = useUiStore((state) => state.setPanelWidth)

  return (
    <div
      className="resizer"
      style={{ left: panelWidth }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the query panel"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setPanelWidth(panelWidth - 16)
        if (event.key === 'ArrowRight') setPanelWidth(panelWidth + 16)
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        const element = event.currentTarget
        const startX = event.clientX
        const startWidth = panelWidth
        element.setPointerCapture(event.pointerId)
        element.dataset.dragging = 'true'

        const onMove = (move: PointerEvent) => {
          setPanelWidth(startWidth + (move.clientX - startX))
        }
        const onUp = () => {
          delete element.dataset.dragging
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }}
    />
  )
}
