import type { ReactElement } from 'react'
import type { Turn } from '../state'
import { couponLabel } from './ToolCoupon'

export interface RailsProps {
  memberCount: number | null
  buildsCount: number | null
  turns: Turn[]
}

export function LeftRail({ memberCount, buildsCount }: RailsProps): ReactElement {
  return (
    <div className="rail left">
      <div className="h">In this issue</div>
      <div className="item">
        <b>Guild roster</b>
        {memberCount != null ? `${memberCount} members on the books` : '— awaiting muster'}
      </div>
      <div className="item">
        <b>Builds index</b>
        {buildsCount != null ? `${buildsCount} filed` : '— not yet indexed'}
      </div>
      <div className="item">
        <b>Weekly reset</b>Friday 18:00 UTC
      </div>
    </div>
  )
}

export function RightRail({ turns }: RailsProps): ReactElement {
  const actions = turns
    .flatMap((t) => t.tools)
    .filter((tool) => tool.resultText !== undefined || tool.isError)
    .slice(-3)
    .reverse()

  return (
    <div className="rail right">
      <div className="h">Notices</div>
      {actions.length === 0 ? (
        <div className="item">
          <b>The wire is quiet</b>no actions filed yet
        </div>
      ) : (
        actions.map((tool) => (
          <div className="item" key={tool.id}>
            <b>{couponLabel(tool.name)}</b>
            <span className={tool.isError ? 'no' : 'ok'}>
              {tool.isError ? '✗ failed' : '✓ filed'}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
