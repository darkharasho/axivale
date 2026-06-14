import { useState, type ReactElement } from 'react'
import type { ToolCall, Turn } from '../state'
import { couponLabel, humanInput, renderCouponBody } from './ToolCoupon'
import ActionModal from './ActionModal'

export interface RailsProps {
  memberCount: number | null
  buildsCount: number | null
  turns: Turn[]
}

interface Notice {
  tool: ToolCall
  seq: number
  filedAt: string
  current: boolean
}

const FEED_CAP = 20

function NoticeCard({
  notice,
  onExpand
}: {
  notice: Notice
  onExpand: (tool: ToolCall) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const { tool, seq, filedAt, current } = notice
  const working = tool.resultText === undefined && !tool.isError
  let status: ReactElement
  if (working) {
    status = <span className="st work">… working</span>
  } else if (tool.isError) {
    status = <span className="st fail">✗ failed</span>
  } else {
    status = <span className="st">✓ filed</span>
  }
  const gist = humanInput(tool.input, 60)
  return (
    <div
      className={`ncard${current ? '' : ' dim'}`}
      onClick={() => setOpen((o) => !o)}
      role="button"
      aria-expanded={open}
    >
      <div className="th">
        <span className="nm">{couponLabel(tool.name)}</span>
        {status}
        <button
          className="expand"
          aria-label="Expand action"
          title="Expand"
          onClick={(e) => {
            e.stopPropagation()
            onExpand(tool)
          }}
        >
          ⤢
        </button>
      </div>
      <div className="tb">
        {gist !== '' && <div className="gist">{gist}</div>}
        <div className="tm">
          № {seq} · {filedAt}
        </div>
        {open && !working && <div className="nx">{renderCouponBody(tool)}</div>}
      </div>
    </div>
  )
}

export function RightRail({ turns }: RailsProps): ReactElement {
  const [expanded, setExpanded] = useState<ToolCall | null>(null)
  let seq = 0
  const feed: Notice[] = turns
    .flatMap((turn, ti) =>
      turn.tools.map((tool) => ({
        tool,
        seq: ++seq,
        filedAt: turn.filedAt,
        current: ti === turns.length - 1
      }))
    )
    .slice(-FEED_CAP)
    .reverse()

  return (
    <div className="rail right">
      <div className="h">Notices · Actions Filed</div>
      {feed.length === 0 ? (
        <div className="item">
          <b>The wire is quiet</b>no actions filed yet
        </div>
      ) : (
        feed.map((notice) => (
          <NoticeCard key={notice.tool.id} notice={notice} onExpand={setExpanded} />
        ))
      )}
      <ActionModal tool={expanded} onClose={() => setExpanded(null)} />
    </div>
  )
}
