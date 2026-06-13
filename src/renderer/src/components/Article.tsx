import { Fragment, useRef, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Camera, Check, X } from 'lucide-react'
import type { Turn } from '../state'
import { rehypeEmojiIcons } from './rehypeEmojiIcons'
import { renderEmojiSpan } from './emojiIcons'
import { splitHeadline, stripMarkdown } from './headline'
import { couponLabel } from './ToolCoupon'
import RichDisplay from './rich/RichDisplay'
import WireThinking from './WireThinking'

type CopyState = 'idle' | 'ok' | 'err'

async function copyArticleAsImage(node: HTMLElement): Promise<void> {
  // dynamic import so the library only loads when used
  const { domToBlob } = await import('modern-screenshot')

  const bgColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim() || '#16171a'

  // Size the capture to the full content width (incl. any overflowing figure)
  // and add the padding OUTSIDE it (content-box) so nothing is clipped on the
  // right — border-box padding would shrink the content area and cut text off.
  const contentWidth = node.scrollWidth

  const blob = await domToBlob(node, {
    type: 'image/png',
    backgroundColor: bgColor,
    scale: 2,
    // Breathing room around the clipping so text isn't flush to the edges.
    style: {
      padding: '32px 36px',
      boxSizing: 'content-box',
      width: `${contentWidth}px`,
      maxWidth: 'none'
    },
    // Exclude the copy button from the capture
    filter: (el: Node) => {
      if (el instanceof HTMLElement && el.dataset.copyBtn === '1') return false
      return true
    }
  })

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })])
}

export default function Article({ turn }: { turn: Turn }): ReactElement {
  const { headline, rest } = splitHeadline(turn.agentText)
  const thinking = !turn.done && turn.agentText.trim() === ''
  const streaming = !turn.done && turn.agentText.trim() !== ''
  const articleRef = useRef<HTMLDivElement>(null)
  const [copyState, setCopyState] = useState<CopyState>('idle')

  function handleCopy(): void {
    if (!articleRef.current || copyState !== 'idle') return
    copyArticleAsImage(articleRef.current).then(() => {
      setCopyState('ok')
      setTimeout(() => setCopyState('idle'), 1500)
    }).catch(() => {
      setCopyState('err')
      setTimeout(() => setCopyState('idle'), 1500)
    })
  }

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
      <div className="msg off" ref={articleRef} style={{ position: 'relative' }}>
        {thinking ? (
          <WireThinking />
        ) : (
          <>
            {turn.done && (
              <button
                className="clip-img-btn"
                data-copy-btn="1"
                onClick={handleCopy}
                aria-label="Copy article as image"
                title="Copy as newspaper clipping"
              >
                {copyState === 'ok' ? (
                  <Check size={12} />
                ) : copyState === 'err' ? (
                  <X size={12} />
                ) : (
                  <Camera size={12} />
                )}
              </button>
            )}
            <div className="lede">{stripMarkdown(headline)}</div>
            <div className="byline">
              By <b>AxiVale</b> · filed {turn.filedAt} · {turn.tools.length} action
              {turn.tools.length === 1 ? '' : 's'} taken
            </div>
            <div className="prose">
              {/* Figures (charts/tables/cards) render full-width in the main
                  column — the right rail is too narrow for a graph. The model
                  places each one inline by writing {{figure}} on its own line;
                  segments split on that marker and figures fill the gaps in
                  order. With no markers, all figures fall to the end. */}
              {(() => {
                const figures = turn.tools.filter((t) => t.display && !t.isError)
                const segments = rest.split(/\{\{\s*figure\s*\}\}/i)
                const renderFigure = (t: (typeof figures)[number]): ReactElement => (
                  <figure className="post-figure" key={t.id}>
                    <RichDisplay display={t.display!} />
                    <figcaption>{couponLabel(t.name)}</figcaption>
                  </figure>
                )
                return (
                  <>
                    {segments.map((seg, i) => (
                      <Fragment key={i}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeEmojiIcons]}
                          components={{ span: renderEmojiSpan }}
                        >
                          {seg}
                        </ReactMarkdown>
                        {i < segments.length - 1 && figures[i] && renderFigure(figures[i])}
                      </Fragment>
                    ))}
                    {/* Leftover figures (fewer markers than figures, incl. the
                        no-marker case) render after the prose. */}
                    {figures.slice(Math.max(0, segments.length - 1)).map(renderFigure)}
                  </>
                )
              })()}
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
