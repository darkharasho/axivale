// src/renderer/src/components/memory/MemoryRollup.tsx
//
// Read-only "What AxiVale knows" block for a roster member, shown beside the
// user's hand-written annotation notes. Accumulated memory, distinct from notes.
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMemoryFact } from '../../../../preload/index.d'

export default function MemoryRollup({ entity }: { entity: string }): ReactElement | null {
  const [facts, setFacts] = useState<RendererMemoryFact[]>([])
  useEffect(() => {
    let live = true
    void window.officer.memoryFactsForEntity(entity).then((f) => { if (live) setFacts(f) })
    return () => { live = false }
  }, [entity])

  if (facts.length === 0) return null
  return (
    <div className="mem-rollup">
      <div className="mem-rollup-h">What AxiVale knows</div>
      <ul className="mem-rollup-list">
        {facts.map((f) => (
          <li key={f.id}>
            {f.body}
            {f.tags.length > 0 && <span className="mem-rollup-tags"> · {f.tags.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
