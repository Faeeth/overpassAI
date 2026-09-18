/**
 * The query prologue, as a block.
 *
 * `[out:json][timeout:25]` is the first thing in every Overpass query and the
 * first thing people copy without understanding, so it gets a block of its own
 * rather than hiding in a settings dialog: the timeout in particular is the
 * fix for the most common failure, and it should be one click from the error.
 */

import { useState } from 'react'

import type { OutputFormat } from '../../core/ast'
import { useQueryStore } from '../../store/useQueryStore'
import { Icon } from '../Common/Icon'

export function SettingsBlock() {
  const settings = useQueryStore((state) => state.ast.settings)
  const updateAst = useQueryStore((state) => state.updateAst)
  const [open, setOpen] = useState(false)

  const summary = [
    settings.format,
    settings.timeout ? `${settings.timeout}s` : null,
    settings.maxsize ? `${Math.round(settings.maxsize / 1_000_000)}MB` : null,
  ]
    .filter(Boolean)
    .join('  ')

  return (
    <div className="block block--raw">
      <div className="block__head">
        <button
          type="button"
          className="block__grip"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Hide query settings' : 'Show query settings'}
          aria-expanded={open}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        </button>
        <span className="block__kind">Settings</span>
        <span className="block__summary">{summary}</span>
      </div>

      {open ? (
        <div className="block__body">
          <div className="field__row">
            <label className="field__label" htmlFor="settings-format">
              Format
            </label>
            <select
              id="settings-format"
              className="select"
              value={settings.format}
              onChange={(event) =>
                updateAst((draft) => {
                  draft.settings.format = event.target.value as OutputFormat
                })
              }
            >
              <option value="json">JSON, mapped and tabled</option>
              <option value="csv">CSV, table only</option>
              <option value="xml">XML, raw only</option>
            </select>
          </div>

          <div className="field__row">
            <label className="field__label" htmlFor="settings-timeout">
              Give up after
            </label>
            <input
              id="settings-timeout"
              className="input input--mono"
              style={{ width: '6rem' }}
              type="number"
              min={1}
              max={900}
              value={settings.timeout ?? 25}
              onChange={(event) =>
                updateAst((draft) => {
                  draft.settings.timeout = Number(event.target.value) || undefined
                })
              }
            />
            <span className="muted">seconds</span>
          </div>

          <div className="field__row">
            <label className="field__label" htmlFor="settings-maxsize">
              Memory cap
            </label>
            <input
              id="settings-maxsize"
              className="input input--mono"
              style={{ width: '6rem' }}
              type="number"
              min={0}
              step={64}
              value={settings.maxsize ? Math.round(settings.maxsize / 1_000_000) : ''}
              placeholder="server default"
              onChange={(event) =>
                updateAst((draft) => {
                  const value = Number(event.target.value)
                  draft.settings.maxsize = value > 0 ? value * 1_000_000 : undefined
                })
              }
            />
            <span className="muted">MB</span>
          </div>

          {settings.format !== 'json' ? (
            <p className="block__note">
              Only JSON can be drawn on the map. Other formats appear in the response tab.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
