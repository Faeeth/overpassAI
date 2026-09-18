/**
 * The catalogue of ready-made feature blocks.
 *
 * Picking one appends a Find block with the right tags already set, and scopes
 * it to whatever the query is already searching: a place block if there is one,
 * the map view otherwise. That last detail is what makes it a single click
 * rather than a click plus two more to say where to look.
 */

import { useMemo, useState } from 'react'

import { makeQuery, newId } from '../../core/factory'
import type { Filter, Statement } from '../../core/ast'
import { PRESETS, presetsByCategory, searchPresets, type Preset } from '../../features/presets'
import { useQueryStore } from '../../store/useQueryStore'
import { Dialog } from '../Common/Dialog'
import { Icon } from '../Common/Icon'

export function PresetPicker() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const updateAst = useQueryStore((state) => state.updateAst)

  const grouped = useMemo(() => presetsByCategory(), [])
  const matches = useMemo(() => (query.trim() ? searchPresets(query) : null), [query])

  const add = (preset: Preset) => {
    updateAst((draft) => {
      const statement = makeQuery(preset.type)

      for (const tag of preset.tags) {
        statement.filters.push({
          kind: 'tag',
          id: newId(),
          keyMatch: 'exact',
          key: tag.key,
          op: tag.value ? 'eq' : 'exists',
          value: tag.value,
        })
      }

      statement.filters.push(scopeFilter(draft.statements))

      // Sit above the output blocks, which belong at the end of a query.
      const firstOut = draft.statements.findIndex((s) => s.kind === 'out')
      if (firstOut >= 0) draft.statements.splice(firstOut, 0, statement)
      else draft.statements.push(statement)
    })
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <button type="button" className="btn btn--small" onClick={() => setOpen(true)}>
        <Icon name="search" size={12} /> Browse features
      </button>

      <Dialog open={open} title="Add a feature" onClose={() => setOpen(false)}>
        <div className="presets">
          <input
            className="input"
            value={query}
            autoFocus
            placeholder="Search for restaurants, cycle paths, pharmacies..."
            aria-label="Search features"
            onChange={(event) => setQuery(event.target.value)}
          />

          {matches ? (
            matches.length ? (
              <div className="presets__grid">
                {matches.map((preset) => (
                  <PresetButton key={preset.id} preset={preset} onPick={add} />
                ))}
              </div>
            ) : (
              <p className="dialog__note">
                Nothing matches that. You can still add a Find block and type any tag by hand,
                with suggestions from taginfo.
              </p>
            )
          ) : (
            [...grouped.entries()].map(([category, presets]) => (
              <section key={category}>
                <h3 className="presets__category">{category}</h3>
                <div className="presets__grid">
                  {presets.map((preset) => (
                    <PresetButton key={preset.id} preset={preset} onPick={add} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </Dialog>
    </>
  )
}

function PresetButton({ preset, onPick }: { preset: Preset; onPick: (preset: Preset) => void }) {
  const tags = preset.tags
    .map((tag) => (tag.value ? `${tag.key}=${tag.value}` : `${tag.key}=*`))
    .join(' ')

  return (
    <button type="button" className="preset" onClick={() => onPick(preset)}>
      <span className="preset__label">{preset.label}</span>
      <span className="preset__tags">{tags}</span>
    </button>
  )
}

/**
 * Where a newly added feature should be looked for.
 *
 * Reusing the query's existing scope keeps a growing query coherent: adding a
 * second feature to a query about Lyon should search Lyon, not the whole
 * planet, which would time out.
 */
function scopeFilter(statements: Statement[]): Filter {
  for (const statement of statements) {
    if (statement.kind === 'geocodeArea' && statement.into) {
      return { kind: 'area', id: newId(), set: statement.into }
    }
    if (statement.kind === 'query' && statement.type === 'area' && statement.into) {
      return { kind: 'area', id: newId(), set: statement.into }
    }
  }
  return { kind: 'bbox', id: newId(), bbox: null }
}

export { PRESETS }
