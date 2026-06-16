import type { ReactElement } from 'react'

export type OperationsSection = 'builds' | 'comps' | 'bureau'

const ITEMS: Array<{ key: OperationsSection; no: string; label: string }> = [
  { key: 'builds', no: '01', label: 'Builds' },
  { key: 'comps', no: '02', label: 'Compositions' },
  { key: 'bureau', no: '03', label: 'Bureau' }
]

/** Left-rail sub-nav for the Operations tab (Builds / Compositions / Bureau),
 *  mirroring SettingsNav/MetaNav. */
export default function OperationsNav({
  active,
  onSelect
}: {
  active: OperationsSection
  onSelect: (s: OperationsSection) => void
}): ReactElement {
  return (
    <nav className="rail left snav">
      <div className="snav-h">Operations</div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`snav-item${active === it.key ? ' on' : ''}`}
          onClick={() => onSelect(it.key)}
        >
          <span className="no">{it.no}</span>
          {it.label}
        </button>
      ))}
    </nav>
  )
}
