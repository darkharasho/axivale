import { Fragment, useRef, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Camera, Check, X, Share2 } from 'lucide-react'
import type { Turn } from '../state'
import { rehypeEmojiIcons } from './rehypeEmojiIcons'
import { renderEmojiSpan, renderExtLink } from './emojiIcons'
import { splitHeadline } from './headline'
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

  // Inline figures (.post-figure / .richchart) use overflow-x:auto, so a wide
  // table scrolls INSIDE its own box and never widens the article — measuring
  // scrollWidth would miss it and the capture would clip on the right. Briefly
  // neutralize that inner overflow (and the article's max-width) so the figures
  // expand to full content width; modern-screenshot reads computed styles off
  // the live DOM, so this must be applied before measuring + capturing.
  const captureStyle = document.createElement('style')
  captureStyle.textContent =
    '.axi-capturing,.axi-capturing .prose{max-width:none!important}' +
    '.axi-capturing .post-figure,.axi-capturing .richchart{overflow:visible!important;max-width:none!important}'
  document.head.appendChild(captureStyle)
  node.classList.add('axi-capturing')

  let blob: Blob | undefined
  try {
    void node.offsetWidth // force reflow so scroll size reflects expanded figures
    // modern-screenshot sizes the output canvas from the element's bounding box,
    // not from a style.width override — so we must pass explicit width/height
    // equal to the full scroll extent (+ padding) or wide tables clip on the
    // right. border-box width = canvas size means padding sits inside, leaving
    // exactly scrollWidth/scrollHeight of content area.
    const PADX = 36
    const PADY = 32
    const w = node.scrollWidth + PADX * 2
    const h = node.scrollHeight + PADY * 2

    blob = await domToBlob(node, {
      type: 'image/png',
      backgroundColor: bgColor,
      scale: 2,
      width: w,
      height: h,
      style: {
        padding: `${PADY}px ${PADX}px`,
        boxSizing: 'border-box',
        width: `${w}px`,
        height: `${h}px`,
        maxWidth: 'none'
      },
      // Exclude the copy button from the capture
      filter: (el: Node) => {
        if (el instanceof HTMLElement && el.dataset.copyBtn === '1') return false
        return true
      }
    })
  } finally {
    node.classList.remove('axi-capturing')
    captureStyle.remove()
  }

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })])
}

export default function Article({
  turn,
  conversationId,
  onShare
}: {
  turn: Turn
  conversationId: string | null
  onShare?: (conversationId: string, turnId: number) => void
}): ReactElement {
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
        <div className="kick">
          From the Commander&apos;s Desk
          {(() => {
            const skill =
              turn.skill ??
              (turn.tools.find((t) => t.name.endsWith('load_skill') && !t.isError)?.input?.name as
                | string
                | undefined)
            return skill ? <span className="kick-skill">{skill}</span> : null
          })()}
        </div>
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
              <>
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
                {onShare && conversationId && (
                  <button
                    className="share-msg-btn"
                    data-copy-btn="1"
                    onClick={() => onShare(conversationId, turn.id)}
                    aria-label="Share this response"
                    title="Share this response"
                  >
                    <Share2 size={12} />
                  </button>
                )}
              </>
            )}
            <div className="lede">
              {/* The lede is display type: render inline markdown so links (and emoji)
                  resolve like the body, but unwrap block/emphasis so it stays a clean
                  single line — no bold/heading styling, no literal [text](url) syntax. */}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeEmojiIcons]}
                disallowedElements={['em', 'strong', 'code', 'del', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']}
                unwrapDisallowed
                components={{ p: ({ children }) => <>{children}</>, span: renderEmojiSpan, a: renderExtLink }}
              >
                {headline}
              </ReactMarkdown>
            </div>
            <div className="byline">
              By <b>AxiVale</b> · filed {turn.filedAt} · {turn.tools.length} action
              {turn.tools.length === 1 ? '' : 's'} taken
            </div>
            <div className="prose">
              {/* Inline figures (charts, build/comp cards) render ONLY where the
                  model writes {{figure}}, in order. Unmarked tool displays are
                  not dumped here — they live in the Actions rail. Tool data
                  tables are excluded from inline entirely. */}
              {(() => {
                const figures = turn.tools.filter(
                  (t) => t.display && t.display.kind !== 'table' && !t.isError
                )
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
                          components={{ span: renderEmojiSpan, a: renderExtLink }}
                        >
                          {seg}
                        </ReactMarkdown>
                        {i < segments.length - 1 && figures[i] && renderFigure(figures[i])}
                      </Fragment>
                    ))}
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
