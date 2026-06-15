// src/main/meta/wiki/ingest.ts
//
// Ingest the GW2-wiki reference corpus into wiki_chunks: the curated registry pages
// (concepts + aggregate "List of …" pages) AND, when a category fetcher is wired,
// the individual skill/trait pages (compressed). Batch-fetch wikitext, clean or
// compress, content-hash gate, chunk (reused), and upsert. Error-isolated per page;
// the per-page crawl is budgeted per run + content-hash gated, so it fills
// incrementally across launches rather than blocking on one huge ingest.
import { stripWikiMarkup } from '@axiapps/gw2-data'
import { cleanWikiText } from './cleanText'
import { compressWikiPage } from './skillCrawl'
import { chunkPage, sha1 } from '../rag/chunk'
import type { MetaIndex } from '../rag/index'
import type { LearnProgress } from '../progress'
import { WIKI_REF_PAGES, PROFESSIONS, type WikiRefPage } from './refPages'

export interface WikiClientLike {
  getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
}
export interface WikiRefIngesterDeps {
  wiki: WikiClientLike
  index: MetaIndex
  pages?: WikiRefPage[]
  /** Reports ingest progress to the shared learning banner (one phase: 'wiki'). */
  emit?: (e: LearnProgress) => void
  /** Enumerate a wiki category's page titles. When set, the per-page crawl runs. */
  categoryMembers?: (category: string) => Promise<string[]>
  /** Max NEW per-page crawl pages to ingest per run (incremental fill). */
  crawlBudget?: number
  /** Wiki categories to crawl page-by-page; defaults to skills/traits + upgrades. */
  crawlTargets?: CrawlTarget[]
}

/** A wiki category to enumerate, tagged with the corpus category to store under. */
export interface CrawlTarget {
  category: string // e.g. "Elementalist skills" or "Runes" (no "Category:" prefix)
  label: string // corpus category, e.g. 'skills' | 'traits' | 'upgrades'
}

const DEFAULT_CRAWL_BUDGET = 1000

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// Default per-page crawl: every profession's skills + traits, plus the upgrade lists.
export const DEFAULT_CRAWL_TARGETS: CrawlTarget[] = [
  ...PROFESSIONS.map((p) => ({ category: `${cap(p)} skills`, label: 'skills' })),
  ...PROFESSIONS.map((p) => ({ category: `${cap(p)} traits`, label: 'traits' })),
  { category: 'Runes', label: 'upgrades' },
  { category: 'Sigils', label: 'upgrades' },
  { category: 'Relics', label: 'upgrades' }
]

interface WorkItem {
  title: string
  category: string
  url: string
  compress: boolean
}

export function wikiPageUrl(title: string): string {
  return 'https://wiki.guildwars2.com/wiki/' + title.replace(/ /g, '_')
}

export class WikiRefIngester {
  constructor(private readonly deps: WikiRefIngesterDeps) {}

  async ingest(): Promise<void> {
    const { wiki, index } = this.deps
    const emit = this.deps.emit ?? ((): void => {})

    const registry: WorkItem[] = (this.deps.pages ?? WIKI_REF_PAGES).map((p) => ({
      title: p.title,
      category: p.category,
      url: wikiPageUrl(p.title),
      compress: false
    }))
    const crawl = this.deps.categoryMembers ? await this.discoverCrawl() : []
    const work = [...registry, ...crawl]
    if (work.length === 0) return

    emit({ phase: 'wiki', kind: 'start', total: work.length, label: 'Reading the GW2 wiki…' })
    try {
      for (let i = 0; i < work.length; i += 50) {
        const batch = work.slice(i, i + 50)
        let texts: Map<string, string | null>
        try {
          texts = await wiki.getWikitextBatch(batch.map((w) => w.title))
        } catch {
          for (let n = 0; n < batch.length; n++) emit({ phase: 'wiki', kind: 'advance' })
          continue // whole batch failed — skip it, keep going
        }
        for (const w of batch) {
          try {
            const raw = texts.get(w.title)
            if (!raw) continue
            const text = w.compress ? compressWikiPage(raw, w.title) : cleanWikiText(stripWikiMarkup(raw))
            if (!text || text.trim().length < 50) continue
            if ((await index.indexedHash(w.url)) === sha1(text)) continue
            const chunks = chunkPage(text, {
              mode: w.category,
              source: 'wiki.guildwars2.com',
              url: w.url,
              title: w.title
            })
            if (chunks.length > 0) await index.replacePage(w.url, chunks)
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

  // Enumerate each crawl target's category members, drop the aggregate/category
  // entries, dedupe, skip pages already indexed (incremental), and cap to the budget.
  private async discoverCrawl(): Promise<WorkItem[]> {
    const members = this.deps.categoryMembers!
    const targets = this.deps.crawlTargets ?? DEFAULT_CRAWL_TARGETS
    const candidates: WorkItem[] = []
    const seen = new Set<string>()
    for (const target of targets) {
      let titles: string[]
      try {
        titles = await members(`Category:${target.category}`)
      } catch {
        continue // one category failing never breaks the crawl
      }
      for (const t of titles) {
        if (/^(List of|Category:)/i.test(t)) continue
        const url = wikiPageUrl(t)
        if (seen.has(url)) continue
        seen.add(url)
        candidates.push({ title: t, category: target.label, url, compress: true })
      }
    }
    const budget = this.deps.crawlBudget ?? DEFAULT_CRAWL_BUDGET
    const fresh: WorkItem[] = []
    for (const c of candidates) {
      if (fresh.length >= budget) break
      // Already indexed (any hash) → skip refetch so the budget fills NEW pages.
      if ((await this.deps.index.indexedHash(c.url)) != null) continue
      fresh.push(c)
    }
    return fresh
  }
}
