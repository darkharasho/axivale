import type { ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

/** The Overview item uses this sentinel as its id. */
export const META_OVERVIEW = 'overview'
/** The Wiki reference corpus view uses this sentinel as its id. */
export const WIKI_REF = 'wiki-ref'

/** General-corpus modes live under the General group; everything else is Meta. */
const isGeneral = (m: RendererMetaMode): boolean => m.mode === 'General'

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
  const metaModes = modes.filter((m) => !isGeneral(m))
  const generalModes = modes.filter(isGeneral)
  let n = 0
  const no = (): string => String(++n).padStart(2, '0')

  const modeBtn = (m: RendererMetaMode): ReactElement => (
    <button
      key={m.id}
      className={`snav-item${active === m.id ? ' on' : ''}`}
      onClick={() => onSelect(m.id)}
    >
      <span className="no">{no()}</span>
      {m.mode}
      {busy[m.id] ? (
        <span className="meta-spin" />
      ) : (
        <span className={`dot${m.refreshedAt ? '' : ' off'}`}>●</span>
      )}
    </button>
  )

  return (
    <nav className="rail left snav">
      <div className="snav-h">Sources</div>

      <div className="snav-grp">Meta</div>
      <button
        className={`snav-item${active === META_OVERVIEW ? ' on' : ''}`}
        onClick={() => onSelect(META_OVERVIEW)}
      >
        <span className="no">{no()}</span>
        Overview
      </button>
      {metaModes.map(modeBtn)}

      <div className="snav-grp">Wiki</div>
      <button
        className={`snav-item${active === WIKI_REF ? ' on' : ''}`}
        onClick={() => onSelect(WIKI_REF)}
      >
        <span className="no">{no()}</span>
        Reference corpus
      </button>

      <div className="snav-grp">General</div>
      {generalModes.length > 0 ? (
        generalModes.map(modeBtn)
      ) : (
        <div className="snav-empty">No general sources.</div>
      )}
    </nav>
  )
}
