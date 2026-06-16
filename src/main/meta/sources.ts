// src/main/meta/sources.ts
//
// The ONLY place site-specific scrape knowledge lives. Per known host: how to
// fetch (real browser vs MediaWiki API) and, for browser sources, which DOM
// node holds the content. A source URL with no config is skipped (not errored).

export interface SourceConfig {
  /** host suffix matched against the source URL's host (www. stripped) */
  host: string
  kind: 'browser' | 'wiki' | 'static'
  /** required for kind==='browser': element whose innerText we extract */
  selector?: string
  /** required for kind==='wiki': MediaWiki api.php base; page title is parsed from the URL */
  wikiApi?: string
  // depth-1: CSS selector for build-page links on the landing page
  linkSelector?: string
  // depth-1: follow links N levels deep from the landing page (default 1)
  crawlDepth?: number
  /** What this source contributes to distillation. Default 'builds'. */
  content?: 'builds' | 'rules'
}

export const SOURCE_CONFIGS: SourceConfig[] = [
  // Snowcrows: build data is API-loaded (fails headless) — extracted statically
  // via the GW2-Armory data attributes in the server HTML (see meta/snowcrows.ts).
  { host: 'snowcrows.com', kind: 'static', crawlDepth: 2 },
  { host: 'hardstuck.gg', kind: 'browser', selector: 'section.gw2-build-page', linkSelector: 'main a[href*="/gw2/builds/"]', crawlDepth: 2 },
  { host: 'guildjen.com', kind: 'browser', selector: '.entry-content', linkSelector: 'a[href*="-build"]', crawlDepth: 2 },
  { host: 'gw2mists.com', kind: 'browser', selector: '.gm-build-detail-page', linkSelector: 'a[href*="/builds/"]', crawlDepth: 2 },
  { host: 'metabattle.com', kind: 'browser', selector: '#mw-content-text', linkSelector: '#mw-content-text a[href*="/wiki/"]' },
  // Discretize [dT] — fractal/CM, mechanics, and profession guides (general corpus).
  { host: 'discretize.eu', kind: 'browser', selector: 'main, article', linkSelector: 'a[href*="/fractals/"], a[href*="/guides/"]', crawlDepth: 2 },
  // --- WvW comp knowledge (Layer 3 mechanics + Layer 1 rules) ---
  { host: 'wiki.guildwars2.com', kind: 'wiki', wikiApi: 'https://wiki.guildwars2.com/api.php', content: 'rules' },
  { host: 'guildorder.com', kind: 'browser', selector: 'article, main', content: 'rules' }
]

export function resolveContent(url: string): 'builds' | 'rules' {
  const cfg = configForUrl(url)
  if (!cfg) return 'builds'
  if (cfg.content) return cfg.content
  // snowcrows.com's single host config covers builds; its /guides/* pages are
  // rules — expressed here by path since one host config can't split by path.
  if (/snowcrows\.com\/guides\//.test(url)) return 'rules'
  return 'builds'
}

export function configForUrl(url: string): SourceConfig | null {
  let host: string
  let path: string
  try {
    const u = new URL(url)
    host = u.host.replace(/^www\./, '')
    path = u.pathname
  } catch {
    return null
  }
  // snowcrows news landings crawl into the newest article (tier lists rotate dates)
  if (host === 'snowcrows.com' && path.startsWith('/news/')) {
    return {
      host: 'snowcrows.com',
      kind: 'browser',
      selector: 'main',
      linkSelector: 'a[href*="/news/wvw/"]',
      crawlDepth: 1,
      content: 'builds'
    }
  }
  return SOURCE_CONFIGS.find((c) => host === c.host || host.endsWith(`.${c.host}`)) ?? null
}
