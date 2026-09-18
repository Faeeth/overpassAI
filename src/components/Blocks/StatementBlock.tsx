/**
 * A statement, drawn as a block.
 *
 * The blocks are not a separate model of the query: they render the AST
 * directly and edit it in place, which is why the text view can never drift
 * from the block view. Container blocks recurse through `BlockList`, which
 * lives here too so the two can reference each other without a cycle.
 */

import { useCallback, useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type {
  Filter,
  OutGeometry,
  OutVerbosity,
  QueryType,
  Statement,
  StatementKind,
} from '../../core/ast'
import { cloneWithNewIds, makeFilter, makeStatement } from '../../core/factory'
import { definedSets, detach, findStatement, insertAt, locate } from '../../core/mutate'
import { summarize } from '../../core/printer'
import { search as searchPlaces, type Place } from '../../services/nominatim'
import { useQueryStore } from '../../store/useQueryStore'
import { Combobox } from '../Common/Combobox'
import { Icon } from '../Common/Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../Common/Menu'
import { containerId } from './dnd'
import { FilterRow } from './FilterRow'
import {
  ADD_MENU_ORDER,
  FILTER_MENU,
  OUT_GEOMETRY_LABELS,
  OUT_VERBOSITY_LABELS,
  QUERY_TYPE_LABELS,
  RECURSE_OP_LABELS,
  metaFor,
  metaForKind,
} from './blockMeta'

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

interface BlockListProps {
  statements: Statement[]
  /** Statement id that owns this list, or null for the top level. */
  parentId: string | null
  emptyLabel: string
}

export function BlockList({ statements, parentId, emptyLabel }: BlockListProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: containerId(parentId),
    data: { parentId, isContainer: true },
  })

  return (
    <div
      ref={setNodeRef}
      className="stack"
      style={isOver && !statements.length ? { outline: '1px dashed var(--accent)' } : undefined}
    >
      <SortableContext
        items={statements.map((stmt) => stmt.id)}
        strategy={verticalListSortingStrategy}
      >
        {statements.map((stmt) => (
          <StatementBlock key={stmt.id} statement={stmt} parentId={parentId} />
        ))}
      </SortableContext>

      {statements.length === 0 ? <div className="block__empty">{emptyLabel}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

interface StatementBlockProps {
  statement: Statement
  parentId: string | null
  /** Slots inside a difference are edited in place but not dragged. */
  draggable?: boolean
}

export function StatementBlock({ statement, parentId, draggable = true }: StatementBlockProps) {
  const meta = metaFor(statement)
  const actions = useStatementActions(statement.id)

  const sortable = useSortable({
    id: statement.id,
    disabled: !draggable,
    data: { parentId },
  })

  const style = draggable
    ? {
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }
    : undefined

  return (
    <div
      ref={draggable ? sortable.setNodeRef : undefined}
      style={style}
      className={`block block--${meta.role}`}
      data-dragging={sortable.isDragging || undefined}
      data-disabled={statement.disabled || undefined}
    >
      <div className="block__head">
        {draggable ? (
          <button
            type="button"
            className="block__grip"
            aria-label={`Move ${meta.title} block`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <Icon name="grip" size={14} />
          </button>
        ) : (
          <span className="block__grip" aria-hidden="true" />
        )}

        <span className="block__kind">{meta.title}</span>
        <span className="block__summary" title={summarize(statement)}>
          {summarize(statement)}
        </span>

        <div className="block__actions">
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--small"
            onClick={actions.toggleDisabled}
            aria-label={statement.disabled ? 'Turn this block back on' : 'Turn this block off'}
            title={statement.disabled ? 'Turn back on' : 'Turn off'}
          >
            <Icon name={statement.disabled ? 'eye-off' : 'eye'} size={13} />
          </button>

          <Menu
            triggerClassName="btn btn--ghost btn--icon btn--small"
            triggerLabel="Block options"
            trigger={<Icon name="menu" size={13} />}
            align="end"
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Icon name="copy" size={13} />}
                  onClick={() => {
                    actions.duplicate()
                    close()
                  }}
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  icon={<Icon name="pin" size={13} />}
                  onClick={() => {
                    actions.setLabel(
                      window.prompt('Note for this block', statement.label ?? '') ?? undefined,
                    )
                    close()
                  }}
                >
                  {statement.label ? 'Edit note' : 'Add a note'}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Icon name="trash" size={13} />}
                  onClick={() => {
                    actions.remove()
                    close()
                  }}
                >
                  Delete
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      {statement.label ? (
        <div className="block__body" style={{ paddingBottom: 0 }}>
          <p className="block__note">{statement.label}</p>
        </div>
      ) : null}

      <BlockBody statement={statement} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function BlockBody({ statement }: { statement: Statement }) {
  switch (statement.kind) {
    case 'query':
      return <QueryBody statement={statement} />
    case 'geocodeArea':
      return <PlaceBody statement={statement} />
    case 'union':
      return (
        <div className="block__children">
          <BlockList
            statements={statement.items}
            parentId={statement.id}
            emptyLabel="Drop blocks here, or add one below."
          />
          <AddBlockButton parentId={statement.id} />
          <IntoField statement={statement} />
        </div>
      )
    case 'difference':
      return <DifferenceBody statement={statement} />
    case 'foreach':
      return (
        <div className="block__children">
          <BlockList
            statements={statement.body}
            parentId={statement.id}
            emptyLabel="Blocks here run once per element."
          />
          <AddBlockButton parentId={statement.id} />
        </div>
      )
    case 'recurse':
      return <RecurseBody statement={statement} />
    case 'out':
      return <OutBody statement={statement} />
    case 'setref':
      return <SetRefBody statement={statement} />
    case 'isin':
      return <IsInBody statement={statement} />
    case 'raw':
      return <RawBody statement={statement} />
  }
}

function QueryBody({ statement }: { statement: Extract<Statement, { kind: 'query' }> }) {
  const actions = useStatementActions(statement.id)
  const sets = useSets()

  return (
    <div className="block__body">
      <div className="field__row">
        <select
          className="select"
          value={statement.type}
          aria-label="Element types"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              stmt.type = event.target.value as QueryType
            })
          }
        >
          {QUERY_TYPE_LABELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="muted">matching</span>
      </div>

      <div className="stack">
        {statement.filters.map((filter) => (
          <FilterRowBound
            key={filter.id}
            statementId={statement.id}
            filter={filter}
            sets={sets}
          />
        ))}
      </div>

      <div className="filter-add">
        <Menu
          triggerClassName="btn btn--small"
          triggerLabel="Add a filter"
          trigger={
            <>
              <Icon name="plus" size={12} /> Filter
            </>
          }
        >
          {(close) => (
            <>
              <MenuLabel>Narrow this down by</MenuLabel>
              {FILTER_MENU.map((entry) => (
                <MenuItem
                  key={entry.kind}
                  onClick={() => {
                    actions.update<typeof statement>((stmt) => {
                      stmt.filters.push(makeFilter(entry.kind as Filter['kind']))
                    })
                    close()
                  }}
                >
                  <span title={entry.description}>{entry.label}</span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>

        <IntoField statement={statement} inline />
      </div>
    </div>
  )
}

function FilterRowBound({
  statementId,
  filter,
  sets,
}: {
  statementId: string
  filter: Filter
  sets: string[]
}) {
  const actions = useStatementActions(statementId)

  return (
    <FilterRow
      filter={filter}
      sets={sets}
      onChange={(next) =>
        actions.update<Extract<Statement, { kind: 'query' }>>((stmt) => {
          const index = stmt.filters.findIndex((f) => f.id === filter.id)
          if (index >= 0) stmt.filters[index] = next
        })
      }
      onRemove={() =>
        actions.update<Extract<Statement, { kind: 'query' }>>((stmt) => {
          stmt.filters = stmt.filters.filter((f) => f.id !== filter.id)
        })
      }
    />
  )
}

function PlaceBody({ statement }: { statement: Extract<Statement, { kind: 'geocodeArea' }> }) {
  const actions = useStatementActions(statement.id)
  const load = useCallback((query: string) => {
    if (query.trim().length < 2) return Promise.resolve([])
    return searchPlaces(query, { limit: 8 }).then((places) =>
      places.filter((place) => place.areaId !== null),
    )
  }, [])

  return (
    <div className="block__body">
      <div className="field__row">
        <Combobox<Place>
          value={statement.query}
          onChange={(query) =>
            actions.update<typeof statement>((stmt) => {
              stmt.query = query
            })
          }
          load={load}
          optionValue={(place) => place.displayName}
          renderOption={(place) => (
            <>
              <span className="combo__value">{place.displayName}</span>
              <span className="combo__count">{place.osmType}</span>
            </>
          )}
          ariaLabel="Place name"
          placeholder="Lyon, Bavaria, Portugal..."
          openOnFocus={false}
          className="input input--grow"
          hint="Only places with a boundary can be searched inside."
        />
      </div>
      <IntoField statement={statement} inline />
    </div>
  )
}

function DifferenceBody({
  statement,
}: {
  statement: Extract<Statement, { kind: 'difference' }>
}) {
  const actions = useStatementActions(statement.id)

  return (
    <div className="block__children">
      <div className="block__slot">
        <span className="block__slot-label">Start from</span>
        <Slot statement={statement.left} onSet={(next) => actions.setSlot('left', next)} />
      </div>

      <div className="block__slot">
        <span className="block__slot-label">and remove</span>
        <Slot statement={statement.right} onSet={(next) => actions.setSlot('right', next)} />
      </div>

      <IntoField statement={statement} />
    </div>
  )
}

function Slot({
  statement,
  onSet,
}: {
  statement: Statement | null
  onSet: (next: Statement | null) => void
}) {
  if (statement) {
    return <StatementBlock statement={statement} parentId={null} draggable={false} />
  }

  return (
    <Menu
      triggerClassName="block__empty"
      triggerLabel="Choose a block for this slot"
      trigger={<>Pick a block</>}
    >
      {(close) => (
        <>
          <MenuLabel>Use</MenuLabel>
          {(['query', 'union', 'setref'] as StatementKind[]).map((kind) => (
            <MenuItem
              key={kind}
              onClick={() => {
                onSet(makeStatement(kind))
                close()
              }}
            >
              {metaForKind(kind).menuTitle}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

function RecurseBody({ statement }: { statement: Extract<Statement, { kind: 'recurse' }> }) {
  const actions = useStatementActions(statement.id)

  return (
    <div className="block__body">
      <select
        className="select"
        value={statement.op}
        aria-label="What to add"
        onChange={(event) =>
          actions.update<typeof statement>((stmt) => {
            stmt.op = event.target.value as typeof stmt.op
          })
        }
      >
        {RECURSE_OP_LABELS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="block__note">
        Ways need their nodes to be drawn. A query that returns ways alone will look empty on
        the map without this.
      </p>
    </div>
  )
}

function OutBody({ statement }: { statement: Extract<Statement, { kind: 'out' }> }) {
  const actions = useStatementActions(statement.id)

  return (
    <div className="block__body">
      <div className="field__row">
        <select
          className="select grow"
          value={statement.verbosity ?? 'body'}
          aria-label="How much detail"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              stmt.verbosity = event.target.value as OutVerbosity
            })
          }
        >
          {OUT_VERBOSITY_LABELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="select grow"
          value={statement.geometry ?? ''}
          aria-label="Geometry"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              stmt.geometry = (event.target.value || undefined) as OutGeometry | undefined
            })
          }
        >
          {OUT_GEOMETRY_LABELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field__row">
        <label className="field__label" htmlFor={`limit-${statement.id}`}>
          Stop after
        </label>
        <input
          id={`limit-${statement.id}`}
          className="input input--mono"
          style={{ width: '7rem' }}
          type="number"
          min={0}
          step={100}
          value={statement.limit ?? ''}
          placeholder="no limit"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              const value = Number(event.target.value)
              stmt.limit = event.target.value && Number.isFinite(value) ? value : undefined
            })
          }
        />
        <span className="muted">elements</span>

        <label className="checkbox" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={statement.sort === 'qt'}
            onChange={(event) =>
              actions.update<typeof statement>((stmt) => {
                stmt.sort = event.target.checked ? 'qt' : undefined
              })
            }
          />
          Fastest order
        </label>
      </div>
    </div>
  )
}

function SetRefBody({ statement }: { statement: Extract<Statement, { kind: 'setref' }> }) {
  const actions = useStatementActions(statement.id)
  const sets = useSets()

  return (
    <div className="block__body">
      <div className="field__row">
        <span className="muted">use</span>
        <select
          className="select grow"
          value={statement.set}
          aria-label="Set name"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              stmt.set = event.target.value
            })
          }
        >
          <option value="_">the last result</option>
          {sets.map((set) => (
            <option key={set} value={set}>
              .{set}
            </option>
          ))}
        </select>
      </div>
      <IntoField statement={statement} inline />
    </div>
  )
}

function IsInBody({ statement }: { statement: Extract<Statement, { kind: 'isin' }> }) {
  const actions = useStatementActions(statement.id)

  return (
    <div className="block__body">
      <div className="field__row">
        <input
          className="input input--mono"
          style={{ width: '8rem' }}
          type="number"
          step="any"
          value={statement.lat ?? ''}
          placeholder="latitude"
          aria-label="Latitude"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              stmt.lat = event.target.value ? Number(event.target.value) : undefined
            })
          }
        />
        <input
          className="input input--mono"
          style={{ width: '8rem' }}
          type="number"
          step="any"
          value={statement.lon ?? ''}
          placeholder="longitude"
          aria-label="Longitude"
          onChange={(event) =>
            actions.update<typeof statement>((stmt) => {
              stmt.lon = event.target.value ? Number(event.target.value) : undefined
            })
          }
        />
      </div>
      <IntoField statement={statement} inline />
    </div>
  )
}

function RawBody({ statement }: { statement: Extract<Statement, { kind: 'raw' }> }) {
  const actions = useStatementActions(statement.id)

  return (
    <div className="block__body">
      <textarea
        className="input input--mono"
        rows={Math.min(8, statement.text.split('\n').length + 1)}
        value={statement.text}
        aria-label="Overpass QL"
        spellCheck={false}
        onChange={(event) =>
          actions.update<typeof statement>((stmt) => {
            stmt.text = event.target.value
          })
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The `->.name` output set, which is how blocks feed each other. */
function IntoField({ statement, inline }: { statement: Statement; inline?: boolean }) {
  const actions = useStatementActions(statement.id)
  const into = 'into' in statement ? statement.into : undefined

  if (into === undefined && inline) {
    return (
      <button
        type="button"
        className="chip chip--action"
        onClick={() => actions.setInto('result')}
        title="Give this result a name so later blocks can use it"
      >
        <Icon name="plus" size={11} /> name this result
      </button>
    )
  }

  if (into === undefined) return null

  return (
    <div className="field__row">
      <span className="muted">save as</span>
      <input
        className="input input--mono"
        style={{ width: '10rem' }}
        value={into}
        aria-label="Result set name"
        spellCheck={false}
        onChange={(event) => actions.setInto(event.target.value.replace(/[^\w]/g, ''))}
      />
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--small"
        onClick={() => actions.setInto(undefined)}
        aria-label="Stop naming this result"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

export function AddBlockButton({ parentId }: { parentId: string | null }) {
  const updateAst = useQueryStore((state) => state.updateAst)

  return (
    <Menu
      triggerClassName="btn btn--small"
      triggerLabel="Add a block"
      trigger={
        <>
          <Icon name="plus" size={12} /> Add block
        </>
      }
    >
      {(close) => (
        <>
          <MenuLabel>Add</MenuLabel>
          {ADD_MENU_ORDER.map((kind) => {
            const meta = metaForKind(kind)
            return (
              <MenuItem
                key={kind}
                onClick={() => {
                  updateAst((draft) => {
                    const target = parentId ? findStatement(draft, parentId) : null
                    const list =
                      target?.kind === 'union'
                        ? target.items
                        : target?.kind === 'foreach'
                          ? target.body
                          : draft.statements
                    list.push(makeStatement(kind))
                  })
                  close()
                }}
              >
                <span title={meta.description}>{meta.menuTitle}</span>
              </MenuItem>
            )
          })}
        </>
      )}
    </Menu>
  )
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

function useSets(): string[] {
  const ast = useQueryStore((state) => state.ast)
  return useMemo(() => definedSets(ast), [ast])
}

interface StatementActions {
  update: <T extends Statement>(recipe: (stmt: T) => void) => void
  remove: () => void
  duplicate: () => void
  toggleDisabled: () => void
  setLabel: (label: string | undefined) => void
  setInto: (into: string | undefined) => void
  setSlot: (slot: 'left' | 'right', next: Statement | null) => void
}

function useStatementActions(id: string): StatementActions {
  const updateAst = useQueryStore((state) => state.updateAst)

  return useMemo<StatementActions>(() => {
    const edit = (recipe: (stmt: Statement) => void) => {
      updateAst((draft) => {
        const stmt = findStatement(draft, id)
        if (stmt) recipe(stmt)
      })
    }

    return {
      update: (recipe) => edit((stmt) => recipe(stmt as never)),

      remove: () =>
        updateAst((draft) => {
          detach(draft, id)
        }),

      duplicate: () =>
        updateAst((draft) => {
          const stmt = findStatement(draft, id)
          const where = locate(draft, id)
          if (!stmt || !where || where.slot) return
          insertAt(draft, where.parentId, where.index + 1, cloneWithNewIds(stmt))
        }),

      toggleDisabled: () =>
        edit((stmt) => {
          stmt.disabled = stmt.disabled ? undefined : true
        }),

      setLabel: (label) =>
        edit((stmt) => {
          stmt.label = label?.trim() || undefined
        }),

      setInto: (into) =>
        edit((stmt) => {
          if ('into' in stmt) (stmt as { into?: string }).into = into || undefined
        }),

      setSlot: (slot, next) =>
        edit((stmt) => {
          if (stmt.kind === 'difference') stmt[slot] = next
        }),
    }
  }, [id, updateAst])
}

