// src/main/meta/fetcher.ts
//
// Fetch engine. SPA sources load in a hidden Electron BrowserWindow (real
// Chromium UA/TLS/cookies + JS execution defeats both client-rendering and
// most bot-blocking); MediaWiki sources hit api.php directly. The wiki path is
// a pure module function (testable with mocked fetch); the BrowserWindow
// adapter is a thin wrapper verified by the manual smoke test.
import { BrowserWindow } from 'electron'
import { configForUrl, type SourceConfig } from './sources'

export type FetchResult = { ok: true; text: string } | { ok: false; error: string }

export interface MetaFetcher {
  fetch(url: string): Promise<FetchResult>
}

const FETCH_TIMEOUT_MS = 20_000

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

/** Real-Chromium fetcher. Not unit-tested (needs Electron); covered by smoke test. */
export class BrowserWindowFetcher implements MetaFetcher {
  private win: BrowserWindow | null = null
  private chain: Promise<unknown> = Promise.resolve()

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
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

    const win = this.window()
    const selector = cfg.selector ?? 'body'
    try {
      const load = win.loadURL(url)
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)
      )
      await Promise.race([load, timeout])
      const text = (await win.webContents.executeJavaScript(
        `(document.querySelector(${JSON.stringify(selector)})||document.body).innerText`
      )) as string
      const trimmed = (text ?? '').trim()
      return trimmed ? { ok: true, text: trimmed } : { ok: false, error: 'empty' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'browser: failed' }
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
