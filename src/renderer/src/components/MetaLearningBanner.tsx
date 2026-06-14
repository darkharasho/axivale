import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMetaProgress } from '../../../preload/index.d'

export default function MetaLearningBanner(): ReactElement | null {
  const [state, setState] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0
  })

  useEffect(() => {
    return window.officer.onMetaProgress((e: RendererMetaProgress) => {
      if (e.type === 'refresh-start') setState({ active: true, done: 0, total: e.total })
      else if (e.type === 'source-done') setState((s) => ({ ...s, done: s.done + 1 }))
      else if (e.type === 'idle') setState((s) => ({ ...s, active: false }))
    })
  }, [])

  if (!state.active) return null
  const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0
  return (
    <div className="learn-banner">
      <span className="learn-label">Learning the current meta…</span>
      <div className="learn-bar">
        <div className="learn-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
