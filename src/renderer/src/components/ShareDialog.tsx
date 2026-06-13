// src/renderer/src/components/ShareDialog.tsx
import { useState, type ReactElement } from 'react'

export type ShareState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'done'; url: string }
  | { status: 'error'; error: string }

export default function ShareDialog({
  state,
  onClose
}: {
  state: ShareState
  onClose: () => void
}): ReactElement | null {
  const [copied, setCopied] = useState(false)
  if (state.status === 'idle') return null

  function copy(url: string): void {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="kick">AxiVale Press</div>
        {state.status === 'publishing' && (
          <div className="share-dialog-body">Publishing… your link will be live shortly.</div>
        )}
        {state.status === 'done' && (
          <div className="share-dialog-body">
            <div className="h">Filed for the public record</div>
            <div className="share-url-row">
              <input className="share-url" readOnly value={state.url} onFocus={(e) => e.target.select()} />
              <button className="folio-act" onClick={() => copy(state.url)}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <div className="share-dialog-note">
              First time sharing? GitHub Pages can take a minute to go live — the link may 404
              briefly before the press run starts.
            </div>
          </div>
        )}
        {state.status === 'error' && (
          <div className="share-dialog-body">
            <div className="h">Could not file this share</div>
            <div className="errnotice">{state.error}</div>
          </div>
        )}
        <div className="share-dialog-acts">
          <button className="folio-act" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
