// src/main/meta/rag/testFake.ts
import type { Chunk } from './chunk'
import type { MetaIndex, MetaSearchHit } from './index'

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
}
