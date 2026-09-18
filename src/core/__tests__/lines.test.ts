/**
 * Line tracking.
 *
 * Both halves of the round trip report which source line each block sits on,
 * so the text view can point at the block a problem belongs to and a block can
 * reveal itself in the text. The two have to agree, or clicking one would
 * scroll to the wrong place.
 */

import { describe, expect, it } from 'vitest'

import { parse } from '../parser'
import { printWithLines } from '../printer'
import { CORPUS } from './corpus'

/** The line a statement sits on, counted from the text itself. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle))
  return index + 1
}

describe('the parser reports where each block is', () => {
  it('records a line for every top-level statement', () => {
    const source = `[out:json];
node["amenity"="bar"](1,2,3,4);
way["highway"](1,2,3,4);
out;`
    const { query, lines } = parse(source)

    expect(lines[query.statements[0].id]).toBe(2)
    expect(lines[query.statements[1].id]).toBe(3)
    expect(lines[query.statements[2].id]).toBe(4)
  })

  it('records lines for blocks nested in a union', () => {
    const source = `[out:json];
(
  node["a"](1,2,3,4);
  way["a"](1,2,3,4);
);
out;`
    const { query, lines } = parse(source)
    const union = query.statements[0]
    if (union.kind !== 'union') throw new Error('expected a union')

    expect(lines[union.id]).toBe(2)
    expect(lines[union.items[0].id]).toBe(3)
    expect(lines[union.items[1].id]).toBe(4)
  })

  it('points past a comment, at the statement it describes', () => {
    const source = `[out:json];
// what we are looking for
node["amenity"="bar"](1,2,3,4);
out;`
    const { query, lines } = parse(source)
    expect(lines[query.statements[0].id]).toBe(3)
  })

  it('handles a query written entirely on one line', () => {
    const { query, lines } = parse('[out:json];node["a"](1,2,3,4);out;')
    expect(lines[query.statements[0].id]).toBe(1)
    expect(lines[query.statements[1].id]).toBe(1)
  })
})

describe('the printer reports the same thing', () => {
  it('agrees with the text it just produced', () => {
    const { query } = parse(`[out:json];
{{geocodeArea:Lyon}}->.a;
(
  node["amenity"="bar"](area.a);
  way["amenity"="bar"](area.a);
);
out geom;`)

    const { text, lines } = printWithLines(query)
    const rows = text.split('\n')

    for (const line of Object.values(lines)) {
      expect(line, `line ${line} is outside a ${rows.length}-line document`).toBeGreaterThan(0)
      expect(line).toBeLessThanOrEqual(rows.length)
    }

    // Spot-check that the recorded lines hold what they claim to.
    const union = query.statements[1]
    if (union.kind !== 'union') throw new Error('expected a union')
    expect(rows[lines[union.items[0].id] - 1]).toContain('node["amenity"="bar"]')
    expect(rows[lines[union.items[1].id] - 1]).toContain('way["amenity"="bar"]')
  })

  it('places a labelled block on its code line, not its comment', () => {
    const { query } = parse('[out:json];\n// a note\nnode["a"](1,2,3,4);\nout;')
    const { text, lines } = printWithLines(query)
    const rows = text.split('\n')

    expect(rows[lines[query.statements[0].id] - 1]).toContain('node["a"]')
  })

  it('places blocks inside a difference correctly', () => {
    const { query } = parse(`[out:json];
(
  node["a"](1,2,3,4);
  - node["b"](1,2,3,4);
);
out;`)
    const { text, lines } = printWithLines(query)
    const rows = text.split('\n')

    const diff = query.statements[0]
    if (diff.kind !== 'difference') throw new Error('expected a difference')
    expect(rows[lines[diff.left!.id] - 1]).toContain('"a"')
    expect(rows[lines[diff.right!.id] - 1]).toContain('"b"')
  })
})

describe('across the whole corpus', () => {
  for (const entry of CORPUS) {
    it(`${entry.name}: every block maps to a line that exists`, () => {
      const { query } = parse(entry.query)
      const { text, lines } = printWithLines(query)
      const rowCount = text.split('\n').length

      const ids = Object.keys(lines)
      expect(ids.length).toBeGreaterThan(0)

      for (const id of ids) {
        expect(lines[id], `${entry.name}: block ${id} maps outside the document`).toBeGreaterThan(0)
        expect(lines[id]).toBeLessThanOrEqual(rowCount)
      }
    })

    it(`${entry.name}: reparsing its own output agrees on the lines`, () => {
      // Printing then reparsing must place every block where the printer said
      // it put it, or a click in one view lands somewhere else in the other.
      const { query } = parse(entry.query)
      const printed = printWithLines(query)
      const reparsed = parse(printed.text)

      const printedLines = query.statements.map((s) => printed.lines[s.id])
      const parsedLines = reparsed.query.statements.map((s) => reparsed.lines[s.id])

      expect(parsedLines).toEqual(printedLines)
    })
  }
})

describe('a practical use', () => {
  it('finds the line a validation issue belongs to', () => {
    const source = `[out:json];
node["amenity"="bar"](1,2,3,4);
node.nosuchset["name"];
out;`
    const { query, lines } = parse(source)
    const broken = query.statements[1]

    expect(lines[broken.id]).toBe(3)
    expect(lineOf(source, 'nosuchset')).toBe(3)
  })
})
