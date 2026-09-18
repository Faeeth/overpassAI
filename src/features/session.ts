/**
 * Actions that span several stores: running the query, and packaging the
 * session into a project file or restoring one.
 *
 * These live outside the components so the keyboard shortcut, the toolbar and
 * a restored permalink all go through exactly the same path.
 */

import { currentViewportBBox } from '../components/Map/mapRegistry'
import { parse } from '../core/parser'
import { useQueryStore } from '../store/useQueryStore'
import { useResultStore } from '../store/useResultStore'
import { useUiStore } from '../store/useUiStore'
import {
  ATTRIBUTION,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ProjectFile,
} from './exporters/project'
import { viewForBounds, boundsOf } from '../store/useResultStore'

/** Runs the query currently in the editor. */
export function runCurrentQuery(): void {
  const { ast } = useQueryStore.getState()
  const { endpointUrl } = useUiStore.getState()

  void useResultStore.getState().run(ast, {
    endpoint: endpointUrl,
    viewport: currentViewportBBox(),
  })
}

/**
 * Builds the reopenable project file.
 *
 * It holds the query *and* the results, which is the difference between an
 * export you can look at and a save you can carry on working from: reopening
 * restores the map, the table and the blocks that produced them.
 */
export function buildProjectFile(): ProjectFile {
  const { source, ast, name } = useQueryStore.getState()
  const { view } = useUiStore.getState()
  const result = useResultStore.getState().data

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    name,
    source,
    ast,
    view,
    result: result
      ? {
          runAt: result.runAt,
          durationMs: result.durationMs,
          endpoint: result.endpoint,
          compiledSource: result.compiledSource,
          stats: result.stats,
          geojson: result.geojson,
        }
      : undefined,
    attribution: ATTRIBUTION,
  }
}

/** Restores a project: query, blocks, map position and the saved results. */
export function openProjectFile(project: ProjectFile): void {
  // Re-parse rather than trusting the stored tree blindly, but keep the stored
  // one when it parses to the same query: it preserves notes and muted blocks.
  const reparsed = parse(project.source)
  const ast = project.ast ?? reparsed.query

  useQueryStore.getState().load(project.source, { name: project.name, ast })

  if (project.view) {
    useUiStore.getState().setView(project.view)
  }

  if (project.result) {
    useResultStore.getState().restore({
      geojson: project.result.geojson,
      stats: project.result.stats,
      unplaced: [],
      compiledSource: project.result.compiledSource,
      raw: JSON.stringify(project.result.geojson, null, 2),
      csv: null,
      durationMs: project.result.durationMs,
      runAt: project.result.runAt,
      endpoint: project.result.endpoint,
      geocoded: [],
    })

    if (!project.view) {
      const bounds = boundsOf(project.result.geojson)
      if (bounds) useUiStore.getState().setView(viewForBounds(bounds))
    }
  } else {
    useResultStore.getState().clear()
  }
}
