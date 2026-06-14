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
}

export const SOURCE_CONFIGS: SourceConfig[] = [
  // Snowcrows: build data is API-loaded (fails headless) — extracted statically
  // via the GW2-Armory data attributes in the server HTML (see meta/snowcrows.ts).
  { host: 'snowcrows.com', kind: 'static', crawlDepth: 2 },
  { host: 'hardstuck.gg', kind: 'browser', selector: 'section.gw2-build-page', linkSelector: 'main a[href*="/gw2/builds/"]', crawlDepth: 2 },
  { host: 'guildjen.com', kind: 'browser', selector: '.entry-content', linkSelector: 'a[href*="-build"]', crawlDepth: 2 },
  { host: 'gw2mists.com', kind: 'browser', selector: '.gm-build-detail-page', linkSelector: 'a[href*="/builds/"]', crawlDepth: 2 },
  { host: 'metabattle.com', kind: 'browser', selector: '#mw-content-text', linkSelector: '#mw-content-text a[href*="/wiki/"]' }
]

export function configForUrl(url: string): SourceConfig | null {
  let host: string
  try {
    host = new URL(url).host.replace(/^www\./, '')
  } catch {
    return null
  }
  return SOURCE_CONFIGS.find((c) => host === c.host || host.endsWith(`.${c.host}`)) ?? null
}
