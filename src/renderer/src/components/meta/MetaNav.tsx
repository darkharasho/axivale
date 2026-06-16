import type { ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

/** The Overview item uses this sentinel as its id. */
export const META_OVERVIEW = 'overview'

export default function MetaNav({
  modes,
  busy,
  active,
  onSelect
}: {
  modes: RendererMetaMode[]
  busy: Record<string, boolean>
  active: string
  onSelect: (id: string) => void
}): ReactElement {
  return (
    <nav className="rail left snav">
      <div className="snav-h">Sources</div>
      <button
        className={`snav-item${active === META_OVERVIEW ? ' on' : ''}`}
        onClick={() => onSelect(META_OVERVIEW)}
      >
        <span className="no">00</span>
        Overview
      </button>
      {modes.map((m, i) => (
        <button
          key={m.id}
          className={`snav-item${active === m.id ? ' on' : ''}`}
          onClick={() => onSelect(m.id)}
        >
          <span className="no">{String(i + 1).padStart(2, '0')}</span>
          {m.mode}
          {busy[m.id] ? (
            <span className="meta-spin" />
          ) : (
            <span className={`dot${m.refreshedAt ? '' : ' off'}`}>●</span>
          )}
        </button>
      ))}
    </nav>
  )
}
