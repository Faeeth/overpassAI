/**
 * Optional OpenStreetMap sign-in, over OAuth 2.0 with PKCE.
 *
 * Nothing in the app requires it: Overpass, Nominatim and taginfo are all
 * open. Signing in only adds the account-flavoured extras (your name, saving
 * queries to your OSM preferences, filing a note on a bad result), so every
 * entry point here degrades to "not configured" rather than failing.
 *
 * The client is registered as a *public* client, so there is no secret to
 * protect: the code-for-token exchange uses PKCE and runs in the browser
 * against an endpoint that allows CORS.
 */

import { osmAuth } from 'osm-auth'

const OSM_URL = 'https://www.openstreetmap.org'
const SCOPES = 'read_prefs write_prefs write_notes'

/**
 * Preference keys are capped at 255 characters by the OSM API, so a saved
 * query is split across numbered chunks under this prefix.
 */
const PREF_PREFIX = 'overpassai.query.'
const PREF_VALUE_LIMIT = 255

export interface OsmUser {
  id: number
  displayName: string
  avatarUrl?: string
}

export class AuthError extends Error {}

type Auth = InstanceType<typeof osmAuth>

let instance: Auth | null = null

function clientId(): string | undefined {
  const value = import.meta.env.VITE_OSM_CLIENT_ID
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** False when no client id was configured, which disables every sign-in path. */
export function isConfigured(): boolean {
  return clientId() !== undefined
}

function client(): Auth {
  const id = clientId()
  if (!id) {
    throw new AuthError(
      'OpenStreetMap sign-in is not configured. Set VITE_OSM_CLIENT_ID to enable it.',
    )
  }

  if (!instance) {
    instance = new osmAuth({
      url: OSM_URL,
      client_id: id,
      // BASE_URL carries the deployment subpath, so this resolves correctly
      // both on the dev server and under a GitHub Pages project path.
      redirect_uri: new URL(
        `${import.meta.env.BASE_URL}oauth-callback.html`,
        window.location.origin,
      ).toString(),
      scope: SCOPES,
      auto: false,
      singlepage: false,
    })
  }

  return instance
}

export function isSignedIn(): boolean {
  if (!isConfigured()) return false
  try {
    return client().authenticated()
  } catch {
    return false
  }
}

/** Opens the OSM consent popup and resolves once a token is held. */
export function signIn(): Promise<void> {
  return new Promise((resolve, reject) => {
    let auth: Auth
    try {
      auth = client()
    } catch (err) {
      reject(err)
      return
    }

    auth.authenticate((err: unknown) => {
      if (err) {
        reject(new AuthError(describe(err)))
        return
      }
      resolve()
    })
  })
}

export function signOut(): void {
  if (!isConfigured()) return
  try {
    client().logout()
  } catch {
    // Already signed out, or storage is unavailable; nothing to undo.
  }
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function api(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: string; headers?: object } = {},
): Promise<Response> {
  const response = await client().fetch(path, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: options.headers,
    prefix: false,
  })

  if (!response.ok) {
    throw new AuthError(`OpenStreetMap replied with HTTP ${response.status}.`)
  }
  return response
}

export async function fetchUser(): Promise<OsmUser | null> {
  if (!isSignedIn()) return null

  const response = await api('/api/0.6/user/details.json')
  const data = (await response.json()) as {
    user?: { id: number; display_name: string; img?: { href?: string } }
  }
  if (!data.user) return null

  return {
    id: data.user.id,
    displayName: data.user.display_name,
    avatarUrl: data.user.img?.href,
  }
}

// ---------------------------------------------------------------------------
// Saving queries to the signed-in user's OSM preferences
// ---------------------------------------------------------------------------

/**
 * The preferences API is a flat string map with a 255 character ceiling per
 * value, so a query is stored as `overpassai.query.<name>.<n>` chunks. It is a
 * modest amount of space, but it is free, needs no server of our own, and
 * follows the account to any device.
 */
export async function saveQueryToAccount(name: string, source: string): Promise<void> {
  const slug = slugify(name)
  if (!slug) throw new AuthError('Give the query a name before saving it to your account.')

  const chunks = chunk(source, PREF_VALUE_LIMIT)
  if (chunks.length > 40) {
    throw new AuthError(
      'This query is too long to store in your OSM preferences. Export it as a file instead.',
    )
  }

  await deleteQueryFromAccount(name)

  for (const [index, part] of chunks.entries()) {
    await api(`/api/0.6/user/preferences/${encodeURIComponent(`${PREF_PREFIX}${slug}.${index}`)}`, {
      method: 'PUT',
      body: part,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

export async function listAccountQueries(): Promise<Record<string, string>> {
  if (!isSignedIn()) return {}

  const response = await api('/api/0.6/user/preferences.json')
  const data = (await response.json()) as { preferences?: Record<string, string> }
  const prefs = data.preferences ?? {}

  const parts = new Map<string, Array<{ index: number; text: string }>>()
  for (const [key, value] of Object.entries(prefs)) {
    if (!key.startsWith(PREF_PREFIX)) continue
    const rest = key.slice(PREF_PREFIX.length)
    const dot = rest.lastIndexOf('.')
    if (dot < 0) continue
    const name = rest.slice(0, dot)
    const index = Number(rest.slice(dot + 1))
    if (!Number.isFinite(index)) continue
    const list = parts.get(name) ?? []
    list.push({ index, text: value })
    parts.set(name, list)
  }

  const out: Record<string, string> = {}
  for (const [name, list] of parts) {
    out[name] = list
      .sort((a, b) => a.index - b.index)
      .map((p) => p.text)
      .join('')
  }
  return out
}

export async function deleteQueryFromAccount(name: string): Promise<void> {
  const slug = slugify(name)
  const response = await api('/api/0.6/user/preferences.json')
  const data = (await response.json()) as { preferences?: Record<string, string> }

  for (const key of Object.keys(data.preferences ?? {})) {
    if (!key.startsWith(`${PREF_PREFIX}${slug}.`)) continue
    await api(`/api/0.6/user/preferences/${encodeURIComponent(key)}`, { method: 'DELETE' })
  }
}

// ---------------------------------------------------------------------------
// Map notes, filed from the result inspector
// ---------------------------------------------------------------------------

/** Files an OSM note at a point. Returns the new note id. */
export async function createNote(
  lat: number,
  lon: number,
  text: string,
): Promise<number | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), text })
  const response = await api(`/api/0.6/notes.json?${params.toString()}`, { method: 'POST' })
  const data = (await response.json()) as { properties?: { id?: number } }
  return data.properties?.id ?? null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function chunk(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : ['']
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message: unknown }).message)
    if (/popup/i.test(message)) {
      return 'The sign-in window was blocked. Allow popups for this site and try again.'
    }
    return message
  }
  return 'Sign-in failed.'
}
