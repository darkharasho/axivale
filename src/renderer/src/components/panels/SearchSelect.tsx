import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'

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
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setQ('')
      return
    }
    setHi(0)
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

  // Navigable rows: the clear/placeholder option, then the filtered options.
  const rows = useMemo(() => [{ value: '', label: placeholder }, ...filtered], [filtered, placeholder])
  useEffect(() => setHi(0), [q])

  function choose(v: string): void {
    onChange(v)
    setOpen(false)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[hi]) choose(rows[hi].value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

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
            onKeyDown={onKey}
          />
          <div className="ssel-list" ref={listRef}>
            {rows.map((o, i) => (
              <button
                type="button"
                key={o.value || '__clear__'}
                className={`ssel-opt${value === o.value ? ' sel' : ''}${hi === i ? ' hi' : ''}`}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(o.value)}
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
