import type { ReactElement } from 'react'
import { Pane, Card } from '../panelui'

export interface AboutProps {
  version: string
  updateMsg: string
  onCheckUpdates: () => void
}

export default function About({ version, updateMsg, onCheckUpdates }: AboutProps): ReactElement {
  return (
    <Pane no="07" title="About" sub="Version and updates.">
      <Card title="AxiVale">
        <div className="sactions">
          <div className="countline">
            AxiVale <b>v{version || '—'}</b>
          </div>
          <button className="sbtn ghost" onClick={onCheckUpdates}>
            Check for updates
          </button>
        </div>
        {updateMsg && <div className="sstatus ok">{updateMsg}</div>}
        <p className="shelp">
          Updates install automatically from GitHub releases; a banner appears when a new
          edition is ready.
        </p>
      </Card>
    </Pane>
  )
}
