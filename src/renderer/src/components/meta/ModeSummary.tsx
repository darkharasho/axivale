import { useEffect, useRef, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Distilled summary rendered as markdown, capped behind a "see more" toggle so a
 *  long write-up doesn't dominate the panel until the reader asks for it. */
export default function ModeSummary({ notes }: { notes: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4)
  }, [notes])

  if (!notes) {
    return <p className="meta-summary meta-summary-empty">No summary yet — awaiting first refresh.</p>
  }
  return (
    <div className="meta-summary-wrap">
      <div ref={ref} className={`meta-summary prose ${expanded ? 'expanded' : 'collapsed'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
      </div>
      {(overflows || expanded) && (
        <button className="meta-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}
