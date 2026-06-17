// src/main/memory/index.ts
//
// MemoryIndex: hybrid (FTS + vector) recall + semantic-dedup neighbor lookup over
// the memory corpus. LanceMemoryIndex wraps LanceDB and owns the Embedder (single
// owner of the model, shared with the meta index). FakeMemoryIndex is a pure,
// deterministic double used by the service tests and as a no-embedder fallback.

import * as lancedb from '@lancedb/lancedb'
import type { Embedder } from '../meta/rag/embedder'
import { EMBED_DIM } from '../meta/rag/embedder'
import { cosine } from './normalize'
import type { MemoryKind } from './types'

export interface MemoryIndexRow {
  id: string
  kind: MemoryKind
  entity: string | null
  text: string
}
export interface MemorySearchHit {
  id: string
  kind: MemoryKind
  score: number
}
export interface MemoryIndexStats {
  total: number
  byKind: Record<string, number>
  lastIndexedAt: string | null
}

export interface MemoryIndex {
  upsert(row: MemoryIndexRow): Promise<void>
  remove(id: string): Promise<void>
  search(query: string, opts: { entity?: string | null; kinds?: MemoryKind[]; k?: number }): Promise<MemorySearchHit[]>
  /** Nearest same-kind neighbor for semantic dedup, scoped to entity (and globals). */
  nearest(text: string, kind: MemoryKind, opts: { entity?: string | null }): Promise<{ id: string; cosine: number } | null>
  reindex(rows: MemoryIndexRow[]): Promise<void>
  stats(): Promise<MemoryIndexStats>
}

const TABLE = 'memory_rows'

export class LanceMemoryIndex implements MemoryIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tbl: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null

  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder,
    private readonly table: string = TABLE
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getTable(): Promise<any> {
    if (this.tbl) return this.tbl
    this.db = await lancedb.connect(this.dir)
    const names = await this.db.tableNames()
    if (names.includes(this.table)) {
      this.tbl = await this.db.openTable(this.table)
    } else {
      const seed = {
        id: '__seed__', kind: 'fact', entity: '', text: '',
        indexedAt: '', vector: new Array(EMBED_DIM).fill(0)
      }
      this.tbl = await this.db.createTable(this.table, [seed])
      await this.tbl.createIndex('text', { config: lancedb.Index.fts() })
      await this.tbl.delete("id = '__seed__'")
    }
    return this.tbl
  }

  async upsert(row: MemoryIndexRow): Promise<void> {
    const tbl = await this.getTable()
    await tbl.delete(`id = ${q(row.id)}`)
    const [vector] = await this.embedder.embed([row.text])
    await tbl.add([{
      id: row.id, kind: row.kind, entity: row.entity ?? '', text: row.text,
      indexedAt: new Date().toISOString(), vector
    }])
  }

  async remove(id: string): Promise<void> {
    const tbl = await this.getTable()
    await tbl.delete(`id = ${q(id)}`)
  }

  async search(query: string, opts: { entity?: string | null; kinds?: MemoryKind[]; k?: number }): Promise<MemorySearchHit[]> {
    const tbl = await this.getTable()
    const k = opts.k ?? 8
    const [vector] = await this.embedder.embed([query])
    let qy = tbl.query().fullTextSearch(query).nearestTo(vector)
      .rerank(await lancedb.rerankers.RRFReranker.create())
    const wheres: string[] = []
    if (opts.entity !== undefined && opts.entity !== null) wheres.push(`(entity = ${q(opts.entity)} OR entity = '')`)
    if (opts.kinds?.length) wheres.push(`kind IN (${opts.kinds.map(q).join(', ')})`)
    if (wheres.length) qy = qy.where(wheres.join(' AND '))
    const rows = await qy.limit(k).toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({ id: r.id, kind: r.kind, score: r._relevance_score ?? 0 }))
  }

  async nearest(text: string, kind: MemoryKind, opts: { entity?: string | null }): Promise<{ id: string; cosine: number } | null> {
    const tbl = await this.getTable()
    const [vector] = await this.embedder.embed([text])
    let qy = tbl.query().nearestTo(vector).where(
      opts.entity !== undefined && opts.entity !== null
        ? `kind = ${q(kind)} AND (entity = ${q(opts.entity)} OR entity = '')`
        : `kind = ${q(kind)}`
    )
    const rows = await qy.limit(1).toArray()
    if (rows.length === 0) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = rows[0]
    return { id: r.id, cosine: cosine(vector, Array.from(r.vector as number[])) }
  }

  async reindex(rows: MemoryIndexRow[]): Promise<void> {
    const tbl = await this.getTable()
    await tbl.delete('id != \'\'')
    if (rows.length === 0) return
    const vectors = await this.embedder.embed(rows.map((r) => r.text))
    const indexedAt = new Date().toISOString()
    await tbl.add(rows.map((r, i) => ({
      id: r.id, kind: r.kind, entity: r.entity ?? '', text: r.text, indexedAt, vector: vectors[i]
    })))
  }

  async stats(): Promise<MemoryIndexStats> {
    try {
      const tbl = await this.getTable()
      const total = await tbl.countRows()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await tbl.query().select(['kind', 'indexedAt']).limit(100_000).toArray()) as any[]
      const byKind: Record<string, number> = {}
      let lastIndexedAt: string | null = null
      for (const r of rows) {
        byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
        if (r.indexedAt && (!lastIndexedAt || r.indexedAt > lastIndexedAt)) lastIndexedAt = r.indexedAt
      }
      return { total, byKind, lastIndexedAt }
    } catch {
      return { total: 0, byKind: {}, lastIndexedAt: null }
    }
  }
}

/** Deterministic in-memory double: token-overlap "search", token-Jaccard "cosine". */
export class FakeMemoryIndex implements MemoryIndex {
  private rows = new Map<string, MemoryIndexRow>()
  private tokens(s: string): Set<string> { return new Set(s.toLowerCase().split(/\s+/).filter(Boolean)) }

  async upsert(row: MemoryIndexRow): Promise<void> { this.rows.set(row.id, row) }
  async remove(id: string): Promise<void> { this.rows.delete(id) }

  async search(query: string, opts: { entity?: string | null; kinds?: MemoryKind[]; k?: number }): Promise<MemorySearchHit[]> {
    const q = this.tokens(query)
    const out: MemorySearchHit[] = []
    for (const r of this.rows.values()) {
      if (opts.kinds?.length && !opts.kinds.includes(r.kind)) continue
      if (opts.entity != null && r.entity !== opts.entity && r.entity !== null) continue
      const t = this.tokens(r.text)
      let overlap = 0
      for (const w of q) if (t.has(w)) overlap++
      if (overlap > 0) out.push({ id: r.id, kind: r.kind, score: overlap })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, opts.k ?? 8)
  }

  async nearest(text: string, kind: MemoryKind, opts: { entity?: string | null }): Promise<{ id: string; cosine: number } | null> {
    const q = this.tokens(text)
    let best: { id: string; cosine: number } | null = null
    for (const r of this.rows.values()) {
      if (r.kind !== kind) continue
      if (opts.entity != null && r.entity !== opts.entity && r.entity !== null) continue
      const t = this.tokens(r.text)
      const inter = [...q].filter((w) => t.has(w)).length
      const union = new Set([...q, ...t]).size
      const c = union === 0 ? 0 : inter / union
      if (!best || c > best.cosine) best = { id: r.id, cosine: c }
    }
    return best
  }

  async reindex(rows: MemoryIndexRow[]): Promise<void> {
    this.rows = new Map(rows.map((r) => [r.id, r]))
  }
  async stats(): Promise<MemoryIndexStats> {
    const byKind: Record<string, number> = {}
    for (const r of this.rows.values()) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    return { total: this.rows.size, byKind, lastIndexedAt: null }
  }
}

function q(s: string): string { return `'${s.replace(/'/g, "''")}'` }
