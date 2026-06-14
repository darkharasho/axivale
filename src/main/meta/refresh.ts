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
import { configForUrl } from './sources'
import type { MetaIndex } from './rag/index'
import { chunkPage, sha1 } from './rag/chunk'

const SEVEN_DAYS_MS = 7 * 86_400_000

export type MetaProgress =
  | { type: 'mode-start'; modeId: string }
  | { type: 'source-start'; modeId: string; url: string }
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
      for (const mode of store.list()) {
        if (!isStale(mode, now(), staleMs)) continue
        emit({ type: 'mode-start', modeId: mode.id })
        const raws: string[] = []
        for (const src of mode.sources) {
          if (!configForUrl(src.url)) continue
          emit({ type: 'source-start', modeId: mode.id, url: src.url })
          const r = await fetcher.fetch(src.url)
          store.recordFetch(mode.id, src.url, r.ok ? { ok: true } : { ok: false, error: r.error })
          if (r.ok) {
            cache.put(src.url, r.text)
            raws.push(r.text)
            await this.ingest(mode.mode, src.url, r.pages)
          }
        }
        if (raws.length > 0) {
          const notes = await distill(mode.mode, raws, model)
          if (notes) store.recordDistill(mode.id, notes)
        }
        emit({ type: 'mode-done', modeId: mode.id })
      }
    } finally {
      emit({ type: 'idle' })
    }
  }

  private async ingest(mode: string, source: string, pages: { url: string; title: string; text: string }[]): Promise<void> {
    const index = this.deps.index
    if (!index) return
    const host = ((): string => {
      try {
        return new URL(source).host.replace(/^www\./, '')
      } catch {
        return source
      }
    })()
    for (const page of pages) {
      try {
        if ((await index.indexedHash(page.url)) === sha1(page.text)) continue
        const chunks = chunkPage(page.text, { mode, source: host, url: page.url, title: page.title })
        if (chunks.length > 0) await index.replacePage(page.url, chunks)
      } catch {
        /* index failure for one page is isolated; never breaks the refresh */
      }
    }
  }
}
