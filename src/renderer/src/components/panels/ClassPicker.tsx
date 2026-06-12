import { useEffect, useRef, useState, type ReactElement } from 'react'
import { PROFESSIONS } from './classes'
import { ClassIcon } from './shared'

/**
 * Grouped class/spec dropdown: each profession header followed by its elite
 * specs, plus a "(core)" option for the bare profession. Stores the chosen
 * spec or profession name as the value; icons shown per option.
 */
export function ClassPicker({
  value,
  onChange,
  placeholder = 'Choose a class…'
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="clspick" ref={ref}>
      <button type="button" className="clspick-btn" onClick={() => setOpen((o) => !o)}>
        {value ? (
          <>
            <ClassIcon name={value} size={16} />
            <span>{value}</span>
          </>
        ) : (
          <span className="ph">{placeholder}</span>
        )}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="clspick-menu">
          {Object.entries(PROFESSIONS).map(([prof, specs]) => (
            <div className="clspick-group" key={prof}>
              <button
                type="button"
                className={`clspick-opt prof${value === prof ? ' sel' : ''}`}
                onClick={() => {
                  onChange(prof)
                  setOpen(false)
                }}
              >
                <ClassIcon name={prof} size={16} />
                <span>{prof}</span>
                <span className="core">core</span>
              </button>
              {specs.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`clspick-opt${value === s ? ' sel' : ''}`}
                  onClick={() => {
                    onChange(s)
                    setOpen(false)
                  }}
                >
                  <ClassIcon name={s} size={16} />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
