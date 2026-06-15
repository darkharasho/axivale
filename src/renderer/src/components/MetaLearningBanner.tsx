import { useEffect, useState, type ReactElement } from 'react'
import type { RendererLearnProgress } from '../../../preload/index.d'

interface PhaseRow {
  label: string
  done: number
  total: number
}

// One labelled progress bar per active background job. The meta refresh ('meta')
// and the wiki reference ingest ('wiki') report through the same stream and can
// run at once, so each shows its own row; a phase disappears when it reports done.
export default function MetaLearningBanner(): ReactElement | null {
  const [phases, setPhases] = useState<Record<string, PhaseRow>>({})

  useEffect(() => {
    return window.officer.onLearnProgress((e: RendererLearnProgress) => {
      setPhases((prev) => {
        if (e.kind === 'start') return { ...prev, [e.phase]: { label: e.label, done: 0, total: e.total } }
        if (e.kind === 'advance') {
          const row = prev[e.phase]
          if (!row) return prev
          return { ...prev, [e.phase]: { ...row, done: row.done + 1 } }
        }
        // done — drop the phase
        const next = { ...prev }
        delete next[e.phase]
        return next
      })
    })
  }, [])

  const active = Object.entries(phases)
  if (active.length === 0) return null
  return (
    <>
      {active.map(([phase, row]) => {
        const pct = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0
        return (
          <div className="learn-banner" key={phase}>
            <span className="learn-label">{row.label}</span>
            <div className="learn-bar">
              <div className="learn-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </>
  )
}
