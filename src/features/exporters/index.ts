/**
 * Result exporters.
 *
 * Everything runs in the browser: a Blob is built in memory and handed to a
 * temporary anchor. No upload, no server, and the data never leaves the
 * machine.
 */

import type { FeatureCollection } from 'geojson'

import { toCsv } from './csv'
import { toGpx } from './gpx'
import { toKml } from './kml'
import type { ProjectFile } from './project'
import { toProjectJson } from './project'

export type ExportFormat = 'geojson' | 'csv' | 'gpx' | 'kml' | 'project'

export interface ExportSpec {
  id: ExportFormat
  label: string
  extension: string
  mimeType: string
  description: string
}

export const EXPORT_FORMATS: ExportSpec[] = [
  {
    id: 'project',
    label: 'Project',
    extension: 'overpassai.json',
    mimeType: 'application/json',
    description: 'Query and results together. Reopen it to review and edit without re-running.',
  },
  {
    id: 'geojson',
    label: 'GeoJSON',
    extension: 'geojson',
    mimeType: 'application/geo+json',
    description: 'Standard geometry and tags, for QGIS, Mapshaper or any GIS tool.',
  },
  {
    id: 'csv',
    label: 'CSV',
    extension: 'csv',
    mimeType: 'text/csv',
    description: 'One row per element, one column per tag, for spreadsheets.',
  },
  {
    id: 'gpx',
    label: 'GPX',
    extension: 'gpx',
    mimeType: 'application/gpx+xml',
    description: 'Waypoints and tracks, for GPS units and outdoor apps.',
  },
  {
    id: 'kml',
    label: 'KML',
    extension: 'kml',
    mimeType: 'application/vnd.google-earth.kml+xml',
    description: 'Placemarks for Google Earth.',
  },
]

export interface ExportInput {
  geojson: FeatureCollection
  project: ProjectFile
  /** Base file name, without an extension. */
  name: string
}

export function serialize(format: ExportFormat, input: ExportInput): string {
  switch (format) {
    case 'geojson':
      return JSON.stringify(input.geojson, null, 2)
    case 'csv':
      return toCsv(input.geojson)
    case 'gpx':
      return toGpx(input.geojson, input.name)
    case 'kml':
      return toKml(input.geojson, input.name)
    case 'project':
      return toProjectJson(input.project)
  }
}

export function download(format: ExportFormat, input: ExportInput): void {
  const spec = EXPORT_FORMATS.find((f) => f.id === format)
  if (!spec) throw new Error(`Unknown export format "${format}".`)

  const blob = new Blob([serialize(format, input)], {
    type: `${spec.mimeType};charset=utf-8`,
  })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitizeFileName(input.name)}.${spec.extension}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Characters Windows rejects in a file name; the rest are safe everywhere. */
const RESERVED_IN_FILENAMES = '<>:"/\\|?*'

/**
 * Makes a query name safe to use as a file name on any platform.
 *
 * Scanned rather than matched with a regex so the C0 control range can be
 * handled by code point: a tag value with a stray control character in it
 * should not be able to produce an unopenable file.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = [...name.trim()]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return code < 0x20 || RESERVED_IN_FILENAMES.includes(char) ? '-' : char
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  return cleaned.slice(0, 80) || 'overpass-query'
}

export type { ProjectFile }
