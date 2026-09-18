/**
 * KML export, for Google Earth.
 *
 * Tags are written as `ExtendedData`, which Google Earth shows in the balloon
 * and which survives a round trip through most GIS tools, unlike cramming
 * them into the description as text.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

import { labelOf, osmUrl } from './gpx'
import { escapeXml } from './xml'

export function toKml(collection: FeatureCollection, name: string): string {
  const placemarks = collection.features
    .map(placemark)
    .filter((entry): entry is string => entry !== null)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${escapeXml(name)}</name>`,
    '    <description>Exported from OverpassAI. Data from OpenStreetMap contributors, ODbL.</description>',
    ...STYLES,
    ...placemarks,
    '  </Document>',
    '</kml>',
  ].join('\n')
}

const STYLES = [
  '    <Style id="point">',
  '      <IconStyle><color>ff4b8bff</color><scale>1.1</scale></IconStyle>',
  '    </Style>',
  '    <Style id="line">',
  '      <LineStyle><color>ff4b8bff</color><width>3</width></LineStyle>',
  '    </Style>',
  '    <Style id="area">',
  '      <LineStyle><color>ff4b8bff</color><width>2</width></LineStyle>',
  '      <PolyStyle><color>664b8bff</color></PolyStyle>',
  '    </Style>',
]

function placemark(feature: Feature): string | null {
  const geometry = feature.geometry
  if (!geometry) return null

  const body = geometryXml(geometry, '      ')
  if (!body) return null

  return [
    '    <Placemark>',
    `      <name>${escapeXml(labelOf(feature))}</name>`,
    `      <styleUrl>#${styleFor(geometry)}</styleUrl>`,
    extendedData(feature),
    body,
    '    </Placemark>',
  ]
    .filter(Boolean)
    .join('\n')
}

function styleFor(geometry: Geometry): string {
  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      return 'point'
    case 'Polygon':
    case 'MultiPolygon':
      return 'area'
    default:
      return 'line'
  }
}

function extendedData(feature: Feature): string {
  const entries = Object.entries(feature.properties ?? {}).filter(
    ([key]) => !key.startsWith('@') || key === '@id' || key === '@type',
  )
  if (!entries.length) return ''

  const rows = entries.map(
    ([key, value]) =>
      `        <Data name="${escapeXml(key)}"><value>${escapeXml(String(value))}</value></Data>`,
  )
  rows.push(
    `        <Data name="osm_url"><value>${escapeXml(osmUrl(feature))}</value></Data>`,
  )

  return ['      <ExtendedData>', ...rows, '      </ExtendedData>'].join('\n')
}

function geometryXml(geometry: Geometry, pad: string): string {
  switch (geometry.type) {
    case 'Point':
      return `${pad}<Point><coordinates>${coord(geometry.coordinates)}</coordinates></Point>`

    case 'MultiPoint':
      return multi(
        geometry.coordinates.map(
          (position) => `${pad}  <Point><coordinates>${coord(position)}</coordinates></Point>`,
        ),
        pad,
      )

    case 'LineString':
      return lineString(geometry.coordinates, pad)

    case 'MultiLineString':
      return multi(
        geometry.coordinates.map((line) => lineString(line, `${pad}  `)),
        pad,
      )

    case 'Polygon':
      return polygon(geometry.coordinates, pad)

    case 'MultiPolygon':
      return multi(
        geometry.coordinates.map((poly) => polygon(poly, `${pad}  `)),
        pad,
      )

    case 'GeometryCollection':
      return multi(
        geometry.geometries.map((child) => geometryXml(child, `${pad}  `)),
        pad,
      )

    default:
      return ''
  }
}

function multi(parts: string[], pad: string): string {
  const body = parts.filter(Boolean)
  if (!body.length) return ''
  if (body.length === 1) return body[0]
  return [`${pad}<MultiGeometry>`, ...body, `${pad}</MultiGeometry>`].join('\n')
}

function lineString(positions: Position[], pad: string): string {
  return [
    `${pad}<LineString><tessellate>1</tessellate><coordinates>`,
    `${pad}  ${positions.map(coord).join(' ')}`,
    `${pad}</coordinates></LineString>`,
  ].join('\n')
}

function polygon(rings: Position[][], pad: string): string {
  if (!rings.length) return ''
  const [outer, ...inner] = rings

  const parts = [
    `${pad}<Polygon>`,
    `${pad}  <outerBoundaryIs><LinearRing><coordinates>`,
    `${pad}    ${outer.map(coord).join(' ')}`,
    `${pad}  </coordinates></LinearRing></outerBoundaryIs>`,
  ]

  for (const ring of inner) {
    parts.push(
      `${pad}  <innerBoundaryIs><LinearRing><coordinates>`,
      `${pad}    ${ring.map(coord).join(' ')}`,
      `${pad}  </coordinates></LinearRing></innerBoundaryIs>`,
    )
  }

  parts.push(`${pad}</Polygon>`)
  return parts.join('\n')
}

/** KML orders coordinates lon,lat,alt, the same as GeoJSON. */
function coord(position: Position): string {
  return `${position[0].toFixed(7)},${position[1].toFixed(7)},0`
}
