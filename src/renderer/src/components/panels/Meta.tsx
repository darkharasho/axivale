// src/renderer/src/components/panels/Meta.tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RendererMetaMode, RendererMetaProgress } from '../../../../preload/index.d'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return 'never'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `updated ${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `updated ${hrs}h ago`
  return 'updated just now'
}

/** Distilled summary rendered as markdown, capped behind a "see more" toggle so a
 *  long write-up doesn't dominate the panel until the reader asks for it. */
function ModeSummary({ notes }: { notes: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4)
  }, [notes])

  if (!notes) {
    return <p className="meta-summary meta-summary-empty">No summary yet — awaiting first refresh.</p>
  }
  return (
    <div className="meta-summary-wrap">
      <div ref={ref} className={`meta-summary prose ${expanded ? 'expanded' : 'collapsed'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
      </div>
      {(overflows || expanded) && (
        <button className="meta-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}

export default function Meta(): ReactElement {
  const [modes, setModes] = useState<RendererMetaMode[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [fetching, setFetching] = useState<Record<string, string | null>>({})

  function refresh(): void {
    void window.officer.metaList().then(setModes)
  }
  useEffect(() => {
    refresh()
    return window.officer.onMetaProgress((e: RendererMetaProgress) => {
      if (e.type === 'mode-start') setBusy((b) => ({ ...b, [e.modeId]: true }))
      else if (e.type === 'source-start') setFetching((f) => ({ ...f, [e.modeId]: e.url }))
      else if (e.type === 'mode-done') {
        setBusy((b) => ({ ...b, [e.modeId]: false }))
        setFetching((f) => ({ ...f, [e.modeId]: null }))
        refresh()
      }
    })
  }, [])

  return (
    <div className="settings meta-panel">
      <div className="sgroup">
        <p className="shelp">
          AxiVale keeps its own read of the current meta per game mode, refreshed
          automatically from these sources in the background. It uses this to bias
          build and comp advice. Nothing to edit — this is what it currently knows.
        </p>
        {import.meta.env.DEV && (
          <div className="srow">
            <button className="sbtn" onClick={() => void window.officer.metaForceRefresh()}>
              Force re-crawl (dev)
            </button>
          </div>
        )}
      </div>
      {modes.length === 0 ? (
        <div className="panel-empty">No meta modes.</div>
      ) : (
        modes.map((m) => (
          <div className="sgroup meta-mode" key={m.id}>
            <h2>
              {m.mode}{' '}
              {busy[m.id] ? (
                <span className="meta-refreshing">
                  <span className="meta-spin" /> refreshing…
                </span>
              ) : (
                <span className="meta-fresh">{ago(m.refreshedAt)}</span>
              )}
            </h2>
            <ModeSummary notes={m.notes} />
            <div className="meta-sources">
              {m.sources.map((s) => {
                const isFetching = fetching[m.id] === s.url
                return (
                  <span className="meta-srcrow" key={s.url}>
                    <a className="meta-src" href={s.url} target="_blank" rel="noreferrer">
                      {s.label}
                    </a>
                    <span
                      className={`meta-chip ${isFetching ? 'fetching' : s.status}`}
                      title={s.error ?? undefined}
                    >
                      {isFetching ? 'fetching…' : s.status}
                    </span>
                  </span>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
