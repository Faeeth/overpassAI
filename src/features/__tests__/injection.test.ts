/**
 * Hostile content in OSM data.
 *
 * Tag values are written by strangers, and an export leaves this app for a
 * spreadsheet, a GIS tool or Google Earth. A value that breaks out of its cell
 * or its element is a real problem in those tools even though React escapes
 * everything on screen.
 */

import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'

import { toCsv } from '../exporters/csv'
import { toGpx } from '../exporters/gpx'
import { toKml } from '../exporters/kml'
import { escapeXml } from '../exporters/xml'
import { sanitizeFileName } from '../exporters'

const HOSTILE_VALUES = [
  '<script>alert(1)</script>',
  '</name><script>alert(1)</script><name>',
  ']]><script>alert(1)</script><![CDATA[',
  '"><img src=x onerror=alert(1)>',
  '=1+1',
  '=HYPERLINK("http://evil.test","click")',
  '+1234567890',
  '-1+1',
  '@SUM(1,1)',
  'value,with,commas',
  'value"with"quotes',
  'value\nwith\nnewlines',
  'value\r\nwith\r\ncrlf',
  'value\twith\ttabs',
  `${String.fromCharCode(0)}${String.fromCharCode(1)}control`,
  `${String.fromCharCode(0x202e)}override`,
  "'; DROP TABLE users; --",
  '../../etc/passwd',
  'a'.repeat(5000),
]

function collectionWith(value: string): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [7.2, 50.1] },
        properties: { '@id': 'node/1', '@type': 'node', '@osmId': 1, name: value },
      },
    ],
  }
}

describe('XML escaping holds', () => {
  for (const [index, value] of HOSTILE_VALUES.entries()) {
    it(`case ${index} produces well-formed GPX`, () => {
      const gpx = toGpx(collectionWith(value), 'export')
      const doc = new DOMParser().parseFromString(gpx, 'application/xml')
      expect(doc.querySelector('parsererror'), `broke GPX: ${value.slice(0, 40)}`).toBeNull()
    })

    it(`case ${index} produces well-formed KML`, () => {
      const kml = toKml(collectionWith(value), 'export')
      const doc = new DOMParser().parseFromString(kml, 'application/xml')
      expect(doc.querySelector('parsererror'), `broke KML: ${value.slice(0, 40)}`).toBeNull()
    })
  }

  it('never leaves a live element in the output', () => {
    for (const value of HOSTILE_VALUES) {
      const kml = toKml(collectionWith(value), 'export')
      const doc = new DOMParser().parseFromString(kml, 'application/xml')
      expect(doc.querySelectorAll('script')).toHaveLength(0)
    }
  })

  it('keeps the value readable rather than dropping it', () => {
    const gpx = toGpx(collectionWith('Café <Le Bon>'), 'export')
    const doc = new DOMParser().parseFromString(gpx, 'application/xml')
    expect(doc.querySelector('wpt > name')?.textContent).toBe('Café <Le Bon>')
  })

  it('escapes the document name too, not only the values', () => {
    const kml = toKml(collectionWith('ok'), '</name><script>x</script>')
    const doc = new DOMParser().parseFromString(kml, 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(kml).not.toContain('<script>')
  })

  it('drops control characters, which are illegal in XML even escaped', () => {
    expect(escapeXml(`a${String.fromCharCode(0)}b`)).toBe('ab')
  })
})

describe('CSV cells stay in their cell', () => {
  for (const [index, value] of HOSTILE_VALUES.entries()) {
    it(`case ${index} keeps one logical row`, () => {
      const csv = toCsv(collectionWith(value))
      const rows = parseCsv(csv)
      expect(rows, `split into ${rows.length} rows: ${value.slice(0, 40)}`).toHaveLength(2)
    })
  }

  it('round-trips a value containing quotes, commas and newlines', () => {
    const nasty = 'a,b"c\nd'
    const rows = parseCsv(toCsv(collectionWith(nasty)))
    const nameColumn = rows[0].indexOf('name')
    expect(rows[1][nameColumn]).toBe(nasty)
  })
})

describe('file names', () => {
  for (const [index, value] of HOSTILE_VALUES.entries()) {
    it(`case ${index} cannot escape its directory or break the OS`, () => {
      const name = sanitizeFileName(value)
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      expect(name).not.toContain('..')
      expect([...name].every((char) => (char.codePointAt(0) ?? 0) >= 0x20)).toBe(true)
      expect(name.length).toBeGreaterThan(0)
      expect(name.length).toBeLessThanOrEqual(80)
    })
  }
})

/**
 * A minimal RFC 4180 reader, so the test judges the output the way a
 * spreadsheet would rather than the way the writer intended.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += 1
    } else {
      cell += char
    }
  }

  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}


describe('spreadsheet formulas are defused', () => {
  const FORMULAS = ['=1+1', '=HYPERLINK("http://evil.test","click")', '+1', '@SUM(1,1)']

  for (const formula of FORMULAS) {
    it(`${formula} is not left executable`, () => {
      const rows = parseCsv(toCsv(collectionWith(formula)))
      const nameColumn = rows[0].indexOf('name')
      const cell = rows[1][nameColumn]

      expect(cell.startsWith("'"), `${formula} would still run in a spreadsheet`).toBe(true)
      // The original value stays readable, just inert.
      expect(cell.slice(1)).toBe(formula)
    })
  }

  it('leaves negative numbers alone', () => {
    // ele=-5 and layer=-1 are everywhere in OSM. Prefixing them would break
    // every spreadsheet that does arithmetic on the column.
    for (const value of ['-5', '-1', '-12.5']) {
      const rows = parseCsv(toCsv(collectionWith(value)))
      const nameColumn = rows[0].indexOf('name')
      expect(rows[1][nameColumn]).toBe(value)
    }
  })

  it('leaves ordinary values untouched', () => {
    for (const value of ['Cafe Central', 'restaurant', '7.2', 'Rue de la Paix']) {
      const rows = parseCsv(toCsv(collectionWith(value)))
      const nameColumn = rows[0].indexOf('name')
      expect(rows[1][nameColumn]).toBe(value)
    }
  })
})
