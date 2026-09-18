/**
 * Download the results.
 *
 * The project format is listed first and on purpose: it is the only one that
 * keeps the question alongside the answer, so it is the one worth reaching for
 * when the work is not finished.
 */

import { useState } from 'react'

import { EXPORT_FORMATS, download, type ExportFormat } from '../../features/exporters'
import { buildProjectFile } from '../../features/session'
import { useQueryStore } from '../../store/useQueryStore'
import { useResultStore } from '../../store/useResultStore'
import { Dialog } from '../Common/Dialog'
import { Icon } from '../Common/Icon'
import { toast } from '../Common/Toast'

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>('project')
  const data = useResultStore((state) => state.data)
  const name = useQueryStore((state) => state.name)

  const hasResults = (data?.geojson.features.length ?? 0) > 0
  const needsResults = format !== 'project'

  const run = () => {
    try {
      download(format, {
        geojson: data?.geojson ?? { type: 'FeatureCollection', features: [] },
        project: buildProjectFile(),
        name,
      })
      toast.success('File saved')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The file could not be written')
    }
  }

  return (
    <Dialog
      open={open}
      title="Export"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={run}
            disabled={needsResults && !hasResults}
          >
            <Icon name="download" size={13} /> Save file
          </button>
        </>
      }
    >
      <div className="option-list">
        {EXPORT_FORMATS.map((spec) => (
          <button
            key={spec.id}
            type="button"
            className="option"
            aria-pressed={format === spec.id}
            onClick={() => setFormat(spec.id)}
          >
            <span className="grow">
              <span className="option__title">{spec.label}</span>
              <span className="option__desc">{spec.description}</span>
            </span>
            <span className="option__ext">.{spec.extension}</span>
          </button>
        ))}
      </div>

      {needsResults && !hasResults ? (
        <p className="dialog__note">
          That format needs results. Run the query first, or save the project, which works even
          before a run.
        </p>
      ) : null}

      <p className="dialog__note">
        Exported data comes from OpenStreetMap and stays under the ODbL: attribute it, and share
        derived databases under the same terms.
      </p>
    </Dialog>
  )
}
