import { useEffect, useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { WhatsNewBody, RELEASE } from './settings/WhatsNew'

const SEEN_KEY = 'axivale:whatsNewSeen'

/**
 * One-time launch modal for the current release. Pops the first time the app
 * runs on a new version, then stays out of the way — the same broadsheet always
 * lives in Settings → About. Dismissal records RELEASE.version so it won't
 * reappear until the next edition.
 */
export default function WhatsNewModal(): ReactElement | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let seen: string | null = null
    try {
      seen = localStorage.getItem(SEEN_KEY)
    } catch {
      // localStorage unavailable — treat as already seen, never nag.
      return
    }
    if (seen !== RELEASE.version) setOpen(true)
  }, [])

  // Escape always closes, regardless of where the pointer lands — a reliable
  // out on frameless windows where the title drag-region can skew clicks.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function dismiss(): void {
    try {
      localStorage.setItem(SEEN_KEY, RELEASE.version)
    } catch {
      // ignore — worst case the reader sees it again next launch.
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="wnm-scrim" onClick={dismiss}>
      <div className="wnm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="wnm-rule">
          <span className="wnm-ear">The AxiVale Herald</span>
          <button className="wnm-x" title="Close" onClick={dismiss}>
            <X size={15} />
          </button>
        </div>
        <div className="wnm-body">
          <WhatsNewBody />
        </div>
        <div className="wnm-foot">
          <button className="wnm-btn" onClick={dismiss}>
            Read all about it
          </button>
        </div>
      </div>
    </div>
  )
}
