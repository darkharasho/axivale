// src/main/memory/service.ts
//
// Orchestrates MemoryStore (records) + MemoryIndex (vectors), keeping them in
// sync. Owns the write-time dedup decision (exact-norm then semantic cosine) and
// the recall value-boost. Entity-name resolution is injected (lazy roster lookup).

import type { MemoryStore } from '../memoryStore'
import type { MemoryIndex } from './index'
import { normalizeMemoryBody } from './normalize'
import { FACT_DUP_COSINE, ARTIFACT_DUP_COSINE, factScore } from './score'
import type {
  MemoryKind, MemorySource, MemoryRecallResult, RecalledFact, RecalledArtifact, ArtifactKind
} from './types'

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly index: MemoryIndex,
    private readonly opts: { entityName?: (key: string) => string | undefined } = {}
  ) {}

  async remember(input: {
    kind: MemoryKind; body: string; title?: string; entity?: string | null; tags?: string[]; source?: MemorySource
  }): Promise<{ id: string; kind: MemoryKind; merged: boolean }> {
    const source: MemorySource = input.source ?? 'agent'
    const entity = input.entity ?? null
    const tags = input.tags ?? []

    if (input.kind === 'fact') {
      const norm = normalizeMemoryBody(input.body)
      const exact = this.store.findFactByNorm(norm, entity)
      if (exact) {
        this.store.markFactRelearned(exact.id, { entity, tags })
        await this.index.upsert({ id: exact.id, kind: 'fact', entity: this.store.getFact(exact.id)!.entity, text: this.store.getFact(exact.id)!.body })
        return { id: exact.id, kind: 'fact', merged: true }
      }
      const near = await this.index.nearest(input.body, 'fact', { entity })
      if (near && near.cosine >= FACT_DUP_COSINE) {
        this.store.markFactRelearned(near.id, { entity, tags })
        const merged = this.store.getFact(near.id)!
        await this.index.upsert({ id: near.id, kind: 'fact', entity: merged.entity, text: merged.body })
        return { id: near.id, kind: 'fact', merged: true }
      }
      const fact = this.store.insertFact({ body: input.body, entity, tags, source })
      await this.index.upsert({ id: fact.id, kind: 'fact', entity, text: fact.body })
      this.store.rerank()
      return { id: fact.id, kind: 'fact', merged: false }
    }

    // Artifact kinds
    const kind = input.kind as ArtifactKind
    const title = (input.title ?? '').trim()
    if (!title) throw new Error(`a ${kind} requires a title`)
    const near = await this.index.nearest(`${title}\n${input.body}`, kind, { entity })
    if (near && near.cosine >= ARTIFACT_DUP_COSINE) {
      this.store.updateArtifact(near.id, { title, body: input.body, tags })
      await this.index.upsert({ id: near.id, kind, entity, text: `${title}\n${input.body}` })
      return { id: near.id, kind, merged: true }
    }
    const art = this.store.insertArtifact({ kind, title, body: input.body, entity, tags, source })
    await this.index.upsert({ id: art.id, kind, entity, text: `${title}\n${art.body}` })
    return { id: art.id, kind, merged: false }
  }

  createManual(input: {
    kind: MemoryKind; body: string; title?: string; entity?: string | null; tags?: string[]
  }): Promise<{ id: string; kind: MemoryKind; merged: boolean }> {
    return this.remember({ ...input, source: 'user' })
  }

  async recall(input: {
    query: string; entity?: string | null; kinds?: MemoryKind[]; limit?: number
  }): Promise<MemoryRecallResult> {
    const now = Date.now()
    const limit = Math.min(input.limit ?? 5, 20)
    const hits = await this.index.search(input.query, { entity: input.entity ?? null, kinds: input.kinds, k: limit * 2 })

    const factHits = hits.filter((h) => h.kind === 'fact')
    const artHits = hits.filter((h) => h.kind !== 'fact')

    // Value-boost facts by stored score (log-damped), preserving search rank as the base.
    const facts: RecalledFact[] = factHits
      .map((h, i) => ({ h, i, f: this.store.getFact(h.id) }))
      .filter((x) => x.f && !x.f.archived)
      .map((x) => ({ x, boost: (1 / i0(x.i)) * (1 + 0.25 * Math.log1p(factScore(x.f!, now))) }))
      .sort((a, b) => b.boost - a.boost)
      .slice(0, limit)
      .map(({ x }) => {
        const f = x.f!
        return {
          id: f.id, body: f.body, entity: f.entity,
          entityName: f.entity ? this.opts.entityName?.(f.entity) : undefined,
          tags: f.tags, source: f.source,
          learnedAt: f.createdAt, lastUsedAt: f.lastUsedAt, timesUsed: f.useCount
        } satisfies RecalledFact
      })

    const artifacts: RecalledArtifact[] = artHits
      .map((h) => this.store.getArtifact(h.id))
      .filter((a): a is NonNullable<typeof a> => !!a && !a.archived)
      .slice(0, limit)
      .map((a) => ({
        id: a.id, kind: a.kind, title: a.title, body: a.body, tags: a.tags,
        source: a.source, updatedAt: a.updatedAt, lastUsedAt: a.lastUsedAt, timesUsed: a.useCount
      }))

    this.store.bumpRecall('fact', facts.map((f) => f.id))
    this.store.bumpRecall('playbook', artifacts.map((a) => a.id)) // kind arg only selects fact-vs-artifact list
    return { facts, artifacts }
  }

  async updateFact(id: string, patch: { body?: string; entity?: string | null; tags?: string[]; archived?: boolean }): Promise<void> {
    const f = this.store.updateFact(id, patch)
    if (!f) return
    if (f.archived) await this.index.remove(id)
    else await this.index.upsert({ id, kind: 'fact', entity: f.entity, text: f.body })
    this.store.rerank()
  }

  async updateArtifact(id: string, patch: { title?: string; body?: string; tags?: string[]; archived?: boolean }): Promise<void> {
    const a = this.store.updateArtifact(id, patch)
    if (!a) return
    if (a.archived) await this.index.remove(id)
    else await this.index.upsert({ id, kind: a.kind, entity: a.entity, text: `${a.title}\n${a.body}` })
    this.store.rerank()
  }

  async deleteFact(id: string): Promise<void> { this.store.deleteFact(id); await this.index.remove(id) }
  async deleteArtifact(id: string): Promise<void> { this.store.deleteArtifact(id); await this.index.remove(id) }

  setPinned(id: string, pinned: boolean): void { this.store.setUserPinned(id, pinned); this.store.rerank() }

  list(opts?: { includeArchived?: boolean }): { facts: ReturnType<MemoryStore['list']>['facts']; artifacts: ReturnType<MemoryStore['list']>['artifacts'] } {
    this.store.rerank()
    return this.store.list(opts)
  }

  factsForEntity(entity: string): ReturnType<MemoryStore['factsForEntity']> {
    return this.store.factsForEntity(entity)
  }

  async reindexAll(): Promise<void> {
    const { facts, artifacts } = this.store.list({ includeArchived: true })
    await this.index.reindex([
      ...facts.filter((f) => !f.archived).map((f) => ({ id: f.id, kind: 'fact' as const, entity: f.entity, text: f.body })),
      ...artifacts.filter((a) => !a.archived).map((a) => ({ id: a.id, kind: a.kind, entity: a.entity, text: `${a.title}\n${a.body}` }))
    ])
  }

  indexStats(): ReturnType<MemoryIndex['stats']> { return this.index.stats() }
}

/** Rank position -> reciprocal base (RRF-style), 1-based. */
function i0(i: number): number { return 60 + i + 1 }
