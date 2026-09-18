/**
 * Popover menu anchored to a trigger button.
 *
 * Positioned with fixed coordinates taken from the trigger, so it escapes the
 * scrolling panel it was opened from and flips up or left when it would run
 * past the viewport edge.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

interface MenuProps {
  /** Rendered inside the trigger button. */
  trigger: ReactNode
  triggerClassName?: string
  triggerLabel: string
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
}

export function Menu({
  trigger,
  triggerClassName = 'btn btn--ghost btn--icon',
  triggerLabel,
  children,
  align = 'start',
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const anchor = triggerRef.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!anchor) return

    const width = menu?.width ?? 200
    const height = menu?.height ?? 160
    const gap = 4

    let left = align === 'end' ? anchor.right - width : anchor.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))

    const below = anchor.bottom + gap
    const top = below + height > window.innerHeight - 8 ? anchor.top - height - gap : below

    setPosition({ top: Math.max(8, top), left })
  }, [open, align])

  useEffect(() => {
    if (!open) return

    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }

    // The menu is positioned once, so anything that moves the trigger closes it
    // rather than leaving the popover stranded.
    const handleDisplace = () => setOpen(false)

    document.addEventListener('pointerdown', handlePointer, true)
    document.addEventListener('keydown', handleKey, true)
    window.addEventListener('resize', handleDisplace)
    window.addEventListener('scroll', handleDisplace, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointer, true)
      document.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('resize', handleDisplace)
      window.removeEventListener('scroll', handleDisplace, true)
    }
  }, [open, close])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="menu"
              role="menu"
              style={{ position: 'fixed', top: position.top, left: position.left }}
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

interface MenuItemProps {
  icon?: ReactNode
  hint?: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

export function MenuItem({ icon, hint, disabled, onClick, children }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="grow">{children}</span>
      {hint ? <span className="menu__hint">{hint}</span> : null}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu__label">{children}</div>
}

export function MenuSeparator() {
  return <div className="menu__sep" role="separator" />
}
