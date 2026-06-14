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

const SEVEN_DAYS_MS = 7 * 86_400_000

export interface RefresherDeps {
  store: MetaStore
  fetcher: MetaFetcher
  cache: RawCache
  model: MetaModel
  now: () => number
  staleMs?: number
}

function isStale(mode: MetaMode, now: number, staleMs: number): boolean {
  if (!mode.refreshedAt) return true
  return now - Date.parse(mode.refreshedAt) > staleMs
}

export class MetaRefresher {
  constructor(private readonly deps: RefresherDeps) {}

  async refreshStale(): Promise<void> {
    const { store, fetcher, cache, model, now } = this.deps
    const staleMs = this.deps.staleMs ?? SEVEN_DAYS_MS
    for (const mode of store.list()) {
      if (!isStale(mode, now(), staleMs)) continue
      const raws: string[] = []
      for (const src of mode.sources) {
        if (!configForUrl(src.url)) continue
        const r = await fetcher.fetch(src.url)
        store.recordFetch(mode.id, src.url, r.ok ? { ok: true } : { ok: false, error: r.error })
        if (r.ok) {
          cache.put(src.url, r.text)
          raws.push(r.text)
        }
      }
      if (raws.length === 0) continue
      const notes = await distill(mode.mode, raws, model)
      if (notes) store.recordDistill(mode.id, notes)
    }
  }
}
