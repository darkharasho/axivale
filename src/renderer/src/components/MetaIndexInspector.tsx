import { useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  RendererMetaIndexStats,
  RendererMetaChunkRow,
  RendererMetaSearchHit
} from '../../../preload/index.d'

const META_MODES = ['', 'PvE', 'WvW', 'WvW Roaming']
type Corpus = 'meta' | 'wiki'

export default function MetaIndexInspector(): ReactElement {
  const [open, setOpen] = useState(false)
  const [corpus, setCorpus] = useState<Corpus>('meta')
  const [stats, setStats] = useState<RendererMetaIndexStats | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('')
  const [hits, setHits] = useState<RendererMetaSearchHit[] | null>(null)
  const [rows, setRows] = useState<RendererMetaChunkRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const modeRef = useRef<HTMLSpanElement>(null)

  // Per-corpus API trio: meta_chunks vs the wiki reference corpus (wiki_chunks).
  const api =
    corpus === 'wiki'
      ? {
          stats: window.officer.wikiIndexStats,
          sample: window.officer.wikiIndexSample,
          search: window.officer.wikiIndexSearch
        }
      : {
          stats: window.officer.metaIndexStats,
          sample: window.officer.metaIndexSample,
          search: window.officer.metaIndexSearch
        }

  // Meta filters by game mode; wiki filters by page category (derived from stats).
  const modeOptions =
    corpus === 'meta' ? META_MODES : ['', ...Object.keys(stats?.byMode ?? {}).sort()]
  const allLabel = corpus === 'meta' ? 'All modes' : 'All categories'

  useEffect(() => {
    if (!open) return
    void api.stats().then(setStats)
    // re-load when the corpus changes or the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpus, open])

  // Close the modal on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

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
    setExpanded(new Set())
    setHits(await api.search(query, mode || undefined))
    setBusy(false)
  }
  async function loadSample(): Promise<void> {
    setHits(null)
    setExpanded(new Set())
    setRows(await api.sample({ mode: mode || undefined, limit: 25 }))
  }
  // Click a stat pill → filter to that mode/category and load ALL of its chunks.
  async function loadAll(m: string): Promise<void> {
    setMode(m)
    setQuery('')
    setHits(null)
    setExpanded(new Set())
    setRows(await api.sample({ mode: m, limit: 10_000 }))
  }

  function switchCorpus(next: Corpus): void {
    if (next === corpus) return
    setCorpus(next)
    setMode('')
    setHits(null)
    setRows(null)
    setStats(null)
    setExpanded(new Set())
  }

  function toggleRow(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // One result card; collapsed shows the snippet, expanded shows the full chunk text.
  const card = (
    key: string,
    head: ReactElement,
    snippet: string,
    full: string | undefined
  ): ReactElement => {
    const isOpen = expanded.has(key)
    return (
      <div className="mi-hit" key={key}>
        <button type="button" className="mi-hit-head" onClick={() => toggleRow(key)}>
          <span className="mi-caret">{isOpen ? '▾' : '▸'}</span> {head}
        </button>
        <div className={isOpen ? 'mi-full' : 'mi-snip'}>{isOpen ? (full ?? snippet) : snippet}</div>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="sgroup mi-inspector">
        <button className="sbtn" onClick={() => setOpen(true)}>
          Open index inspector <span className="mi-dev">dev</span>
        </button>
      </div>
    )
  }

  return (
    <div className="action-overlay" onClick={() => setOpen(false)}>
      <div className="mi-modal" onClick={(e) => e.stopPropagation()}>
        <div className="action-modal__head">
          <span className="nm">Index inspector</span>
          <span className="mi-dev">dev</span>
          <div className="mi-corpus">
            <button
              type="button"
              className={`mi-tab${corpus === 'meta' ? ' sel' : ''}`}
              onClick={() => switchCorpus('meta')}
            >
              Meta
            </button>
            <button
              type="button"
              className={`mi-tab${corpus === 'wiki' ? ' sel' : ''}`}
              onClick={() => switchCorpus('wiki')}
            >
              Wiki
            </button>
          </div>
          <button className="action-modal__x" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="mi-modal__body">
          {stats && (
            <div className="mi-stats">
              <span>
                <b>{stats.total}</b> chunks
              </span>
              {Object.entries(stats.byMode).map(([m, c]) => (
                <button
                  key={m}
                  type="button"
                  className={`mi-pill${mode === m ? ' sel' : ''}`}
                  onClick={() => void loadAll(m)}
                  title={`Show all ${c} ${m} chunks`}
                >
                  {m} <b>{c}</b>
                </button>
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
                {mode || allLabel} <span className="mi-caret">▾</span>
              </button>
              {modeOpen && (
                <div className="mi-menu">
                  {modeOptions.map((m) => (
                    <button
                      type="button"
                      key={m}
                      className={`mi-opt${mode === m ? ' sel' : ''}`}
                      onClick={() => {
                        setMode(m)
                        setModeOpen(false)
                      }}
                    >
                      {m || allLabel}
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
                hits.map((h, i) =>
                  card(
                    `h-${i}`,
                    <>
                      <span className="mi-score">{h.score.toFixed(3)}</span> <b>{h.title}</b>{' '}
                      <span className="mi-src">{h.source}</span>
                    </>,
                    h.snippet,
                    h.text
                  )
                )
              )}
            </div>
          )}
          {rows && (
            <div className="mi-results">
              {rows.length === 0 ? (
                <div className="mi-empty">
                  {corpus === 'meta' ? 'index empty — run a crawl' : 'index empty — wiki ingest pending'}
                </div>
              ) : (
                rows.map((r) =>
                  card(
                    `r-${r.id}`,
                    <>
                      <b>{r.title}</b>{' '}
                      <span className="mi-src">
                        {r.source} · {r.mode}
                      </span>
                    </>,
                    r.snippet,
                    r.text
                  )
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
