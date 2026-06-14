// src/main/meta/fetcher.ts
//
// Fetch engine. SPA sources load in a hidden Electron BrowserWindow (real
// Chromium UA/TLS/cookies + JS execution defeats both client-rendering and
// most bot-blocking); MediaWiki sources hit api.php directly. The wiki path is
// a pure module function (testable with mocked fetch); the BrowserWindow
// adapter is a thin wrapper verified by the manual smoke test.
// Browser sources with a linkSelector do a depth-1 crawl: follow build-page
// links off the landing page and concatenate their content.
import { BrowserWindow, session } from 'electron'
import { configForUrl, type SourceConfig } from './sources'

export type FetchResult = { ok: true; text: string } | { ok: false; error: string }

export interface MetaFetcher {
  fetch(url: string): Promise<FetchResult>
}

const FETCH_TIMEOUT_MS = 20_000
const CONTENT_WAIT_MS = 12_000 // max in-page wait for SPA content to render
const MIN_CONTENT_CHARS = 400 // consider the page "rendered" past this much text
const MAX_EXTRACT_CHARS = 8_000 // cap the excerpt handed to the distiller
const MAX_CRAWL_PAGES = 6 // depth-1: build pages to follow from a landing page
const CRAWL_BUDGET_MS = 60_000 // stop following more build pages once a source exceeds this
const LANDING_CHARS = 3_000 // keep a slice of the index/landing overview
const MAX_CRAWL_TOTAL_CHARS = 16_000 // cap the combined landing+build-pages excerpt

// Meta sites embed ad/tracker/image subresources that don't affect innerText
// and spam the console (ERR_CONNECTION_REFUSED behind ad-blockers). Run the
// scrape window in an isolated in-memory session and drop those resource types.
const SCRAPE_PARTITION = 'meta-scrape'
const BLOCKED_TYPES = new Set(['image', 'media', 'font', 'object', 'ping', 'cspReport', 'subFrame'])

export async function fetchWiki(url: string, cfg: SourceConfig): Promise<FetchResult> {
  let title: string
  try {
    title = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ''))
  } catch {
    return { ok: false, error: 'bad url' }
  }
  const api = `${cfg.wikiApi}?action=parse&prop=wikitext&format=json&formatversion=2&page=${encodeURIComponent(title)}`
  try {
    const res = await fetch(api, { headers: { 'User-Agent': 'AxiVale' } })
    if (!res.ok) return { ok: false, error: `wiki ${res.status}` }
    const data = (await res.json()) as { parse?: { wikitext?: string } }
    const text = data?.parse?.wikitext
    if (!text) return { ok: false, error: 'wiki: no content' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'wiki: network' }
  }
}

/** From raw hrefs found on a landing page, pick distinct build-page URLs to crawl:
 *  drop the landing page itself, skip namespaced wiki paths (a ':' in the path),
 *  dedupe by origin+pathname, and cap the count. Pure + unit-tested. */
export function pickCrawlLinks(hrefs: string[], landingUrl: string, max: number): string[] {
  const norm = (u: URL): string => (u.origin + u.pathname).replace(/\/$/, '')
  let landing = ''
  let landingOrigin = ''
  try {
    const lu = new URL(landingUrl)
    landing = norm(lu)
    landingOrigin = lu.origin
  } catch {
    /* leave landing empty */
  }
  const seen = new Set<string>(landing ? [landing] : [])
  const out: string[] = []
  for (const h of hrefs) {
    let u: URL
    try {
      u = new URL(h)
    } catch {
      continue
    }
    if (landingOrigin && u.origin !== landingOrigin) continue
    if (u.pathname.includes(':')) continue
    const key = norm(u)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u.origin + u.pathname)
    if (out.length >= max) break
  }
  return out
}

/** Real-Chromium fetcher. Not unit-tested (needs Electron); covered by smoke test. */
export class BrowserWindowFetcher implements MetaFetcher {
  private win: BrowserWindow | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private filtered = false

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const ses = session.fromPartition(SCRAPE_PARTITION)
    if (!this.filtered) {
      ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) =>
        cb({ cancel: BLOCKED_TYPES.has(details.resourceType) })
      )
      this.filtered = true
    }
    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        partition: SCRAPE_PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    return this.win
  }

  /** Serialize all fetches through the single window. */
  fetch(url: string): Promise<FetchResult> {
    const run = this.chain.then(() => this.fetchOne(url))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async fetchOne(url: string): Promise<FetchResult> {
    const cfg = configForUrl(url)
    if (!cfg) return { ok: false, error: 'no extractor' }
    if (cfg.kind === 'wiki') return fetchWiki(url, cfg)

    const selector = cfg.selector ?? 'body'
    try {
      const landing = await this.loadAndExtract(url, selector)
      if (!cfg.linkSelector) {
        const t = landing.slice(0, MAX_EXTRACT_CHARS)
        return t ? { ok: true, text: t } : { ok: false, error: 'empty' }
      }
      // depth-1 crawl: gather build-page links (while still on the landing page)
      // and extract each, concatenating onto a slice of the landing overview.
      const hrefs = await this.collectLinks(cfg.linkSelector)
      const links = pickCrawlLinks(hrefs, url, MAX_CRAWL_PAGES)
      const parts = [landing.slice(0, LANDING_CHARS)]
      const crawlStart = Date.now()
      for (const link of links) {
        if (Date.now() - crawlStart > CRAWL_BUDGET_MS) break
        try {
          parts.push(await this.loadAndExtract(link, selector))
        } catch {
          /* skip a bad sub-page; keep what we have */
        }
      }
      const text = parts.join('\n\n=== build page ===\n\n').trim().slice(0, MAX_CRAWL_TOTAL_CHARS)
      return text ? { ok: true, text } : { ok: false, error: 'empty' }
    } catch (e) {
      try {
        if (this.win && !this.win.isDestroyed()) this.win.webContents.stop()
      } catch {
        /* ignore */
      }
      return { ok: false, error: e instanceof Error ? e.message : 'browser: failed' }
    }
  }

  /** Load a URL, wait in-page for content to render, return trimmed innerText. Throws on load timeout. */
  private async loadAndExtract(url: string, selector: string): Promise<string> {
    const win = this.window()
    const load = win.loadURL(url)
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)
    )
    await Promise.race([load, timeout])
    const script = `new Promise((resolve) => {
      const sel = ${JSON.stringify(selector)};
      const start = Date.now();
      const tick = () => {
        const el = document.querySelector(sel) || document.body;
        const txt = el && el.innerText ? el.innerText : '';
        if (txt.length >= ${MIN_CONTENT_CHARS} || Date.now() - start > ${CONTENT_WAIT_MS}) resolve(txt);
        else setTimeout(tick, 500);
      };
      tick();
    })`
    const text = (await win.webContents.executeJavaScript(script)) as string
    return (text ?? '').trim()
  }

  /** Collect candidate build-page hrefs from the currently-loaded landing page. */
  private async collectLinks(linkSelector: string): Promise<string[]> {
    const win = this.window()
    const script = `Array.from(document.querySelectorAll(${JSON.stringify(linkSelector)})).map((a) => a.href).filter(Boolean)`
    try {
      return (await win.webContents.executeJavaScript(script)) as string[]
    } catch {
      return []
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
