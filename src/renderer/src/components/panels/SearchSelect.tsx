import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'

export interface SearchSelectOption {
  value: string
  label: string
  /** Optional leading avatar image URL. */
  icon?: string
  /** Fallback letter shown in a placeholder circle when there's no icon. */
  initial?: string
  /** Extra text the filter should match (e.g. a username), beyond the label. */
  search?: string
}

/** Most option rows we render at once; the search box reaches the rest. */
const MAX_VISIBLE = 50

function Lead({ o }: { o: SearchSelectOption }): ReactElement | null {
  if (o.icon) return <img className="ssel-ava" src={o.icon} alt="" />
  if (o.initial) return <span className="ssel-ava ssel-ava-ph">{o.initial}</span>
  return null
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
    if (!needle) return options
    return options.filter((o) => `${o.label} ${o.search ?? ''}`.toLowerCase().includes(needle))
  }, [options, q])

  // Cap how many options we actually render: a full guild's worth of avatar rows
  // re-painting on every keystroke is what made typing here stutter. Narrow with
  // the search box to reach anything past the cap.
  const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered])
  const hidden = filtered.length - visible.length

  // Navigable rows: the clear/placeholder option, then the (capped) options.
  const rows = useMemo(() => [{ value: '', label: placeholder }, ...visible], [visible, placeholder])
  useEffect(() => setHi(0), [q])
  // Keep the keyboard-highlighted option in view as it moves.
  useEffect(() => {
    ;(listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [hi])

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
        <span className={`ssel-cur${current ? '' : ' ph'}`}>
          {current && <Lead o={current} />}
          {current ? current.label : placeholder}
        </span>
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
                <Lead o={o} />
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && <div className="ssel-empty">no matches</div>}
            {hidden > 0 && <div className="ssel-empty">{hidden} more — keep typing to narrow</div>}
          </div>
        </div>
      )}
    </div>
  )
}
