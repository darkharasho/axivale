import { useEffect, useState, type ReactElement } from 'react'

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

/**
 * Newsprint banner that appears when a new edition has downloaded and is ready
 * to install. Quiet during checking/downloading; only "ready" demands action.
 */
export default function UpdateBanner(): ReactElement | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => window.officer.onUpdateStatus((s) => setStatus(s as UpdateStatus)), [])

  // Only the "ready to install" state warrants interrupting the reader.
  if (!status || status.state !== 'ready') return null

  return (
    <div className="updatebar">
      <span className="ub-flag">Late Edition</span>
      <span className="ub-msg">
        AxiVale <b>v{status.version}</b> is ready to install.
      </span>
      <button className="ub-btn" onClick={() => void window.officer.installUpdate()}>
        Restart &amp; update
      </button>
      <button className="ub-dismiss" title="Dismiss" onClick={() => setStatus(null)}>
        ✕
      </button>
    </div>
  )
}
