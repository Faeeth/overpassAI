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
import type { FeatureCollection } from 'geojson'

import { flyToFeature } from '../Map/mapRegistry'
import { useUiStore } from '../../store/useUiStore'
import { Icon } from '../Common/Icon'
import { labelFor, pickColumns, sortFeatures, valueOf, type Sort } from './tableColumns'

const PAGE = 250

export function ResultTable({ collection }: { collection: FeatureCollection }) {
  const [limit, setLimit] = useState(PAGE)
  const [sort, setSort] = useState<Sort | null>(null)
  const selectedId = useUiStore((state) => state.selectedFeatureId)
  const selectFeature = useUiStore((state) => state.selectFeature)

  const columns = useMemo(() => pickColumns(collection.features), [collection])

  const ordered = useMemo(() => {
    if (!sort) return collection.features
    return sortFeatures(collection.features, sort)
  }, [collection, sort])

  const rows = ordered.slice(0, limit)
  const remaining = ordered.length - rows.length

  const select = (id: string) => {
    const next = id === selectedId ? null : id
    selectFeature(next)
    // Selecting a row is how people find a result on the map, so the map has
    // to go there rather than highlighting something off-screen.
    if (next) flyToFeature(ordered.find((f) => f.properties?.['@id'] === next) ?? null)
  }

  const toggleSort = (column: string) => {
    setSort((current) => {
      if (current?.column !== column) return { column, direction: 'asc' }
      if (current.direction === 'asc') return { column, direction: 'desc' }
      return null
    })
  }

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

  const header = ['@type', '@osmId', ...columns]

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            {header.map((column) => (
              <th
                key={column}
                scope="col"
                aria-sort={
                  sort?.column === column
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button type="button" className="table__sort" onClick={() => toggleSort(column)}>
                  {labelFor(column)}
                  {sort?.column === column ? (
                    <Icon name={sort.direction === 'asc' ? 'chevron-up' : 'chevron-down'} size={11} />
                  ) : null}
                </button>
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
                tabIndex={0}
                aria-selected={id === selectedId}
                onClick={() => select(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    select(id)
                  }
                }}
              >
                {header.map((column) => (
                  <td
                    key={column}
                    className={column.startsWith('@') ? 'table__mono' : undefined}
                    title={valueOf(feature, column)}
                  >
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
