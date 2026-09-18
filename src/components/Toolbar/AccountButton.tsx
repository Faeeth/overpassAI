/**
 * Optional OpenStreetMap sign-in.
 *
 * Nothing in the app needs an account, so this button disappears entirely when
 * no client id is configured rather than sitting there inviting a click that
 * cannot work. Signed in, it adds one genuinely useful thing: queries saved to
 * your OSM preferences, which follow you to any machine without this app ever
 * running a server.
 */

import { useCallback, useEffect, useState } from 'react'

import * as auth from '../../services/auth'
import { useQueryStore } from '../../store/useQueryStore'
import { Icon } from '../Common/Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../Common/Menu'
import { toast } from '../Common/Toast'

export function AccountButton() {
  const [user, setUser] = useState<auth.OsmUser | null>(null)
  const [busy, setBusy] = useState(false)
  const [remote, setRemote] = useState<Record<string, string>>({})

  const source = useQueryStore((state) => state.source)
  const name = useQueryStore((state) => state.name)
  const load = useQueryStore((state) => state.load)

  const refresh = useCallback(async () => {
    if (!auth.isSignedIn()) {
      setUser(null)
      setRemote({})
      return
    }
    try {
      setUser(await auth.fetchUser())
      setRemote(await auth.listAccountQueries())
    } catch {
      // An expired token looks exactly like being signed out.
      setUser(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!auth.isConfigured()) return null

  const signIn = async () => {
    setBusy(true)
    try {
      await auth.signIn()
      await refresh()
      toast.success('Signed in to OpenStreetMap')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        onClick={signIn}
        disabled={busy}
        aria-label="Sign in to OpenStreetMap"
        title="Sign in to OpenStreetMap"
      >
        {busy ? <span className="btn__spinner" /> : <Icon name="user" />}
      </button>
    )
  }

  return (
    <Menu
      triggerClassName="btn btn--ghost btn--icon"
      triggerLabel={`Signed in as ${user.displayName}`}
      trigger={<Icon name="user" />}
      align="end"
    >
      {(close) => (
        <>
          <MenuLabel>Signed in as {user.displayName}</MenuLabel>

          <MenuItem
            onClick={() => {
              void auth
                .saveQueryToAccount(name, source)
                .then(() => {
                  toast.success('Saved to your OSM account')
                  return refresh()
                })
                .catch((err: unknown) =>
                  toast.error(err instanceof Error ? err.message : 'Could not save'),
                )
              close()
            }}
          >
            Save this query to my account
          </MenuItem>

          {Object.keys(remote).length ? (
            <>
              <MenuSeparator />
              <MenuLabel>On your account</MenuLabel>
              {Object.entries(remote).map(([slug, stored]) => (
                <MenuItem
                  key={slug}
                  onClick={() => {
                    load(stored, { name: slug })
                    close()
                  }}
                >
                  {slug}
                </MenuItem>
              ))}
            </>
          ) : null}

          <MenuSeparator />
          <MenuItem
            onClick={() => {
              auth.signOut()
              setUser(null)
              setRemote({})
              close()
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
