import type { ReactElement } from 'react'
import type { DisplayPayload } from '../../state'

type CodeSpec = Extract<DisplayPayload, { kind: 'code' }>['data']

/** Preformatted, wrapping block for query results that don't fit a table. */
export default function RichCode({ spec }: { spec: CodeSpec }): ReactElement {
  return (
    <div className="rich richcode">
      {spec.title && <div className="rich-title">{spec.title}</div>}
      <pre>{spec.text}</pre>
    </div>
  )
}
