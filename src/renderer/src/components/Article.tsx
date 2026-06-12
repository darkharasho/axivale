import type { ReactElement } from 'react'
import type { Turn } from '../state'
import ToolCoupon from './ToolCoupon'

function splitHeadline(text: string): { headline: string; rest: string } {
  const trimmed = text.replace(/^\s+/, '')
  const match = trimmed.match(/[.!?\n]/)
  if (!match || match.index === undefined) {
    return { headline: trimmed, rest: '' }
  }
  const breakChar = trimmed[match.index]
  const end = breakChar === '\n' ? match.index : match.index + 1
  const headline = trimmed.slice(0, end).trim()
  const rest = trimmed.slice(match.index + 1).trim()
  return { headline, rest }
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

export default function Article({ turn }: { turn: Turn }): ReactElement {
  const { headline, rest } = splitHeadline(turn.agentText)
  const paras = paragraphs(rest)
  return (
    <>
      <div className="msg user">
        <div className="kick">From the Commander's Desk</div>
        <div className="body">{turn.userText}</div>
      </div>
      <div className="rip">
        <span className="t"></span>
        <span className="lbl">AxiVale Reports</span>
        <span className="t"></span>
      </div>
      <div className="msg off">
        <div className="lede">{headline || '…'}</div>
        <div className="byline">
          By <b>AxiVale</b> · filed {turn.filedAt} · {turn.tools.length} action
          {turn.tools.length === 1 ? '' : 's'} taken
        </div>
        <div className="prose">
          {paras.map((p, i) => (
            <p key={i} className={i === 0 ? 'dc' : undefined}>
              {p}
            </p>
          ))}
          {turn.tools.map((tool) => (
            <ToolCoupon key={tool.id} tool={tool} />
          ))}
          {turn.error && (
            <div className="errnotice">
              <div className="h">Dispatch Interrupted</div>
              {turn.error}
            </div>
          )}
          {turn.done && !turn.error && <span className="endmark"> ∎</span>}
        </div>
      </div>
    </>
  )
}
