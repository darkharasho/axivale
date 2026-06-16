//
// The single source of truth for which retrieval corpus a fetched page belongs
// to. Used by the refresher to route each crawled page's chunks into meta_chunks,
// wiki_chunks, or general_chunks. Path-based so one host can split builds vs guides.

export type Corpus = 'meta' | 'wiki' | 'general'

export function corpusForUrl(url: string): Corpus {
  let host: string
  let path: string
  try {
    const u = new URL(url)
    host = u.host.replace(/^www\./, '')
    path = u.pathname
  } catch {
    return 'meta'
  }
  if (host === 'wiki.guildwars2.com') return 'wiki'
  if (host === 'discretize.eu' || host.endsWith('.discretize.eu')) return 'general'
  if (/\/guides?\//.test(path)) return 'general'
  return 'meta'
}
