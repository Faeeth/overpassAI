/**
 * Results as a table.
 *
 * Columns are chosen by how many rows actually carry each tag, so the ones
 * that describe the result sit on the left instead of being buried behind a
 * tag three features happen to have. Rows are capped and extended on demand:
 * a query can legitimately return 50,000 elements, and rendering them all
 * would freeze the tab for the sake of a scrollbar nobody drags to the end of.
 */

import { useMemo, useState, type KeyboardEvent } from 'react'
import type { FeatureCollection } from 'geojson'

import { flyToFeature } from '../Map/mapRegistry'
import { useResultStore } from '../../store/useResultStore'
import { useUiStore } from '../../store/useUiStore'
import { shortPlace } from './ResultsPanel'
import { Icon } from '../Common/Icon'
import { labelFor, pickColumns, sortFeatures, valueOf, type Sort } from './tableColumns'

const PAGE = 250

export function ResultTable({ collection }: { collection: FeatureCollection }) {
  const [limit, setLimit] = useState(PAGE)
  const [sort, setSort] = useState<Sort | null>(null)
  const [focusedRow, setFocusedRow] = useState(0)
  const selectedId = useUiStore((state) => state.selectedFeatureId)
  const selectFeature = useUiStore((state) => state.selectFeature)
  const geocoded = useResultStore((state) => state.data?.geocoded ?? [])
  const scope = geocoded.length ? shortPlace(geocoded[0].displayName) : null

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

  /**
   * Arrow keys walk the rows, Enter and Space select, Home and End jump.
   *
   * The row that has focus becomes the table's single tab stop, so tabbing
   * out of the table lands on whatever follows it rather than on row two.
   */
  const moveOrSelect = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number,
    id: string,
    total: number,
  ) => {
    const go = (next: number) => {
      event.preventDefault()
      const clamped = Math.max(0, Math.min(next, total - 1))
      setFocusedRow(clamped)
      const target = event.currentTarget.parentElement?.children[clamped]
      if (target instanceof HTMLElement) target.focus()
    }

    switch (event.key) {
      case 'ArrowDown':
        return go(index + 1)
      case 'ArrowUp':
        return go(index - 1)
      case 'Home':
        return go(0)
      case 'End':
        return go(total - 1)
      case 'Enter':
      case ' ':
        event.preventDefault()
        return select(id)
      default:
        return undefined
    }
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
          The query ran but matched no elements
          {scope ? (
            <>
              {' '}
              in <strong>{scope}</strong>
            </>
          ) : null}
          . Widen the area, loosen a filter, or check the tag spelling against the suggestions.
        </p>
        {scope ? (
          <div className="results__hint">
            Adding a feature reuses the place the query already had, which is not always where
            the map is looking. Change the Place block to search somewhere else.
          </div>
        ) : null}
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
          {rows.map((feature, index) => {
            const id = String(feature.properties?.['@id'] ?? '')
            return (
              <tr
                key={id}
                // Roving tabindex: one stop for the whole table, arrows inside.
                // Making every row focusable put 250 stops between the results
                // and anything after them.
                tabIndex={index === focusedRow ? 0 : -1}
                aria-selected={id === selectedId}
                onClick={() => select(id)}
                onFocus={() => setFocusedRow(index)}
                onKeyDown={(event) => moveOrSelect(event, index, id, rows.length)}
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
