// src/main/meta/sources.ts
//
// The ONLY place site-specific scrape knowledge lives. Per known host: how to
// fetch (real browser vs MediaWiki API) and, for browser sources, which DOM
// node holds the content. A source URL with no config is skipped (not errored).

export interface SourceConfig {
  /** host suffix matched against the source URL's host (www. stripped) */
  host: string
  kind: 'browser' | 'wiki'
  /** required for kind==='browser': element whose innerText we extract */
  selector?: string
  /** required for kind==='wiki': MediaWiki api.php base; page title is parsed from the URL */
  wikiApi?: string
}

export const SOURCE_CONFIGS: SourceConfig[] = [
  { host: 'snowcrows.com', kind: 'browser', selector: 'main' },
  { host: 'hardstuck.gg', kind: 'browser', selector: 'main' },
  { host: 'guildjen.com', kind: 'browser', selector: 'main' },
  { host: 'gw2mists.com', kind: 'browser', selector: 'body' },
  { host: 'metabattle.com', kind: 'wiki', wikiApi: 'https://metabattle.com/api.php' }
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
