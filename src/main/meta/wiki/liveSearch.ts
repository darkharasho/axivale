// src/main/meta/wiki/liveSearch.ts
//
// Query-time fallback for wiki_search: when the pre-ingested index has no strong
// hit, search the live GW2 wiki (MediaWiki list=search), fetch the top pages'
// RENDERED HTML (action=parse), and return cleaned snippets. Rendered HTML is
// essential here: collection / precursor-crafting / recipe / achievement pages
// build their per-tier task tables from MediaWiki templates that only exist
// after the page is rendered — raw wikitext strips to template noise and loses
// exactly the data these queries ask for. Covers the long tail (legendaries,
// achievements, recipes) without pre-ingesting 100k+ pages.
import { wikiPageUrl } from './ingest'

const API = 'https://wiki.guildwars2.com/api.php'

export interface LiveWikiDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchJson: (url: string) => Promise<any>
  /** Cleaned, rendered page text for a title (see cleanWikiHtml), or null. */
  getPageText: (title: string) => Promise<string | null>
}

// MediaWiki's full-text search ranks on keywords, not natural language — a
// conversational query ("how do I make the precursor Dusk") buries the specific
// page under generic overviews, while the keyword core ("precursor dusk") surfaces
// the exact collection pages. Strip question/filler words so the search lands.
const FILLER = new Set(
  ('how do i to the a an my of for what which is are can could would get getting make making craft' +
    ' crafting unlock obtain need want help me with this that you and in on at best does it work')
    .split(' ')
)

/** Reduce a natural-language query to its keyword core for MediaWiki search.
 *  Falls back to the original when stripping would leave too little to match. */
export function searchTerms(query: string): string {
  const core = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(' ')
    .trim()
  return core.length >= 3 ? core : query
}

/** Strip MediaWiki's rendered HTML to readable text, preserving table/list rows
 *  (newlines) so collection-item and materials tables stay legible. */
export function cleanWikiHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<span class="mw-editsection"[\s\S]*?<\/span>/gi, ' ')
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, ' ')
    // structural tags → newlines so rows/list items stay on their own lines
    .replace(/<(li|tr|p|h[1-6]|div|dt|dd)\b[^>]*>/gi, '\n')
    .replace(/<\/(li|tr|p|h[1-6]|div|dt|dd)>/gi, '\n')
    .replace(/<td\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[edit\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export async function liveWikiSearch(
  query: string,
  deps: LiveWikiDeps,
  opts: { limit?: number; chars?: number } = {}
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  // Fetch a few candidates: the specific collection/recipe page is often ranked
  // below a generic overview, so a too-small limit misses it entirely.
  const limit = opts.limit ?? 5
  // Collection/recipe tables run long; give the model enough of the page to see
  // a full tier's task list rather than truncating mid-table.
  const chars = opts.chars ?? 2800
  const searchUrl =
    `${API}?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(searchTerms(query))}`
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
      const text = await deps.getPageText(title)
      if (!text || text.trim().length < 50) continue
      out.push({ title, url: wikiPageUrl(title), snippet: text.slice(0, chars) })
    } catch {
      /* one page failing never breaks the fallback */
    }
  }
  return out
}
