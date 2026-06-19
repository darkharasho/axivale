import type { ReactElement } from 'react'
import { couponLabel } from './ToolCoupon'

export interface ConfirmReq {
  id: string
  toolName: string
  input: Record<string, unknown>
  /** True for irreversible/harmful actions (deletes); false for sensitive-but-safe
   *  ones (publish, send). Treated as destructive when absent, so an older main
   *  process that omits the flag still errs toward the stronger warning. */
  destructive?: boolean
}

export interface ConfirmDialogProps {
  req: ConfirmReq
  onRespond: (id: string, allowed: boolean) => void
}

export default function ConfirmDialog({ req, onRespond }: ConfirmDialogProps): ReactElement {
  const destructive = req.destructive !== false
  return (
    <div className="overlay">
      <div className={`notice${destructive ? '' : ' notice--safe'}`}>
        <div className="nh">{destructive ? 'Notice of Destruction' : 'Authorization Required'}</div>
        <div className="nsub">
          {destructive ? 'Public Notice · Authorization Required' : 'Public Notice · Awaiting Approval'}
        </div>
        <div className="nbody">
          <div className="tool">
            <div className="th">
              <span className="nm">{couponLabel(req.toolName)}</span>
            </div>
            <div className="tb">
              <pre>{JSON.stringify(req.input, null, 2)}</pre>
            </div>
          </div>
          <div className="nask">AxiVale requests authorization to proceed.</div>
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
