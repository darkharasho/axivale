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
  | { type: 'refresh-start'; total: number } // total = configured sources across stale modes
  | { type: 'mode-start'; modeId: string }
  | { type: 'source-start'; modeId: string; url: string }
  | { type: 'source-done'; modeId: string; url: string }
  | { type: 'mode-done'; modeId: string }
  | { type: 'idle' }

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

  async refreshStale(): Promise<void> {
    const { store, fetcher, cache, model, now } = this.deps
    const emit = this.deps.emit ?? ((): void => {})
    const staleMs = this.deps.staleMs ?? SEVEN_DAYS_MS
    try {
      const stale = store.list().filter((m) => isStale(m, now(), staleMs))
      // Progress is per-source (not per-mode) so the bar moves as each source
      // finishes its crawl, instead of sitting still for a whole mode.
      const totalSources = stale.reduce(
        (n, m) => n + m.sources.filter((s) => configForUrl(s.url)).length,
        0
      )
      if (totalSources > 0) emit({ type: 'refresh-start', total: totalSources })
      // Resolve the authoritative elite-spec map ONCE per run (only when there's
      // stale work), so every distill in this run is grounded by the same map.
      const specMap = totalSources > 0 && this.deps.eliteSpecs ? await this.deps.eliteSpecs() : {}
      for (const mode of stale) {
        emit({ type: 'mode-start', modeId: mode.id })
        const buildRaws: string[] = []
        const ruleRaws: string[] = []
        for (const src of mode.sources) {
          if (!configForUrl(src.url)) continue
          emit({ type: 'source-start', modeId: mode.id, url: src.url })
          console.log(`[meta] fetch start (${mode.id}):`, src.url)
          const r = await fetcher.fetch(src.url)
          store.recordFetch(mode.id, src.url, r.ok ? { ok: true } : { ok: false, error: r.error })
          if (r.ok) {
            cache.put(src.url, r.text)
            if (resolveContent(src.url) === 'rules') {
              ruleRaws.push(r.text)
            } else {
              buildRaws.push(r.text)
            }
            console.log(`[meta] fetch ok (${mode.id}): ${src.url} — ${r.pages.length} page(s)`)
            await this.ingest(mode.mode, src.url, r.pages)
          } else {
            console.warn(`[meta] fetch FAILED (${mode.id}): ${src.url} — ${r.error}`)
          }
          emit({ type: 'source-done', modeId: mode.id, url: src.url })
        }
        // combine build-table + comp-rule notes into one blob; either half may be null
        {
          const buildNotes = buildRaws.length ? await distill(mode.mode, buildRaws, model, specMap) : null
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
