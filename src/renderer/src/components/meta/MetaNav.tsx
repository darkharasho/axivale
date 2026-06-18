import { Circle } from 'lucide-react'
import type { ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

/** The Overview item uses this sentinel as its id. */
export const META_OVERVIEW = 'overview'
/** The Wiki reference corpus view uses this sentinel as its id. */
export const WIKI_REF = 'wiki-ref'
/** The Memory view (AxiVale's durable self-authored memory) uses this sentinel id. */
export const MEMORY_VIEW = 'memory-view'

/** The Guides corpus mode lives under the Guides group; everything else is Meta. */
const isGuides = (m: RendererMetaMode): boolean => m.mode === 'Guides'

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
  const metaModes = modes.filter((m) => !isGuides(m))
  const guideModes = modes.filter(isGuides)
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
        <span className={`dot${m.refreshedAt ? '' : ' off'}`}>
          <Circle size={8} fill="currentColor" strokeWidth={0} />
        </span>
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

      <div className="snav-grp">Guides</div>
      {guideModes.length > 0 ? (
        guideModes.map(modeBtn)
      ) : (
        <div className="snav-empty">No guide sources.</div>
      )}

      <div className="snav-grp">Memory</div>
      <button
        className={`snav-item${active === MEMORY_VIEW ? ' on' : ''}`}
        onClick={() => onSelect(MEMORY_VIEW)}
      >
        <span className="no">{no()}</span>
        Memory
      </button>
    </nav>
  )
}
