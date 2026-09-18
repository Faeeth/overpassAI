/**
 * Pure helpers behind the result table: which columns to show, and how to
 * order rows by one of them.
 *
 * Separate from the component so they can be tested as functions, which is
 * where the interesting behaviour is: the markup is not what gets a column
 * ordering wrong.
 */

import type { Feature } from 'geojson'

export interface Sort {
  column: string
  direction: 'asc' | 'desc'
}

export const MAX_TAG_COLUMNS = 8

export function labelFor(column: string): string {
  if (column === '@type') return 'Type'
  if (column === '@osmId') return 'Id'
  return column
}

export function valueOf(feature: Feature, key: string): string {
  const value = feature.properties?.[key]
  return value === undefined || value === null ? '' : String(value)
}

/**
 * Sorts by a column, numerically where the values are numbers.
 *
 * Rows with no value for the column always sink to the bottom, whichever way
 * the sort runs: they are absent, not smallest.
 */
export function sortFeatures(features: Feature[], sort: Sort): Feature[] {
  const factor = sort.direction === 'asc' ? 1 : -1

  return [...features].sort((a, b) => {
    const left = valueOf(a, sort.column)
    const right = valueOf(b, sort.column)

    if (!left && !right) return 0
    if (!left) return 1
    if (!right) return -1

    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return (leftNumber - rightNumber) * factor
    }

    return left.localeCompare(right, undefined, { numeric: true }) * factor
  })
}

/** The most widely used tags in the result, `name` first when present. */
export function pickColumns(features: Feature[]): string[] {
  const frequency = new Map<string, number>()

  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      if (key.startsWith('@')) continue
      frequency.set(key, (frequency.get(key) ?? 0) + 1)
    }
  }

  const ranked = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)

  // `name` is what people scan for, even when a technical tag is commoner.
  const withName = ranked.includes('name')
    ? ['name', ...ranked.filter((key) => key !== 'name')]
    : ranked

  return withName.slice(0, MAX_TAG_COLUMNS)
}
