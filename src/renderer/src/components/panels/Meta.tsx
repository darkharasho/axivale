// src/renderer/src/components/panels/Meta.tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RendererMetaMode, RendererMetaProgress } from '../../../../preload/index.d'
import MetaIndexInspector from '../MetaIndexInspector'

/** The comp playbook itself, rendered inside a popup. Squad-comp concept, so it is
 *  only ever launched for the squad WvW mode (see PlaybookLauncher). */
function PlaybookModal({ mode, onChange, onClose }: { mode: RendererMetaMode; onChange: () => void; onClose: () => void }): ReactElement {
  const pb = mode.playbook
  const [principles, setPrinciples] = useState(pb.principles)
  const [overrides, setOverrides] = useState(pb.overrides)
  const [deriving, setDeriving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const synced = useRef({ principles: pb.principles, overrides: pb.overrides })
  useEffect(() => {
    // Adopt only genuine external changes (e.g. a derive/refresh) — don't re-echo our
    // own saves over in-progress edits in the other field.
    if (pb.principles !== synced.current.principles) {
      setPrinciples(pb.principles)
      synced.current.principles = pb.principles
    }
    if (pb.overrides !== synced.current.overrides) {
      setOverrides(pb.overrides)
      synced.current.overrides = pb.overrides
    }
  }, [pb.principles, pb.overrides])

  // Close on Escape, like the app's other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = (patch: { principles?: string; overrides?: string; blessed?: boolean }): void => {
    void window.officer.metaUpdatePlaybook(mode.id, patch).then(onChange)
  }
  const derive = (): void => {
    setDeriving(true)
    setMsg(null)
    void window.officer.metaDeriveComp(mode.id).then((r) => {
      setDeriving(false)
      setMsg(r.ok ? 'Derived from AxiBridge reports.' : r.error ?? 'Failed.')
      onChange()
    })
  }

  const d = pb.derived
  return (
    <div className="action-overlay meta-pb-overlay" onClick={onClose}>
      <div className="action-modal meta-pb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="action-modal__head">
          <span className="nm">Comp Playbook — {mode.mode}</span>
          <button className="action-modal__x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="action-modal__body meta-playbook">
          <div className="srow meta-pb-controls">
            <label className="meta-bless">
              <input type="checkbox" checked={pb.blessed} onChange={(e) => save({ blessed: e.target.checked })} />
              blessed (used by AI)
            </label>
            <button className="sbtn meta-pb-derive" disabled={deriving} onClick={derive}>
              {deriving ? 'Deriving…' : 'Refresh from AxiBridge'}
            </button>
          </div>
          {msg && <p className="shelp meta-pb-msg">{msg}</p>}
          {d ? (
            <div className="meta-derived">
              <p className="meta-derived-meta">
                <strong>{d.sampleSize} reports</strong> · {d.window.fromISO}–{d.window.toISO} · {d.sourceRepos.join(', ')}
                {d.lowConfidence ? ' · low confidence' : ''} · squad ~{d.avgSquadSize}, {d.supportPct}% support
              </p>
              <p className="meta-derived-sub">
                Subgroup: <strong>{d.subgroup.core.join(' + ')}</strong>
                {d.subgroup.flex.length ? ` + flex (${d.subgroup.flex.join(' / ')})` : ''}
              </p>
              <div className="meta-derived-profs">
                {d.professions.slice(0, 12).map((p, i) => (
                  <span className="meta-prof" key={`${p.name}-${i}`}>
                    {p.name}: {p.avgPerSquad}/squad ({p.presencePct}%, {p.runAs})
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="shelp meta-derived-empty">No derived baseline yet — click "Refresh from AxiBridge".</p>
          )}
          {/* saves on blur; an unmount before blur drops the in-flight edit — acceptable for notes fields */}
          <label className="meta-edit-label" htmlFor={`pb-principles-${mode.id}`}>Principles</label>
          <textarea id={`pb-principles-${mode.id}`} className="meta-edit" rows={6} value={principles} onChange={(e) => setPrinciples(e.target.value)} onBlur={() => save({ principles })} />
          <label className="meta-edit-label" htmlFor={`pb-overrides-${mode.id}`}>Guild overrides</label>
          <textarea id={`pb-overrides-${mode.id}`} className="meta-edit" rows={3} value={overrides} onChange={(e) => setOverrides(e.target.value)} onBlur={() => save({ overrides })} />
        </div>
      </div>
    </div>
  )
}

/** WvW-only launcher: a button (with a derived-state hint) below the sources that
 *  opens the comp playbook in a popup. */
function PlaybookLauncher({ mode, onChange }: { mode: RendererMetaMode; onChange: () => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const d = mode.playbook.derived
  const hint = d ? `${d.sampleSize} reports · ${d.sourceRepos.join(', ')}` : 'not yet derived'
  return (
    <div className="meta-pb-launch">
      <button className="sbtn out meta-pb-btn" onClick={() => setOpen(true)}>
        Comp playbook
      </button>
      <span className={`meta-pb-hint${mode.playbook.blessed ? ' blessed' : ''}`}>
        {mode.playbook.blessed ? 'blessed · ' : ''}
        {hint}
      </span>
      {open && <PlaybookModal mode={mode} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  )
}

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
            {/* Squad-comp playbook is WvW-only; Roaming/PvE never show it. */}
            {m.mode === 'WvW' && <PlaybookLauncher mode={m} onChange={refresh} />}
          </div>
        ))
      )}
      {import.meta.env.DEV && <MetaIndexInspector />}
    </div>
  )
}
