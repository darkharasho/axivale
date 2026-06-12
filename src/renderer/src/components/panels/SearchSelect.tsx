import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

export interface SearchSelectOption {
  value: string
  label: string
}

/**
 * Custom dropdown with a built-in search box — for option lists too long for a
 * native select (e.g. dozens of guilds). Gazette-styled; keyboard-friendly.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = 'All',
  searchPlaceholder = 'Filter…'
}: {
  value: string
  options: SearchSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQ('')
      return
    }
    searchRef.current?.focus()
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options
  }, [options, q])

  const current = options.find((o) => o.value === value)

  return (
    <div className="ssel" ref={ref}>
      <button type="button" className="ssel-btn" onClick={() => setOpen((o) => !o)}>
        <span className={current ? '' : 'ph'}>{current ? current.label : placeholder}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="ssel-menu">
          <input
            ref={searchRef}
            className="ssel-search"
            value={q}
            placeholder={searchPlaceholder}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="ssel-list">
            <button
              type="button"
              className={`ssel-opt${value === '' ? ' sel' : ''}`}
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              {placeholder}
            </button>
            {filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                className={`ssel-opt${value === o.value ? ' sel' : ''}`}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && <div className="ssel-empty">no matches</div>}
          </div>
        </div>
      )}
    </div>
  )
}
