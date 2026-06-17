// src/main/memoryStore.ts
//
// Owns userData/memory.json — AxiVale's durable self-authored memory (facts +
// artifacts). Atomic tmp+rename, debounced, corrupt-safe (mirrors metaStore.ts).
// Records are authoritative; the LanceDB index (memory/index.ts) is derived.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { MemoryFact, MemoryArtifact, MemoryKind, MemorySource, ArtifactKind } from './memory/types'
import { normalizeMemoryBody } from './memory/normalize'
import { factScore, artifactScore, FACT_PIN_BUDGET, ARCHIVE_AFTER_MS } from './memory/score'

interface FileShape {
  facts: MemoryFact[]
  artifacts: MemoryArtifact[]
}

const DEBOUNCE_MS = 300
const DEFAULT_MAX_FACTS = 2000

export class MemoryStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly maxFacts: number

  constructor(private readonly path: string, opts?: { maxFacts?: number }) {
    this.maxFacts = opts?.maxFacts ?? DEFAULT_MAX_FACTS
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { facts: [], artifacts: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return {
        facts: (Array.isArray(parsed.facts) ? parsed.facts : []).map((f) => this.normFact(f)),
        artifacts: (Array.isArray(parsed.artifacts) ? parsed.artifacts : []).map((a) => this.normArtifact(a))
      }
    } catch {
      return { facts: [], artifacts: [] }
    }
  }

  private normFact(f: MemoryFact): MemoryFact {
    return {
      id: f.id ?? randomUUID(),
      body: f.body ?? '',
      bodyNorm: f.bodyNorm ?? normalizeMemoryBody(f.body ?? ''),
      entity: f.entity ?? null,
      tags: Array.isArray(f.tags) ? f.tags : [],
      pinned: !!f.pinned,
      userPinned: !!f.userPinned,
      useCount: f.useCount ?? 0,
      score: f.score ?? 0,
      source: (f.source as MemorySource) ?? 'agent',
      createdAt: f.createdAt ?? new Date().toISOString(),
      lastUsedAt: f.lastUsedAt ?? null,
      archived: !!f.archived
    }
  }

  private normArtifact(a: MemoryArtifact): MemoryArtifact {
    return {
      id: a.id ?? randomUUID(),
      kind: (a.kind as ArtifactKind) ?? 'heuristic',
      title: a.title ?? '',
      body: a.body ?? '',
      bodyNorm: a.bodyNorm ?? normalizeMemoryBody(a.title ?? ''),
      tags: Array.isArray(a.tags) ? a.tags : [],
      entity: a.entity ?? null,
      useCount: a.useCount ?? 0,
      score: a.score ?? 0,
      source: (a.source as MemorySource) ?? 'agent',
      createdAt: a.createdAt ?? new Date().toISOString(),
      updatedAt: a.updatedAt ?? new Date().toISOString(),
      lastUsedAt: a.lastUsedAt ?? null,
      archived: !!a.archived
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  list(opts?: { includeArchived?: boolean }): { facts: MemoryFact[]; artifacts: MemoryArtifact[] } {
    const keep = <T extends { archived: boolean }>(xs: T[]): T[] =>
      opts?.includeArchived ? [...xs] : xs.filter((x) => !x.archived)
    return { facts: keep(this.state.facts), artifacts: keep(this.state.artifacts) }
  }

  factsForEntity(entity: string): MemoryFact[] {
    return this.state.facts.filter((f) => !f.archived && f.entity === entity)
  }

  findFactByNorm(bodyNorm: string, entity: string | null): MemoryFact | null {
    return this.state.facts.find((f) => f.bodyNorm === bodyNorm && f.entity === entity) ?? null
  }

  findArtifactByNorm(bodyNorm: string): MemoryArtifact | null {
    return this.state.artifacts.find((a) => a.bodyNorm === bodyNorm) ?? null
  }

  getFact(id: string): MemoryFact | null {
    return this.state.facts.find((f) => f.id === id) ?? null
  }

  getArtifact(id: string): MemoryArtifact | null {
    return this.state.artifacts.find((a) => a.id === id) ?? null
  }

  insertFact(seed: { body: string; entity: string | null; tags: string[]; source: MemorySource }): MemoryFact {
    const now = new Date().toISOString()
    const fact: MemoryFact = {
      id: randomUUID(),
      body: seed.body.trim(),
      bodyNorm: normalizeMemoryBody(seed.body),
      entity: seed.entity,
      tags: dedupeTags(seed.tags),
      pinned: false,
      userPinned: false,
      useCount: 0,
      score: 0,
      source: seed.source,
      createdAt: now,
      lastUsedAt: null,
      archived: false
    }
    this.state.facts.push(fact)
    this.scheduleWrite()
    return fact
  }

  insertArtifact(seed: {
    kind: ArtifactKind; title: string; body: string; entity: string | null; tags: string[]; source: MemorySource
  }): MemoryArtifact {
    const now = new Date().toISOString()
    const art: MemoryArtifact = {
      id: randomUUID(),
      kind: seed.kind,
      title: seed.title.trim(),
      body: seed.body.trim(),
      bodyNorm: normalizeMemoryBody(seed.title),
      tags: dedupeTags(seed.tags),
      entity: seed.entity,
      useCount: 0,
      score: 0,
      source: seed.source,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      archived: false
    }
    this.state.artifacts.push(art)
    this.scheduleWrite()
    return art
  }

  markFactRelearned(id: string, extra: { entity?: string | null; tags?: string[] }): MemoryFact | null {
    const f = this.getFact(id)
    if (!f) return null
    f.useCount += 1
    f.lastUsedAt = new Date().toISOString()
    f.archived = false
    if (f.entity === null && extra.entity != null) f.entity = extra.entity
    if (extra.tags?.length) f.tags = dedupeTags([...f.tags, ...extra.tags])
    this.scheduleWrite()
    return f
  }

  updateFact(id: string, patch: Partial<Pick<MemoryFact, 'body' | 'entity' | 'tags' | 'archived'>>): MemoryFact | null {
    const f = this.getFact(id)
    if (!f) return null
    if (patch.body !== undefined) { f.body = patch.body.trim(); f.bodyNorm = normalizeMemoryBody(patch.body) }
    if (patch.entity !== undefined) f.entity = patch.entity
    if (patch.tags !== undefined) f.tags = dedupeTags(patch.tags)
    if (patch.archived !== undefined) f.archived = patch.archived
    this.scheduleWrite()
    return f
  }

  updateArtifact(id: string, patch: Partial<Pick<MemoryArtifact, 'title' | 'body' | 'tags' | 'archived'>>): MemoryArtifact | null {
    const a = this.getArtifact(id)
    if (!a) return null
    if (patch.title !== undefined) { a.title = patch.title.trim(); a.bodyNorm = normalizeMemoryBody(patch.title) }
    if (patch.body !== undefined) a.body = patch.body.trim()
    if (patch.tags !== undefined) a.tags = dedupeTags(patch.tags)
    if (patch.archived !== undefined) a.archived = patch.archived
    a.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return a
  }

  deleteFact(id: string): void {
    this.state.facts = this.state.facts.filter((f) => f.id !== id)
    this.scheduleWrite()
  }

  deleteArtifact(id: string): void {
    this.state.artifacts = this.state.artifacts.filter((a) => a.id !== id)
    this.scheduleWrite()
  }

  setUserPinned(id: string, pinned: boolean): MemoryFact | null {
    const f = this.getFact(id)
    if (!f) return null
    f.userPinned = pinned
    if (pinned) f.pinned = true
    this.scheduleWrite()
    return f
  }

  bumpRecall(kind: MemoryKind, ids: string[]): void {
    const now = new Date().toISOString()
    const set = new Set(ids)
    const list = kind === 'fact' ? this.state.facts : this.state.artifacts
    for (const r of list) if (set.has(r.id)) { r.useCount += 1; r.lastUsedAt = now }
    this.scheduleWrite()
  }

  /** Recompute scores, set effective pins (user pins + top FACT_PIN_BUDGET, global-leaning),
   *  archive stale unpinned facts and over-cap tail. */
  rerank(now: number = Date.now()): void {
    for (const f of this.state.facts) f.score = factScore(f, now)
    for (const a of this.state.artifacts) a.score = artifactScore(a, now)

    // Archive stale unpinned facts untouched past the window.
    for (const f of this.state.facts) {
      if (f.userPinned || f.archived) continue
      const ref = Date.parse(f.lastUsedAt ?? f.createdAt)
      if (!Number.isNaN(ref) && now - ref > ARCHIVE_AFTER_MS) f.archived = true
    }

    // Cap-driven archival: keep the highest-score unpinned facts under maxFacts.
    const active = this.state.facts.filter((f) => !f.archived)
    if (active.length > this.maxFacts) {
      const unpinned = active.filter((f) => !f.userPinned).sort((a, b) => a.score - b.score)
      let over = active.length - this.maxFacts
      for (const f of unpinned) { if (over <= 0) break; f.archived = true; over-- }
    }

    // Effective auto-pin: top N non-archived facts by score, weighting globals first.
    const ranked = this.state.facts
      .filter((f) => !f.archived)
      .sort((a, b) => (Number(b.entity === null) - Number(a.entity === null)) || (b.score - a.score))
    const autoPin = new Set(ranked.slice(0, FACT_PIN_BUDGET).map((f) => f.id))
    for (const f of this.state.facts) f.pinned = f.userPinned || autoPin.has(f.id)

    this.scheduleWrite()
  }
}

function dedupeTags(xs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = String(x).trim()
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s) }
  }
  return out.slice(0, 8)
}
