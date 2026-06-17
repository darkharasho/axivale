import type { ReactElement } from 'react'

export type SettingsSection =
  | 'intelligence'
  | 'gw2'
  | 'axitools'
  | 'axiforge'
  | 'repos'
  | 'dispatches'
  | 'notifications'
  | 'about'

/** Which sections show a "configured" status dot. Sections not listed show no dot. */
export interface SettingsNavStatus {
  intelligence?: boolean
  gw2?: boolean
  axitools?: boolean
  axiforge?: boolean
  repos?: boolean
}

const ITEMS: Array<{ key: SettingsSection; no: string; label: string; hasDot: boolean }> = [
  { key: 'intelligence', no: '01', label: 'Intelligence', hasDot: true },
  { key: 'gw2', no: '02', label: 'GW2 Keys', hasDot: true },
  { key: 'axitools', no: '03', label: 'AxiTools', hasDot: true },
  { key: 'axiforge', no: '04', label: 'AxiForge', hasDot: true },
  { key: 'repos', no: '05', label: 'Report Repos', hasDot: true },
  { key: 'dispatches', no: '06', label: 'Dispatches', hasDot: false },
  { key: 'notifications', no: '07', label: 'Notifications', hasDot: false },
  { key: 'about', no: '08', label: 'About', hasDot: false }
]

export default function SettingsNav({
  active,
  onSelect,
  status
}: {
  active: SettingsSection
  onSelect: (s: SettingsSection) => void
  status: SettingsNavStatus
}): ReactElement {
  return (
    <nav className="rail left snav">
      <div className="snav-h">Settings</div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`snav-item${active === it.key ? ' on' : ''}`}
          onClick={() => onSelect(it.key)}
        >
          <span className="no">{it.no}</span>
          {it.label}
          {it.hasDot && (
            <span className={`dot${status[it.key as keyof SettingsNavStatus] ? '' : ' off'}`}>
              ●
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
