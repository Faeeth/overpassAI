import { describe, expect, it } from 'vitest'

import type { OverpassQuery } from '../ast'
import { makeFilter, makeQuery, makeStatement } from '../factory'
import { parseQuery } from '../parser'
import { validate } from '../validate'
import { CORPUS } from './corpus'

function wrap(statements: OverpassQuery['statements']): OverpassQuery {
  return { settings: { format: 'json', timeout: 25 }, statements }
}

/** Builds the query a user gets by adding one fresh filter to a Find block. */
function withFreshFilter(kind: Parameters<typeof makeFilter>[0]): OverpassQuery {
  const query = makeQuery('nwr')
  query.filters.push(makeFilter(kind))
  return wrap([query, makeStatement('out')])
}

describe('a valid query passes', () => {
  for (const entry of CORPUS) {
    it(entry.name, () => {
      const result = validate(parseQuery(entry.query))
      expect(
        result.errors.map((e) => e.message),
        `unexpected errors in:\n${entry.query}`,
      ).toEqual([])
    })
  }
})

describe('freshly added blocks are reported, not sent', () => {
  const cases: Array<[Parameters<typeof makeFilter>[0], RegExp]> = [
    ['tag', /no key/i],
    ['ids', /no ids/i],
    ['user', /no user name/i],
    ['uid', /no ids/i],
    ['poly', /no coordinates/i],
    ['if', /empty/i],
    ['raw', /empty/i],
  ]

  for (const [kind, expected] of cases) {
    it(`an empty ${kind} filter is an error`, () => {
      const result = validate(withFreshFilter(kind))
      expect(result.ok).toBe(false)
      expect(result.errors.some((issue) => expected.test(issue.message))).toBe(true)
    })
  }

  it('a fresh area filter points at a set nothing creates', () => {
    const result = validate(withFreshFilter('area'))
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toMatch(/searchArea.*nothing creates/i)
  })

  it('a fresh advanced block holds a comment, which is valid on its own', () => {
    const result = validate(wrap([makeStatement('raw'), makeStatement('out')]))
    expect(result.errors).toEqual([])
  })

  it('an advanced block emptied by the user is an error', () => {
    const raw = makeStatement('raw')
    if (raw.kind !== 'raw') throw new Error('expected a raw statement')
    raw.text = '   '
    const result = validate(wrap([raw, makeStatement('out')]))
    expect(result.errors.some((issue) => /advanced block is empty/i.test(issue.message))).toBe(true)
  })

  it('a comment mentioning "out" does not count as an output block', () => {
    const raw = makeStatement('raw')
    if (raw.kind !== 'raw') throw new Error('expected a raw statement')
    raw.text = '// find out more later'
    const result = validate(wrap([raw]))
    expect(result.errors.some((issue) => /no output block/i.test(issue.message))).toBe(true)
  })

  it('an empty place block is an error', () => {
    const result = validate(wrap([makeStatement('geocodeArea'), makeStatement('out')]))
    expect(result.errors.some((issue) => /no name in it/i.test(issue.message))).toBe(true)
  })

  it('an empty union is an error', () => {
    const union = makeStatement('union')
    if (union.kind !== 'union') throw new Error('expected a union')
    union.items = []
    const result = validate(wrap([union, makeStatement('out')]))
    expect(result.errors.some((issue) => /empty/i.test(issue.message))).toBe(true)
  })

  it('a difference with an empty slot is an error', () => {
    const diff = makeStatement('difference')
    if (diff.kind !== 'difference') throw new Error('expected a difference')
    diff.right = null
    const result = validate(wrap([diff, makeStatement('out')]))
    expect(result.errors.some((issue) => /both of its two inputs/i.test(issue.message))).toBe(true)
  })
})

describe('set references', () => {
  it('flags a set nothing creates', () => {
    const result = validate(parseQuery('[out:json];node.missing["amenity"];out;'))
    expect(result.errors[0].message).toMatch(/"missing", which nothing creates/)
  })

  it('flags a set used before it is created', () => {
    const result = validate(
      parseQuery('[out:json];node.later["amenity"](50,7,51,8);way["x"](50,7,51,8)->.later;out;'),
    )
    expect(result.errors.some((issue) => /before the block that creates it/.test(issue.message))).toBe(
      true,
    )
  })

  it('accepts the default set', () => {
    const result = validate(parseQuery('[out:json];node["amenity"](50,7,51,8);._;out;'))
    expect(result.errors).toEqual([])
  })

  it('accepts a set defined earlier', () => {
    const result = validate(
      parseQuery('[out:json];node["amenity"](50,7,51,8)->.a;node.a["name"];out;'),
    )
    expect(result.errors).toEqual([])
  })
})

describe('whole-query rules', () => {
  it('an empty query is an error', () => {
    const result = validate(wrap([]))
    expect(result.errors[0].message).toMatch(/query is empty/i)
  })

  it('a query with no output is an error', () => {
    const result = validate(parseQuery('[out:json];node["amenity"](50,7,51,8);'))
    expect(result.errors.some((issue) => /no output block/i.test(issue.message))).toBe(true)
  })

  it('a raw block containing out counts as output', () => {
    const result = validate(parseQuery('[out:json];node["amenity"](50,7,51,8);make x a=1;out;'))
    expect(result.errors).toEqual([])
  })

  it('a negative timeout is an error', () => {
    const query = parseQuery('[out:json];node["amenity"](50,7,51,8);out;')
    query.settings.timeout = -5
    expect(validate(query).errors.some((i) => /positive number/i.test(i.message))).toBe(true)
  })

  it('muted blocks are not validated', () => {
    const query = parseQuery('[out:json];node.missing["amenity"];out;')
    query.statements[0].disabled = true
    expect(validate(query).errors).toEqual([])
  })
})

describe('warnings do not block a run', () => {
  it('an unbounded query warns but stays sendable', () => {
    const result = validate(parseQuery('[out:json];node["amenity"="bench"];out;'))
    expect(result.ok).toBe(true)
    expect(result.warnings.some((issue) => /whole planet/i.test(issue.message))).toBe(true)
  })

  it('an empty tag value warns but stays sendable', () => {
    const result = validate(parseQuery('[out:json];node["amenity"=""](50,7,51,8);out;'))
    expect(result.ok).toBe(true)
    expect(result.warnings.some((issue) => /empty value/i.test(issue.message))).toBe(true)
  })
})

describe('field-level checks', () => {
  it('rejects a broken regular expression', () => {
    const result = validate(parseQuery('[out:json];node["name"~"[unclosed"](50,7,51,8);out;'))
    expect(result.errors.some((issue) => /not a valid regular expression/i.test(issue.message))).toBe(
      true,
    )
  })

  it('rejects an inverted bounding box', () => {
    const result = validate(parseQuery('[out:json];node["amenity"](51,7,50,8);out;'))
    expect(result.errors.some((issue) => /south edge above its north/i.test(issue.message))).toBe(
      true,
    )
  })

  it('rejects a polygon with an odd number of numbers', () => {
    const result = validate(parseQuery('[out:json];node(poly:"50 7 51 8 52");out;'))
    expect(result.errors.some((issue) => /odd number/i.test(issue.message))).toBe(true)
  })

  it('rejects a zero radius', () => {
    const result = validate(
      parseQuery('[out:json];node["a"](50,7,51,8)->.x;node(around.x:0);out;'),
    )
    expect(result.errors.some((issue) => /positive number of metres/i.test(issue.message))).toBe(
      true,
    )
  })

  it('rejects "near" with nothing to be near', () => {
    const result = validate(parseQuery('[out:json];node(around:500);out;'))
    expect(result.errors.some((issue) => /nothing to be near/i.test(issue.message))).toBe(true)
  })

  it('accepts "near" once an earlier block produces a result', () => {
    const result = validate(
      parseQuery('[out:json];node["railway"](50,7,51,8);node(around:500);out;'),
    )
    expect(result.errors).toEqual([])
  })
})

describe('issues point at the block they belong to', () => {
  it('carries the statement id', () => {
    const query = makeQuery('nwr')
    query.filters.push(makeFilter('ids'))
    const result = validate(wrap([query, makeStatement('out')]))
    expect(result.errors[0].statementId).toBe(query.id)
    expect(result.errors[0].filterId).toBe(query.filters[0].id)
  })
})

describe('containers are not mistaken for earlier results', () => {
  it('rejects "near" in the first block of a union with nothing before it', () => {
    // A traversal reaches the union before the block inside it. Counting the
    // union as an earlier result would let this through, and the server would
    // then answer "query has no valid input set".
    const result = validate(parseQuery('[out:json];(node(around:500););out;'))
    expect(result.errors.some((issue) => /nothing to be near/i.test(issue.message))).toBe(true)
  })

  it('accepts "near" in a union once a real block precedes it', () => {
    const result = validate(
      parseQuery('[out:json];node["railway"](50,7,51,8);(node(around:500););out;'),
    )
    expect(result.errors).toEqual([])
  })

  it('accepts "near" in the second block of a union', () => {
    const result = validate(
      parseQuery('[out:json];(node["railway"](50,7,51,8);node(around:500););out;'),
    )
    expect(result.errors).toEqual([])
  })

  it('ignores a muted block when deciding what came before', () => {
    const query = parseQuery('[out:json];node["railway"](50,7,51,8);node(around:500);out;')
    query.statements[0].disabled = true
    expect(validate(query).errors.some((i) => /nothing to be near/i.test(i.message))).toBe(true)
  })
})
