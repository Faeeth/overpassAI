/**
 * First-run panel.
 *
 * An empty screen is an invitation to act, so this offers two concrete
 * starting points rather than explaining what Overpass is. It disappears for
 * good once dismissed.
 */

import { runCurrentQuery } from '../../features/session'
import { useQueryStore } from '../../store/useQueryStore'
import { useUiStore } from '../../store/useUiStore'
import { Icon } from '../Common/Icon'

const EXAMPLE = `[out:json][timeout:25];
{{geocodeArea:Bordeaux}}->.searchArea;
nwr["amenity"="drinking_water"](area.searchArea);
out geom;`

export function Welcome() {
  const dismiss = useUiStore((state) => state.dismissOnboarding)
  const setMode = useUiStore((state) => state.setEditorMode)
  const load = useQueryStore((state) => state.load)

  return (
    <section className="welcome">
      <h2>Query OpenStreetMap without learning the syntax</h2>
      <p>
        Stack blocks to say where to look and what to find, and the Overpass query writes itself.
        Switch to the text view any time: both sides stay in step, so you can start with blocks
        and finish by hand.
      </p>

      <div className="welcome__actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            load(EXAMPLE, { name: 'Drinking water in Bordeaux' })
            runCurrentQuery()
            dismiss()
          }}
        >
          <Icon name="run" size={11} /> Try an example
        </button>

        <button
          type="button"
          className="btn"
          onClick={() => {
            setMode('text')
            dismiss()
          }}
        >
          I already know Overpass QL
        </button>

        <button type="button" className="btn btn--ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </section>
  )
}
