/**
 * Interface state: theme, layout, map view and server choice.
 *
 * Everything here is a per-viewer convenience, so it is persisted to
 * localStorage behind try/catch: a private window or blocked site data simply
 * falls back to the defaults rather than breaking the page.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { DEFAULT_ENDPOINT } from '../services/overpass'
import type { MapView } from '../features/permalink'

export type Theme = 'dark' | 'light' | 'system'
export type EditorMode = 'blocks' | 'text'
export type ResultTab = 'table' | 'raw' | 'query'
export type BasemapId = 'gray-light' | 'gray-dark' | 'osm' | 'satellite'

interface UiState {
  theme: Theme
  editorMode: EditorMode
  resultTab: ResultTab
  basemap: BasemapId
  endpointUrl: string
  /** Width of the left panel, in pixels. */
  panelWidth: number
  /** Height of the results drawer, in pixels. */
  resultsHeight: number
  resultsOpen: boolean
  view: MapView
  /** Feature the inspector is showing. */
  selectedFeatureId: string | null
  /** Block to scroll to and highlight, set when an issue is clicked. */
  selectedBlockId: string | null
  /** Whether new users see the welcome panel. */
  onboardingDismissed: boolean

  setTheme: (theme: Theme) => void
  setEditorMode: (mode: EditorMode) => void
  setResultTab: (tab: ResultTab) => void
  setBasemap: (basemap: BasemapId) => void
  setEndpointUrl: (url: string) => void
  setPanelWidth: (width: number) => void
  setResultsHeight: (height: number) => void
  setResultsOpen: (open: boolean) => void
  setView: (view: MapView) => void
  selectFeature: (id: string | null) => void
  selectBlock: (id: string | null) => void
  dismissOnboarding: () => void
}

/**
 * localStorage that no-ops instead of throwing when storage is unavailable.
 *
 * Declared above the store on purpose: `persist` resolves its storage while
 * this module is evaluating, so a `const` defined further down would still be
 * in its temporal dead zone. Zustand swallows the resulting ReferenceError and
 * carries on with no storage at all, which only shows up later as
 * "cannot read properties of undefined (reading 'setItem')".
 */
const safeStorage: Storage = {
  get length() {
    try {
      return localStorage.length
    } catch {
      return 0
    }
  },
  clear() {
    try {
      localStorage.clear()
    } catch {
      /* storage unavailable */
    }
  },
  getItem(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  key(index) {
    try {
      return localStorage.key(index)
    } catch {
      return null
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* storage unavailable */
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage unavailable */
    }
  },
}

/** Roughly France, a neutral starting view with plenty of dense OSM data. */
const DEFAULT_VIEW: MapView = { lat: 45.764, lon: 4.8357, zoom: 12 }

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      editorMode: 'blocks',
      resultTab: 'table',
      basemap: 'gray-light',
      endpointUrl: DEFAULT_ENDPOINT.url,
      panelWidth: 440,
      resultsHeight: 260,
      resultsOpen: true,
      view: DEFAULT_VIEW,
      selectedFeatureId: null,
      selectedBlockId: null,
      onboardingDismissed: false,

      setTheme: (theme) => set({ theme }),
      setEditorMode: (editorMode) => set({ editorMode }),
      setResultTab: (resultTab) => set({ resultTab }),
      setBasemap: (basemap) => set({ basemap }),
      setEndpointUrl: (endpointUrl) => set({ endpointUrl }),
      setPanelWidth: (panelWidth) => set({ panelWidth: clamp(panelWidth, 320, 900) }),
      setResultsHeight: (resultsHeight) => set({ resultsHeight: clamp(resultsHeight, 120, 720) }),
      setResultsOpen: (resultsOpen) => set({ resultsOpen }),
      setView: (view) => set({ view }),
      selectFeature: (selectedFeatureId) => set({ selectedFeatureId }),
      selectBlock: (selectedBlockId) => set({ selectedBlockId }),
      dismissOnboarding: () => set({ onboardingDismissed: true }),
    }),
    {
      name: 'overpassai.ui.v1',
      storage: createJSONStorage(() => safeStorage),
      // The selection and the map view are session state, not preferences.
      partialize: (state) => ({
        theme: state.theme,
        editorMode: state.editorMode,
        resultTab: state.resultTab,
        basemap: state.basemap,
        endpointUrl: state.endpointUrl,
        panelWidth: state.panelWidth,
        resultsHeight: state.resultsHeight,
        resultsOpen: state.resultsOpen,
        onboardingDismissed: state.onboardingDismissed,
      }),
    },
  ),
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Resolves `system` against the OS setting. */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
