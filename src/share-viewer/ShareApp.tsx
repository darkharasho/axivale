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
import { rehypeClassIcons } from '../renderer/src/components/rehypeClassIcons'
import { rehypeEntityLinks } from '../renderer/src/components/rehypeEntityLinks'
import { renderExtLink } from '../renderer/src/components/emojiIcons'
import { renderRichSpan } from '../renderer/src/components/richSpan'
import { splitHeadline } from '../renderer/src/components/headline'
import { stripRawJson } from '../renderer/src/components/sanitizeProse'
import { couponLabel } from '../renderer/src/components/ToolCoupon'
import RichDisplay from '../renderer/src/components/rich/RichDisplay'
import type { ShareDoc, SharedTurn, ShareEntity } from './shareTypes'

/** Roman numeral; 0 has none, so keep it literal. */
function toRoman(n: number): string {
  if (n <= 0) return '0'
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ]
  let out = ''
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v)
  return out
}

/** Cheeky folio from the share's app version — mirrors the app masthead.
 *  Duplicated from renderer/components/Masthead.tsx (viewer stays standalone). */
function versionFolio(version: string): string {
  const p = version.split('.')
  const maj = parseInt(p[0] ?? '', 10) || 0
  const min = parseInt(p[1] ?? '', 10) || 0
  const pat = parseInt(p[2] ?? '', 10) || 0
  return `Vol. ${toRoman(maj)} · No. ${min} · Ed. ${pat}`
}

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

function ArticleView({
  turn,
  kicker,
  entities
}: {
  turn: SharedTurn
  kicker: string
  entities: ShareEntity[]
}): ReactElement {
  // Resolve [[skill|trait|item:Name]] markers using the dictionary baked into the
  // share doc at publish time — the viewer has no Electron/API to resolve them live.
  const entityPlugin: [typeof rehypeEntityLinks, { dictionary: { entries: ShareEntity[] } }] = [
    rehypeEntityLinks,
    { dictionary: { entries: entities } }
  ]
  const { headline, rest: rawRest } = splitHeadline(turn.agentText)
  const rest = stripRawJson(rawRest)
  // Unlike the main app (where excluded tables fall back to the Actions panel),
  // the standalone viewer has no such panel — so tables must render here or they
  // vanish entirely. Include every display kind RichDisplay can draw.
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
      <h2 className="sv-headline">
        {/* Headline is display type: render inline markdown so links (and emoji)
            resolve like the body, but unwrap block/emphasis so it stays a clean
            single line — no bold/heading styling, no literal [text](url) syntax.
            Mirrors the app's Article.tsx lede. */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeEmojiIcons, rehypeClassIcons, entityPlugin]}
          disallowedElements={['em', 'strong', 'code', 'del', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']}
          unwrapDisallowed
          components={{ p: ({ children }) => <>{children}</>, span: renderRichSpan, a: renderExtLink }}
        >
          {headline}
        </ReactMarkdown>
      </h2>
      <div className="sv-byline">
        By <b>AxiVale</b> · Filed {turn.filedAt}
        {actions > 0 && <> · {actions} action{actions === 1 ? '' : 's'} taken</>}
      </div>
      <div className="prose sv-prose">
        {segments.map((seg, i) => (
          <Fragment key={i}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeEmojiIcons, rehypeClassIcons, entityPlugin]}
              components={{ span: renderRichSpan, a: renderExtLink }}
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
          <span className="smh-top-mid">{versionFolio(doc.app.version)}</span>
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
          <ArticleView turn={turn} kicker={kicker} entities={doc.entities ?? []} />
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
