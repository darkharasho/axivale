// src/main/meta/wiki/ingest.ts
//
// Ingest the curated GW2-wiki reference pages into the wiki_chunks corpus: batch-fetch
// wikitext, strip markup, content-hash gate, chunk (reused), and upsert. Error-isolated
// per page; a missing page is skipped. Runs in the background.
import { stripWikiMarkup } from '@axiapps/gw2-data'
import { cleanWikiText } from './cleanText'
import { chunkPage, sha1 } from '../rag/chunk'
import type { MetaIndex } from '../rag/index'
import type { LearnProgress } from '../progress'
import { WIKI_REF_PAGES, type WikiRefPage } from './refPages'

export interface WikiClientLike {
  getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
}
export interface WikiRefIngesterDeps {
  wiki: WikiClientLike
  index: MetaIndex
  pages?: WikiRefPage[]
  /** Reports ingest progress to the shared learning banner (one phase: 'wiki'). */
  emit?: (e: LearnProgress) => void
}

export function wikiPageUrl(title: string): string {
  return 'https://wiki.guildwars2.com/wiki/' + title.replace(/ /g, '_')
}

export class WikiRefIngester {
  constructor(private readonly deps: WikiRefIngesterDeps) {}

  async ingest(): Promise<void> {
    const pages = this.deps.pages ?? WIKI_REF_PAGES
    const { wiki, index } = this.deps
    const emit = this.deps.emit ?? ((): void => {})
    if (pages.length === 0) return
    // One bar for the whole ingest; it advances per page (indexed, skipped, or
    // failed) so the banner fills steadily even when most pages are hash-gated.
    emit({ phase: 'wiki', kind: 'start', total: pages.length, label: 'Reading the GW2 wiki…' })
    try {
      for (let i = 0; i < pages.length; i += 50) {
        const batch = pages.slice(i, i + 50)
        let texts: Map<string, string | null>
        try {
          texts = await wiki.getWikitextBatch(batch.map((p) => p.title))
        } catch {
          for (let n = 0; n < batch.length; n++) emit({ phase: 'wiki', kind: 'advance' })
          continue // whole batch failed — skip it, keep going
        }
        for (const p of batch) {
          try {
            const raw = texts.get(p.title)
            if (!raw) continue
            const text = cleanWikiText(stripWikiMarkup(raw))
            if (!text || text.trim().length < 50) continue
            const url = wikiPageUrl(p.title)
            if ((await index.indexedHash(url)) === sha1(text)) continue
            const chunks = chunkPage(text, {
              mode: p.category,
              source: 'wiki.guildwars2.com',
              url,
              title: p.title
            })
            if (chunks.length > 0) await index.replacePage(url, chunks)
          } catch {
            /* one page failed — isolate and continue */
          } finally {
            emit({ phase: 'wiki', kind: 'advance' })
          }
        }
      }
    } finally {
      emit({ phase: 'wiki', kind: 'done' })
    }
  }
}
