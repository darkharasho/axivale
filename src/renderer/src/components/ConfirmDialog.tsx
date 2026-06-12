import type { ReactElement } from 'react'
import { couponLabel } from './ToolCoupon'

export interface ConfirmReq {
  id: string
  toolName: string
  input: Record<string, unknown>
}

export interface ConfirmDialogProps {
  req: ConfirmReq
  onRespond: (id: string, allowed: boolean) => void
}

export default function ConfirmDialog({ req, onRespond }: ConfirmDialogProps): ReactElement {
  return (
    <div className="overlay">
      <div className="notice">
        <div className="nh">Notice of Destruction</div>
        <div className="nsub">Public Notice · Authorization Required</div>
        <div className="nbody">
          <div className="tool">
            <div className="th">
              <span className="nm">{couponLabel(req.toolName)}</span>
            </div>
            <div className="tb">
              <pre>{JSON.stringify(req.input, null, 2)}</pre>
            </div>
          </div>
          <div className="nask">The Officer requests authorization to proceed.</div>
        </div>
        <div className="nact">
          <button className="btn-stamp" onClick={() => onRespond(req.id, true)}>
            Approve
          </button>
          <button className="btn-out" onClick={() => onRespond(req.id, false)}>
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
