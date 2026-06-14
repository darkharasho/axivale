import { useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  RendererMetaIndexStats,
  RendererMetaChunkRow,
  RendererMetaSearchHit
} from '../../../preload/index.d'

const MODES = ['', 'PvE', 'WvW', 'WvW Roaming']

export default function MetaIndexInspector(): ReactElement {
  const [stats, setStats] = useState<RendererMetaIndexStats | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('')
  const [hits, setHits] = useState<RendererMetaSearchHit[] | null>(null)
  const [rows, setRows] = useState<RendererMetaChunkRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const modeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    void window.officer.metaIndexStats().then(setStats)
  }, [])

  // Custom dark dropdown — close on outside click (native <select> popup is light).
  useEffect(() => {
    if (!modeOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [modeOpen])

  async function runSearch(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setRows(null)
    setHits(await window.officer.metaIndexSearch(query, mode || undefined))
    setBusy(false)
  }
  async function loadSample(): Promise<void> {
    setHits(null)
    setRows(await window.officer.metaIndexSample({ mode: mode || undefined, limit: 25 }))
  }

  return (
    <div className="sgroup mi-inspector">
      <h2>
        Index inspector <span className="mi-dev">dev</span>
      </h2>
      {stats && (
        <div className="mi-stats">
          <span>
            <b>{stats.total}</b> chunks
          </span>
          {Object.entries(stats.byMode).map(([m, c]) => (
            <span key={m}>
              {m}: {c}
            </span>
          ))}
          <span className="mi-sub">
            {Object.entries(stats.bySource).map(([s, c]) => `${s} ${c}`).join(' · ') || 'no sources'}
          </span>
        </div>
      )}
      <div className="srow mi-row">
        <input
          className="sinput"
          placeholder="test search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
        />
        <span className="mi-pick-wrap" ref={modeRef}>
          <button
            type="button"
            className={`mi-pick${modeOpen ? ' open' : ''}`}
            onClick={() => setModeOpen((o) => !o)}
          >
            {mode || 'All modes'} <span className="mi-caret">▾</span>
          </button>
          {modeOpen && (
            <div className="mi-menu">
              {MODES.map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`mi-opt${mode === m ? ' sel' : ''}`}
                  onClick={() => {
                    setMode(m)
                    setModeOpen(false)
                  }}
                >
                  {m || 'All modes'}
                </button>
              ))}
            </div>
          )}
        </span>
        <button className="sbtn" disabled={busy} onClick={() => void runSearch()}>
          Search
        </button>
        <button className="sbtn" onClick={() => void loadSample()}>
          Load sample
        </button>
      </div>
      {hits && (
        <div className="mi-results">
          {hits.length === 0 ? (
            <div className="mi-empty">no results</div>
          ) : (
            hits.map((h, i) => (
              <div className="mi-hit" key={i}>
                <div className="mi-hit-head">
                  <span className="mi-score">{h.score.toFixed(3)}</span> <b>{h.title}</b>{' '}
                  <span className="mi-src">{h.source}</span>
                </div>
                <div className="mi-snip">{h.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}
      {rows && (
        <div className="mi-results">
          {rows.length === 0 ? (
            <div className="mi-empty">index empty — run a crawl</div>
          ) : (
            rows.map((r) => (
              <div className="mi-hit" key={r.id}>
                <div className="mi-hit-head">
                  <b>{r.title}</b> <span className="mi-src">{r.source} · {r.mode}</span>
                </div>
                <div className="mi-snip">{r.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
