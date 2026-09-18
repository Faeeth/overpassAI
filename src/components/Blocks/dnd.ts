/**
 * Drag and drop identity for block containers.
 *
 * A drop target is either a block (drop next to it) or a container (drop at the
 * end of it), and both arrive as a single string id. Containers are prefixed so
 * the two can never be confused, and both sides of the conversion live here so
 * the prefix is written once.
 */

const PREFIX = 'container:'
const ROOT = 'root'

/** Droppable id for a container. `null` is the top level. */
export function containerId(parentId: string | null): string {
  return `${PREFIX}${parentId ?? ROOT}`
}

/**
 * The parent a droppable id refers to, or `undefined` when the id belongs to a
 * block rather than a container. `null` means the top level.
 */
export function parentFromContainerId(id: string): string | null | undefined {
  if (!id.startsWith(PREFIX)) return undefined
  const rest = id.slice(PREFIX.length)
  return rest === ROOT ? null : rest
}
