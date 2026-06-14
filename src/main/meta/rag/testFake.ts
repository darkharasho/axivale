// src/main/meta/rag/testFake.ts
import type { Chunk } from './chunk'
import type { MetaIndex, MetaSearchHit, MetaChunkRow, MetaIndexStats } from './index'

/** In-memory MetaIndex for unit tests. */
export class FakeMetaIndex implements MetaIndex {
  replaced: string[] = []
  queries: Array<{ query: string; mode?: string; k?: number }> = []
  private hashes = new Map<string, string>()
  constructor(private readonly hits: MetaSearchHit[] = []) {}
  async indexedHash(url: string): Promise<string | null> {
    return this.hashes.get(url) ?? null
  }
  async replacePage(url: string, chunks: Chunk[]): Promise<void> {
    this.replaced.push(url)
    if (chunks[0]) this.hashes.set(url, chunks[0].contentHash)
  }
  async search(query: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]> {
    this.queries.push({ query, mode: opts.mode, k: opts.k })
    return this.hits
  }
  sampleRows: MetaChunkRow[] = []
  async stats(): Promise<MetaIndexStats> {
    const byMode: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    let lastIndexedAt: string | null = null
    for (const r of this.sampleRows) {
      byMode[r.mode] = (byMode[r.mode] ?? 0) + 1
      bySource[r.source] = (bySource[r.source] ?? 0) + 1
      if (r.indexedAt && (!lastIndexedAt || r.indexedAt > lastIndexedAt)) lastIndexedAt = r.indexedAt
    }
    return { total: this.sampleRows.length, byMode, bySource, lastIndexedAt }
  }
  async sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]> {
    return this.sampleRows.filter((r) => !opts.mode || r.mode === opts.mode).slice(0, opts.limit)
  }
}
