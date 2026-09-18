/**
 * Results as a table.
 *
 * Columns are chosen by how many rows actually carry each tag, so the ones
 * that describe the result sit on the left instead of being buried behind a
 * tag three features happen to have. Rows are capped and extended on demand:
 * a query can legitimately return 50,000 elements, and rendering them all
 * would freeze the tab for the sake of a scrollbar nobody drags to the end of.
 */

import { useMemo, useState } from 'react'
import type { Feature, FeatureCollection } from 'geojson'

import { useUiStore } from '../../store/useUiStore'

const PAGE = 250
const MAX_TAG_COLUMNS = 8

export function ResultTable({ collection }: { collection: FeatureCollection }) {
  const [limit, setLimit] = useState(PAGE)
  const selectedId = useUiStore((state) => state.selectedFeatureId)
  const selectFeature = useUiStore((state) => state.selectFeature)

  const columns = useMemo(() => pickColumns(collection.features), [collection])
  const rows = collection.features.slice(0, limit)
  const remaining = collection.features.length - rows.length

  if (!collection.features.length) {
    return (
      <div className="results__message">
        <h3>Nothing came back</h3>
        <p>
          The query ran but matched no elements. Widen the area, loosen a filter, or check the
          tag spelling against the suggestions.
        </p>
      </div>
    )
  }

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Id</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((feature) => {
            const id = String(feature.properties?.['@id'] ?? '')
            return (
              <tr
                key={id}
                aria-selected={id === selectedId}
                onClick={() => selectFeature(id === selectedId ? null : id)}
              >
                <td className="table__mono">{String(feature.properties?.['@type'] ?? '')}</td>
                <td className="table__mono">{String(feature.properties?.['@osmId'] ?? '')}</td>
                {columns.map((column) => (
                  <td key={column} title={valueOf(feature, column)}>
                    {valueOf(feature, column)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      {remaining > 0 ? (
        <div className="table__more">
          <button type="button" className="btn btn--small" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, remaining).toLocaleString()} more
          </button>
          <span className="faint" style={{ marginLeft: '0.75rem' }}>
            {remaining.toLocaleString()} still hidden
          </span>
        </div>
      ) : null}
    </>
  )
}

function valueOf(feature: Feature, key: string): string {
  const value = feature.properties?.[key]
  return value === undefined || value === null ? '' : String(value)
}

/** The most widely used tags in the result, `name` first when present. */
function pickColumns(features: Feature[]): string[] {
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
