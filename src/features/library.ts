/**
 * The local query library.
 *
 * Saved queries live in `localStorage`, which keeps the app serverless but
 * means they are tied to one browser profile: they do not sync, and clearing
 * site data erases them. Both are made plain in the UI, and the library can be
 * exported to a JSON file, which is the durable copy.
 */

import type { MapView } from './permalink'

const STORAGE_KEY = 'overpassai.library.v1'
const LIBRARY_FORMAT = 'overpassai.library'

export interface SavedQuery {
  id: string
  name: string
  source: string
  createdAt: string
  updatedAt: string
  view?: MapView
  /** Free-form user tags, for filtering a long list. */
  labels?: string[]
}

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT
  version: 1
  exportedAt: string
  queries: SavedQuery[]
}

export class LibraryError extends Error {}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function read(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSavedQuery) : []
  } catch {
    // Private windows and blocked site data both throw here. An empty library
    // is the right answer; the UI surfaces the "not persisted" state instead.
    return []
  }
}

function write(queries: SavedQuery[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries))
  } catch (err) {
    if (err instanceof DOMException && /quota/i.test(err.name)) {
      throw new LibraryError(
        'Browser storage is full. Delete a few saved queries, or export the library to a file.',
      )
    }
    throw new LibraryError('This browser will not let the page store saved queries.')
  }
}

function isSavedQuery(value: unknown): value is SavedQuery {
  if (!value || typeof value !== 'object') return false
  const query = value as SavedQuery
  return typeof query.id === 'string' && typeof query.source === 'string'
}

/** True when saved queries will actually survive a reload. */
export function isPersistent(): boolean {
  try {
    const probe = `${STORAGE_KEY}.probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function list(): SavedQuery[] {
  return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function get(id: string): SavedQuery | undefined {
  return read().find((query) => query.id === id)
}

export function save(input: {
  id?: string
  name: string
  source: string
  view?: MapView
  labels?: string[]
}): SavedQuery {
  const queries = read()
  const now = new Date().toISOString()

  const existingIndex = input.id ? queries.findIndex((q) => q.id === input.id) : -1

  const entry: SavedQuery = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim() || 'Untitled query',
    source: input.source,
    createdAt: existingIndex >= 0 ? queries[existingIndex].createdAt : now,
    updatedAt: now,
    view: input.view,
    labels: input.labels,
  }

  if (existingIndex >= 0) queries[existingIndex] = entry
  else queries.unshift(entry)

  write(queries)
  return entry
}

export function remove(id: string): void {
  write(read().filter((query) => query.id !== id))
}

export function rename(id: string, name: string): void {
  const queries = read()
  const entry = queries.find((query) => query.id === id)
  if (!entry) return
  entry.name = name.trim() || entry.name
  entry.updatedAt = new Date().toISOString()
  write(queries)
}

export function clear(): void {
  write([])
}

// ---------------------------------------------------------------------------
// Import and export
// ---------------------------------------------------------------------------

export function exportLibrary(): string {
  const file: LibraryFile = {
    format: LIBRARY_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    queries: list(),
  }
  return JSON.stringify(file, null, 2)
}

/**
 * Merges a library file into the current one.
 *
 * Existing entries are matched by id and kept when they are newer, so
 * importing the same file twice does not create duplicates and does not
 * silently overwrite newer local edits.
 */
export function importLibrary(text: string): { added: number; updated: number } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new LibraryError('That file is not valid JSON.')
  }

  const file = data as Partial<LibraryFile>
  if (file.format !== LIBRARY_FORMAT || !Array.isArray(file.queries)) {
    throw new LibraryError('That file is not an OverpassAI query library.')
  }

  const queries = read()
  const byId = new Map(queries.map((query) => [query.id, query]))
  let added = 0
  let updated = 0

  for (const candidate of file.queries) {
    if (!isSavedQuery(candidate)) continue
    const existing = byId.get(candidate.id)

    if (!existing) {
      queries.push(candidate)
      byId.set(candidate.id, candidate)
      added += 1
      continue
    }

    if (candidate.updatedAt > existing.updatedAt) {
      Object.assign(existing, candidate)
      updated += 1
    }
  }

  write(queries)
  return { added, updated }
}
