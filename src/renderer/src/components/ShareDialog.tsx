// src/renderer/src/components/ShareDialog.tsx
import { useState, type ReactElement } from 'react'
import { Check, Info, Loader } from 'lucide-react'

export type ShareState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'done'; url: string; live: boolean }
  | { status: 'error'; error: string }

/** Newspaper "Special Edition" clipping for a freshly filed public share. */
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

  const title =
    state.status === 'publishing'
      ? 'Going to press…'
      : state.status === 'error'
        ? 'Held from the press'
        : 'Filed for the public record'

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sd-head">
          <div className="sd-kick">AxiVale · Special Edition</div>
          <h2 className="sd-title">{title}</h2>
        </div>
        <div className="sd-rule">
          <span className="ln" />
          <span className="dot">Wire Copy</span>
          <span className="ln" />
        </div>

        <div className="sd-body">
          {state.status === 'publishing' && (
            <div className="sd-pending">
              <Loader size={15} className="sd-spin" />
              <span>
                Setting type and waiting for the presses (GitHub Pages) to run — your link goes out
                the moment it&apos;s live.
              </span>
            </div>
          )}

          {state.status === 'done' && (
            <>
              <p className="sd-sub">Anyone with this link can read this dispatch.</p>
              <div className="sd-urlrow">
                <input
                  className="sd-url"
                  readOnly
                  value={state.url}
                  onFocus={(e) => e.target.select()}
                />
                <button className="sd-copy" onClick={() => copy(state.url)}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              {state.live ? (
                <div className="sd-note sd-note--ok">
                  <Check size={13} />
                  <span>Live and ready — the link is serving now.</span>
                </div>
              ) : (
                <div className="sd-note">
                  <Info size={13} />
                  <span>
                    Still going to press — GitHub Pages is taking longer than usual. The link will
                    work shortly; give it a minute before sharing it around.
                  </span>
                </div>
              )}
            </>
          )}

          {state.status === 'error' && <div className="sd-error">{state.error}</div>}
        </div>

        <div className="sd-acts">
          <button className="sd-btn" onClick={onClose}>
            {state.status === 'done' ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
