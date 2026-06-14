// src/renderer/src/components/panels/Meta.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

export default function Meta(): ReactElement {
  const [modes, setModes] = useState<RendererMetaMode[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  async function refresh(): Promise<void> {
    const list = await window.officer.metaList()
    setModes(list)
    setDrafts(Object.fromEntries(list.map((m) => [m.id, m.notes])))
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function save(m: RendererMetaMode): Promise<void> {
    await window.officer.metaUpdateMode(m.id, { notes: drafts[m.id] ?? '' })
    await refresh()
  }

  return (
    <div className="settings meta-panel">
      <div className="sgroup">
        <p className="shelp">
          The AI treats these per-mode sources as current-meta ground truth for
          build/comp advice and cites them. Edit the notes as the meta shifts.
        </p>
      </div>
      {modes.length === 0 ? (
        <div className="panel-empty">No meta modes.</div>
      ) : (
        modes.map((m) => (
          <div className="sgroup meta-mode" key={m.id}>
            <h2>{m.mode}</h2>
            <div className="meta-sources">
              {m.sources.map((s) => (
                <a key={s.url} className="meta-src" href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ))}
            </div>
            <textarea
              className="sinput sk-area"
              placeholder="Current meta notes for this mode (e.g. comp staples, standout builds)"
              value={drafts[m.id] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
            />
            <div className="srow">
              <button className="sbtn" onClick={() => void save(m)}>
                Save notes
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
