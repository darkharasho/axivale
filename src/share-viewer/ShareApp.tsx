// src/share-viewer/ShareApp.tsx
//
// Standalone reader for a single share. Resolves the id from the hash route
// (#/s/<id>), fetches shares/<id>.json relative to the page, and renders each
// turn with the SAME markdown + figure pipeline AxiVale uses (imported from the
// renderer components), so it looks identical to the app.
import { Fragment, useEffect, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeEmojiIcons } from '../renderer/src/components/rehypeEmojiIcons'
import { renderEmojiSpan } from '../renderer/src/components/emojiIcons'
import { splitHeadline, stripMarkdown } from '../renderer/src/components/headline'
import { couponLabel } from '../renderer/src/components/ToolCoupon'
import RichDisplay from '../renderer/src/components/rich/RichDisplay'
import type { ShareDoc, SharedTurn } from './shareTypes'

function shareIdFromHash(): string | null {
  const m = window.location.hash.match(/^#\/s\/([0-9A-Za-z]+)/)
  return m ? m[1] : null
}

function docUrl(id: string): string {
  // Page lives at /<repo>/ (hash route); the doc sits next to it under shares/.
  const base = window.location.href.split('#')[0]
  return new URL(`shares/${id}.json`, base).toString()
}

function ArticleView({ turn }: { turn: SharedTurn }): ReactElement {
  const { headline, rest } = splitHeadline(turn.agentText)
  const figures = turn.tools.filter((t) => t.display)
  const segments = rest.split(/\{\{\s*figure\s*\}\}/i)
  const renderFigure = (t: (typeof figures)[number], key: number): ReactElement => (
    <figure className="post-figure" key={key}>
      <RichDisplay display={t.display!} />
      <figcaption>{couponLabel(t.name)}</figcaption>
    </figure>
  )
  return (
    <>
      {turn.userText && (
        <>
          <div className="msg user">
            <div className="kick">From the Commander&apos;s Desk</div>
            <div className="body">{turn.userText}</div>
          </div>
          <div className="rip">
            <span className="t"></span>
            <span className="lbl">AxiVale Reports</span>
            <span className="t"></span>
          </div>
        </>
      )}
      <div className="msg off" style={{ position: 'relative' }}>
        <div className="lede">{stripMarkdown(headline)}</div>
        <div className="byline">
          By <b>AxiVale</b> · filed {turn.filedAt} · {turn.tools.length} action
          {turn.tools.length === 1 ? '' : 's'} taken
        </div>
        <div className="prose">
          {segments.map((seg, i) => (
            <Fragment key={i}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeEmojiIcons]}
                components={{ span: renderEmojiSpan }}
              >
                {seg}
              </ReactMarkdown>
              {i < segments.length - 1 && figures[i] && renderFigure(figures[i], i)}
            </Fragment>
          ))}
          {figures.slice(Math.max(0, segments.length - 1)).map((t, i) => renderFigure(t, 1000 + i))}
          <span className="endmark"> ∎</span>
        </div>
      </div>
    </>
  )
}

export default function ShareApp(): ReactElement {
  const [doc, setDoc] = useState<ShareDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = shareIdFromHash()
    if (!id) {
      setError('No share specified.')
      return
    }
    fetch(docUrl(id))
      .then((r) => {
        if (!r.ok) throw new Error('not found')
        return r.json()
      })
      .then((d: ShareDoc) => setDoc(d))
      .catch(() => setError('This share could not be found. It may have been deleted.'))
  }, [])

  if (error) return <div className="share-state">{error}</div>
  if (!doc) return <div className="share-state">Loading dispatch…</div>

  const dateline = new Date(doc.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  return (
    <div className="share-page">
      <div className="share-masthead">
        <div className="title">AxiVale</div>
        <div className="dateline">Filed {dateline}</div>
      </div>
      {doc.turns.map((turn, i) => (
        <ArticleView key={i} turn={turn} />
      ))}
      <div className="share-footer">Shared from AxiVale · {doc.app.name} v{doc.app.version}</div>
    </div>
  )
}
