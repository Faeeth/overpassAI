/**
 * The project file: a saved session you can reopen.
 *
 * A plain GeoJSON export freezes the answer but loses the question. This file
 * keeps both, so reopening it restores the map, the result table and the exact
 * query that produced them. You can then adjust a block and re-run, instead of
 * rebuilding the query from scratch to change one filter.
 *
 * It is ordinary JSON, so it also opens in any text editor.
 */

import type { FeatureCollection } from 'geojson'

import type { OverpassQuery } from '../../core/ast'
import type { ConversionStats } from '../../services/osmToGeoJSON'
import type { MapView } from '../permalink'

export const PROJECT_FORMAT = 'overpassai.project'
export const PROJECT_VERSION = 1

export interface ProjectResult {
  /** When the query was run. */
  runAt: string
  /** Server round-trip in milliseconds. */
  durationMs: number
  /** Endpoint the result came from. */
  endpoint: string
  /** The query actually sent, with shortcuts already expanded. */
  compiledSource: string
  stats: ConversionStats
  geojson: FeatureCollection
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  savedAt: string
  name: string
  /** The query as the user wrote it, shortcuts and all. */
  source: string
  /** The parsed tree, so reopening restores blocks without re-parsing. */
  ast?: OverpassQuery
  view?: MapView
  /** Absent when the file was saved before the query had been run. */
  result?: ProjectResult
  attribution: string
}

export const ATTRIBUTION =
  'Data from OpenStreetMap contributors, licensed under the ODbL (opendatacommons.org/licenses/odbl).'

export function toProjectJson(project: ProjectFile): string {
  return JSON.stringify(project, null, 2)
}

export class ProjectFormatError extends Error {}

/**
 * Reads a project file, rejecting anything that is not one.
 *
 * Deliberately strict about the envelope and forgiving about the payload: a
 * file written by a newer version should still open, minus whatever this
 * version does not understand.
 */
export function parseProjectJson(text: string): ProjectFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ProjectFormatError('That file is not valid JSON.')
  }

  if (!data || typeof data !== 'object') {
    throw new ProjectFormatError('That file does not contain a project.')
  }

  const record = data as Record<string, unknown>

  if (record.format !== PROJECT_FORMAT) {
    // A bare GeoJSON file is a reasonable thing to drop on the window, so say
    // something more useful than "wrong format".
    if (record.type === 'FeatureCollection') {
      throw new ProjectFormatError(
        'That is a plain GeoJSON file: it holds results but not the query that produced them. Open a .overpassai.json project instead.',
      )
    }
    throw new ProjectFormatError('That file is not an OverpassAI project.')
  }

  if (typeof record.source !== 'string') {
    throw new ProjectFormatError('The project file has no query in it.')
  }

  const version = typeof record.version === 'number' ? record.version : 0
  if (version > PROJECT_VERSION) {
    throw new ProjectFormatError(
      'That project was saved by a newer version of OverpassAI. Update the page and try again.',
    )
  }

  return {
    format: PROJECT_FORMAT,
    version,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date().toISOString(),
    name: typeof record.name === 'string' ? record.name : 'Untitled query',
    source: record.source,
    ast: isQuery(record.ast) ? record.ast : undefined,
    view: isView(record.view) ? record.view : undefined,
    result: isResult(record.result) ? record.result : undefined,
    attribution: typeof record.attribution === 'string' ? record.attribution : ATTRIBUTION,
  }
}

function isQuery(value: unknown): value is OverpassQuery {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as OverpassQuery).statements) &&
    typeof (value as OverpassQuery).settings === 'object'
  )
}

function isView(value: unknown): value is MapView {
  if (!value || typeof value !== 'object') return false
  const view = value as MapView
  return (
    Number.isFinite(view.lat) && Number.isFinite(view.lon) && Number.isFinite(view.zoom)
  )
}

function isResult(value: unknown): value is ProjectResult {
  if (!value || typeof value !== 'object') return false
  const result = value as ProjectResult
  return (
    !!result.geojson &&
    typeof result.geojson === 'object' &&
    result.geojson.type === 'FeatureCollection' &&
    Array.isArray(result.geojson.features)
  )
}

/** Reads a project from a dropped or picked file. */
export async function readProjectFile(file: File): Promise<ProjectFile> {
  const text = await file.text()
  return parseProjectJson(text)
}
