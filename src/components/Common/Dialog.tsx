/**
 * Modal dialog.
 *
 * Built on the native `<dialog>` element so focus trapping, the top layer and
 * Escape all come from the platform rather than from a hand-rolled focus
 * manager that will get one edge case wrong.
 */

import { useEffect, useRef, type ReactNode } from 'react'

import { Icon } from './Icon'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  narrow?: boolean
}

export function Dialog({ open, title, onClose, children, footer, narrow }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Escape fires `cancel`; let the parent own the open state either way.
    const handleCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    element.addEventListener('cancel', handleCancel)
    return () => element.removeEventListener('cancel', handleCancel)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className="dialog-native"
      aria-label={title}
      onClick={(event) => {
        // The backdrop is part of the dialog box, so a click that lands on the
        // element itself rather than its contents is a click outside.
        if (event.target === ref.current) onClose()
      }}
    >
      <div className={narrow ? 'dialog dialog--narrow' : 'dialog'}>
        <header className="dialog__head">
          <h2 className="dialog__title">{title}</h2>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog__body">{children}</div>

        {footer ? <footer className="dialog__foot">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
