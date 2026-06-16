//
// Query-time fallback for wiki_search: when the pre-ingested index has no good
// hit, search the live GW2 wiki (MediaWiki list=search), fetch the top pages'
// wikitext, and return cleaned snippets. Covers the long tail (legendaries,
// achievements, obscure pages) without pre-ingesting 100k+ pages.
import { stripWikiMarkup } from '@axiapps/gw2-data'
import { cleanWikiText } from './cleanText'
import { wikiPageUrl } from './ingest'

const API = 'https://wiki.guildwars2.com/api.php'

export interface LiveWikiDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchJson: (url: string) => Promise<any>
  getWikitext: (title: string) => Promise<string | null>
}

export async function liveWikiSearch(
  query: string,
  deps: LiveWikiDeps,
  opts: { limit?: number } = {}
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const limit = opts.limit ?? 3
  const searchUrl =
    `${API}?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`
  let titles: string[]
  try {
    const json = await deps.fetchJson(searchUrl)
    titles = (json?.query?.search ?? []).map((s: { title: string }) => s.title)
  } catch {
    return []
  }
  const out: Array<{ title: string; url: string; snippet: string }> = []
  for (const title of titles) {
    try {
      const raw = await deps.getWikitext(title)
      if (!raw) continue
      const text = cleanWikiText(stripWikiMarkup(raw))
      if (!text || text.trim().length < 50) continue
      out.push({ title, url: wikiPageUrl(title), snippet: text.slice(0, 600) })
    } catch {
      /* one page failing never breaks the fallback */
    }
  }
  return out
}
