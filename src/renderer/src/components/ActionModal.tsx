// src/renderer/src/components/ActionModal.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { ToolCall } from '../state'
import { couponLabel, humanInput, renderCouponBody } from './ToolCoupon'

/** Roomy overlay showing the full result of one Actions-rail tool call. */
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
  const gist = humanInput(tool.input, 200)

  return (
    <div className="action-overlay" onClick={onClose}>
      <div className="action-modal" onClick={(e) => e.stopPropagation()}>
        <div className="action-modal__head">
          <span className="nm">{couponLabel(tool.name)}</span>
          {tool.isError ? (
            <span className="st fail">✗ failed</span>
          ) : (
            <span className="st">✓ filed</span>
          )}
          <button className="action-modal__x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {gist !== '' && <div className="action-modal__inputs">{gist}</div>}
        <div className="action-modal__body">{renderCouponBody(tool)}</div>
        {tool.resultText && (
          <div className="action-modal__raw">
            <button className="sbtn" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Hide raw' : 'Show raw'}
            </button>
            {showRaw && <pre className="action-raw">{tool.resultText}</pre>}
          </div>
        )}
      </div>
    </div>
  )
}
