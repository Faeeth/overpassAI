/**
 * Shareable links.
 *
 * A link carries the *query*, never the results: the recipient re-runs it and
 * gets fresh data, the URL stays short, and nothing about someone's session
 * leaves their browser. Results travel through the project file instead, in
 * `exporters/project.ts`.
 *
 * The query is raw-deflated and base64url encoded, which turns a typical
 * 300-character query into roughly 150 characters of URL.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'

export interface MapView {
  lat: number
  lon: number
  zoom: number
}

export interface SharedState {
  query: string
  view?: MapView
  /** Endpoint id, so a link can pin the server it was written against. */
  endpoint?: string
  /** Run the query as soon as the page loads. */
  autorun?: boolean
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // Chunked to stay well under the argument limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function compress(text: string): string {
  return toBase64Url(deflateSync(strToU8(text), { level: 9 }))
}

export function decompress(encoded: string): string {
  return strFromU8(inflateSync(fromBase64Url(encoded)))
}

// ---------------------------------------------------------------------------
// Hash encoding
// ---------------------------------------------------------------------------

/** Builds the location hash for a state, without the leading `#`. */
export function encodeHash(state: SharedState): string {
  const params = new URLSearchParams()
  params.set('q', compress(state.query))

  if (state.view) {
    const { zoom, lat, lon } = state.view
    params.set('map', `${zoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`)
  }
  if (state.endpoint) params.set('e', state.endpoint)
  if (state.autorun) params.set('run', '1')

  // URLSearchParams percent-encodes `/`, which makes the map fragment
  // unreadable for no benefit inside a hash.
  return params.toString().replace(/%2F/g, '/')
}

/** Reads a location hash back, tolerating links written by hand. */
export function decodeHash(hash: string): SharedState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null

  const params = new URLSearchParams(raw)
  const encoded = params.get('q') ?? params.get('query') ?? params.get('Q')
  if (!encoded) return null

  let query: string
  try {
    query = decompress(encoded)
  } catch {
    // Not compressed: accept a plainly URI-encoded query, so a link someone
    // typed by hand still opens.
    try {
      query = decodeURIComponent(encoded)
    } catch {
      return null
    }
  }

  const state: SharedState = { query }

  const map = params.get('map')
  if (map) {
    const [zoom, lat, lon] = map.split('/').map(Number)
    if ([zoom, lat, lon].every((value) => Number.isFinite(value))) {
      state.view = { zoom, lat, lon }
    }
  }

  const endpoint = params.get('e')
  if (endpoint) state.endpoint = endpoint
  if (params.get('run') === '1') state.autorun = true

  return state
}

/** Absolute shareable URL for a state. */
export function buildUrl(state: SharedState): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#${encodeHash(state)}`
}

/**
 * Replaces the hash without adding a history entry.
 *
 * Every keystroke in the editor updates the hash, so pushing state would fill
 * the back button with hundreds of intermediate queries.
 */
export function updateHash(state: SharedState): void {
  const hash = `#${encodeHash(state)}`
  if (window.location.hash === hash) return
  window.history.replaceState(null, '', hash)
}

/** Reads the current page hash, if it holds a query. */
export function readCurrentHash(): SharedState | null {
  return decodeHash(window.location.hash)
}
