// src/share-viewer/ShareApp.tsx
//
// Standalone reader for a single share. Resolves the id from the hash route
// (#/s/<id>), fetches shares/<id>.json relative to the page, and renders it as a
// newspaper page. Body markdown + figures use the SAME pipeline AxiVale uses
// (imported from the renderer components) so article content looks identical to
// the app; the page chrome (masthead, headline, byline, footer) is styled by
// viewer.css.
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
  // Prefer raw.githubusercontent.com: a committed file is served there within
  // seconds (CORS-enabled), whereas the Pages-built path only updates after a
  // full site rebuild (~30s). Falls back to the relative Pages path for custom
  // domains or any non-*.github.io host.
  const owner = window.location.hostname.match(/^([^.]+)\.github\.io$/)?.[1]
  const repo = window.location.pathname.split('/').filter(Boolean)[0]
  if (owner && repo) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/shares/${id}.json`
  }
  const base = window.location.href.split('#')[0]
  return new URL(`shares/${id}.json`, base).toString()
}

function ArticleView({ turn, kicker }: { turn: SharedTurn; kicker: string }): ReactElement {
  const { headline, rest } = splitHeadline(turn.agentText)
  const figures = turn.tools.filter((t) => t.display)
  const segments = rest.split(/\{\{\s*figure\s*\}\}/i)
  const renderFigure = (t: (typeof figures)[number], key: number): ReactElement => (
    <figure className="post-figure" key={key}>
      <RichDisplay display={t.display!} />
      <figcaption>{couponLabel(t.name)}</figcaption>
    </figure>
  )
  const actions = turn.tools.length
  return (
    <article className="sv-article">
      {turn.userText && (
        <blockquote className="sv-ask">
          <span className="who">From the Commander&apos;s Desk</span>
          {turn.userText}
        </blockquote>
      )}
      <div className="sv-kicker">{kicker}</div>
      <h2 className="sv-headline">{stripMarkdown(headline)}</h2>
      <div className="sv-byline">
        By <b>AxiVale</b> · Filed {turn.filedAt}
        {actions > 0 && <> · {actions} action{actions === 1 ? '' : 's'} taken</>}
      </div>
      <div className="prose sv-prose">
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
        <span className="sv-endmark">∎</span>
      </div>
    </article>
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
  if (!doc) return <div className="share-state">Setting the type…</div>

  const filed = new Date(doc.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
  // Honest kicker from the share kind — no fabricated categories.
  const kicker = doc.kind === 'response' ? 'Field Dispatch' : 'Full Dispatch'

  return (
    <div className="share-page">
      <div className="svgut l" aria-hidden="true">
        <span className="reg">
          <i />
        </span>
        <div className="tick">
          AxiVale · Guild Intelligence · AxiVale · Guild Intelligence · AxiVale · Guild Intelligence
        </div>
        <div className="barcode" />
        <div className="code">ISSN 2026-AXIV</div>
      </div>
      <div className="svgut r" aria-hidden="true">
        <span className="reg">
          <i />
        </span>
        <div className="tick">
          All the guild intel that&apos;s fit to print · All the guild intel that&apos;s fit to print
        </div>
        <div className="price">
          Free
          <br />
          <b>to</b>
          <br />
          Members
        </div>
      </div>
      <header className="smh">
        <div className="smh-top">
          <span>The Commander&apos;s Dispatch</span>
          <span className="smh-top-mid">Public Dispatch</span>
          <span>Filed {filed}</span>
        </div>
        <h1 className="smh-title">
          Axi<em>Vale</em>
        </h1>
        <div className="smh-motto">“All the guild intel that&apos;s fit to print.”</div>
        <div className="smh-band">
          <span className="ln" />
          <span>Guild Wars 2 · Guild Intelligence · Late Edition</span>
          <span className="ln" />
        </div>
      </header>

      {doc.turns.map((turn, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <div className="sv-rip">
              <span className="t" />
              <span>Next Dispatch</span>
              <span className="t" />
            </div>
          )}
          <ArticleView turn={turn} kicker={kicker} />
        </Fragment>
      ))}

      <footer className="sv-foot">
        <div className="ast">⁂</div>
        <div className="line">Filed from the AxiVale newsroom · Published via GitHub Pages</div>
        <div className="brand">
          Shared from {doc.app.name} · v{doc.app.version}
        </div>
      </footer>
    </div>
  )
}
