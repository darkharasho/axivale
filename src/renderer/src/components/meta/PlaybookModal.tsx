import { useEffect, useRef, useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import { Card, Field } from '../panelui'

/** The comp playbook itself, rendered inside a popup. Squad-comp concept, so it is
 *  only ever launched for the squad WvW mode (see PlaybookLauncher). */
function PlaybookModal({
  mode,
  onChange,
  onClose
}: {
  mode: RendererMetaMode
  onChange: () => void
  onClose: () => void
}): ReactElement {
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
          <button className="action-modal__x" onClick={onClose} aria-label="Close">
            <X size={13} />
          </button>
        </div>
        <div className="action-modal__body meta-playbook">
          <Card title="Baseline">
            <div className="sactions" style={{ marginTop: 0 }}>
              <label className="meta-bless">
                <input
                  type="checkbox"
                  checked={pb.blessed}
                  onChange={(e) => save({ blessed: e.target.checked })}
                />
                blessed (used by AI)
              </label>
              <button className="sbtn ghost meta-pb-derive" disabled={deriving} onClick={derive}>
                {deriving ? 'Deriving…' : 'Refresh from AxiBridge'}
              </button>
            </div>
            {msg && <p className="shelp meta-pb-msg">{msg}</p>}
            {d ? (
              <div className="meta-derived">
                <p className="meta-derived-meta">
                  <strong>{d.sampleSize} reports</strong> · {d.window.fromISO}–{d.window.toISO} ·{' '}
                  {d.sourceRepos.join(', ')}
                  {d.lowConfidence ? ' · low confidence' : ''} · squad ~{d.avgSquadSize},{' '}
                  {d.supportPct}% support
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
              <p className="shelp meta-derived-empty">
                No derived baseline yet — click &quot;Refresh from AxiBridge&quot;.
              </p>
            )}
          </Card>

          {/* saves on blur; an unmount before blur drops the in-flight edit — acceptable for notes fields */}
          <Field label="Principles">
            <textarea
              id={`pb-principles-${mode.id}`}
              className="sfield-area"
              rows={6}
              value={principles}
              onChange={(e) => setPrinciples(e.target.value)}
              onBlur={() => save({ principles })}
            />
          </Field>
          <Field label="Guild overrides">
            <textarea
              id={`pb-overrides-${mode.id}`}
              className="sfield-area"
              rows={3}
              value={overrides}
              onChange={(e) => setOverrides(e.target.value)}
              onBlur={() => save({ overrides })}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

/** WvW-only launcher: a button (with a derived-state hint) that opens the comp
 *  playbook in a popup. */
export default function PlaybookLauncher({
  mode,
  onChange
}: {
  mode: RendererMetaMode
  onChange: () => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const d = mode.playbook.derived
  const hint = d ? `${d.sampleSize} reports · ${d.sourceRepos.join(', ')}` : 'not yet derived'
  return (
    <div className="meta-pb-launch">
      <button className="sbtn ghost meta-pb-btn" onClick={() => setOpen(true)}>
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
