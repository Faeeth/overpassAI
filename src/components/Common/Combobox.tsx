/**
 * Text input with an asynchronous suggestion list.
 *
 * Shared by the tag editor (taginfo) and the place picker (Nominatim), which
 * differ only in where their options come from and how a row is drawn. Typing
 * is never blocked on the network: the field owns its value, and suggestions
 * arrive when they arrive.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

interface ComboboxProps<T> {
  value: string
  onChange: (value: string) => void
  /** Called when an option is picked, in addition to `onChange`. */
  onPick?: (option: T) => void
  /** Resolves the options for a query. Rejections are treated as "no results". */
  load: (query: string) => Promise<T[]>
  optionValue: (option: T) => string
  renderOption: (option: T) => ReactNode
  ariaLabel: string
  placeholder?: string
  className?: string
  /** Footnote under the list, e.g. where the numbers come from. */
  hint?: string
  /** Show suggestions as soon as the field is focused, before typing. */
  openOnFocus?: boolean
  disabled?: boolean
  invalid?: boolean
  debounceMs?: number
}

export function Combobox<T>({
  value,
  onChange,
  onPick,
  load,
  optionValue,
  renderOption,
  ariaLabel,
  placeholder,
  className = 'input input--mono input--grow',
  hint,
  openOnFocus = true,
  disabled,
  invalid,
  debounceMs = 180,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState(value)

  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  /** Guards against a slow response overwriting a newer one. */
  const requestId = useRef(0)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (!open) return

    const id = ++requestId.current

    const timer = window.setTimeout(() => {
      // Set inside the debounce rather than beside it: during the wait no
      // request is in flight, so saying "looking up suggestions" would be
      // both an extra render and untrue.
      setLoading(true)
      load(query)
        .then((result) => {
          if (requestId.current !== id) return
          setOptions(result)
          setActive(result.length ? 0 : -1)
        })
        .catch(() => {
          if (requestId.current !== id) return
          setOptions([])
          setActive(-1)
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false)
        })
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [query, open, load, debounceMs])

  useEffect(() => {
    if (!open) return

    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer, true)
    return () => document.removeEventListener('pointerdown', handlePointer, true)
  }, [open])

  const pick = useCallback(
    (option: T) => {
      const next = optionValue(option)
      setQuery(next)
      onChange(next)
      onPick?.(option)
      setOpen(false)
    },
    [onChange, onPick, optionValue],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (!options.length) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => (current + delta + options.length) % options.length)
      return
    }

    if (event.key === 'Enter' && open && active >= 0 && options[active]) {
      event.preventDefault()
      pick(options[active])
      return
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="combo" ref={rootRef}>
      <input
        className={invalid ? `${className} input--invalid` : className}
        style={{ width: '100%' }}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value)
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          if (openOnFocus) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />

      {open ? (
        <div className="combo__menu" id={listId} role="listbox">
          {options.map((option, index) => (
            <button
              key={`${optionValue(option)}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className="combo__option"
              // Pointer down beats the input's blur, so the click still lands.
              onPointerDown={(event) => {
                event.preventDefault()
                pick(option)
              }}
              onMouseEnter={() => setActive(index)}
            >
              {renderOption(option)}
            </button>
          ))}

          {!options.length && loading ? (
            <div className="combo__loading">Looking up suggestions...</div>
          ) : null}

          {!options.length && !loading ? (
            <div className="combo__empty">No matches. Type your own value.</div>
          ) : null}

          {hint && options.length ? <div className="combo__hint">{hint}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
