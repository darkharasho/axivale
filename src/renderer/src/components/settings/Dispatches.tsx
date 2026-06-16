import type { ReactElement } from 'react'
import { Pane, Card } from '../panelui'

export interface ShareEntry {
  id: string
  kind: string
  title: string
  url: string
  createdAt: string
}

export interface DispatchesProps {
  shareEntries: ShareEntry[]
  onDelete: (id: string) => void
}

export default function Dispatches({ shareEntries, onDelete }: DispatchesProps): ReactElement {
  return (
    <Pane
      no="06"
      title="Shared Dispatches"
      sub="Public links you have published to your GitHub Pages share site. Deleting one removes it from the web."
    >
      <Card title="Published">
        {shareEntries.length === 0 ? (
          <div className="sstatus">You haven&apos;t shared anything yet.</div>
        ) : (
          <ul className="share-list">
            {shareEntries.map((s) => (
              <li key={s.id} className="share-list-row">
                <div className="share-list-meta">
                  <span className="share-list-title">{s.title || 'Untitled'}</span>
                  <span className="share-list-kind">{s.kind}</span>
                </div>
                <div className="share-list-acts">
                  <a className="sbtn ghost" href={s.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="sbtn ghost" onClick={() => onDelete(s.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Pane>
  )
}
