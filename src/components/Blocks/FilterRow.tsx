/**
 * Editors for a single filter inside a Find block.
 *
 * Each filter kind gets the smallest control that expresses it. Tag filters
 * get taginfo autocompletion on both sides, which is the difference between
 * "type amenity=restaurant from memory" and "type rest and pick the value
 * 1.4 million objects already use".
 */

import { useCallback } from 'react'

import type { Filter, RecurseRole, TagOp } from '../../core/ast'
import { formatCount, suggestKeys, suggestValues } from '../../services/taginfo'
import type { KeySuggestion, ValueSuggestion } from '../../services/taginfo'
import { Combobox } from '../Common/Combobox'
import { Icon } from '../Common/Icon'
import { RECURSE_ROLE_LABELS, TAG_OP_LABELS } from './blockMeta'

interface FilterRowProps {
  filter: Filter
  onChange: (next: Filter) => void
  onRemove: () => void
  /** Set names the query defines, offered where a filter can reference one. */
  sets: string[]
}

export function FilterRow({ filter, onChange, onRemove, sets }: FilterRowProps) {
  return (
    <div className="filter">
      <FilterBody filter={filter} onChange={onChange} sets={sets} />
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--small filter__remove"
        onClick={onRemove}
        aria-label="Remove this filter"
        title="Remove this filter"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

function FilterBody({
  filter,
  onChange,
  sets,
}: {
  filter: Filter
  onChange: (next: Filter) => void
  sets: string[]
}) {
  switch (filter.kind) {
    case 'tag':
      return <TagFilterFields filter={filter} onChange={onChange} />

    case 'area':
      return (
        <>
          <span className="filter__op muted">in area</span>
          <SetPicker
            value={filter.set ?? ''}
            sets={sets}
            allowEmpty="the last one found"
            onChange={(set) => onChange({ ...filter, set: set || undefined, areaId: undefined })}
          />
        </>
      )

    case 'bbox':
      return filter.bbox ? (
        <>
          <span className="filter__op muted">in box</span>
          <span className="filter__raw grow">
            {filter.bbox.south}, {filter.bbox.west}, {filter.bbox.north}, {filter.bbox.east}
          </span>
          <button
            type="button"
            className="chip chip--action"
            onClick={() => onChange({ ...filter, bbox: null })}
          >
            Follow the map
          </button>
        </>
      ) : (
        <>
          <span className="filter__op muted">in the current map view</span>
          <span className="grow" />
          <span className="chip chip--accent">live</span>
        </>
      )

    case 'around':
      return (
        <>
          <span className="filter__op muted">within</span>
          <input
            className="input input--mono"
            style={{ width: '5rem' }}
            type="number"
            min={0}
            step={10}
            value={filter.radius}
            aria-label="Radius in metres"
            onChange={(event) => onChange({ ...filter, radius: Number(event.target.value) })}
          />
          <span className="muted">m of</span>
          {filter.points.length ? (
            <input
              className="input input--mono input--grow"
              value={filter.points.join(', ')}
              aria-label="Latitude and longitude pairs"
              onChange={(event) =>
                onChange({
                  ...filter,
                  points: event.target.value
                    .split(',')
                    .map((part) => Number(part.trim()))
                    .filter((value) => Number.isFinite(value)),
                })
              }
            />
          ) : (
            <SetPicker
              value={filter.set ?? ''}
              sets={sets}
              allowEmpty="the last result"
              onChange={(set) => onChange({ ...filter, set: set || undefined })}
            />
          )}
        </>
      )

    case 'ids':
      return (
        <>
          <span className="filter__op muted">id is</span>
          <input
            className="input input--mono input--grow"
            value={filter.ids.join(', ')}
            placeholder="240109189, 240109190"
            aria-label="OSM element ids"
            onChange={(event) =>
              onChange({
                ...filter,
                ids: event.target.value
                  .split(/[,\s]+/)
                  .map((part) => Number(part))
                  .filter((value) => Number.isFinite(value) && value !== 0),
              })
            }
          />
        </>
      )

    case 'recurse':
      return (
        <>
          <select
            className="select select--compact"
            value={filter.role}
            aria-label="Relationship"
            onChange={(event) =>
              onChange({ ...filter, role: event.target.value as RecurseRole })
            }
          >
            {RECURSE_ROLE_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SetPicker
            value={filter.set ?? ''}
            sets={sets}
            allowEmpty="the last result"
            onChange={(set) => onChange({ ...filter, set: set || undefined })}
          />
        </>
      )

    case 'poly':
      return (
        <>
          <span className="filter__op muted">inside</span>
          <input
            className="input input--mono input--grow"
            value={filter.points}
            placeholder="48.85 2.29 48.86 2.35 48.87 2.30"
            aria-label="Polygon coordinates, lat lon pairs"
            onChange={(event) => onChange({ ...filter, points: event.target.value })}
          />
        </>
      )

    case 'user':
      return (
        <>
          <span className="filter__op muted">edited by</span>
          <input
            className="input input--mono input--grow"
            value={filter.users.join(', ')}
            placeholder="mapper name"
            aria-label="OSM user names"
            onChange={(event) =>
              onChange({
                ...filter,
                users: event.target.value
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean),
              })
            }
          />
        </>
      )

    case 'uid':
      return (
        <>
          <span className="filter__op muted">edited by user id</span>
          <input
            className="input input--mono input--grow"
            value={filter.uids.join(', ')}
            aria-label="OSM user ids"
            onChange={(event) =>
              onChange({
                ...filter,
                uids: event.target.value
                  .split(/[,\s]+/)
                  .map(Number)
                  .filter((value) => Number.isFinite(value) && value !== 0),
              })
            }
          />
        </>
      )

    case 'newer':
      return (
        <>
          <span className="filter__op muted">changed since</span>
          <DateField
            value={filter.date}
            onChange={(date) => onChange({ ...filter, date })}
            label="Date"
          />
        </>
      )

    case 'changed':
      return (
        <>
          <span className="filter__op muted">changed between</span>
          <DateField
            value={filter.from}
            onChange={(from) => onChange({ ...filter, from })}
            label="Start date"
          />
          <span className="muted">and</span>
          <DateField
            value={filter.to ?? ''}
            onChange={(to) => onChange({ ...filter, to: to || undefined })}
            label="End date"
          />
        </>
      )

    case 'pivot':
      return (
        <>
          <span className="filter__op muted">outline of</span>
          <SetPicker
            value={filter.set ?? ''}
            sets={sets}
            allowEmpty="the last area"
            onChange={(set) => onChange({ ...filter, set: set || undefined })}
          />
        </>
      )

    case 'if':
      return (
        <>
          <span className="filter__op muted">where</span>
          <input
            className="input input--mono input--grow"
            value={filter.expr}
            placeholder="count_tags() > 5"
            aria-label="Overpass condition"
            onChange={(event) => onChange({ ...filter, expr: event.target.value })}
          />
        </>
      )

    case 'raw':
      return (
        <>
          <span className="filter__op faint">raw</span>
          <input
            className="input input--mono input--grow"
            value={filter.text}
            aria-label="Raw Overpass filter"
            onChange={(event) => onChange({ ...filter, text: event.target.value })}
          />
        </>
      )
  }
}

// ---------------------------------------------------------------------------
// Tag filters
// ---------------------------------------------------------------------------

function TagFilterFields({
  filter,
  onChange,
}: {
  filter: Extract<Filter, { kind: 'tag' }>
  onChange: (next: Filter) => void
}) {
  const loadKeys = useCallback((query: string) => suggestKeys(query), [])
  const loadValues = useCallback(
    (query: string) => suggestValues(filter.key, query),
    [filter.key],
  )

  const needsValue = filter.op !== 'exists' && filter.op !== 'missing'
  const isRegex = filter.op === 'like' || filter.op === 'notlike'

  return (
    <>
      <Combobox<KeySuggestion>
        value={filter.key}
        onChange={(key) => onChange({ ...filter, key })}
        load={loadKeys}
        optionValue={(option) => option.key}
        renderOption={(option) => (
          <>
            <span className="combo__value">{option.key}</span>
            <span className="combo__count">{formatCount(option.count)}</span>
          </>
        )}
        ariaLabel="Tag key"
        placeholder="key"
        hint="Counts are objects using this key across OpenStreetMap."
      />

      <select
        className="select select--compact filter__op"
        value={filter.op}
        aria-label="Comparison"
        onChange={(event) => {
          const op = event.target.value as TagOp
          onChange({
            ...filter,
            op,
            value: op === 'exists' || op === 'missing' ? undefined : (filter.value ?? ''),
          })
        }}
      >
        {TAG_OP_LABELS.map((option) => (
          <option key={option.value} value={option.value} title={option.hint}>
            {option.label}
          </option>
        ))}
      </select>

      {needsValue ? (
        <Combobox<ValueSuggestion>
          value={filter.value ?? ''}
          onChange={(value) => onChange({ ...filter, value })}
          load={loadValues}
          optionValue={(option) => option.value}
          renderOption={(option) => (
            <>
              <span className="combo__value">{option.value}</span>
              <span className="combo__count">{formatCount(option.count)}</span>
            </>
          )}
          ariaLabel="Tag value"
          placeholder={isRegex ? 'regular expression' : 'value'}
          openOnFocus={!isRegex}
          hint={
            isRegex
              ? 'Matching is a regular expression, so ^ and $ anchor it.'
              : 'Counts are objects with this exact value.'
          }
        />
      ) : (
        <span className="grow" />
      )}

      {needsValue ? (
        <label className="checkbox" title="Ignore upper and lower case">
          <input
            type="checkbox"
            checked={filter.caseInsensitive ?? false}
            onChange={(event) =>
              onChange({ ...filter, caseInsensitive: event.target.checked || undefined })
            }
          />
          Aa
        </label>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Shared small controls
// ---------------------------------------------------------------------------

function SetPicker({
  value,
  sets,
  allowEmpty,
  onChange,
}: {
  value: string
  sets: string[]
  /** Label for the "no explicit set" option. */
  allowEmpty: string
  onChange: (set: string) => void
}) {
  // A set the query no longer defines must still be listed, or selecting it
  // would silently switch the filter to something else.
  const options = value && !sets.includes(value) ? [...sets, value] : sets

  return (
    <select
      className="select select--compact grow"
      value={value}
      aria-label="Set"
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{allowEmpty}</option>
      {options.map((set) => (
        <option key={set} value={set}>
          .{set}
        </option>
      ))}
    </select>
  )
}

/**
 * Date field.
 *
 * Overpass wants a full ISO timestamp, but people think in days, so the
 * control is a plain date and the time is pinned to midnight UTC.
 */
function DateField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const asDate = value.slice(0, 10)

  return (
    <input
      className="input input--mono"
      type="date"
      value={asDate}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.value
        onChange(next ? `${next}T00:00:00Z` : '')
      }}
    />
  )
}
