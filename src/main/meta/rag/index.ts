// src/main/meta/rag/index.ts
//
// MetaIndex: the corpus's hybrid (keyword + semantic) retrieval surface. The real
// impl wraps LanceDB and owns the Embedder (single owner of the model). Behind
// this interface so the orchestrator + tool are tested with a fake; the real
// LanceDB impl is smoke-tested.
import * as lancedb from '@lancedb/lancedb'
import type { Chunk } from './chunk'
import type { Embedder } from './embedder'
import { EMBED_DIM } from './embedder'

export interface MetaSearchHit {
  source: string
  url: string
  title: string
  snippet: string
  score: number
}

export interface MetaChunkRow {
  id: string
  mode: string
  source: string
  url: string
  title: string
  snippet: string
  indexedAt: string
}
export interface MetaIndexStats {
  total: number
  byMode: Record<string, number>
  bySource: Record<string, number>
  lastIndexedAt: string | null
}

export interface MetaIndex {
  /** The contentHash currently indexed for a url, or null if unindexed. */
  indexedHash(url: string): Promise<string | null>
  /** Embed the chunk texts, delete existing rows for the url, then insert. */
  replacePage(url: string, chunks: Chunk[]): Promise<void>
  /** Hybrid search; embeds the query internally. */
  search(queryText: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]>
  /** Index stats for the dev inspector. */
  stats(): Promise<MetaIndexStats>
  /** Browse a sample of indexed chunks (dev inspector). */
  sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]>
}

const TABLE = 'meta_chunks'

export class LanceMetaIndex implements MetaIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tbl: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null

  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async table(): Promise<any> {
    if (this.tbl) return this.tbl
    this.db = await lancedb.connect(this.dir)
    const names = await this.db.tableNames()
    if (names.includes(TABLE)) {
      this.tbl = await this.db.openTable(TABLE)
    } else {
      // Create with one seed row's shape (LanceDB infers schema from data); a
      // zero-vector placeholder row is immediately deleted to leave it empty.
      const seed = {
        id: '__seed__',
        mode: '',
        source: '',
        url: '__seed__',
        title: '',
        text: '',
        contentHash: '',
        indexedAt: '',
        vector: new Array(EMBED_DIM).fill(0)
      }
      this.tbl = await this.db.createTable(TABLE, [seed])
      await this.tbl.createIndex('text', { config: lancedb.Index.fts() })
      await this.tbl.delete("url = '__seed__'")
    }
    return this.tbl
  }

  async indexedHash(url: string): Promise<string | null> {
    const tbl = await this.table()
    const rows = await tbl.query().where(`url = ${quote(url)}`).limit(1).toArray()
    return rows[0]?.contentHash ?? null
  }

  async replacePage(url: string, chunks: Chunk[]): Promise<void> {
    const tbl = await this.table()
    await tbl.delete(`url = ${quote(url)}`)
    if (chunks.length === 0) return
    const vectors = await this.embedder.embed(chunks.map((c) => c.text))
    if (vectors.length !== chunks.length) {
      throw new Error(`embed returned ${vectors.length} vectors for ${chunks.length} chunks`)
    }
    const indexedAt = new Date().toISOString()
    const rows = chunks.map((c, i) => ({
      id: c.id,
      mode: c.mode,
      source: c.source,
      url: c.url,
      title: c.title,
      text: c.text,
      contentHash: c.contentHash,
      indexedAt,
      vector: vectors[i]
    }))
    await tbl.add(rows)
  }

  async search(queryText: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]> {
    const tbl = await this.table()
    const k = opts.k ?? 6
    const [vector] = await this.embedder.embed([queryText])
    let q = tbl
      .query()
      .fullTextSearch(queryText)
      .nearestTo(vector)
      .rerank(await lancedb.rerankers.RRFReranker.create())
    if (opts.mode) q = q.where(`mode = ${quote(opts.mode)}`)
    const rows = await q.limit(k).toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({
      source: r.source,
      url: r.url,
      title: r.title,
      snippet: String(r.text).slice(0, 600),
      score: r._relevance_score ?? 0
    }))
  }

  async stats(): Promise<MetaIndexStats> {
    try {
      const tbl = await this.table()
      const total = await tbl.countRows()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await tbl.query().select(['mode', 'source', 'indexedAt']).limit(100_000).toArray()) as any[]
      const byMode: Record<string, number> = {}
      const bySource: Record<string, number> = {}
      let lastIndexedAt: string | null = null
      for (const r of rows) {
        byMode[r.mode] = (byMode[r.mode] ?? 0) + 1
        bySource[r.source] = (bySource[r.source] ?? 0) + 1
        if (r.indexedAt && (!lastIndexedAt || r.indexedAt > lastIndexedAt)) lastIndexedAt = r.indexedAt
      }
      return { total, byMode, bySource, lastIndexedAt }
    } catch {
      return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }
    }
  }

  async sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]> {
    try {
      const tbl = await this.table()
      let q = tbl.query().select(['id', 'mode', 'source', 'url', 'title', 'text', 'indexedAt'])
      if (opts.mode) q = q.where(`mode = ${quote(opts.mode)}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await q.limit(opts.limit).toArray()) as any[]
      return rows.map((r) => ({
        id: r.id,
        mode: r.mode,
        source: r.source,
        url: r.url,
        title: r.title,
        snippet: String(r.text ?? '').slice(0, 300),
        indexedAt: r.indexedAt ?? ''
      }))
    } catch {
      return []
    }
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
