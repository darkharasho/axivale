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
  /** Optional cap on NEW per-page crawl pages per run. Unset = full coverage. */
  crawlBudget?: number
  /** Wiki categories to crawl page-by-page; defaults to skills/traits + upgrades. */
  crawlTargets?: CrawlTarget[]
  /** Abort the ingest cleanly mid-run (e.g. app quitting); resumes next launch. */
  signal?: AbortSignal
  /** Epoch ms of the last fully-completed ingest, or null if never. */
  lastRunAt?: () => number | null
  /** Record a fully-completed ingest's timestamp (epoch ms). */
  markRun?: (ts: number) => void
  /** Re-ingest only after this much time has passed since the last completed run. */
  staleMs?: number
  now?: () => number
}

const SEVEN_DAYS_MS = 7 * 86_400_000

/** A wiki category to enumerate, tagged with the corpus category to store under. */
export interface CrawlTarget {
  category: string // e.g. "Elementalist skills" or "Runes" (no "Category:" prefix)
  label: string // corpus category, e.g. 'skills' | 'traits' | 'upgrades'
}

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

  async ingest(opts: { force?: boolean } = {}): Promise<void> {
    const { wiki, index } = this.deps
    const emit = this.deps.emit ?? ((): void => {})
    const now = this.deps.now ?? Date.now
    const staleMs = this.deps.staleMs ?? SEVEN_DAYS_MS

    // Skip entirely (no network, no banner) if a full ingest completed recently.
    // A run aborted mid-crawl never records a timestamp, so it resumes next launch.
    const last = this.deps.lastRunAt?.() ?? null
    if (!opts.force && last != null && now() - last < staleMs) return

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
    let aborted = false
    try {
      for (let i = 0; i < work.length; i += 50) {
        if (this.deps.signal?.aborted) {
          aborted = true
          break // graceful stop; resumes next launch
        }
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
    // Only stamp a clean, complete run — an aborted one must re-run next launch.
    if (!aborted && !this.deps.signal?.aborted) this.deps.markRun?.(now())
  }

  // Enumerate each crawl target's category members, drop the aggregate/category
  // entries, dedupe, skip pages already indexed (incremental), and cap to the budget.
  private async discoverCrawl(): Promise<WorkItem[]> {
    const members = this.deps.categoryMembers!
    const targets = this.deps.crawlTargets ?? DEFAULT_CRAWL_TARGETS
    const candidates: WorkItem[] = []
    const seen = new Set<string>()
    for (const target of targets) {
      if (this.deps.signal?.aborted) break
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
    // Skip already-indexed pages (one query, not one per page) so each run only
    // fetches what's left — that's the resume. No budget = full coverage; a
    // graceful stop on quit just leaves the rest for next launch.
    const indexed = this.deps.index.indexedUrls
      ? await this.deps.index.indexedUrls()
      : null
    const budget = this.deps.crawlBudget ?? Infinity
    const fresh: WorkItem[] = []
    for (const c of candidates) {
      if (fresh.length >= budget) break
      const already = indexed ? indexed.has(c.url) : (await this.deps.index.indexedHash(c.url)) != null
      if (already) continue
      fresh.push(c)
    }
    return fresh
  }
}
