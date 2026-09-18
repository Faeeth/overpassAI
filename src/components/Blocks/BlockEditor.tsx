/**
 * The block view of a query.
 *
 * Blocks can be reordered within a list and dragged between containers. The
 * drop target is resolved from whatever the pointer is over: another block
 * means "next to that one", a container means "at the end of it".
 */

import { useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { findStatement, locate, move } from '../../core/mutate'
import { summarize } from '../../core/printer'
import { useQueryStore } from '../../store/useQueryStore'
import { Icon } from '../Common/Icon'
import { metaFor } from './blockMeta'
import { parentFromContainerId } from './dnd'
import { AddBlockButton, BlockList } from './StatementBlock'
import { PresetPicker } from './PresetPicker'
import { SettingsBlock } from './SettingsBlock'

export function BlockEditor() {
  const ast = useQueryStore((state) => state.ast)
  const updateAst = useQueryStore((state) => state.updateAst)
  const parseErrors = useQueryStore((state) => state.parseErrors)
  const [dragging, setDragging] = useState<string | null>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking a control
    // inside a block does not accidentally pick the block up.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragging(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null)

      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeId = String(active.id)
      const overId = String(over.id)

      updateAst((draft) => {
        // Dropped on a container: append to it.
        const container = parentFromContainerId(overId)
        if (container !== undefined) {
          const parentId = container
          const list =
            parentId === null
              ? draft.statements
              : (() => {
                  const parent = findStatement(draft, parentId)
                  if (parent?.kind === 'union') return parent.items
                  if (parent?.kind === 'foreach') return parent.body
                  return null
                })()
          if (!list) return
          move(draft, activeId, parentId, list.length)
          return
        }

        // Dropped on another block: take that block's place.
        const target = locate(draft, overId)
        if (!target || target.slot) return
        move(draft, activeId, target.parentId, target.index)
      })
    },
    [updateAst],
  )

  const draggedStatement = dragging ? findStatement(ast, dragging) : null

  return (
    <div className="blocks">
      {parseErrors.length ? (
        <div className="results__message results__message--error" style={{ padding: 0 }}>
          <h3>The query text has an error</h3>
          <p>
            Blocks show the query as far as it could be read. Fix the problem in the text view,
            or keep editing here to overwrite it.
          </p>
        </div>
      ) : null}

      <SettingsBlock />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <BlockList
          statements={ast.statements}
          parentId={null}
          emptyLabel="No blocks yet. Start with a place, or pick a feature below."
        />

        <DragOverlay dropAnimation={null}>
          {draggedStatement ? (
            <div className={`block block--${metaFor(draggedStatement).role}`}>
              <div className="block__head">
                <span className="block__grip">
                  <Icon name="grip" size={14} />
                </span>
                <span className="block__kind">{metaFor(draggedStatement).title}</span>
                <span className="block__summary">{summarize(draggedStatement)}</span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="row">
        <AddBlockButton parentId={null} />
        <PresetPicker />
      </div>
    </div>
  )
}
