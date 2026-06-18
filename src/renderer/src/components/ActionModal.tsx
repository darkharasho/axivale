// src/renderer/src/components/ActionModal.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { ToolCall } from '../state'
import { couponLabel, humanValue, prettyKey, renderCouponBody } from './ToolCoupon'

/** Split a coupon label ("GW2 / BUILD FROM URL") into an eyebrow section and a
 *  headline. Long words are title-cased; short all-caps tokens (GW2, API, WVW,
 *  URL, RSS) are kept as acronyms. */
function headline(label: string): { section: string | null; title: string } {
  const slash = label.indexOf(' / ')
  const section = slash >= 0 ? label.slice(0, slash) : null
  const rest = slash >= 0 ? label.slice(slash + 3) : label
  const title = rest
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
  return { section, title }
}

/** Roomy overlay showing the full result of one Actions-rail tool call, set as
 *  a filed-dispatch dossier. */
export default function ActionModal({
  tool,
  onClose
}: {
  tool: ToolCall | null
  onClose: () => void
}): ReactElement | null {
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tool, onClose])

  // Reset the raw toggle whenever a different tool is opened.
  useEffect(() => setShowRaw(false), [tool?.id])

  if (!tool) return null

  const working = tool.resultText === undefined && !tool.isError
  const state = working ? 'work' : tool.isError ? 'fail' : 'ok'
  const stampLabel = working ? 'Working' : tool.isError ? 'Failed' : 'Filed'
  const { section, title } = headline(couponLabel(tool.name))
  const inputs = tool.input ? Object.entries(tool.input) : []

  return (
    <div className="action-overlay" onClick={onClose}>
      <div className="action-modal" onClick={(e) => e.stopPropagation()}>
        <button className="action-modal__x" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="action-modal__head">
          <div className="action-modal__kick">{section ? `${section} · Action` : 'Action'}</div>
          <div className="action-modal__headrow">
            <h2 className="action-modal__title">{title}</h2>
            <span className={`action-modal__stamp ${state}`}>{stampLabel}</span>
          </div>
        </div>
        <hr className="action-modal__rule" />

        {inputs.length > 0 && (
          <div className="action-modal__filed">
            <div className="action-modal__filed-lbl">Filed with</div>
            <div className="manifest">
              {inputs.map(([k, v]) => (
                <div className="kv" key={k}>
                  <span className="k">{prettyKey(k)}</span>
                  <span className="v">{humanValue(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="action-modal__body">
          {tool.isError ? (
            <div className="errnotice">
              <div className="h">Action did not file</div>
              {tool.resultText || 'The action failed.'}
            </div>
          ) : working ? (
            <div className="copy">Still on the wire — this action hasn't filed yet.</div>
          ) : (
            renderCouponBody(tool)
          )}
        </div>

        {showRaw && tool.resultText && <pre className="action-raw">{tool.resultText}</pre>}

        <div className="action-modal__foot">
          {tool.resultText && (
            <button className="sd-btn" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Hide raw' : 'Show raw'}
            </button>
          )}
          <button className="sd-btn right" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
