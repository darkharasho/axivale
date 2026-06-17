// src/main/meta/refresh.ts
//
// Orchestrates a background meta refresh: for each STALE mode, fetch each
// configured source, cache the raw text + record provenance, then distill the
// gathered raw into summary notes. Error-isolated — a failed source never wipes
// good notes, and a mode with zero successful sources is left untouched.
import type { MetaStore, MetaMode } from '../metaStore'
import type { MetaFetcher } from './fetcher'
import type { RawCache } from './cache'
import { distill, type MetaModel } from './distill'
import { distillComp } from './distillComp'
import { configForUrl, resolveContent } from './sources'
import type { MetaIndex } from './rag/index'
import { chunkPage, sha1 } from './rag/chunk'
import { corpusForUrl, type Corpus } from './corpus'

const SEVEN_DAYS_MS = 7 * 86_400_000

export type MetaProgress =
  | { type: 'refresh-start'; total: number } // total = estimated pages across fetched sources
  | { type: 'mode-start'; modeId: string }
  | { type: 'source-start'; modeId: string; url: string }
  | { type: 'page'; modeId: string; url: string } // one crawled page within a source
  | { type: 'source-done'; modeId: string; url: string }
  | { type: 'mode-done'; modeId: string }
  | { type: 'idle' }

// Rough per-source page estimates (mirror the crawler caps in fetcher.ts /
// snowcrows.ts) so the progress bar is page-grained, not source-grained. We
// OVER-estimate on purpose: the real page count is ≤ the cap, so the bar ends a
// little short and snaps to done — never the reverse (hitting 100% then freezing).
export function estimatePages(url: string): number {
  const cfg = configForUrl(url)
  if (!cfg) return 1
  if (cfg.kind === 'wiki') return 1
  if (cfg.kind === 'static') return 60 // snowcrows MAX_PAGES
  if (cfg.kind === 'browser') return cfg.linkSelector ? 30 : 1 // MAX_CRAWL_PAGES vs single page
  return 1
}

export interface RefresherDeps {
  store: MetaStore
  fetcher: MetaFetcher
  cache: RawCache
  model: MetaModel
  now: () => number
  staleMs?: number
  emit?: (e: MetaProgress) => void
  index?: MetaIndex
  wikiIndex?: MetaIndex
  generalIndex?: MetaIndex
  eliteSpecs?: () => Promise<Record<string, string>>
}

function isStale(mode: MetaMode, now: number, staleMs: number): boolean {
  if (!mode.refreshedAt) return true
  return now - Date.parse(mode.refreshedAt) > staleMs
}

export class MetaRefresher {
  constructor(private readonly deps: RefresherDeps) {}

  /**
   * Re-crawl + re-distill. With no args, processes every stale mode and fetches
   * all its sources. With `only` (a URL or substring), targets just the matching
   * source(s) for a fast iteration: fetches only those, but pulls every OTHER
   * build source from the raw cache so the consensus distill still sees the full
   * source set (a single-source re-distill would otherwise wipe the cross-source
   * notes). Modes containing a matching source are processed regardless of staleness.
   */
  async refreshStale(opts: { only?: string } = {}): Promise<void> {
    const { store, fetcher, cache, model, now } = this.deps
    const emit = this.deps.emit ?? ((): void => {})
    const staleMs = this.deps.staleMs ?? SEVEN_DAYS_MS
    const only = opts.only?.trim() || undefined
    const targets = (s: { url: string }): boolean => !only || s.url.includes(only)
    try {
      const stale = only
        ? store.list().filter((m) => m.sources.some((s) => configForUrl(s.url) && targets(s)))
        : store.list().filter((m) => isStale(m, now(), staleMs))
      // Page-grained total: sum the per-source page estimates of the sources we
      // actually FETCH (the targeted ones when scoped), so the bar moves per page.
      const fetched = stale.flatMap((m) => m.sources.filter((s) => configForUrl(s.url) && targets(s)))
      const totalPages = fetched.reduce((n, s) => n + estimatePages(s.url), 0)
      if (fetched.length > 0) emit({ type: 'refresh-start', total: totalPages })
      // Resolve the authoritative elite-spec map ONCE per run (only when there's
      // work), so every distill in this run is grounded by the same map.
      const specMap = fetched.length > 0 && this.deps.eliteSpecs ? await this.deps.eliteSpecs() : {}
      for (const mode of stale) {
        emit({ type: 'mode-start', modeId: mode.id })
        const buildRaws: Array<{ source: string; text: string }> = []
        const ruleRaws: string[] = []
        for (const src of mode.sources) {
          if (!configForUrl(src.url)) continue
          if (!targets(src)) {
            // Not the targeted source — reuse its cached raw text so the distiller
            // keeps full cross-source consensus without re-crawling it.
            const cached = cache.get(src.url)
            if (cached) {
              if (resolveContent(src.url) === 'rules') ruleRaws.push(cached)
              else buildRaws.push({ source: src.label, text: cached })
            }
            continue
          }
          emit({ type: 'source-start', modeId: mode.id, url: src.url })
          console.log(`[meta] fetch start (${mode.id}):`, src.url)
          // Tick per crawled page so the bar moves during a long multi-page crawl.
          const r = await fetcher.fetch(src.url, () => emit({ type: 'page', modeId: mode.id, url: src.url }))
          store.recordFetch(
            mode.id,
            src.url,
            r.ok ? { ok: true, sourceDate: r.date ?? null } : { ok: false, error: r.error }
          )
          if (r.ok) {
            cache.put(src.url, r.text)
            if (resolveContent(src.url) === 'rules') {
              ruleRaws.push(r.text)
            } else {
              // Tag with the configured source label so the distiller attributes
              // builds/dates to a real source and can weight cross-source consensus.
              buildRaws.push({ source: src.label, text: r.text })
            }
            console.log(`[meta] fetch ok (${mode.id}): ${src.url} — ${r.pages.length} page(s)`)
            await this.ingest(mode.mode, src.url, r.pages)
          } else {
            console.warn(`[meta] fetch FAILED (${mode.id}): ${src.url} — ${r.error}`)
          }
          emit({ type: 'source-done', modeId: mode.id, url: src.url })
        }
        if (mode.mode === 'Guides') {
          // Guides are prose, not builds — a build-tier table summary makes no sense.
          // Stamp the refresh (so it isn't re-crawled every cycle) with empty notes;
          // the value lives in the indexed general corpus, not a distilled summary.
          if (buildRaws.length || ruleRaws.length) store.recordDistill(mode.id, '')
        } else {
          // combine build-table + comp-rule notes into one blob; either half may be null
          const today = new Date().toISOString().slice(0, 10)
          const buildNotes = buildRaws.length ? await distill(mode.mode, buildRaws, model, specMap, today) : null
          const compNotes = ruleRaws.length ? await distillComp(mode.mode, ruleRaws, model) : null
          const combined = [buildNotes, compNotes].filter(Boolean).join('\n\n')
          if (combined) store.recordDistill(mode.id, combined)
        }
        emit({ type: 'mode-done', modeId: mode.id })
      }
    } finally {
      emit({ type: 'idle' })
    }
  }

  private indexFor(corpus: Corpus): MetaIndex | undefined {
    if (corpus === 'wiki') return this.deps.wikiIndex ?? this.deps.index
    if (corpus === 'general') return this.deps.generalIndex ?? this.deps.index
    return this.deps.index
  }

  private async ingest(mode: string, source: string, pages: { url: string; title: string; text: string }[]): Promise<void> {
    const host = ((): string => {
      try { return new URL(source).host.replace(/^www\./, '') } catch { return source }
    })()
    for (const page of pages) {
      const index = this.indexFor(corpusForUrl(page.url))
      if (!index) continue
      try {
        if ((await index.indexedHash(page.url)) === sha1(page.text)) {
          console.log('[meta] skip (unchanged):', page.url)
          continue
        }
        const chunks = chunkPage(page.text, { mode, source: host, url: page.url, title: page.title })
        if (chunks.length > 0) await index.replacePage(page.url, chunks)
        console.log('[meta] indexed', chunks.length, 'chunks:', page.url)
      } catch (e) {
        console.warn('[meta] index failed:', page.url, e)
      }
    }
  }
}
