import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Turn } from '../state'
import { rehypeEmojiIcons } from './rehypeEmojiIcons'
import { renderEmojiSpan } from './emojiIcons'
import { splitHeadline, stripMarkdown } from './headline'
import WireThinking from './WireThinking'

export default function Article({ turn }: { turn: Turn }): ReactElement {
  const { headline, rest } = splitHeadline(turn.agentText)
  const thinking = !turn.done && turn.agentText.trim() === ''
  const streaming = !turn.done && turn.agentText.trim() !== ''
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
        {thinking ? (
          <WireThinking />
        ) : (
          <>
            <div className="lede">{stripMarkdown(headline)}</div>
            <div className="byline">
              By <b>AxiVale</b> · filed {turn.filedAt} · {turn.tools.length} action
              {turn.tools.length === 1 ? '' : 's'} taken
            </div>
            <div className="prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeEmojiIcons]}
                components={{ span: renderEmojiSpan }}
              >
                {rest}
              </ReactMarkdown>
              {streaming && <span className="typebar"></span>}
              {turn.error && (
                <div className="errnotice">
                  <div className="h">Dispatch Interrupted</div>
                  {turn.error}
                </div>
              )}
              {turn.done && !turn.error && <span className="endmark"> ∎</span>}
            </div>
          </>
        )}
      </div>
    </>
  )
}
