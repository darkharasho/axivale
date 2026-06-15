// src/main/meta/fetcher.ts
//
// Fetch engine. SPA sources load in a hidden Electron BrowserWindow (real
// Chromium UA/TLS/cookies + JS execution defeats both client-rendering and
// most bot-blocking); MediaWiki sources hit api.php directly. The wiki path is
// a pure module function (testable with mocked fetch); the BrowserWindow
// adapter is a thin wrapper verified by the manual smoke test.
// Browser sources with a linkSelector do a depth-aware breadth-first crawl:
// follow links off the landing page down to the source's crawlDepth, with hard
// page/time caps, and concatenate the visited pages' content.
import { BrowserWindow, session } from 'electron'
import { configForUrl, type SourceConfig } from './sources'
import { fetchSnowcrowsStatic } from './snowcrows'

export interface FetchedPage {
  url: string
  title: string
  text: string
}
export type FetchResult =
  | { ok: true; text: string; pages: FetchedPage[] }
  | { ok: false; error: string }

export interface MetaFetcher {
  fetch(url: string): Promise<FetchResult>
}

const FETCH_TIMEOUT_MS = 20_000
const CONTENT_WAIT_MS = 12_000 // max in-page wait for SPA content to render
const MIN_CONTENT_CHARS = 400 // consider the page "rendered" past this much text
const MAX_EXTRACT_CHARS = 8_000 // cap the excerpt handed to the distiller
const MAX_CRAWL_PAGES = 30 // total pages to visit per source across all crawl levels
const CRAWL_BUDGET_MS = 120_000 // per-source wall-clock cap on the whole crawl
const MAX_CRAWL_TOTAL_CHARS = 16_000 // cap the combined landing+build-pages excerpt

// Meta sites embed ad/tracker/image subresources that don't affect innerText
// and spam the console (ERR_CONNECTION_REFUSED behind ad-blockers). Run the
// scrape window in an isolated in-memory session and drop those resource types.
const SCRAPE_PARTITION = 'persist:meta-scrape'
const BLOCKED_TYPES = new Set(['image', 'media', 'font', 'object', 'ping', 'cspReport'])

const SCRAPE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const CRAWL_PAGE_DELAY_MS = 400 // ease rate-based challenges between page loads

/** Heuristic: does this look like a Cloudflare (or similar) bot-challenge interstitial
 *  rather than real content? Used to avoid indexing challenge boilerplate. */
export function isChallengePage(title: string, text: string): boolean {
  const hay = `${title}\n${text}`.toLowerCase()
  return (
    hay.includes('just a moment') ||
    hay.includes('checking your browser') ||
    hay.includes('verifying you are human') ||
    hay.includes('enable javascript and cookies to continue') ||
    hay.includes('attention required') ||
    hay.includes('cf-browser-verification') ||
    hay.includes('performance & security by cloudflare') ||
    (hay.includes('cloudflare') && hay.includes('ray id'))
  )
}

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
    return { ok: true, text, pages: [{ url, title, text }] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'wiki: network' }
  }
}

/** MediaWiki meta/admin namespaces to skip when crawling (NOT content like Build:). */
const WIKI_NS_SKIP =
  /\/(Category|Template|File|Help|Special|Talk|User|MediaWiki|Property|Form|Module|Project)(_talk)?:/i

/** Canonical key for a URL (origin + pathname, no query/hash, no trailing slash). null if malformed. */
export function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u)
    return (url.origin + url.pathname).replace(/\/$/, '')
  } catch {
    return null
  }
}

/** From raw hrefs found on a landing page, pick distinct build-page URLs to crawl:
 *  drop the landing page itself, skip namespaced wiki paths (a ':' in the path),
 *  dedupe by origin+pathname, and cap the count. Pure + unit-tested. */
export function pickCrawlLinks(hrefs: string[], landingUrl: string, max: number): string[] {
  const landingKey = normalizeUrl(landingUrl)
  let landingOrigin = ''
  try {
    landingOrigin = new URL(landingUrl).origin
  } catch {
    /* leave empty */
  }
  const seen = new Set<string>(landingKey ? [landingKey] : [])
  const out: string[] = []
  for (const h of hrefs) {
    let u: URL
    try {
      u = new URL(h)
    } catch {
      continue
    }
    if (landingOrigin && u.origin !== landingOrigin) continue
    // Skip MediaWiki meta-namespaces (Category:, Template:, etc.) but KEEP content
    // namespaces like Build: — MetaBattle's actual build pages live at /wiki/Build:<name>.
    if (WIKI_NS_SKIP.test(u.pathname)) continue
    const key = (u.origin + u.pathname).replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
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
    this.win.webContents.setUserAgent(SCRAPE_UA)
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
    if (cfg.kind === 'static') return fetchSnowcrowsStatic(url, { crawlDepth: cfg.crawlDepth })

    const selector = cfg.selector ?? 'body'
    const depth = cfg.linkSelector ? (cfg.crawlDepth ?? 1) : 0
    try {
      const pages: FetchedPage[] = []
      const visited = new Set<string>()
      const queue: Array<{ url: string; level: number }> = [{ url, level: 0 }]
      const crawlStart = Date.now()
      let challenged = 0
      let loadErrors = 0

      while (queue.length > 0) {
        if (pages.length >= MAX_CRAWL_PAGES || Date.now() - crawlStart > CRAWL_BUDGET_MS) break
        const { url: pageUrl, level } = queue.shift()!
        const key = normalizeUrl(pageUrl)
        if (key === null || visited.has(key)) continue
        visited.add(key)

        let extracted: { title: string; text: string } | null
        try {
          extracted = await this.loadChecked(pageUrl, selector)
        } catch {
          loadErrors++
          continue // skip a bad page; keep walking
        }
        if (extracted === null) {
          challenged++
          continue // challenged — skip, keep walking
        }
        if (extracted.text) {
          pages.push({ url: pageUrl, title: extracted.title, text: extracted.text.slice(0, MAX_EXTRACT_CHARS) })
        }

        // Expand links if we haven't hit the depth limit. collectLinks runs on the
        // page we just loaded (pageUrl), so we read its links before navigating away.
        if (level < depth && cfg.linkSelector) {
          const hrefs = await this.collectLinks(cfg.linkSelector)
          for (const link of pickCrawlLinks(hrefs, pageUrl, MAX_CRAWL_PAGES)) {
            const k = normalizeUrl(link)
            if (k !== null && !visited.has(k)) queue.push({ url: link, level: level + 1 })
          }
        }
        await sleep(CRAWL_PAGE_DELAY_MS)
      }

      if (pages.length === 0) {
        // Be specific so the refresh log says WHY a source yielded nothing.
        const reason =
          challenged > 0
            ? `blocked by challenge on ${challenged}/${visited.size} page(s) (selector "${selector}")`
            : loadErrors >= visited.size
              ? `all ${visited.size} page load(s) failed`
              : `no content matched selector "${selector}" across ${visited.size} page(s)`
        return { ok: false, error: reason }
      }
      const text = pages.map((p) => p.text).join('\n\n=== build page ===\n\n').slice(0, MAX_CRAWL_TOTAL_CHARS)
      return { ok: true, text, pages }
    } catch (e) {
      try {
        if (this.win && !this.win.isDestroyed()) this.win.webContents.stop()
      } catch {
        /* ignore */
      }
      return { ok: false, error: e instanceof Error ? e.message : 'browser: failed' }
    }
  }

  /** loadAndExtract + challenge handling: retries once on a Cloudflare interstitial,
   *  returns null if the page is still challenged (caller skips it). */
  private async loadChecked(url: string, selector: string): Promise<{ title: string; text: string } | null> {
    let out = await this.loadAndExtract(url, selector)
    if (isChallengePage(out.title, out.text)) {
      await sleep(3_000)
      out = await this.loadAndExtract(url, selector)
      if (isChallengePage(out.title, out.text)) return null
    }
    return out
  }

  /**
   * Load a URL, wait in-page for content to render, return its title + trimmed
   * innerText PLUS a deduped "[components]" list harvested from icon/link
   * metadata. Many build sites render skills/traits/sigils as bare icons with no
   * visible text — innerText misses those entirely — but the names usually live
   * in `img[alt]`, `[title]`/`[aria-label]`, or the wiki-link href path. Harvesting
   * those recovers component names that pure innerText drops. Throws on load timeout.
   */
  private async loadAndExtract(url: string, selector: string): Promise<{ title: string; text: string }> {
    const win = this.window()
    const load = win.loadURL(url)
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)
    )
    await Promise.race([load, timeout])
    const script = `new Promise((resolve) => {
      const sel = ${JSON.stringify(selector)};
      const start = Date.now();
      const harvest = (root) => {
        const labels = new Set();
        const add = (s) => { if (s == null) return; const t = String(s).trim(); if (t.length >= 2 && t.length <= 80) labels.add(t); };
        root.querySelectorAll('img[alt]').forEach((n) => add(n.getAttribute('alt')));
        root.querySelectorAll('[title]').forEach((n) => add(n.getAttribute('title')));
        root.querySelectorAll('[aria-label]').forEach((n) => add(n.getAttribute('aria-label')));
        root.querySelectorAll('a[href]').forEach((n) => {
          try {
            const seg = new URL(n.href).pathname.split('/').filter(Boolean).pop() || '';
            const name = decodeURIComponent(seg).replace(/[_-]+/g, ' ').trim();
            if (name && !/^[0-9]+$/.test(name) && /[a-zA-Z]/.test(name)) add(name);
          } catch (e) { /* skip a bad href */ }
        });
        return Array.from(labels);
      };
      const tick = () => {
        const el = document.querySelector(sel);
        const txt = el && el.innerText ? el.innerText : '';
        if (txt.length >= ${MIN_CONTENT_CHARS}) {
          const labels = harvest(el);
          const extra = labels.length ? '\\n\\n[components] ' + labels.join(' · ') : '';
          resolve({ title: document.title || '', text: txt + extra });
        } else if (Date.now() - start > ${CONTENT_WAIT_MS}) {
          // Selector never rendered enough content (list/cookie/filter page) — yield nothing.
          resolve({ title: document.title || '', text: '' });
        } else setTimeout(tick, 500);
      };
      tick();
    })`
    const out = (await win.webContents.executeJavaScript(script)) as { title: string; text: string }
    return { title: (out?.title ?? '').trim(), text: (out?.text ?? '').trim() }
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
