# Memory under Sources — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AxiVale a durable, self-authored memory — facts and operational artifacts it writes via a `remember` tool and the user curates in a UI — surfaced as a new entry under Sources and recalled via a `recall` tool plus a pinned-facts block in the system prompt.

**Architecture:** Mirror the existing `metaStore` (JSON, atomic writes) + `meta/rag` (LanceDB + `Xenova/all-MiniLM-L6-v2` embedder, hybrid FTS+vector search) split. Records live in `userData/memory.json` and are authoritative; a derived LanceDB table (`userData/memory-lance/`) provides hybrid recall and semantic-dedup neighbor lookups. A `MemoryService` orchestrates store + index so they stay in sync. Two new tools (`remember`, `recall`) plug into `buildOfficerTools`; a `buildMemoryReference()` block plugs into `agent.ts` like `buildMetaReference()`.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), `@lancedb/lancedb`, `@xenova/transformers`, `@anthropic-ai/claude-agent-sdk` (`tool()` + Zod), React + `@testing-library/react`, Vitest.

## Global Constraints

- **Embedding model:** `Xenova/all-MiniLM-L6-v2`, `EMBED_DIM = 384`. Reuse the existing `TransformersEmbedder` instance (`metaEmbedder`) — do NOT construct a second embedder.
- **Store persistence:** debounced (300ms) atomic tmp+rename writes, corrupt-file-safe (return empty state), file mode `0o600` — copy `src/main/metaStore.ts` exactly.
- **Identity keys:** an entity anchor is `"<discord_member_id>"`, `"acct:<accountName>"`, or `null` (global). Resolve loose names with the existing `rankIdentities` (`src/main/identityResolve.ts`) — do NOT write new fuzzy matching.
- **Tool result shape:** wrap handlers with `safe(...)` from `src/main/tools/shared.ts`; results are compact JSON for the model.
- **Vitest:** `pool: 'forks'`, `maxForks: 2` (already configured — respect it). Tests live next to source as `*.test.ts` / `*.test.tsx`.
- **`remember` is non-destructive:** do NOT add it to `DESTRUCTIVE_TOOLS`. Deletion is UI/IPC-only; the agent never deletes.
- **Scoring constants:** `HALF_LIFE_MS = 21 days`, `FACT_PIN_BUDGET = 40`, `ARCHIVE_AFTER_MS = 180 days`, fact semantic-dup cosine `>= 0.9`, artifact semantic-dup cosine `>= 0.85`.

---

## File Structure

**New (main):**
- `src/main/memory/types.ts` — `MemoryFact`, `MemoryArtifact`, kind/source unions, recall result types.
- `src/main/memory/normalize.ts` — `normalizeMemoryBody()`, `cosine()` (pure).
- `src/main/memory/score.ts` — `factScore()`, `artifactScore()`, constants (pure).
- `src/main/memoryStore.ts` — `MemoryStore`: JSON CRUD, exact-norm dedup helpers, `rerank()`.
- `src/main/memory/index.ts` — `MemoryIndex` interface + `LanceMemoryIndex` + `FakeMemoryIndex` (test helper).
- `src/main/memory/service.ts` — `MemoryService`: orchestrates store + index (remember/recall/CRUD/reindex).
- `src/main/tools/memory.ts` — `buildMemoryTools(deps)` (`remember`, `recall`).
- `src/main/memoryPrompt.ts` — `buildMemoryReference(facts)`.

**New (renderer):**
- `src/renderer/src/components/memory/MemoryPanel.tsx` — management UI.
- `src/renderer/src/components/memory/MemoryRollup.tsx` — roster "What AxiVale knows" block.

**Modified:**
- `src/main/tools/shared.ts` — add `memory` + `resolveEntityKey` to `ToolDeps`.
- `src/main/tools/index.ts` — register `buildMemoryTools`.
- `src/main/agent.ts` — `AgentDeps.pinnedMemory`, inject `buildMemoryReference` (cloud only).
- `src/main/index.ts` — instantiate store/index/service, `resolveEntityKey`, IPC handlers, `memory:progress`.
- `src/preload/index.ts` + `src/preload/index.d.ts` — `memory*` bridge + renderer types.
- `src/renderer/src/components/meta/MetaNav.tsx` — add a Memory item (sentinel `MEMORY_VIEW`).
- `src/renderer/src/App.tsx` — route `MEMORY_VIEW` to `MemoryPanel`.
- `src/renderer/src/components/panels/Roster.tsx` — mount `MemoryRollup` beside notes.

---

## Task 1: Memory types + pure helpers

**Files:**
- Create: `src/main/memory/types.ts`
- Create: `src/main/memory/normalize.ts`
- Test: `src/main/memory/normalize.test.ts`

**Interfaces:**
- Produces (`types.ts`): `ArtifactKind = 'playbook'|'anti_pattern'|'heuristic'`; `MemoryKind = 'fact'|ArtifactKind`; `MemorySource = 'agent'|'user'`; `MemoryFact`, `MemoryArtifact`, `RecalledFact`, `RecalledArtifact`, `MemoryRecallResult` (full shapes below).
- Produces (`normalize.ts`): `normalizeMemoryBody(s: string): string`; `cosine(a: number[], b: number[]): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/memory/normalize.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeMemoryBody, cosine } from './normalize'

describe('normalizeMemoryBody', () => {
  it('lowercases, collapses whitespace, strips leading bullets and trailing dates', () => {
    expect(normalizeMemoryBody('- Prefers   WvW  small-scale')).toBe('prefers wvw small-scale')
    expect(normalizeMemoryBody('Raids Tue/Thu (2026-06-16)')).toBe('raids tue/thu')
    expect(normalizeMemoryBody('* Mains Firebrand.')).toBe('mains firebrand')
  })
})

describe('cosine', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })
  it('returns 0 on zero or mismatched-length vectors', () => {
    expect(cosine([0, 0], [1, 0])).toBe(0)
    expect(cosine([1], [1, 0])).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memory/normalize.test.ts`
Expected: FAIL — cannot find module `./normalize`.

- [ ] **Step 3: Write `types.ts`**

```ts
// src/main/memory/types.ts
//
// Durable officer memory: facts (one-liners) + artifacts (operational know-how).
// Records live in userData/memory.json (authoritative); the LanceDB table is a
// derived recall/dedup index. See docs/superpowers/specs/2026-06-16-memory-sources-design.md.

export type ArtifactKind = 'playbook' | 'anti_pattern' | 'heuristic'
export type MemoryKind = 'fact' | ArtifactKind
export type MemorySource = 'agent' | 'user'

export interface MemoryFact {
  id: string
  body: string
  bodyNorm: string
  /** Roster identity key the fact is about, or null for a global/guild fact. */
  entity: string | null
  tags: string[]
  /** Effective pin (userPinned OR top-score auto-pin) — what gets injected. */
  pinned: boolean
  /** Sticky user intent; auto-pin can never clear this. */
  userPinned: boolean
  useCount: number
  score: number
  source: MemorySource
  createdAt: string
  lastUsedAt: string | null
  archived: boolean
}

export interface MemoryArtifact {
  id: string
  kind: ArtifactKind
  title: string
  body: string
  bodyNorm: string
  tags: string[]
  entity: string | null
  useCount: number
  score: number
  source: MemorySource
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  archived: boolean
}

export interface RecalledFact {
  id: string
  body: string
  entity: string | null
  entityName?: string
  tags: string[]
  source: MemorySource
  learnedAt: string
  lastUsedAt: string | null
  timesUsed: number
}

export interface RecalledArtifact {
  id: string
  kind: ArtifactKind
  title: string
  body: string
  tags: string[]
  source: MemorySource
  updatedAt: string
  lastUsedAt: string | null
  timesUsed: number
}

export interface MemoryRecallResult {
  facts: RecalledFact[]
  artifacts: RecalledArtifact[]
}
```

- [ ] **Step 4: Write `normalize.ts`**

```ts
// src/main/memory/normalize.ts
//
// Pure helpers: body normalization for exact dedup, and cosine similarity for
// semantic dedup (metric-agnostic — computed in JS over stored vectors).

/** Lowercase, strip a leading bullet, drop a trailing parenthetical/bare date and
 *  trailing punctuation, collapse whitespace. Stable key for exact-dedup. */
export function normalizeMemoryBody(s: string): string {
  return s
    .replace(/^[\s*\-•]+/, '')
    .replace(/\s*\(?\b\d{4}-\d{2}-\d{2}\b\)?\s*$/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/memory/normalize.test.ts`
Expected: PASS (2 suites, 4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/memory/types.ts src/main/memory/normalize.ts src/main/memory/normalize.test.ts
git commit -m "feat(memory): record types + normalize/cosine helpers"
```

---

## Task 2: Scoring + rerank math

**Files:**
- Create: `src/main/memory/score.ts`
- Test: `src/main/memory/score.test.ts`

**Interfaces:**
- Consumes: `MemoryFact`, `MemoryArtifact` from `./types`.
- Produces: `HALF_LIFE_MS`, `FACT_PIN_BUDGET`, `ARCHIVE_AFTER_MS`, `FACT_DUP_COSINE`, `ARTIFACT_DUP_COSINE` constants; `factScore(f: MemoryFact, now: number): number`; `artifactScore(a: MemoryArtifact, now: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/memory/score.test.ts
import { describe, it, expect } from 'vitest'
import { factScore, HALF_LIFE_MS } from './score'
import type { MemoryFact } from './types'

const base: MemoryFact = {
  id: 'a', body: 'x', bodyNorm: 'x', entity: null, tags: [],
  pinned: false, userPinned: false, useCount: 0, score: 0,
  source: 'agent', createdAt: '', lastUsedAt: null, archived: false
}
const now = 1_000_000_000_000

describe('factScore', () => {
  it('decays to half over one half-life', () => {
    const fresh = factScore({ ...base, lastUsedAt: new Date(now).toISOString() }, now)
    const old = factScore({ ...base, lastUsedAt: new Date(now - HALF_LIFE_MS).toISOString() }, now)
    expect(old).toBeCloseTo(fresh / 2, 3)
  })
  it('ranks user source above agent source, all else equal', () => {
    const iso = new Date(now).toISOString()
    expect(factScore({ ...base, source: 'user', createdAt: iso }, now))
      .toBeGreaterThan(factScore({ ...base, source: 'agent', createdAt: iso }, now))
  })
  it('gives user-pinned facts a dominating constant', () => {
    const ancient = new Date(now - 10 * HALF_LIFE_MS).toISOString()
    expect(factScore({ ...base, userPinned: true, lastUsedAt: ancient }, now))
      .toBeGreaterThan(factScore({ ...base, source: 'user', lastUsedAt: new Date(now).toISOString() }, now))
  })
  it('uses createdAt when never recalled', () => {
    expect(factScore({ ...base, createdAt: new Date(now).toISOString() }, now)).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memory/score.test.ts`
Expected: FAIL — cannot find module `./score`.

- [ ] **Step 3: Write `score.ts`**

```ts
// src/main/memory/score.ts
//
// Pure scoring for memory rerank. score = base(source/pin) * recencyDecay *
// (1 + 0.25*log1p(useCount)). Recency uses lastUsedAt, falling back to createdAt.

import type { MemoryFact, MemoryArtifact } from './types'

export const HALF_LIFE_MS = 21 * 86_400_000
export const ARCHIVE_AFTER_MS = 180 * 86_400_000
export const FACT_PIN_BUDGET = 40
export const FACT_DUP_COSINE = 0.9
export const ARTIFACT_DUP_COSINE = 0.85

const USER_PIN_BASE = 1_000_000
const USER_BASE = 2
const AGENT_BASE = 1
const USE_WEIGHT = 0.25

function recency(lastUsedAt: string | null, createdAt: string, now: number): number {
  const ref = lastUsedAt ?? createdAt
  const t = Date.parse(ref)
  if (Number.isNaN(t)) return 1
  return Math.exp(-Math.max(0, now - t) / HALF_LIFE_MS)
}

export function factScore(f: MemoryFact, now: number): number {
  const base = f.userPinned ? USER_PIN_BASE : f.source === 'user' ? USER_BASE : AGENT_BASE
  return base * recency(f.lastUsedAt, f.createdAt, now) * (1 + USE_WEIGHT * Math.log1p(f.useCount))
}

export function artifactScore(a: MemoryArtifact, now: number): number {
  const base = a.source === 'user' ? USER_BASE : AGENT_BASE
  return base * recency(a.lastUsedAt, a.updatedAt, now) * (1 + USE_WEIGHT * Math.log1p(a.useCount))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/memory/score.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/score.ts src/main/memory/score.test.ts
git commit -m "feat(memory): recency-decay scoring with sticky user pins"
```

---

## Task 3: MemoryStore (JSON persistence, CRUD, dedup-by-norm, rerank)

**Files:**
- Create: `src/main/memoryStore.ts`
- Test: `src/main/memoryStore.test.ts`

**Interfaces:**
- Consumes: types from `./memory/types`; `normalizeMemoryBody` from `./memory/normalize`; `factScore`, `artifactScore`, `FACT_PIN_BUDGET`, `ARCHIVE_AFTER_MS` from `./memory/score`.
- Produces: `class MemoryStore` with:
  - `constructor(path: string, opts?: { maxFacts?: number })`
  - `list(opts?: { includeArchived?: boolean }): { facts: MemoryFact[]; artifacts: MemoryArtifact[] }`
  - `factsForEntity(entity: string): MemoryFact[]`
  - `findFactByNorm(bodyNorm: string, entity: string | null): MemoryFact | null`
  - `findArtifactByNorm(bodyNorm: string): MemoryArtifact | null`
  - `insertFact(seed: { body: string; entity: string | null; tags: string[]; source: MemorySource }): MemoryFact`
  - `insertArtifact(seed: { kind: ArtifactKind; title: string; body: string; entity: string | null; tags: string[]; source: MemorySource }): MemoryArtifact`
  - `markFactRelearned(id: string, extra: { entity?: string | null; tags?: string[] }): MemoryFact | null`
  - `updateFact(id: string, patch: Partial<Pick<MemoryFact, 'body'|'entity'|'tags'|'archived'>>): MemoryFact | null`
  - `updateArtifact(id: string, patch: Partial<Pick<MemoryArtifact, 'title'|'body'|'tags'|'archived'>>): MemoryArtifact | null`
  - `deleteFact(id: string): void` / `deleteArtifact(id: string): void`
  - `setUserPinned(id: string, pinned: boolean): MemoryFact | null`
  - `bumpRecall(kind: MemoryKind, ids: string[]): void`
  - `rerank(now?: number): void`
  - `flush(): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/memoryStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from './memoryStore'

function freshPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json')
}

describe('MemoryStore', () => {
  let store: MemoryStore
  beforeEach(() => { store = new MemoryStore(freshPath()) })

  it('inserts a fact with a normalized dedup key and finds it back', () => {
    const f = store.insertFact({ body: '- Prefers WvW.', entity: null, tags: ['wvw'], source: 'agent' })
    expect(f.bodyNorm).toBe('prefers wvw')
    expect(store.findFactByNorm('prefers wvw', null)?.id).toBe(f.id)
  })

  it('scopes exact-norm dedup by entity', () => {
    store.insertFact({ body: 'plays small-scale', entity: '111', tags: [], source: 'agent' })
    expect(store.findFactByNorm('plays small-scale', '222')).toBeNull()
    expect(store.findFactByNorm('plays small-scale', '111')).not.toBeNull()
  })

  it('markFactRelearned bumps useCount, un-archives, fills missing entity, merges tags', () => {
    const f = store.insertFact({ body: 'mains fb', entity: null, tags: ['build'], source: 'agent' })
    store.updateFact(f.id, { archived: true })
    const r = store.markFactRelearned(f.id, { entity: '111', tags: ['wvw'] })
    expect(r?.archived).toBe(false)
    expect(r?.useCount).toBe(1)
    expect(r?.entity).toBe('111')
    expect(r?.tags.sort()).toEqual(['build', 'wvw'])
  })

  it('rerank auto-pins the top FACT_PIN_BUDGET and keeps user pins sticky', () => {
    for (let i = 0; i < 45; i++) store.insertFact({ body: `f${i}`, entity: null, tags: [], source: 'agent' })
    const last = store.insertFact({ body: 'sticky', entity: null, tags: [], source: 'agent' })
    store.setUserPinned(last.id, true)
    store.rerank()
    const pinned = store.list().facts.filter((f) => f.pinned)
    expect(pinned.length).toBeGreaterThanOrEqual(40)
    expect(pinned.find((f) => f.id === last.id)).toBeDefined()
  })

  it('rerank archives unpinned facts untouched past ARCHIVE_AFTER_MS', () => {
    const f = store.insertFact({ body: 'stale', entity: null, tags: [], source: 'agent' })
    store.updateFact(f.id, {}) // no-op; set createdAt below via reload is overkill — use rerank clock
    const future = Date.parse(f.createdAt) + 181 * 86_400_000
    store.rerank(future)
    expect(store.list({ includeArchived: true }).facts.find((x) => x.id === f.id)?.archived).toBe(true)
  })

  it('persists across reload', () => {
    const p = freshPath()
    const s1 = new MemoryStore(p)
    s1.insertFact({ body: 'durable', entity: null, tags: [], source: 'user' })
    s1.flush()
    const s2 = new MemoryStore(p)
    expect(s2.list().facts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memoryStore.test.ts`
Expected: FAIL — cannot find module `./memoryStore`.

- [ ] **Step 3: Write `memoryStore.ts`**

Copy the persistence skeleton (read/normalize/scheduleWrite/flush) from `src/main/metaStore.ts` verbatim in shape. Full file:

```ts
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
    return this.state.facts.length >= 0
      ? this.state.artifacts.find((a) => a.bodyNorm === bodyNorm) ?? null
      : null
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
```

> Note: `findArtifactByNorm`'s guard is written plainly as `this.state.artifacts.find(...) ?? null`; simplify the stray `facts.length >= 0` ternary to a direct return when implementing — it exists only to keep the diff obvious. Direct form:
> ```ts
> findArtifactByNorm(bodyNorm: string): MemoryArtifact | null {
>   return this.state.artifacts.find((a) => a.bodyNorm === bodyNorm) ?? null
> }
> ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/memoryStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memoryStore.ts src/main/memoryStore.test.ts
git commit -m "feat(memory): JSON store with dedup keys, recall bumps, rerank"
```

---

## Task 4: MemoryIndex interface + FakeMemoryIndex + LanceMemoryIndex

**Files:**
- Create: `src/main/memory/index.ts`
- Test: `src/main/memory/index.test.ts`

**Interfaces:**
- Consumes: `Embedder`, `EMBED_DIM` from `../meta/rag/embedder`; `cosine` from `./normalize`; `MemoryKind` from `./types`.
- Produces:
  - `interface MemoryIndexRow { id: string; kind: MemoryKind; entity: string | null; text: string }`
  - `interface MemorySearchHit { id: string; kind: MemoryKind; score: number }`
  - `interface MemoryIndexStats { total: number; byKind: Record<string, number>; lastIndexedAt: string | null }`
  - `interface MemoryIndex` with `upsert(row)`, `remove(id)`, `search(query, { entity?, kinds?, k? })`, `nearest(text, kind, { entity? })` → `{ id: string; cosine: number } | null`, `reindex(rows)`, `stats()`.
  - `class LanceMemoryIndex implements MemoryIndex`
  - `class FakeMemoryIndex implements MemoryIndex` (test/dev double; deterministic, no embedder).

- [ ] **Step 1: Write the failing test** (exercises `FakeMemoryIndex` only — the Lance impl is smoke-tested in Task 8 wiring via the app)

```ts
// src/main/memory/index.test.ts
import { describe, it, expect } from 'vitest'
import { FakeMemoryIndex } from './index'

describe('FakeMemoryIndex', () => {
  it('search matches on shared words and filters by entity (entity OR global)', async () => {
    const ix = new FakeMemoryIndex()
    await ix.upsert({ id: '1', kind: 'fact', entity: '111', text: 'prefers wvw small scale' })
    await ix.upsert({ id: '2', kind: 'fact', entity: '222', text: 'prefers pve raids' })
    await ix.upsert({ id: '3', kind: 'fact', entity: null, text: 'guild raids tuesday wvw' })
    const hits = await ix.search('wvw', { entity: '111' })
    const ids = hits.map((h) => h.id)
    expect(ids).toContain('1')
    expect(ids).toContain('3')
    expect(ids).not.toContain('2')
  })

  it('nearest returns the best same-kind candidate with a cosine score', async () => {
    const ix = new FakeMemoryIndex()
    await ix.upsert({ id: '1', kind: 'fact', entity: null, text: 'mains firebrand support' })
    const near = await ix.nearest('mains firebrand support', 'fact', {})
    expect(near?.id).toBe('1')
    expect(near?.cosine).toBeGreaterThan(0.99)
  })

  it('remove drops a row', async () => {
    const ix = new FakeMemoryIndex()
    await ix.upsert({ id: '1', kind: 'fact', entity: null, text: 'x y z' })
    await ix.remove('1')
    expect(await ix.search('x', {})).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memory/index.test.ts`
Expected: FAIL — cannot find module `./index` export `FakeMemoryIndex`.

- [ ] **Step 3: Write `index.ts`** (model `LanceMemoryIndex` on `src/main/meta/rag/index.ts`; add `FakeMemoryIndex` for tests)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/memory/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/index.ts src/main/memory/index.test.ts
git commit -m "feat(memory): LanceDB index + deterministic fake for hybrid recall/dedup"
```

---

## Task 5: MemoryService (orchestrate store + index)

**Files:**
- Create: `src/main/memory/service.ts`
- Test: `src/main/memory/service.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` (`../memoryStore`); `MemoryIndex` (`./index`); `FACT_DUP_COSINE`, `ARTIFACT_DUP_COSINE` (`./score`); types (`./types`).
- Produces: `class MemoryService` with:
  - `constructor(store: MemoryStore, index: MemoryIndex, opts?: { entityName?: (key: string) => string | undefined })`
  - `remember(input: { kind: MemoryKind; body: string; title?: string; entity?: string | null; tags?: string[]; source?: MemorySource }): Promise<{ id: string; kind: MemoryKind; merged: boolean }>`
  - `recall(input: { query: string; entity?: string | null; kinds?: MemoryKind[]; limit?: number }): Promise<MemoryRecallResult>`
  - `createManual(...)` (same input as `remember` minus `source`, forces `source:'user'`) — delegates to `remember`
  - `updateFact(id, patch)` / `updateArtifact(id, patch)` — store update + index re-upsert
  - `deleteFact(id)` / `deleteArtifact(id)` — store delete + index remove
  - `setPinned(id, pinned)` — store + rerank
  - `list(opts)` — `store.rerank()` then `store.list(opts)`
  - `factsForEntity(entity)` — `store.factsForEntity`
  - `reindexAll(): Promise<void>` — rebuild index from all (incl. archived) records
  - `indexStats()` — `index.stats()`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/memory/service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memoryStore'
import { FakeMemoryIndex } from './index'
import { MemoryService } from './service'

function svc(): { service: MemoryService; store: MemoryStore; index: FakeMemoryIndex } {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json'))
  const index = new FakeMemoryIndex()
  const service = new MemoryService(store, index, { entityName: (k) => (k === '111' ? 'Zara' : undefined) })
  return { service, store, index }
}

describe('MemoryService.remember', () => {
  it('creates a new fact and indexes it', async () => {
    const { service, index } = svc()
    const r = await service.remember({ kind: 'fact', body: 'Zara prefers WvW small-scale', entity: '111', tags: ['wvw'] })
    expect(r.merged).toBe(false)
    expect((await index.search('wvw', { entity: '111' })).map((h) => h.id)).toContain(r.id)
  })

  it('merges an exact-duplicate fact instead of inserting twice', async () => {
    const { service, store } = svc()
    await service.remember({ kind: 'fact', body: 'mains firebrand', entity: null })
    const r2 = await service.remember({ kind: 'fact', body: 'Mains firebrand.', entity: null })
    expect(r2.merged).toBe(true)
    expect(store.list().facts).toHaveLength(1)
    expect(store.list().facts[0].useCount).toBe(1)
  })

  it('merges a semantic near-duplicate above the cosine threshold', async () => {
    const { service, store } = svc()
    await service.remember({ kind: 'fact', body: 'plays wvw small scale roaming', entity: null })
    const r2 = await service.remember({ kind: 'fact', body: 'plays wvw small scale roaming often', entity: null })
    expect(r2.merged).toBe(true)
    expect(store.list().facts).toHaveLength(1)
  })

  it('keeps the same sentence about different entities as distinct facts', async () => {
    const { service, store } = svc()
    await service.remember({ kind: 'fact', body: 'plays small scale', entity: '111' })
    await service.remember({ kind: 'fact', body: 'plays small scale', entity: '222' })
    expect(store.list().facts).toHaveLength(2)
  })
})

describe('MemoryService.recall', () => {
  it('returns provenance and the resolved entity name, and bumps useCount', async () => {
    const { service, store } = svc()
    const { id } = await service.remember({ kind: 'fact', body: 'Zara prefers wvw', entity: '111' })
    const out = await service.recall({ query: 'wvw', entity: '111', limit: 5 })
    expect(out.facts[0].id).toBe(id)
    expect(out.facts[0].entityName).toBe('Zara')
    expect(out.facts[0].timesUsed).toBeGreaterThanOrEqual(0)
    expect(store.getFact(id)?.useCount).toBe(1)
  })
})

describe('MemoryService.reindexAll', () => {
  it('rebuilds the index from all stored records', async () => {
    const { service, index } = svc()
    await service.remember({ kind: 'fact', body: 'alpha beta', entity: null })
    await service.remember({ kind: 'heuristic', body: 'gamma delta', title: 'A rule', entity: null })
    await index.reindex([]) // wipe
    await service.reindexAll()
    expect((await index.stats()).total).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memory/service.test.ts`
Expected: FAIL — cannot find module `./service`.

- [ ] **Step 3: Write `service.ts`**

```ts
// src/main/memory/service.ts
//
// Orchestrates MemoryStore (records) + MemoryIndex (vectors), keeping them in
// sync. Owns the write-time dedup decision (exact-norm then semantic cosine) and
// the recall value-boost. Entity-name resolution is injected (lazy roster lookup).

import type { MemoryStore } from '../memoryStore'
import type { MemoryIndex } from './index'
import { normalizeMemoryBody } from './normalize'
import { FACT_DUP_COSINE, ARTIFACT_DUP_COSINE } from './score'
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
    const limit = Math.min(input.limit ?? 5, 20)
    const hits = await this.index.search(input.query, { entity: input.entity ?? null, kinds: input.kinds, k: limit * 2 })

    const factHits = hits.filter((h) => h.kind === 'fact')
    const artHits = hits.filter((h) => h.kind !== 'fact')

    // Value-boost facts by stored score (log-damped), preserving search rank as the base.
    const facts: RecalledFact[] = factHits
      .map((h, i) => ({ h, i, f: this.store.getFact(h.id) }))
      .filter((x) => x.f && !x.f.archived)
      .map((x) => ({ x, boost: (1 / (i0(x.i))) * (1 + 0.25 * Math.log1p(x.f!.score)) }))
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
```

> Implementation note for Step 3: the `facts` map uses `x.i` for the rank base — write it as `boost: (1 / i0(x.i)) * (1 + 0.25 * Math.log1p(x.f!.score))`. The `bumpRecall('playbook', ...)` call selects the artifact list (any non-`'fact'` kind routes to artifacts in `MemoryStore.bumpRecall`); keep that behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/memory/service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/memory/service.ts src/main/memory/service.test.ts
git commit -m "feat(memory): service orchestrating dedup writes + value-boosted recall"
```

---

## Task 6: `remember` + `recall` tools

**Files:**
- Modify: `src/main/tools/shared.ts` (add to `ToolDeps`)
- Create: `src/main/tools/memory.ts`
- Modify: `src/main/tools/index.ts` (register)
- Test: `src/main/tools/memory.test.ts`

**Interfaces:**
- Consumes: `ToolDeps` (extended), `MemoryService` (`../memory/service`).
- Produces: `buildMemoryTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>>` exposing `remember` and `recall`. New `ToolDeps` fields: `memory: () => MemoryService`; `resolveEntityKey: (name: string) => Promise<{ key: string; name: string } | null>`.

- [ ] **Step 1: Add the two `ToolDeps` fields**

In `src/main/tools/shared.ts`, add an import and two fields to the `ToolDeps` interface (after `generalIndex`):

```ts
import type { MemoryService } from '../memory/service'
```
```ts
  /** Durable officer memory (facts + artifacts). */
  memory: () => MemoryService
  /** Resolve a loose name to a single roster identity key, or null if ambiguous/none. */
  resolveEntityKey: (name: string) => Promise<{ key: string; name: string } | null>
```

- [ ] **Step 2: Write the failing test**

```ts
// src/main/tools/memory.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memoryStore'
import { FakeMemoryIndex } from '../memory/index'
import { MemoryService } from '../memory/service'
import { buildMemoryTools } from './memory'
import type { ToolDeps } from './shared'

function deps(over: Partial<ToolDeps> = {}): { deps: ToolDeps; service: MemoryService } {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json'))
  const service = new MemoryService(store, new FakeMemoryIndex(), { entityName: (k) => (k === '111' ? 'Zara' : undefined) })
  const d = {
    memory: () => service,
    resolveEntityKey: async (name: string) => (name.toLowerCase().includes('zara') ? { key: '111', name: 'Zara' } : null)
  } as unknown as ToolDeps
  return { deps: { ...d, ...over }, service }
}
const call = async (t: { handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[] }> }, args: unknown) =>
  JSON.parse((await t.handler(args, {})).content[0].text)

describe('remember tool', () => {
  it('resolves a loose entity name and anchors the fact', async () => {
    const { deps: d, service } = deps()
    const tools = buildMemoryTools(d)
    const remember = tools.find((t) => t.name === 'remember')!
    const out = await call(remember, { kind: 'fact', body: 'prefers wvw', entity: 'zara' })
    expect(out.merged).toBe(false)
    expect(service.list().facts[0].entity).toBe('111')
  })

  it('stores entity:null and folds an unresolved name into tags', async () => {
    const { deps: d, service } = deps()
    const remember = buildMemoryTools(d).find((t) => t.name === 'remember')!
    await call(remember, { kind: 'fact', body: 'likes condi', entity: 'nobodyhere' })
    const f = service.list().facts[0]
    expect(f.entity).toBeNull()
    expect(f.tags).toContain('nobodyhere')
  })
})

describe('recall tool', () => {
  it('returns matching facts with provenance', async () => {
    const { deps: d } = deps()
    const tools = buildMemoryTools(d)
    await call(tools.find((t) => t.name === 'remember')!, { kind: 'fact', body: 'zara plays wvw small scale', entity: 'zara' })
    const out = await call(tools.find((t) => t.name === 'recall')!, { query: 'wvw', entity: 'zara' })
    expect(out.facts[0].body).toContain('wvw')
    expect(out.facts[0].entityName).toBe('Zara')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/tools/memory.test.ts`
Expected: FAIL — cannot find module `./memory`.

- [ ] **Step 4: Write `tools/memory.ts`**

```ts
// src/main/tools/memory.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, type ToolDeps } from './shared'

const KIND = z.enum(['fact', 'playbook', 'anti_pattern', 'heuristic'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMemoryTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'remember',
      'Save a durable memory so future sessions can reuse it. kind "fact" = a short standing truth (a person\'s build/comp preference, a schedule, a guild convention); "playbook"/"anti_pattern"/"heuristic" = operational know-how (needs a title + markdown body). Pass entity (a person\'s name/handle like "Zara" or "@zara") when the memory is ABOUT someone — it is resolved to that roster member. Use this when you learn something worth keeping, not for one-off chat. Non-destructive; saved immediately.',
      {
        kind: KIND,
        body: z.string().describe('Fact text, or the artifact markdown body'),
        title: z.string().optional().describe('Required for playbook/anti_pattern/heuristic'),
        entity: z.string().optional().describe('Person this is about — a loose name/handle to resolve, e.g. "Zara"'),
        tags: z.array(z.string()).optional().describe('Lowercase labels, e.g. ["wvw","build"]')
      },
      safe(async ({ kind, body, title, entity, tags }: {
        kind: 'fact' | 'playbook' | 'anti_pattern' | 'heuristic'
        body: string; title?: string; entity?: string; tags?: string[]
      }) => {
        let key: string | null = null
        let resolvedName: string | undefined
        const extraTags = [...(tags ?? [])]
        if (entity && entity.trim()) {
          const hit = await deps.resolveEntityKey(entity)
          if (hit) { key = hit.key; resolvedName = hit.name }
          else extraTags.push(entity.trim()) // unresolved → keep the name as a tag
        }
        const r = await deps.memory().remember({ kind, body, title, entity: key, tags: extraTags })
        return { id: r.id, kind: r.kind, merged: r.merged, entity: key, entity_name: resolvedName }
      })
    ),
    tool(
      'recall',
      "Search AxiVale's durable memory from past sessions. Call at the START of a task that resembles past work or concerns a specific person, before answering from scratch. Pass entity (a name/handle) to focus on that person (their facts plus global ones). Returns facts and operational artifacts with provenance (when learned, how often used) — weigh fresh, frequently-used memory over stale.",
      {
        query: z.string().describe('What to look up, e.g. "comp style" or "raid schedule"'),
        entity: z.string().optional().describe('Focus on this person — a loose name/handle'),
        kinds: z.array(KIND).optional().describe('Filter to these memory kinds'),
        limit: z.number().optional().describe('Max results (default 5, max 20)')
      },
      safe(async ({ query, entity, kinds, limit }: {
        query: string; entity?: string; kinds?: Array<'fact' | 'playbook' | 'anti_pattern' | 'heuristic'>; limit?: number
      }) => {
        let key: string | null = null
        if (entity && entity.trim()) key = (await deps.resolveEntityKey(entity))?.key ?? null
        const out = await deps.memory().recall({ query, entity: key, kinds, limit })
        if (out.facts.length === 0 && out.artifacts.length === 0) return { note: 'no matching memory yet' }
        return out
      })
    )
  ]
}
```

- [ ] **Step 5: Register in `tools/index.ts`**

Add the import and spread it into `buildOfficerTools`:

```ts
import { buildMemoryTools } from './memory'
```
```ts
    ...buildGeneralSearchTools(deps.generalIndex),
    ...buildMemoryTools(deps)
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/main/tools/memory.test.ts`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: PASS (no type errors — `ToolDeps` now requires `memory`/`resolveEntityKey`; the only real construction site is `src/main/index.ts`, wired in Task 8. If typecheck fails ONLY there, that's expected and resolved in Task 8 — note it and proceed; all other files must typecheck.)

- [ ] **Step 7: Commit**

```bash
git add src/main/tools/shared.ts src/main/tools/memory.ts src/main/tools/index.ts src/main/tools/memory.test.ts
git commit -m "feat(memory): remember + recall tools with entity resolution"
```

---

## Task 7: Pinned-facts system-prompt block

**Files:**
- Create: `src/main/memoryPrompt.ts`
- Modify: `src/main/agent.ts` (`AgentDeps.pinnedMemory`, inject for cloud)
- Test: `src/main/memoryPrompt.test.ts`

**Interfaces:**
- Consumes: `MemoryFact` from `./memory/types`.
- Produces: `buildMemoryReference(facts: MemoryFact[]): string` (empty string when no pinned facts). New `AgentDeps` field: `pinnedMemory: () => MemoryFact[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/memoryPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildMemoryReference } from './memoryPrompt'
import type { MemoryFact } from './memory/types'

const f = (over: Partial<MemoryFact>): MemoryFact => ({
  id: 'x', body: 'b', bodyNorm: 'b', entity: null, tags: [], pinned: true, userPinned: false,
  useCount: 0, score: 0, source: 'agent', createdAt: '', lastUsedAt: null, archived: false, ...over
})

describe('buildMemoryReference', () => {
  it('returns empty string with no facts', () => {
    expect(buildMemoryReference([])).toBe('')
  })
  it('renders a heading and one bullet per fact', () => {
    const out = buildMemoryReference([f({ body: 'Raids Tue/Thu 8pm EST' }), f({ body: 'Prefers Snowcrows' })])
    expect(out).toContain('# What AxiVale remembers')
    expect(out).toContain('- Raids Tue/Thu 8pm EST')
    expect(out).toContain('- Prefers Snowcrows')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/memoryPrompt.test.ts`
Expected: FAIL — cannot find module `./memoryPrompt`.

- [ ] **Step 3: Write `memoryPrompt.ts`**

```ts
// src/main/memoryPrompt.ts
//
// Builds the per-turn "What AxiVale remembers" block: the pinned durable facts,
// injected into the system prompt for cloud providers (mirrors metaPrompt.ts).
// Returns '' (no leading separator) when there is nothing pinned — zero overhead.

import type { MemoryFact } from './memory/types'

const MAX_CHARS = 4000

export function buildMemoryReference(facts: MemoryFact[]): string {
  if (facts.length === 0) return ''
  const lines: string[] = []
  let used = 0
  for (const f of facts) {
    const line = `- ${f.body}`
    if (used + line.length > MAX_CHARS) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return (
    `\n\n# What AxiVale remembers\n` +
    `Durable facts learned across past sessions. Treat as standing context; when a ` +
    `task concerns a specific person or resembles past work, also call recall for detail.\n` +
    lines.join('\n')
  )
}
```

- [ ] **Step 4: Wire into `agent.ts`**

Add the import (next to `buildMetaReference`):
```ts
import { buildMemoryReference } from './memoryPrompt'
```
Add to the `AgentDeps` interface (after `meta`):
```ts
  /** Pinned durable memory facts, read fresh per turn (cloud-only context). */
  pinnedMemory: () => MemoryFact[]
```
Add the type import at the top of `agent.ts` (with the other `import type`):
```ts
import type { MemoryFact } from './memory/types'
```
In `runTurn`, extend the cloud-only branch of `systemPrompt` to append the memory block:
```ts
      const systemPrompt =
        (provider === 'local'
          ? base
          : base +
            buildMetaReference(this.deps.meta()) +
            buildPlaybookReference(this.deps.meta()) +
            buildMemoryReference(this.deps.pinnedMemory())) +
        dateLine
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/main/memoryPrompt.test.ts`
Expected: PASS (2 tests).
Run: `npx vitest run src/main/agent.test.ts src/main/systemPrompt.test.ts`
Expected: PASS — if `agent.test.ts` constructs `AgentDeps`, add `pinnedMemory: () => []` to its fixture so it compiles; make that edit and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/main/memoryPrompt.ts src/main/memoryPrompt.test.ts src/main/agent.ts src/main/agent.test.ts
git commit -m "feat(memory): inject pinned facts into the cloud system prompt"
```

---

## Task 8: Main-process wiring (instantiate, resolveEntityKey, IPC)

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `MemoryStore`, `LanceMemoryIndex`/`FakeMemoryIndex`, `MemoryService`, existing `metaEmbedder`, `rankIdentities`/`mergeManualLinks`.
- Produces (IPC channels): `memory:list`, `memory:search`, `memory:create`, `memory:update`, `memory:delete`, `memory:pin`, `memory:reindex`, `memory:index-stats`, `memory:facts-for-entity`; renderer event `memory:progress`.

> No unit test for wiring; verified by `npm run typecheck` and an app smoke run (Task 12 verification). This task is the integration seam, so fold setup + all handlers into one commit.

- [ ] **Step 1: Add imports**

Near the other memory/meta imports (around line 50-64 of `src/main/index.ts`):
```ts
import { MemoryStore } from './memoryStore'
import { LanceMemoryIndex } from './memory/index'
import { MemoryService } from './memory/service'
import { rankIdentities, mergeManualLinks, type ResolveMemberLite } from './identityResolve'
```
(If `identityResolve` symbols are already imported elsewhere in the file, extend that import instead of duplicating.)

- [ ] **Step 2: Instantiate the store/index/service**

After the line `const generalIndex = new LanceMetaIndex(... 'general-lance' ...)` (≈ line 279), add:
```ts
  const memoryStore = new MemoryStore(join(app.getPath('userData'), 'memory.json'))
  const memoryIndex = new LanceMemoryIndex(join(app.getPath('userData'), 'memory-lance'), metaEmbedder)
```

- [ ] **Step 3: Build the entity-name resolver + `resolveEntityKey`, then the service**

The display-name lookup duplicates the `resolve_identity` tool's member gathering; factor it as a local helper so both the tool path and memory share it. After the store/index lines add:

```ts
  // Resolve a loose name to a single roster identity key (member_id or acct:<name>),
  // returning null when nothing matches or the top two candidates tie (ambiguous).
  async function resolveEntityKey(name: string): Promise<{ key: string; name: string } | null> {
    const gid = store.getSetting('guildId') ?? ''
    if (gid === '') return null
    let raw: ResolveMemberLite[] = []
    try { raw = (await buildAxitools().membersLinked(gid)) as ResolveMemberLite[] } catch { raw = [] }
    const anns = rosterAnnotations.list()
    const acctMembers: ResolveMemberLite[] = anns
      .filter((a) => a.memberId.startsWith('acct:'))
      .map((a) => ({ member_id: a.memberId, accounts: [{ account_name: a.memberId.slice(5) }] }))
    const members = [...mergeManualLinks(raw, rosterLinks.list()), ...acctMembers]
    const ranked = rankIdentities(name, members, anns, 2)
    if (ranked.length === 0) return null
    if (ranked.length > 1 && ranked[1].score >= ranked[0].score) return null // ambiguous tie
    const top = ranked[0]
    const label = top.nickname || top.display_name || top.member_name || top.account_names[0] || name
    return { key: top.member_id, name: label }
  }

  // Best-effort display name for a stored identity key (for recall provenance).
  function entityDisplay(key: string): string | undefined {
    if (key.startsWith('acct:')) return key.slice(5)
    const a = rosterAnnotations.list().find((x) => x.memberId === key)
    return a?.nickname || (a?.aliases?.[0]) || undefined
  }

  const memoryService = new MemoryService(memoryStore, memoryIndex, { entityName: entityDisplay })
```

> `buildAxitools`, `rosterAnnotations`, `rosterLinks`, and `store` are all already defined above this point in `index.ts` (see lines 270-273, 458). Place this block after they exist.

- [ ] **Step 4: Boot reconcile (rerank + reindex, best-effort)**

Near where the meta refresher is kicked off (the `metaStartTimer`/`app.whenReady` body), add a fire-and-forget rebuild so the index matches records after upgrades:
```ts
  memoryStore.rerank()
  void memoryService.reindexAll().catch(() => { /* index rebuilds lazily on next write */ })
```

- [ ] **Step 5: Add the two `ToolDeps` fields to the `agent`'s `toolDeps` factory**

In the `toolDeps: () => ({ ... })` object (≈ line 457-498), add:
```ts
      memory: () => memoryService,
      resolveEntityKey
```
And add to the `AgentService` deps object (next to `meta: () => meta.list()`, ≈ line 500):
```ts
    pinnedMemory: () => memoryStore.list().facts.filter((f) => f.pinned),
```

- [ ] **Step 6: Add IPC handlers**

Alongside the `meta:*` handlers (after the `meta:index-search` handler, ≈ line 1078), add:
```ts
  const emitMemoryProgress = (): void => {
    if (win && !win.isDestroyed()) win.webContents.send('memory:progress', { type: 'changed' })
  }

  ipcMain.handle('memory:list', (_e, opts?: { includeArchived?: boolean }) => memoryService.list(opts))
  ipcMain.handle('memory:search', async (_e, query: string, entity?: string | null, kinds?: string[]) => {
    try { return await memoryService.recall({ query, entity: entity ?? null, kinds: kinds as never, limit: 20 }) }
    catch { return { facts: [], artifacts: [] } }
  })
  ipcMain.handle('memory:create', async (_e, input: { kind: string; body: string; title?: string; entity?: string | null; tags?: string[] }) => {
    const r = await memoryService.createManual(input as never)
    emitMemoryProgress()
    return r
  })
  ipcMain.handle('memory:update', async (_e, kind: 'fact' | 'artifact', id: string, patch: Record<string, unknown>) => {
    if (kind === 'fact') await memoryService.updateFact(id, patch as never)
    else await memoryService.updateArtifact(id, patch as never)
    emitMemoryProgress()
  })
  ipcMain.handle('memory:delete', async (_e, kind: 'fact' | 'artifact', id: string) => {
    if (kind === 'fact') await memoryService.deleteFact(id)
    else await memoryService.deleteArtifact(id)
    emitMemoryProgress()
  })
  ipcMain.handle('memory:pin', (_e, id: string, pinned: boolean) => {
    memoryService.setPinned(id, pinned)
    emitMemoryProgress()
  })
  ipcMain.handle('memory:reindex', async () => {
    await memoryService.reindexAll()
    emitMemoryProgress()
  })
  ipcMain.handle('memory:index-stats', () => memoryService.indexStats())
  ipcMain.handle('memory:facts-for-entity', (_e, entity: string) => memoryService.factsForEntity(entity))
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the Task 6 `ToolDeps` requirement is now satisfied here; no errors).

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(memory): wire store/index/service, resolveEntityKey, IPC handlers"
```

---

## Task 9: Preload bridge + renderer types

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

> No unit test (preload is a thin pass-through); verified by `npm run typecheck`.

- [ ] **Step 1: Add bridge methods in `src/preload/index.ts`**

After the `metaIndexSearch` line (≈ line 45):
```ts
  memoryList: (opts?: { includeArchived?: boolean }) => ipcRenderer.invoke('memory:list', opts),
  memorySearch: (query: string, entity?: string | null, kinds?: string[]) =>
    ipcRenderer.invoke('memory:search', query, entity, kinds),
  memoryCreate: (input: { kind: string; body: string; title?: string; entity?: string | null; tags?: string[] }) =>
    ipcRenderer.invoke('memory:create', input),
  memoryUpdate: (kind: 'fact' | 'artifact', id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke('memory:update', kind, id, patch),
  memoryDelete: (kind: 'fact' | 'artifact', id: string) => ipcRenderer.invoke('memory:delete', kind, id),
  memoryPin: (id: string, pinned: boolean) => ipcRenderer.invoke('memory:pin', id, pinned),
  memoryReindex: () => ipcRenderer.invoke('memory:reindex'),
  memoryIndexStats: () => ipcRenderer.invoke('memory:index-stats'),
  memoryFactsForEntity: (entity: string) => ipcRenderer.invoke('memory:facts-for-entity', entity),
```
After the `onMetaProgress` block (≈ line 123-126):
```ts
  onMemoryProgress: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on('memory:progress', handler)
    return () => ipcRenderer.removeListener('memory:progress', handler)
  },
```

- [ ] **Step 2: Add renderer types in `src/preload/index.d.ts`**

Near the `RendererMeta*` interfaces (≈ line 40-110), add:
```ts
export type RendererArtifactKind = 'playbook' | 'anti_pattern' | 'heuristic'
export type RendererMemoryKind = 'fact' | RendererArtifactKind

export interface RendererMemoryFact {
  id: string
  body: string
  bodyNorm: string
  entity: string | null
  tags: string[]
  pinned: boolean
  userPinned: boolean
  useCount: number
  score: number
  source: 'agent' | 'user'
  createdAt: string
  lastUsedAt: string | null
  archived: boolean
}
export interface RendererMemoryArtifact {
  id: string
  kind: RendererArtifactKind
  title: string
  body: string
  bodyNorm: string
  tags: string[]
  entity: string | null
  useCount: number
  score: number
  source: 'agent' | 'user'
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  archived: boolean
}
export interface RendererMemoryList {
  facts: RendererMemoryFact[]
  artifacts: RendererMemoryArtifact[]
}
export interface RendererMemoryIndexStats {
  total: number
  byKind: Record<string, number>
  lastIndexedAt: string | null
}
```
In the `OfficerApi` interface (near `metaIndexSearch`, ≈ line 269 and `onMetaProgress`, ≈ line 326), add:
```ts
  memoryList(opts?: { includeArchived?: boolean }): Promise<RendererMemoryList>
  memorySearch(query: string, entity?: string | null, kinds?: RendererMemoryKind[]): Promise<{ facts: unknown[]; artifacts: unknown[] }>
  memoryCreate(input: { kind: RendererMemoryKind; body: string; title?: string; entity?: string | null; tags?: string[] }): Promise<{ id: string; kind: RendererMemoryKind; merged: boolean }>
  memoryUpdate(kind: 'fact' | 'artifact', id: string, patch: Record<string, unknown>): Promise<void>
  memoryDelete(kind: 'fact' | 'artifact', id: string): Promise<void>
  memoryPin(id: string, pinned: boolean): Promise<void>
  memoryReindex(): Promise<void>
  memoryIndexStats(): Promise<RendererMemoryIndexStats>
  memoryFactsForEntity(entity: string): Promise<RendererMemoryFact[]>
```
```ts
  onMemoryProgress(cb: (e: unknown) => void): () => void
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(memory): preload bridge + renderer types"
```

---

## Task 10: Memory management panel UI

**Files:**
- Create: `src/renderer/src/components/memory/MemoryPanel.tsx`
- Test: `src/renderer/src/components/memory/MemoryPanel.test.tsx`

**Interfaces:**
- Consumes: `window.officer.memoryList/memorySearch/memoryCreate/memoryUpdate/memoryDelete/memoryPin/memoryReindex/memoryIndexStats/onMemoryProgress`; `RendererMemoryList`, `RendererMemoryFact`, `RendererMemoryArtifact` from `../../../../preload/index.d`; `Pane`, `Card` from `../panelui`.
- Produces: `export default function MemoryPanel(): ReactElement`.

- [ ] **Step 1: Write the failing test** (testing-library, mirroring `Meta.test.tsx`)

```tsx
// src/renderer/src/components/memory/MemoryPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MemoryPanel from './MemoryPanel'

const facts = [
  { id: 'f1', body: 'Zara prefers WvW small-scale', bodyNorm: '', entity: '111', tags: ['wvw'],
    pinned: true, userPinned: false, useCount: 3, score: 1, source: 'agent', createdAt: new Date().toISOString(),
    lastUsedAt: null, archived: false }
]

beforeEach(() => {
  ;(globalThis as unknown as { window: { officer: unknown } }).window.officer = {
    memoryList: vi.fn().mockResolvedValue({ facts, artifacts: [] }),
    memoryIndexStats: vi.fn().mockResolvedValue({ total: 1, byKind: { fact: 1 }, lastIndexedAt: null }),
    onMemoryProgress: vi.fn().mockReturnValue(() => {})
  }
})

describe('MemoryPanel', () => {
  it('lists facts with body and a pinned badge', async () => {
    render(<MemoryPanel />)
    await waitFor(() => expect(screen.getByText(/Zara prefers WvW small-scale/)).toBeTruthy())
    expect(screen.getByText(/pinned/i)).toBeTruthy()
  })
})
```

> If the repo's component tests need a DOM matcher import, follow `Meta.test.tsx`'s existing setup (it already renders components under the `node` + jsdom-less config via `@testing-library/react`); copy its import lines verbatim if `getByText` truthiness checks differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/memory/MemoryPanel.test.tsx`
Expected: FAIL — cannot find module `./MemoryPanel`.

- [ ] **Step 3: Write `MemoryPanel.tsx`**

```tsx
// src/renderer/src/components/memory/MemoryPanel.tsx
//
// Sources → Memory: browse/curate AxiVale's durable self-authored memory.
// Mirrors Meta.tsx panel styling (Pane/Card) and the meta:progress refresh pattern.
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMemoryFact, RendererMemoryArtifact, RendererMemoryKind } from '../../../../preload/index.d'
import { Pane, Card } from '../panelui'

function shortDate(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleDateString()
}

export default function MemoryPanel(): ReactElement {
  const [facts, setFacts] = useState<RendererMemoryFact[]>([])
  const [artifacts, setArtifacts] = useState<RendererMemoryArtifact[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<RendererMemoryKind | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [stats, setStats] = useState<{ total: number; lastIndexedAt: string | null } | null>(null)

  async function load(): Promise<void> {
    const out = await window.officer.memoryList({ includeArchived: showArchived })
    setFacts(out.facts)
    setArtifacts(out.artifacts)
    void window.officer.memoryIndexStats().then((s) => setStats({ total: s.total, lastIndexedAt: s.lastIndexedAt }))
  }

  useEffect(() => {
    void load()
    const unsub = window.officer.onMemoryProgress(() => void load())
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived])

  const ql = query.trim().toLowerCase()
  const shownFacts = facts.filter(
    (f) => (kind === 'all' || kind === 'fact') && (!ql || f.body.toLowerCase().includes(ql) || f.tags.some((t) => t.toLowerCase().includes(ql)))
  )
  const shownArtifacts = artifacts.filter(
    (a) => (kind === 'all' || kind === a.kind) && (!ql || a.title.toLowerCase().includes(ql) || a.body.toLowerCase().includes(ql))
  )

  return (
    <div className="settings meta-panel">
      <Pane no="M" title="Memory" sub="What AxiVale has learned and remembers across sessions — facts about people and the guild, plus operational playbooks. Curate it here.">
        <div className="meta-pane-status">
          <span className="meta-fresh">{stats ? `${stats.total} indexed · updated ${shortDate(stats.lastIndexedAt)}` : 'loading…'}</span>
          <input className="mem-search" placeholder="Search memory…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="meta-srcs">
          {(['all', 'fact', 'playbook', 'anti_pattern', 'heuristic'] as const).map((k) => (
            <button key={k} className={`meta-srcchip${kind === k ? ' ok' : ''}`} onClick={() => setKind(k)}>{k}</button>
          ))}
          <label className="mem-archived">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
          </label>
        </div>

        <Card title={`Facts (${shownFacts.length})`}>
          {shownFacts.length === 0 ? (
            <div className="panel-empty">No facts yet — AxiVale saves them with the remember tool, or add one below.</div>
          ) : (
            <ul className="mem-list">
              {shownFacts.map((f) => (
                <li key={f.id} className="mem-row">
                  <div className="mem-badges">
                    {f.pinned && <span className="mem-badge pin">pinned</span>}
                    {f.archived && <span className="mem-badge arc">archived</span>}
                    <span className="mem-badge src">{f.source}</span>
                    {f.entity && <span className="mem-badge ent">{f.entity.startsWith('acct:') ? f.entity.slice(5) : 'member'}</span>}
                  </div>
                  <div className="mem-body">{f.body}</div>
                  <div className="mem-prov">learned {shortDate(f.createdAt)} · last used {shortDate(f.lastUsedAt)} · used {f.useCount}×</div>
                  <div className="mem-actions">
                    <button onClick={() => void window.officer.memoryPin(f.id, !f.userPinned)}>{f.userPinned ? 'unpin' : 'pin'}</button>
                    <button onClick={() => void window.officer.memoryUpdate('fact', f.id, { archived: !f.archived })}>{f.archived ? 'restore' : 'archive'}</button>
                    <button onClick={() => void window.officer.memoryDelete('fact', f.id)}>delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <AddFact onAdded={() => void load()} />
        </Card>

        <Card title={`Artifacts (${shownArtifacts.length})`}>
          {shownArtifacts.length === 0 ? (
            <div className="panel-empty">No playbooks, anti-patterns, or heuristics yet.</div>
          ) : (
            <ul className="mem-list">
              {shownArtifacts.map((a) => (
                <li key={a.id} className="mem-row">
                  <div className="mem-badges">
                    <span className="mem-badge kind">{a.kind}</span>
                    {a.archived && <span className="mem-badge arc">archived</span>}
                    <span className="mem-badge src">{a.source}</span>
                  </div>
                  <div className="mem-title">{a.title}</div>
                  <div className="mem-prov">{a.tags.join(', ')} · used {a.useCount}× · updated {shortDate(a.updatedAt)}</div>
                  <div className="mem-actions">
                    <button onClick={() => void window.officer.memoryUpdate('artifact', a.id, { archived: !a.archived })}>{a.archived ? 'restore' : 'archive'}</button>
                    <button onClick={() => void window.officer.memoryDelete('artifact', a.id)}>delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Index">
          <div className="mem-actions">
            <button onClick={() => void window.officer.memoryReindex()}>Rebuild index</button>
          </div>
        </Card>
      </Pane>
    </div>
  )
}

function AddFact({ onAdded }: { onAdded: () => void }): ReactElement {
  const [body, setBody] = useState('')
  const [entity, setEntity] = useState('')
  return (
    <div className="mem-add">
      <input placeholder="New fact…" value={body} onChange={(e) => setBody(e.target.value)} />
      <input placeholder="about (name, optional)" value={entity} onChange={(e) => setEntity(e.target.value)} />
      <button
        disabled={!body.trim()}
        onClick={async () => {
          await window.officer.memoryCreate({ kind: 'fact', body: body.trim(), entity: entity.trim() || null })
          setBody(''); setEntity(''); onAdded()
        }}
      >Add</button>
    </div>
  )
}
```

> Styling classes (`mem-*`) reuse the existing `settings`/`meta-panel`/`Card` look; add minimal CSS for `.mem-list`/`.mem-badge`/`.mem-row` to `src/renderer/src/theme.css` to match the meta chips (small, monospace badges) — copy the `.meta-srcchip` rule as the starting point. This styling step is cosmetic; do it in this task's commit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/memory/MemoryPanel.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/memory/MemoryPanel.tsx src/renderer/src/components/memory/MemoryPanel.test.tsx src/renderer/src/theme.css
git commit -m "feat(memory): Sources → Memory management panel"
```

---

## Task 11: Nav entry + App routing

**Files:**
- Modify: `src/renderer/src/components/meta/MetaNav.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/components/meta/MetaNav.test.tsx` (extend)

**Interfaces:**
- Consumes: `MEMORY_VIEW` sentinel.
- Produces: a "Memory" group/item in the Sources rail; `App` renders `MemoryPanel` when `activeMetaMode === MEMORY_VIEW`.

- [ ] **Step 1: Extend the failing test**

Add to `src/renderer/src/components/meta/MetaNav.test.tsx`:
```tsx
import { MEMORY_VIEW } from './MetaNav'

it('renders a Memory item that selects MEMORY_VIEW', () => {
  const onSelect = vi.fn()
  render(<MetaNav modes={[]} busy={{}} active={MEMORY_VIEW} onSelect={onSelect} />)
  const btn = screen.getByRole('button', { name: /Memory/ })
  btn.click()
  expect(onSelect).toHaveBeenCalledWith(MEMORY_VIEW)
})
```
(Reuse the file's existing imports for `render`, `screen`, `vi`, `MetaNav`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/meta/MetaNav.test.tsx`
Expected: FAIL — `MEMORY_VIEW` is not exported.

- [ ] **Step 3: Add the sentinel + nav group in `MetaNav.tsx`**

Add the export near the other sentinels:
```ts
/** The Memory view (AxiVale's durable self-authored memory) uses this sentinel id. */
export const MEMORY_VIEW = 'memory-view'
```
Add a Memory group after the Guides group (before the closing `</nav>`):
```tsx
      <div className="snav-grp">Memory</div>
      <button
        className={`snav-item${active === MEMORY_VIEW ? ' on' : ''}`}
        onClick={() => onSelect(MEMORY_VIEW)}
      >
        <span className="no">{no()}</span>
        Memory
      </button>
```

- [ ] **Step 4: Route it in `App.tsx`**

Add the import:
```ts
import { MEMORY_VIEW } from './components/meta/MetaNav'
import MemoryPanel from './components/memory/MemoryPanel'
```
(`META_OVERVIEW` is already imported from the same module — extend that import rather than duplicating.)

Change the `section === 'meta'` render branch (≈ line 501-509) to switch on the sentinel:
```tsx
          {section === 'meta' && (
            activeMetaMode === MEMORY_VIEW ? (
              <MemoryPanel />
            ) : (
              <Meta
                modes={metaModes}
                active={activeMetaMode}
                busy={metaBusy}
                fetching={metaFetching}
                onRefresh={refreshMeta}
              />
            )
          )}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/components/meta/MetaNav.test.tsx`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/meta/MetaNav.tsx src/renderer/src/components/meta/MetaNav.test.tsx src/renderer/src/App.tsx
git commit -m "feat(memory): Memory entry in the Sources rail + App routing"
```

---

## Task 12: Roster rollup ("What AxiVale knows")

**Files:**
- Create: `src/renderer/src/components/memory/MemoryRollup.tsx`
- Modify: `src/renderer/src/components/panels/Roster.tsx`
- Test: `src/renderer/src/components/memory/MemoryRollup.test.tsx`

**Interfaces:**
- Consumes: `window.officer.memoryFactsForEntity(entity)`; `RendererMemoryFact`.
- Produces: `export default function MemoryRollup({ entity }: { entity: string }): ReactElement` — read-only list; renders nothing when there are no facts.

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/src/components/memory/MemoryRollup.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MemoryRollup from './MemoryRollup'

beforeEach(() => {
  ;(globalThis as unknown as { window: { officer: unknown } }).window.officer = {
    memoryFactsForEntity: vi.fn().mockResolvedValue([
      { id: 'f1', body: 'Prefers WvW small-scale', entity: '111', tags: [], pinned: false, userPinned: false,
        useCount: 0, score: 0, source: 'agent', createdAt: new Date().toISOString(), lastUsedAt: null, archived: false, bodyNorm: '' }
    ])
  }
})

describe('MemoryRollup', () => {
  it('renders the entity facts under a heading', async () => {
    render(<MemoryRollup entity="111" />)
    await waitFor(() => expect(screen.getByText(/Prefers WvW small-scale/)).toBeTruthy())
    expect(screen.getByText(/What AxiVale knows/i)).toBeTruthy()
  })

  it('renders nothing when there are no facts', async () => {
    ;(window.officer.memoryFactsForEntity as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    const { container } = render(<MemoryRollup entity="999" />)
    await waitFor(() => expect(container.querySelector('.mem-rollup')).toBeNull())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/memory/MemoryRollup.test.tsx`
Expected: FAIL — cannot find module `./MemoryRollup`.

- [ ] **Step 3: Write `MemoryRollup.tsx`**

```tsx
// src/renderer/src/components/memory/MemoryRollup.tsx
//
// Read-only "What AxiVale knows" block for a roster member, shown beside the
// user's hand-written annotation notes. Accumulated memory, distinct from notes.
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMemoryFact } from '../../../../preload/index.d'

export default function MemoryRollup({ entity }: { entity: string }): ReactElement | null {
  const [facts, setFacts] = useState<RendererMemoryFact[]>([])
  useEffect(() => {
    let live = true
    void window.officer.memoryFactsForEntity(entity).then((f) => { if (live) setFacts(f) })
    return () => { live = false }
  }, [entity])

  if (facts.length === 0) return null
  return (
    <div className="mem-rollup">
      <div className="mem-rollup-h">What AxiVale knows</div>
      <ul className="mem-rollup-list">
        {facts.map((f) => (
          <li key={f.id}>
            {f.body}
            {f.tags.length > 0 && <span className="mem-rollup-tags"> · {f.tags.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Mount in `Roster.tsx`**

In `src/renderer/src/components/panels/Roster.tsx`, import the component:
```ts
import MemoryRollup from '../memory/MemoryRollup'
```
Locate the per-member detail area where the annotation `notes` are rendered/edited (search the file for `notes`), and render the rollup directly beneath the notes field, passing the member's identity key:
```tsx
<MemoryRollup entity={selected.memberId} />
```
> Use the same identifier the roster uses for the selected member's annotation key (the Discord `member_id`, or the `acct:<name>` synthetic key for account-only rows). Match the surrounding variable name in `Roster.tsx` (e.g. `selected.memberId` / `active.member_id`) — read the file to confirm the exact field before wiring.

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/renderer/src/components/memory/MemoryRollup.test.tsx`
Expected: PASS (2 tests).
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Full test sweep + app smoke**

Run: `npx vitest run`
Expected: PASS (all suites, including the new memory ones).
Then smoke-test the running app (use the `/run` skill or `npm run dev`):
1. Open Sources → Memory: panel loads, empty state shows.
2. Add a fact via the "New fact…" box → it appears with a `user` badge.
3. In a conversation, ask AxiVale to remember something about a known member, then ask it to recall — confirm the `remember`/`recall` tools fire and the fact shows in the panel and the member's roster rollup.
4. Pin the fact → confirm it persists across an app restart (records in `userData/memory.json`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/memory/MemoryRollup.tsx src/renderer/src/components/memory/MemoryRollup.test.tsx src/renderer/src/components/panels/Roster.tsx
git commit -m "feat(memory): roster 'What AxiVale knows' rollup"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §1 Data model (`MemoryFact`/`MemoryArtifact`, `entity` key, `source`) | 1 |
| §1 `entity` key convention (member_id / acct: / null) | 1, 8 (`resolveEntityKey`) |
| §2 Storage (`memory.json` store, `memory-lance/` index, derived/one-way sync, contentHash skip → `reindex`) | 3, 4, 5 |
| §2 Entity filtering (where entity = ? OR null) | 4 (`search`/`nearest`), 5 |
| §3 `remember` tool (unconfirmed, entity degrades to null+tags) | 6 |
| §3 Manual entry (`source:'user'`) | 5 (`createManual`), 8 (IPC), 10 (UI) |
| §3 Dedup (exact-norm + semantic 0.9 fact / 0.85 artifact, entity-scoped) | 2 (constants), 3 (exact), 5 (semantic) |
| §3 Caps (max facts, ~500/kind via archival) | 3 (`rerank` cap-driven archival) |
| §4 `recall` tool (provenance, entity filter, useCount bump) | 5, 6 |
| §4 Pinned-facts system-prompt injection (cloud-only, token cap) | 7 |
| §5 Scoring (21d half-life, log-damped useCount, sticky user pins) | 2, 3 |
| §5 Auto-pin top-40 global-leaning; soft archival 180d; UI-only delete | 3, 5, 8 |
| §6 Memory under Sources nav + panel | 10, 11 |
| §6 Roster rollup | 12 |
| §6 IPC surface (`memory:*`, `memory:progress`) | 8, 9 |

No gaps. (Auto-reflection and `acct:`→Discord re-pointing are explicit non-goals — correctly absent.)

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Two prose notes flag a cosmetic simplification (`findArtifactByNorm`) and a value-boost line (`i0(x.i)`) — both give the exact final code, not a deferral.

**3. Type consistency:** `MemoryService.remember` signature is identical across Tasks 5/6/8. `MemoryIndex` methods (`upsert`/`remove`/`search`/`nearest`/`reindex`/`stats`) match between Task 4 (impl) and Task 5 (caller). `ToolDeps.memory`/`resolveEntityKey` declared in Task 6, supplied in Task 8. `pinnedMemory` declared in Task 7, supplied in Task 8. Renderer `memory*` methods match between preload (Task 9) and UI (Tasks 10/12). `entity` is `string | null` everywhere; the Lance row uses `''` for null internally only.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-16-memory-sources.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
