/**
 * Transient confirmations and failures.
 *
 * Toasts are for things that happened away from where the user is looking:
 * a file written, a link copied, a save that failed. Anything they need to act
 * on stays on screen in the results panel instead.
 */

import { useEffect } from 'react'
import { create } from 'zustand'

import { Icon, type IconName } from './Icon'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: string) => void
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) =>
    set((state) => ({
      // Repeating the same message should not stack up copies of it.
      toasts: [
        ...state.toasts.filter((t) => t.message !== message),
        { id: crypto.randomUUID(), kind, message },
      ].slice(-4),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}

const ICONS: Record<ToastKind, IconName> = {
  success: 'check',
  error: 'alert',
  info: 'info',
}

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  )
}

function ToastItem({ toast: item }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss)

  useEffect(() => {
    // Errors stay longer, because they are usually worth reading twice.
    const delay = item.kind === 'error' ? 8000 : 4000
    const timer = window.setTimeout(() => dismiss(item.id), delay)
    return () => window.clearTimeout(timer)
  }, [item.id, item.kind, dismiss])

  return (
    <div className={`toast toast--${item.kind}`}>
      <Icon name={ICONS[item.kind]} />
      <span className="grow">{item.message}</span>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--small"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}
