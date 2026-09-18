/**
 * GPX export.
 *
 * GPX only knows waypoints, routes and tracks, so geometry is mapped down:
 * points become waypoints, lines become tracks, and an area becomes a track
 * following its outline. Tags that GPX has no field for are dropped rather
 * than smuggled into the description, except for a short readable summary.
 */

import type { Feature, FeatureCollection, Position } from 'geojson'

import { escapeXml } from './xml'

export function toGpx(collection: FeatureCollection, name: string): string {
  const waypoints: string[] = []
  const tracks: string[] = []

  for (const feature of collection.features) {
    const geometry = feature.geometry
    if (!geometry) continue

    switch (geometry.type) {
      case 'Point':
        waypoints.push(waypoint(geometry.coordinates, feature))
        break

      case 'MultiPoint':
        for (const position of geometry.coordinates) {
          waypoints.push(waypoint(position, feature))
        }
        break

      case 'LineString':
        tracks.push(track([geometry.coordinates], feature))
        break

      case 'MultiLineString':
        tracks.push(track(geometry.coordinates, feature))
        break

      case 'Polygon':
        tracks.push(track(geometry.coordinates, feature))
        break

      case 'MultiPolygon':
        tracks.push(track(geometry.coordinates.flat(), feature))
        break

      default:
        break
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="OverpassAI"',
    '     xmlns="http://www.topografix.com/GPX/1/1"',
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${escapeXml(name)}</name>`,
    `    <time>${new Date().toISOString()}</time>`,
    '    <copyright author="OpenStreetMap contributors">',
    '      <license>https://opendatacommons.org/licenses/odbl/</license>',
    '    </copyright>',
    '  </metadata>',
    ...waypoints,
    ...tracks,
    '</gpx>',
  ].join('\n')
}

function waypoint(position: Position, feature: Feature): string {
  const [lon, lat] = position
  return [
    `  <wpt lat="${fixed(lat)}" lon="${fixed(lon)}">`,
    `    <name>${escapeXml(labelOf(feature))}</name>`,
    `    <desc>${escapeXml(describe(feature))}</desc>`,
    `    <link href="${escapeXml(osmUrl(feature))}"/>`,
    '  </wpt>',
  ].join('\n')
}

function track(segments: Position[][], feature: Feature): string {
  const body = segments
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const points = segment
        .map(([lon, lat]) => `      <trkpt lat="${fixed(lat)}" lon="${fixed(lon)}"/>`)
        .join('\n')
      return `    <trkseg>\n${points}\n    </trkseg>`
    })
    .join('\n')

  return [
    '  <trk>',
    `    <name>${escapeXml(labelOf(feature))}</name>`,
    `    <desc>${escapeXml(describe(feature))}</desc>`,
    `    <link href="${escapeXml(osmUrl(feature))}"/>`,
    body,
    '  </trk>',
  ].join('\n')
}

function fixed(value: number): string {
  return value.toFixed(7)
}

export function labelOf(feature: Feature): string {
  const props = feature.properties ?? {}
  for (const key of ['name', 'ref', 'operator', 'brand', 'addr:housename']) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return String(props['@id'] ?? 'Unnamed')
}

/** Compact `key=value` summary of the OSM tags, for description fields. */
export function describe(feature: Feature): string {
  return Object.entries(feature.properties ?? {})
    .filter(([key]) => !key.startsWith('@'))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('; ')
}

export function osmUrl(feature: Feature): string {
  const id = feature.properties?.['@id']
  return typeof id === 'string' ? `https://www.openstreetmap.org/${id}` : 'https://www.openstreetmap.org/'
}
