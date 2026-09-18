/**
 * Details of the selected element.
 *
 * Shows the tags as they are in the database, not a prettified summary: this
 * is the panel a mapper uses to decide whether the data is wrong, so it has to
 * be faithful, and it links straight out to the tools for fixing it.
 */

import { useMemo } from 'react'
import type { Feature } from 'geojson'

import { representativePoint } from '../../features/exporters/csv'
import { useResultStore } from '../../store/useResultStore'
import { useUiStore } from '../../store/useUiStore'
import { Icon } from '../Common/Icon'
import { toast } from '../Common/Toast'

export function Inspector() {
  const selectedId = useUiStore((state) => state.selectedFeatureId)
  const selectFeature = useUiStore((state) => state.selectFeature)
  const data = useResultStore((state) => state.data)

  const feature = useMemo(() => {
    if (!selectedId || !data) return null
    return (
      data.geojson.features.find((item) => item.properties?.['@id'] === selectedId) ?? null
    )
  }, [selectedId, data])

  if (!feature) return null

  const props = feature.properties ?? {}
  const osmId = String(props['@id'] ?? '')
  const tags = Object.entries(props).filter(([key]) => !key.startsWith('@'))
  const meta = props['@meta'] as
    | { version?: number; timestamp?: string; user?: string }
    | undefined

  const [lon, lat] = representativePoint(feature)
  const osmUrl = `https://www.openstreetmap.org/${osmId}`

  return (
    <aside className="inspector" aria-label="Element details">
      <header className="inspector__head">
        <div className="inspector__title">
          {titleOf(feature)}
          <span className="inspector__id">{osmId}</span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--small"
          onClick={() => selectFeature(null)}
          aria-label="Close details"
        >
          <Icon name="close" size={13} />
        </button>
      </header>

      <div className="inspector__tags">
        {tags.length ? (
          tags.map(([key, value]) => (
            <div className="tag-row" key={key}>
              <span className="tag-row__key">{key}</span>
              <span className="tag-row__value">{String(value)}</span>
            </div>
          ))
        ) : (
          <p className="faint" style={{ fontSize: 'var(--text-sm)' }}>
            This element carries no tags. It is here because something else references it.
          </p>
        )}

        {meta ? (
          <div className="tag-row" style={{ marginTop: 'var(--space-2)' }}>
            <span className="tag-row__key">last edited</span>
            <span className="tag-row__value">
              v{meta.version} by {meta.user ?? 'unknown'}
              {meta.timestamp ? ` on ${meta.timestamp.slice(0, 10)}` : ''}
            </span>
          </div>
        ) : null}
      </div>

      <footer className="inspector__foot">
        <a className="btn btn--small" href={osmUrl} target="_blank" rel="noreferrer">
          <Icon name="external" size={12} /> OpenStreetMap
        </a>

        {lat !== null && lon !== null ? (
          <>
            <a
              className="btn btn--small"
              href={`https://www.openstreetmap.org/edit?editor=id&${osmId.replace('/', '=')}#map=19/${lat}/${lon}`}
              target="_blank"
              rel="noreferrer"
            >
              Edit in iD
            </a>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                navigator.clipboard
                  .writeText(`${lat}, ${lon}`)
                  .then(() => toast.success('Coordinates copied'))
                  .catch(() => toast.error('The browser would not let the page copy that'))
              }}
            >
              <Icon name="copy" size={12} /> {lat.toFixed(5)}, {lon.toFixed(5)}
            </button>
          </>
        ) : null}
      </footer>
    </aside>
  )
}

/** The most human name available, falling back to the tag that identifies it. */
function titleOf(feature: Feature): string {
  const props = feature.properties ?? {}

  for (const key of ['name', 'ref', 'operator', 'brand', 'addr:housename']) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return value
  }

  for (const key of ['amenity', 'shop', 'highway', 'building', 'natural', 'landuse', 'leisure']) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return `${key}=${value}`
  }

  return 'Unnamed element'
}
