import { useState, type KeyboardEvent, type ReactElement } from 'react'
import type { ToolCall, Turn } from '../state'
import { couponLabel, humanInput } from './ToolCoupon'
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

// The whole card is the hit target: a click (or Enter/Space) opens the roomy
// ActionModal, where a result actually has room to breathe — the rail is too
// narrow to read a table in. No tiny separate button to aim at.
function NoticeCard({
  notice,
  onExpand
}: {
  notice: Notice
  onExpand: (tool: ToolCall) => void
}): ReactElement {
  const { tool, seq, filedAt, current } = notice
  const working = tool.resultText === undefined && !tool.isError
  const state = working ? 'work' : tool.isError ? 'fail' : 'ok'
  const stateLabel = working ? 'working' : tool.isError ? 'failed' : 'filed'
  const gist = humanInput(tool.input, 60)

  function open(): void {
    onExpand(tool)
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

  return (
    <div
      className={`ncard${current ? '' : ' dim'}`}
      onClick={open}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${couponLabel(tool.name)} — ${stateLabel}`}
    >
      <div className="th">
        <span className={`led ${state}`} aria-hidden="true" />
        <span className="nm">{couponLabel(tool.name)}</span>
      </div>
      <div className="tb">
        {gist !== '' && <div className="gist">{gist}</div>}
        <div className="foot">
          <span className="tm">
            № {seq} · {filedAt}
            {state !== 'ok' ? ` · ${stateLabel}` : ''}
          </span>
          <span className="open" aria-hidden="true">
            open ⤢
          </span>
        </div>
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
