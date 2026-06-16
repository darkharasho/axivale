import type { ReactElement, ReactNode } from 'react'

export interface KeyLabel {
  label: string
  active: boolean
}

/** Section pane wrapper: kicker + title + one-line description, then children. */
export function Pane({
  no,
  title,
  sub,
  children
}: {
  no: string
  title: string
  sub: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="spane">
      <div className="spane-kick">Section {no}</div>
      <h2 className="spane-h">{title}</h2>
      <p className="spane-sub">{sub}</p>
      {children}
    </div>
  )
}

/** Grouping card with a header bar (title + optional status) and a padded body. */
export function Card({
  title,
  status,
  children
}: {
  title: string
  status?: { msg: string; tone?: 'ok' | 'err' | 'dim' }
  children: ReactNode
}): ReactElement {
  return (
    <div className="spcard">
      <div className="spcard-h">
        <span className="spcard-t">{title}</span>
        {status && (
          <span className={`spcard-s ${status.tone ?? 'dim'}`}>
            <span className="led" />
            {status.msg}
          </span>
        )}
      </div>
      <div className="spcard-b">{children}</div>
    </div>
  )
}

/** Labelled input field with optional help text below. */
export function Field({
  label,
  help,
  children
}: {
  label?: string
  help?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <div className="sfield">
      {label && <label className="slabel">{label}</label>}
      {children}
      {help && <p className="shelp">{help}</p>}
    </div>
  )
}

/** Connected segmented toggle. */
export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}): ReactElement {
  return (
    <div className="sseg">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Keyring: bordered rows, click to activate, ✕ to remove. */
export function Keyring({
  keys,
  onActivate,
  onRemove
}: {
  keys: KeyLabel[]
  onActivate: (label: string) => void
  onRemove: (label: string) => void
}): ReactElement | null {
  if (keys.length === 0) return null
  return (
    <div className="skeys">
      {keys.map((k) => (
        <button
          key={k.label}
          className={`skey${k.active ? ' on' : ''}`}
          onClick={() => onActivate(k.label)}
        >
          <span className="rad" />
          {k.label}
          {k.active && <span className="badge">active</span>}
          <span
            className="kx"
            title={`Remove "${k.label}"`}
            onClick={(e) => {
              e.stopPropagation()
              onRemove(k.label)
            }}
          >
            ✕
          </span>
        </button>
      ))}
    </div>
  )
}
