/**
 * Saved queries.
 *
 * Stored in this browser only, which the panel says plainly rather than
 * letting people discover it when they switch machines. Exporting the library
 * to a file is the durable copy, and the button for it is right there.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import * as library from '../../features/library'
import { openProjectFile } from '../../features/session'
import { readProjectFile, ProjectFormatError } from '../../features/exporters/project'
import { useQueryStore } from '../../store/useQueryStore'
import { useUiStore } from '../../store/useUiStore'
import { Dialog } from '../Common/Dialog'
import { Icon } from '../Common/Icon'
import { toast } from '../Common/Toast'

export function LibraryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [queries, setQueries] = useState<library.SavedQuery[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const source = useQueryStore((state) => state.source)
  const name = useQueryStore((state) => state.name)
  const load = useQueryStore((state) => state.load)
  const setName = useQueryStore((state) => state.setName)
  const view = useUiStore((state) => state.view)

  const refresh = useCallback(() => setQueries(library.list()), [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const persistent = library.isPersistent()

  const saveCurrent = () => {
    try {
      library.save({ name, source, view })
      refresh()
      toast.success(`Saved "${name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const openSaved = (entry: library.SavedQuery) => {
    load(entry.source, { name: entry.name })
    if (entry.view) useUiStore.getState().setView(entry.view)
    onClose()
  }

  const exportAll = () => {
    const blob = new Blob([library.exportLibrary()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'overpassai-library.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    toast.success('Library exported')
  }

  const importFile = async (file: File) => {
    const text = await file.text()

    // The same picker accepts a library and a single project, because from the
    // outside they are both "a file this app made".
    try {
      const result = library.importLibrary(text)
      refresh()
      toast.success(`Imported ${result.added} new, updated ${result.updated}`)
      return
    } catch {
      /* not a library; try a project below */
    }

    try {
      const project = await readProjectFile(file)
      openProjectFile(project)
      onClose()
      toast.success(`Opened "${project.name}"`)
    } catch (err) {
      toast.error(
        err instanceof ProjectFormatError
          ? err.message
          : 'That file is neither a query library nor a project.',
      )
    }
  }

  return (
    <Dialog
      open={open}
      title="Saved queries"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={13} /> Open a file
          </button>
          <button
            type="button"
            className="btn"
            onClick={exportAll}
            disabled={!queries.length}
          >
            <Icon name="download" size={13} /> Export library
          </button>
          <button type="button" className="btn btn--primary" onClick={saveCurrent}>
            Save this query
          </button>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />

      <div className="field">
        <label className="field__label" htmlFor="library-name">
          Name for the current query
        </label>
        <input
          id="library-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {queries.length ? (
        <div>
          {queries.map((entry) => (
            <div className="saved" key={entry.id}>
              <button type="button" className="saved__main" onClick={() => openSaved(entry)}>
                <div className="saved__name">{entry.name}</div>
                <div className="saved__meta">
                  {new Date(entry.updatedAt).toLocaleString()} &middot;{' '}
                  {entry.source.split('\n').length} lines
                </div>
              </button>

              <button
                type="button"
                className="btn btn--ghost btn--icon btn--small btn--danger"
                aria-label={`Delete ${entry.name}`}
                onClick={() => {
                  library.remove(entry.id)
                  refresh()
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="dialog__note">
          No saved queries yet. Save the current one, or open a project file you exported
          earlier.
        </p>
      )}

      <p className="dialog__note">
        {persistent
          ? 'Saved queries live in this browser only. They do not follow you to another machine, and clearing site data erases them. Export the library to keep a copy.'
          : 'This browser is not letting the page store anything, so saving will not survive a reload. Export the library to a file instead.'}
      </p>
    </Dialog>
  )
}
