# AxiLog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AxiVale open a raw arcdps `.zevtc` — from a watched folder or a dropped file — and answer specific questions about that one fight from parsed data.

**Architecture:** `@axiapps/axilog` (napi native module) parses logs inside a `node:worker_threads` worker that owns a 1–2 entry LRU of parsed reports. Section shaping and jq run inside that worker, so only shaped rows cross the thread boundary — a ~90 MiB report never reaches the main process. Main exposes an `AxilogService` façade; five read-only MCP tools sit on top of it.

**Tech Stack:** TypeScript, Electron 33, electron-vite, `node:worker_threads`, `@axiapps/axilog`, `jq-web` (via the existing `jqEngine`), vitest, React 18.

**Spec:** `docs/superpowers/specs/2026-08-30-axilog-integration-design.md` — read it before Task 1. Every decision here argues from it.

## Global Constraints

- **Verification is two commands, both required:** `npx vitest run --maxWorkers=2 <paths>` **and** `npm run typecheck`. Vitest's esbuild transform passes type errors straight through; CI runs both. A task is not done until both pass.
- **Never exceed 2 vitest workers.** `vitest.config.ts` already pins `poolOptions.forks.maxForks: 2`. Do not raise it.
- **The report never leaves the worker.** Any code that `postMessage`s a parsed axilog document, or returns one from `AxilogService`, is wrong. Only `{rows, columns, note?, warnings?}`-shaped results and small overview objects cross the boundary.
- **Nothing parsed is written to disk.** No summary cache, no report cache. The worker LRU is the only place a parsed report lives.
- **`blocks.<name>.by_entity` keys are strings.** They are JSON object keys. `by_entity[entity.id]` works by coercion but `Object.keys()` yields strings. All id handling goes through `axilogEntities.ts` — nowhere else.
- **All five tools are read-only.** Nothing goes into `DESTRUCTIVE_TOOLS` or `ACTION_GATED_TOOLS` in `src/main/tools/index.ts`.
- **Fixture policy:** use `wvw-small.anon.zevtc` only. Never read or copy anything from the axilog repo's `fixtures/local/` — those are real logs with real account names.
- **Commit style:** `git commit` per task, conventional prefixes (`feat:`, `test:`, `chore:`, `docs:`), ending with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.
- **Branch:** `feat/axilog-integration` (already created; the spec commit is `a8217d2`).

---

### Task 0: Spike — is enemy-side data attributable?

Throwaway. Its output is a written finding that shapes Task 5, not code you keep. The spec's one open question: `blocks.minions.by_entity` is documented as "one entry per *player* that has minions" — whether it populates for `enemy_player` entities is unverified.

**Files:**
- Create (temporary, deleted in Step 5): `scripts/spike-axilog-coverage.mjs`
- Modify: `docs/superpowers/specs/2026-08-30-axilog-integration-design.md` (record the finding)

**Interfaces:**
- Consumes: nothing.
- Produces: a decision recorded in the spec — whether `axilog_section` exposes an enemy-minion section in Task 5.

- [ ] **Step 1: Install the SDK locally, without committing the manifest change yet**

```bash
npm install --no-save @axiapps/axilog
```

If this fails because no prebuilt binary exists for `x86_64-unknown-linux-gnu`, stop and report it — that finding changes Task 1's approach and is worth surfacing before any other work.

- [ ] **Step 2: Write the spike script**

```javascript
// scripts/spike-axilog-coverage.mjs — THROWAWAY. Deleted at the end of Task 0.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseFile } = require('@axiapps/axilog')

const LOG = process.argv[2] ?? '../axilog/fixtures/wvw-small.anon.zevtc'
const report = parseFile(LOG, { everything: true })

console.log('=== coverage ===')
console.log(JSON.stringify(report.coverage, null, 2))

const roles = {}
for (const e of report.entities) roles[e.role] = (roles[e.role] ?? 0) + 1
console.log('=== entity roles ===', roles)

const byId = new Map(report.entities.map((e) => [String(e.id), e]))
const minions = report.blocks?.minions?.by_entity ?? {}
console.log('=== minions block: entities with minions ===')
for (const [id, rows] of Object.entries(minions)) {
  const e = byId.get(id)
  console.log(
    id,
    e ? `${e.role}/${e.profession}/${e.name}` : 'UNKNOWN ENTITY',
    '→',
    rows.map((r) => report.catalogs.minions[r.minion]?.name ?? `minion#${r.minion}`).join(', ')
  )
}
const enemyWithMinions = Object.keys(minions).filter((id) => byId.get(id)?.role === 'enemy_player')
console.log('=== VERDICT: enemy_player entities with minion rows:', enemyWithMinions.length, '===')
```

- [ ] **Step 3: Run it against the anonymized WvW fixture**

```bash
node scripts/spike-axilog-coverage.mjs ../axilog/fixtures/wvw-small.anon.zevtc
```

Expected: a coverage map, a role histogram (`squad`, `friendly_player`, `enemy_player`, `npc`), and a verdict line. Record the exact `ParseOptions` field names you see in `node_modules/@axiapps/axilog/index.d.ts` — Task 3 needs them and this plan assumes camelCase (`skillDamage`) without having verified it.

- [ ] **Step 4: Record the finding in the spec**

Replace the spec's "Open question, resolved by a spike" section with the answer. Two shapes:

- *Enemy minions ARE attributable* → Task 5 includes a `minions` section with a `role` filter, and the spec says so.
- *They are NOT* → the spec states that enemy build inference is out of scope, and Task 5's sections carry a `note` for enemy-scoped minion queries: `"This log does not attribute minions to enemy players."` No guessing, no approximation.

Also record the verified `ParseOptions` field names in the spec's "The axilog 1.0 container" section.

- [ ] **Step 5: Delete the spike and commit the finding**

```bash
rm scripts/spike-axilog-coverage.mjs
git add docs/superpowers/specs/2026-08-30-axilog-integration-design.md
git commit -m "docs: resolve axilog enemy-coverage open question from spike"
```

---

### Task 1: Dependency and packaging

Prove the native binary survives packaging before building anything on it. A native module that fails to unpack is discovered at release time otherwise.

**Files:**
- Modify: `package.json` (dependencies, `build.asarUnpack`)
- Modify: `scripts/` — the Windows packaging verify script (locate it with `grep -rn "officer" scripts/`)
- Create: `src/main/axilogNative.ts`
- Create: `src/main/axilogNative.test.ts`

**Interfaces:**
- Produces:
  - `loadAxilog(): AxilogNative | null` — the single `require` site for the native module. Returns `null` (never throws) when the binary is missing or fails to load.
  - `interface AxilogNative { parseFile(path: string, opts?: Record<string, boolean>): unknown }`
  - `axilogUnavailableReason(): string | null` — human-readable load failure, for the Logs panel.

- [ ] **Step 1: Add the dependency**

```bash
npm install @axiapps/axilog
```

- [ ] **Step 2: Add asarUnpack and the verify assertion**

In `package.json`, add to the existing `build.asarUnpack` array (which already carries the LanceDB and Xenova entries):

```json
"**/node_modules/@axiapps/axilog*/**"
```

In the Windows packaging verify script, add an assertion that a `.node` binary exists under the unpacked `@axiapps/axilog` tree — mirroring how the script already checks for the officer proxy file. Follow that script's existing style for path resolution and failure messaging exactly.

- [ ] **Step 3: Write the failing test**

```typescript
// src/main/axilogNative.test.ts
import { describe, it, expect } from 'vitest'
import { loadAxilog, axilogUnavailableReason } from './axilogNative'

describe('loadAxilog', () => {
  it('returns a module exposing parseFile when the binary is present', () => {
    const native = loadAxilog()
    if (native === null) {
      // Acceptable on a platform with no prebuilt binary; the reason must say why.
      expect(axilogUnavailableReason()).toBeTruthy()
      return
    }
    expect(typeof native.parseFile).toBe('function')
    expect(axilogUnavailableReason()).toBeNull()
  })

  it('never throws, even when the require fails', () => {
    expect(() => loadAxilog()).not.toThrow()
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogNative.test.ts
```

Expected: FAIL — `Failed to resolve import "./axilogNative"`.

- [ ] **Step 5: Implement the loader**

```typescript
// src/main/axilogNative.ts
//
// The ONE place @axiapps/axilog is required. It is a napi native module: a
// missing or wrong-platform .node binary must degrade the AxiLog feature, never
// take the app down. Everything else in the codebase asks this module whether
// AxiLog is available and gets null, not an exception.

import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

export interface AxilogNative {
  parseFile(path: string, opts?: Record<string, boolean>): unknown
}

let cached: AxilogNative | null = null
let reason: string | null = null
let attempted = false

/** The native module, or null when it cannot be loaded. Never throws. */
export function loadAxilog(): AxilogNative | null {
  if (attempted) return cached
  attempted = true
  try {
    const mod = nodeRequire('@axiapps/axilog') as AxilogNative
    if (typeof mod?.parseFile !== 'function') {
      reason = '@axiapps/axilog loaded but exposes no parseFile'
      return null
    }
    cached = mod
    return cached
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err)
    return null
  }
}

/** Why the native module is unavailable, or null when it loaded fine. */
export function axilogUnavailableReason(): string | null {
  loadAxilog()
  return cached ? null : reason
}
```

- [ ] **Step 6: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/axilogNative.test.ts
npm run typecheck
```

Expected: PASS, and typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/ src/main/axilogNative.ts src/main/axilogNative.test.ts
git commit -m "feat: add @axiapps/axilog dependency with safe native loader"
```

---

### Task 2: Entity resolver and the JSON fixture

The resolver is the single place entity ids are handled. Every section and every jq result passes through it, so it lands before anything that shapes data. The JSON fixture it is tested against is what makes Tasks 3–5 runnable without the native module.

**Files:**
- Create: `src/main/axilogEntities.ts`
- Create: `src/main/axilogEntities.test.ts`
- Create: `src/main/__fixtures__/wvw-small.report.json` (generated)
- Create: `src/main/__fixtures__/wvw-small.anon.zevtc` (copied, 1.5 MB)
- Create: `scripts/gen-axilog-fixture.mjs`

**Interfaces:**
- Consumes: `loadAxilog()` from Task 1 (in the generator script only).
- Produces:
  - `interface AxilogReport { axilog: {schema: string; version: string; generated_from: string}; encounter: AxilogEncounter; entities: AxilogEntity[]; catalogs: Record<string, Record<string, {name?: string}>>; blocks: Record<string, {by_entity?: Record<string, unknown>} & Record<string, unknown>>; coverage: Record<string, CoverageState>; warnings?: string[] }`
  - `type CoverageState = 'present' | 'empty' | 'not_computed' | 'unsupported'`
  - `type EntityRole = 'squad' | 'friendly_player' | 'enemy_player' | 'npc'`
  - `interface AxilogEntity { id: number; name?: string; account?: string; profession?: string; role: EntityRole; subgroup?: number }`
  - `interface AxilogEncounter { kind?: string; map?: string; duration_ms?: number; recorded_by?: string }`
  - `interface EntityRef { id: string; name: string; account: string; profession: string; role: EntityRole; subgroup: number | null }`
  - `class EntityIndex` with `get(id: string | number): EntityRef | null`, `all(): EntityRef[]`, `byRole(role: EntityRole): EntityRef[]`, `roleCounts(): Record<string, number>`, `resolveName(loose: string): EntityRef | null`
  - `buildEntityIndex(report: AxilogReport): EntityIndex`

- [ ] **Step 1: Write the fixture generator**

```javascript
// scripts/gen-axilog-fixture.mjs
//
// Regenerates src/main/__fixtures__/wvw-small.report.json from the committed
// anonymized log. Run it when @axiapps/axilog is upgraded; the worker
// integration test (Task 3) fails if the committed JSON drifts from reality.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { parseFile } = require('@axiapps/axilog')

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'src', 'main', '__fixtures__')
const report = parseFile(join(fixtures, 'wvw-small.anon.zevtc'), { everything: true })
writeFileSync(join(fixtures, 'wvw-small.report.json'), JSON.stringify(report))
console.log('wrote wvw-small.report.json —', report.entities.length, 'entities')
```

- [ ] **Step 2: Copy the log fixture and generate the JSON**

```bash
mkdir -p src/main/__fixtures__
cp ../axilog/fixtures/wvw-small.anon.zevtc src/main/__fixtures__/
node scripts/gen-axilog-fixture.mjs
```

Expected: `wrote wvw-small.report.json — <N> entities`. If the JSON exceeds ~40 MB, regenerate without `{ everything: true }` and note in the file header which passes it carries — a fixture that bloats the repo is worse than one covering fewer sections.

- [ ] **Step 3: Write the failing test**

```typescript
// src/main/axilogEntities.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildEntityIndex, type AxilogReport } from './axilogEntities'

const report = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'wvw-small.report.json'), 'utf8')
) as AxilogReport

describe('buildEntityIndex', () => {
  it('resolves a by_entity string key back to its entity', () => {
    const index = buildEntityIndex(report)
    const someKey = Object.keys(report.blocks.damage?.by_entity ?? {})[0]
    expect(someKey).toBeTypeOf('string')
    const ref = index.get(someKey)
    expect(ref).not.toBeNull()
    expect(ref!.id).toBe(someKey)
    expect(ref!.name).not.toBe('')
  })

  it('accepts a numeric id and a string id interchangeably', () => {
    const index = buildEntityIndex(report)
    const first = report.entities[0]
    expect(index.get(first.id)).toEqual(index.get(String(first.id)))
  })

  it('returns null for an unknown id rather than a placeholder entity', () => {
    expect(buildEntityIndex(report).get('99999999')).toBeNull()
  })

  it('separates squad from enemy players', () => {
    const index = buildEntityIndex(report)
    const squad = index.byRole('squad')
    expect(squad.length).toBeGreaterThan(0)
    expect(squad.every((e) => e.role === 'squad')).toBe(true)
    expect(index.roleCounts().squad).toBe(squad.length)
  })

  it('substitutes a readable placeholder when a name is missing', () => {
    const index = buildEntityIndex({
      ...report,
      entities: [{ id: 7, role: 'npc' }]
    } as AxilogReport)
    expect(index.get(7)!.name).toBe('Unknown #7')
  })

  it('resolves a loose name case-insensitively, and null when ambiguous', () => {
    const index = buildEntityIndex(report)
    const target = index.byRole('squad')[0]
    expect(index.resolveName(target.name.toLowerCase())!.id).toBe(target.id)
    expect(index.resolveName('definitely-not-a-player')).toBeNull()
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogEntities.test.ts
```

Expected: FAIL — `Failed to resolve import "./axilogEntities"`.

- [ ] **Step 5: Implement the resolver**

```typescript
// src/main/axilogEntities.ts
//
// The ONE place axilog entity ids are handled. axilog's roster is `entities[]`
// (there is no players[]), and every per-entity statistic lives in
// `blocks.<name>.by_entity` keyed by `entities[].id`. Those are JSON object
// keys, so they arrive as STRINGS: `by_entity[entity.id]` happens to work by
// coercion, but `Object.keys()` gives strings. Normalizing on strings here, once,
// is what keeps that footgun out of every section.

export type CoverageState = 'present' | 'empty' | 'not_computed' | 'unsupported'
export type EntityRole = 'squad' | 'friendly_player' | 'enemy_player' | 'npc'

export interface AxilogEntity {
  id: number
  name?: string
  account?: string
  profession?: string
  role: EntityRole
  subgroup?: number
}

export interface AxilogEncounter {
  kind?: string
  map?: string
  duration_ms?: number
  recorded_by?: string
}

export interface AxilogReport {
  axilog: { schema: string; version: string; generated_from: string }
  encounter: AxilogEncounter
  entities: AxilogEntity[]
  catalogs: Record<string, Record<string, { name?: string }>>
  blocks: Record<string, { by_entity?: Record<string, unknown> } & Record<string, unknown>>
  coverage: Record<string, CoverageState>
  warnings?: string[]
}

export interface EntityRef {
  /** Always the STRING form — the same shape `by_entity` keys arrive in. */
  id: string
  name: string
  account: string
  profession: string
  role: EntityRole
  subgroup: number | null
}

export class EntityIndex {
  private readonly byId: Map<string, EntityRef>
  private readonly byLowerName: Map<string, EntityRef[]>

  constructor(refs: EntityRef[]) {
    this.byId = new Map(refs.map((r) => [r.id, r]))
    this.byLowerName = new Map()
    for (const r of refs) {
      for (const key of [r.name.toLowerCase(), r.account.toLowerCase()]) {
        if (!key) continue
        const bucket = this.byLowerName.get(key)
        if (bucket) bucket.push(r)
        else this.byLowerName.set(key, [r])
      }
    }
  }

  /** null, never a placeholder — an unresolved id is a real condition callers must show. */
  get(id: string | number): EntityRef | null {
    return this.byId.get(String(id)) ?? null
  }

  all(): EntityRef[] {
    return [...this.byId.values()]
  }

  byRole(role: EntityRole): EntityRef[] {
    return this.all().filter((r) => r.role === role)
  }

  roleCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const r of this.all()) counts[r.role] = (counts[r.role] ?? 0) + 1
    return counts
  }

  /** Exact (case-insensitive) name or account match. Ambiguous or absent -> null. */
  resolveName(loose: string): EntityRef | null {
    const hits = this.byLowerName.get(loose.trim().toLowerCase()) ?? []
    return hits.length === 1 ? hits[0] : null
  }
}

export function buildEntityIndex(report: AxilogReport): EntityIndex {
  return new EntityIndex(
    (report.entities ?? []).map((e) => ({
      id: String(e.id),
      name: e.name?.trim() || `Unknown #${e.id}`,
      account: e.account?.trim() ?? '',
      profession: e.profession?.trim() ?? '',
      role: e.role,
      subgroup: typeof e.subgroup === 'number' ? e.subgroup : null
    }))
  )
}
```

- [ ] **Step 6: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/axilogEntities.test.ts
npm run typecheck
```

Expected: all six tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/axilogEntities.ts src/main/axilogEntities.test.ts \
        src/main/__fixtures__ scripts/gen-axilog-fixture.mjs
git commit -m "feat: add axilog entity resolver and committed report fixture"
```

---

### Task 3: Worker and service

The worker owns the reports; the service is the only thing that knows a worker exists. Both land together because neither is testable alone.

**Files:**
- Create: `src/main/axilogWorker.ts`
- Create: `src/main/axilogWorker.test.ts`
- Create: `src/main/axilogService.ts`
- Create: `src/main/axilogService.test.ts`
- Modify: `electron.vite.config.ts:56-62` (rollup `input` map)

**Interfaces:**
- Consumes: `loadAxilog()` (Task 1); `AxilogReport`, `buildEntityIndex` (Task 2).
- Produces:
  - `interface PassFlags { rotation?: boolean; timeseries?: boolean; skillDamage?: boolean; modifiers?: boolean; minions?: boolean }`
  - `interface FightOverview { logId: string; map: string; durationMs: number; recordedBy: string; roleCounts: Record<string, number>; squad: Array<{name: string; account: string; profession: string; subgroup: number | null}>; coverage: Record<string, CoverageState>; warnings: string[] }`
  - `type WorkerRequest = {id: number; kind: 'overview'; logId: string; path: string} | {id: number; kind: 'section'; logId: string; path: string; section: string; opts: SectionQuery; passes: PassFlags} | {id: number; kind: 'query'; logId: string; path: string; filter: string; limit: number}`
  - `type WorkerResponse = {id: number; ok: true; value: unknown} | {id: number; ok: false; error: string}`
  - `class AxilogService` with `overview(logId, path): Promise<FightOverview>`, `section(logId, path, section, opts): Promise<SectionResult>`, `query(logId, path, filter, limit): Promise<{rows: unknown[]; truncated: boolean}>`, `dispose(): void`
  - `const MAX_LOG_BYTES = 150 * 1024 * 1024`, `const PARSE_TIMEOUT_MS = 30_000`, `const IDLE_KILL_MS = 5 * 60_000`, `const REPORT_LRU_SIZE = 2`

`SectionQuery` and `SectionResult` come from Task 4. To keep the tasks orderable, define them in Task 4's `axilogSections.ts` and have this task import the types only — the worker calls `runSection()` from that module, which Task 4 implements. Until Task 4 lands, stub `runSection` in the worker as a function that throws `new Error('no sections registered')`, and let Task 4 replace the stub. The worker test below asserts the `overview` and `query` paths, which do not need sections.

- [ ] **Step 1: Add the worker entry to the build**

In `electron.vite.config.ts`, add to `build.rollupOptions.input`:

```typescript
          axilogWorker: 'src/main/axilogWorker.ts',
```

It sits alongside `axibridgeWorker` and inherits the same `[name].js` output naming, so it loads as ESM under `worker_threads` (the package is `type: module`). Do not touch the `codexOfficerServer` `.mjs` special case.

- [ ] **Step 2: Write the failing service test**

```typescript
// src/main/axilogService.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { AxilogService, MAX_LOG_BYTES } from './axilogService'

const FIXTURE = join(__dirname, '__fixtures__', 'wvw-small.anon.zevtc')
const WORKER = join(__dirname, '..', '..', 'out', 'main', 'axilogWorker.js')

let service: AxilogService | null = null
afterEach(() => {
  service?.dispose()
  service = null
})

describe('AxilogService', () => {
  it('rejects a path over the size ceiling without spawning a worker', async () => {
    service = new AxilogService({ workerPath: WORKER, statSize: () => MAX_LOG_BYTES + 1 })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/too large/i)
    expect(service.workerIsRunning()).toBe(false)
  })

  it('surfaces a missing file as an actionable message', async () => {
    service = new AxilogService({
      workerPath: WORKER,
      statSize: () => {
        throw new Error('ENOENT')
      }
    })
    await expect(service.overview('abc', '/nope/gone.zevtc')).rejects.toThrow(
      /log no longer at \/nope\/gone\.zevtc/
    )
  })

  it('reports the worker bundle missing rather than hanging', async () => {
    service = new AxilogService({ workerPath: '/nonexistent/axilogWorker.js', statSize: () => 10 })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/worker bundle/i)
  })

  it('times out a wedged parse and kills the worker', async () => {
    service = new AxilogService({
      workerPath: WORKER,
      statSize: () => 10,
      parseTimeoutMs: 50,
      spawn: () => ({
        postMessage: () => {},
        terminate: () => Promise.resolve(0),
        once: () => {},
        on: () => {},
        off: () => {}
      })
    })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/timed out after 50ms/)
    expect(service.workerIsRunning()).toBe(false)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogService.test.ts
```

Expected: FAIL — `Failed to resolve import "./axilogService"`.

- [ ] **Step 4: Implement the worker**

```typescript
// src/main/axilogWorker.ts
//
// Owns every parsed axilog report. A 5:48 zerg fight is ~90 MiB and napi's
// parseFile is synchronous, so parsing on the main thread would freeze IPC and
// the agent stream for hundreds of ms. Reports live here, in a small LRU, and
// ONLY shaped rows are posted back — a report never crosses the boundary.

import { parentPort } from 'node:worker_threads'
import { loadAxilog } from './axilogNative'
import { buildEntityIndex, type AxilogReport } from './axilogEntities'
import { runSection, type SectionQuery, type SectionResult } from './axilogSections'
import { jqEngine } from './jqEngine'

export interface PassFlags {
  rotation?: boolean
  timeseries?: boolean
  skillDamage?: boolean
  modifiers?: boolean
  minions?: boolean
}

export type WorkerRequest =
  | { id: number; kind: 'overview'; logId: string; path: string }
  | {
      id: number
      kind: 'section'
      logId: string
      path: string
      section: string
      opts: SectionQuery
      passes: PassFlags
    }
  | { id: number; kind: 'query'; logId: string; path: string; filter: string; limit: number }

export type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }

export const REPORT_LRU_SIZE = 2
export const MAX_QUERY_BYTES = 64_000

interface Loaded {
  report: AxilogReport
  passes: PassFlags
}

/** Insertion-ordered Map used as the LRU: re-inserting moves an entry to the end. */
const lru = new Map<string, Loaded>()

/** True when `have` already covers every pass `want` asks for. */
function covers(have: PassFlags, want: PassFlags): boolean {
  return (Object.keys(want) as Array<keyof PassFlags>).every((k) => !want[k] || have[k])
}

function load(logId: string, path: string, passes: PassFlags): AxilogReport {
  const hit = lru.get(logId)
  if (hit && covers(hit.passes, passes)) {
    lru.delete(logId)
    lru.set(logId, hit)
    return hit.report
  }
  const native = loadAxilog()
  if (!native) throw new Error('axilog native module unavailable in worker')
  // Union with what is already loaded: a re-parse never LOSES a pass, so a
  // section that needed rotations does not force the next one to re-parse.
  const merged: PassFlags = { ...(hit?.passes ?? {}), ...passes }
  const report = native.parseFile(path, merged as Record<string, boolean>) as AxilogReport
  lru.delete(logId)
  lru.set(logId, { report, passes: merged })
  while (lru.size > REPORT_LRU_SIZE) lru.delete(lru.keys().next().value as string)
  return report
}

export async function handle(req: WorkerRequest): Promise<unknown> {
  if (req.kind === 'overview') {
    const report = load(req.logId, req.path, {})
    const index = buildEntityIndex(report)
    return {
      logId: req.logId,
      map: report.encounter?.map ?? 'Unknown',
      durationMs: report.encounter?.duration_ms ?? 0,
      recordedBy: report.encounter?.recorded_by ?? '',
      roleCounts: index.roleCounts(),
      squad: index.byRole('squad').map((e) => ({
        name: e.name,
        account: e.account,
        profession: e.profession,
        subgroup: e.subgroup
      })),
      coverage: report.coverage ?? {},
      warnings: report.warnings ?? []
    }
  }
  if (req.kind === 'section') {
    const report = load(req.logId, req.path, req.passes)
    return runSection(report, req.section, req.opts) satisfies SectionResult
  }
  const report = load(req.logId, req.path, {})
  const rows = await jqEngine.run(req.filter, report)
  // Cap by SERIALIZED size, not row count: one row of replay tracks can be
  // megabytes while a thousand scalar rows are trivial.
  const out: unknown[] = []
  let bytes = 0
  let truncated = false
  for (const row of rows.slice(0, req.limit)) {
    const size = JSON.stringify(row)?.length ?? 0
    if (bytes + size > MAX_QUERY_BYTES) {
      truncated = true
      break
    }
    out.push(row)
    bytes += size
  }
  if (rows.length > req.limit) truncated = true
  return { rows: out, truncated }
}

parentPort?.on('message', (req: WorkerRequest) => {
  void handle(req)
    .then((value) => parentPort!.postMessage({ id: req.id, ok: true, value } as WorkerResponse))
    .catch((err) =>
      parentPort!.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      } as WorkerResponse)
    )
})
```

Until Task 4 lands, create a placeholder `src/main/axilogSections.ts` containing exactly:

```typescript
// Replaced wholesale in Task 4.
export interface SectionQuery {
  granularity?: string
  entity?: string
  role?: string
  subgroup?: number
  sort?: string
  limit?: number
}
export interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string
  warnings?: string[]
}
export function runSection(
  _report: unknown,
  section: string,
  _opts: SectionQuery
): SectionResult {
  throw new Error(`Unknown section "${section}" — no sections registered yet`)
}
```

- [ ] **Step 5: Implement the service**

```typescript
// src/main/axilogService.ts
//
// The only module that knows a worker exists. Owns the worker lifecycle
// (spawn on demand, idle-kill), request correlation, and the guards. Swapping
// worker_threads for Electron's utilityProcess later is a change to this file
// and nothing else.

import { Worker } from 'node:worker_threads'
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PassFlags, WorkerRequest, WorkerResponse } from './axilogWorker'
import type { SectionQuery, SectionResult } from './axilogSections'
import type { CoverageState } from './axilogEntities'

export const MAX_LOG_BYTES = 150 * 1024 * 1024
export const PARSE_TIMEOUT_MS = 30_000
export const IDLE_KILL_MS = 5 * 60_000

export interface FightOverview {
  logId: string
  map: string
  durationMs: number
  recordedBy: string
  roleCounts: Record<string, number>
  squad: Array<{ name: string; account: string; profession: string; subgroup: number | null }>
  coverage: Record<string, CoverageState>
  warnings: string[]
}

/** Just enough of node:worker_threads' Worker to fake in tests. */
interface WorkerLike {
  postMessage(value: unknown): void
  terminate(): Promise<number>
  on(event: string, cb: (arg: never) => void): void
  off(event: string, cb: (arg: never) => void): void
  once(event: string, cb: (arg: never) => void): void
}

export interface AxilogServiceOptions {
  workerPath?: string
  /** Injected so size-guard tests never touch the filesystem. */
  statSize?: (path: string) => number
  parseTimeoutMs?: number
  idleKillMs?: number
  spawn?: (workerPath: string) => WorkerLike
  maxLogBytes?: number
}

const defaultWorkerPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), 'axilogWorker.js')

export class AxilogService {
  private worker: WorkerLike | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private idleTimer: NodeJS.Timeout | null = null

  private readonly workerPath: string
  private readonly statSize: (path: string) => number
  private readonly parseTimeoutMs: number
  private readonly idleKillMs: number
  private readonly maxLogBytes: number
  private readonly spawn: (workerPath: string) => WorkerLike

  constructor(opts: AxilogServiceOptions = {}) {
    this.workerPath = opts.workerPath ?? defaultWorkerPath()
    this.statSize = opts.statSize ?? ((p) => statSync(p).size)
    this.parseTimeoutMs = opts.parseTimeoutMs ?? PARSE_TIMEOUT_MS
    this.idleKillMs = opts.idleKillMs ?? IDLE_KILL_MS
    this.maxLogBytes = opts.maxLogBytes ?? MAX_LOG_BYTES
    this.spawn = opts.spawn ?? ((p) => new Worker(p) as unknown as WorkerLike)
  }

  workerIsRunning(): boolean {
    return this.worker !== null
  }

  async overview(logId: string, path: string): Promise<FightOverview> {
    return (await this.send(path, { kind: 'overview', logId, path })) as FightOverview
  }

  async section(
    logId: string,
    path: string,
    section: string,
    opts: SectionQuery,
    passes: PassFlags = {}
  ): Promise<SectionResult> {
    return (await this.send(path, {
      kind: 'section',
      logId,
      path,
      section,
      opts,
      passes
    })) as SectionResult
  }

  async query(
    logId: string,
    path: string,
    filter: string,
    limit: number
  ): Promise<{ rows: unknown[]; truncated: boolean }> {
    return (await this.send(path, { kind: 'query', logId, path, filter, limit })) as {
      rows: unknown[]
      truncated: boolean
    }
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('AxiLog service disposed'))
    }
    this.pending.clear()
    void this.worker?.terminate()
    this.worker = null
  }

  private guard(path: string): void {
    let size: number
    try {
      size = this.statSize(path)
    } catch {
      throw new Error(`log no longer at ${path}`)
    }
    if (size > this.maxLogBytes) {
      const mb = Math.round(size / 1024 / 1024)
      const capMb = Math.round(this.maxLogBytes / 1024 / 1024)
      throw new Error(`Log is too large to parse (${mb} MB, limit ${capMb} MB)`)
    }
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    if (this.spawn === undefined) throw new Error('no spawn')
    if (!existsSync(this.workerPath)) {
      throw new Error(
        `AxiLog worker bundle missing at ${this.workerPath} — run \`npm run build\` (electron-vite emits it as a second main entry)`
      )
    }
    const worker = this.spawn(this.workerPath)
    worker.on('message', ((res: WorkerResponse) => {
      const entry = this.pending.get(res.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(res.id)
      if (res.ok) entry.resolve(res.value)
      else entry.reject(new Error(res.error))
      this.armIdleKill()
    }) as (arg: never) => void)
    worker.on('error', ((err: Error) => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer)
        reject(err)
      }
      this.pending.clear()
      this.worker = null
    }) as (arg: never) => void)
    this.worker = worker
    return worker
  }

  /** Five minutes idle and the worker exits, taking every parsed report with it. */
  private armIdleKill(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.pending.size > 0) return
    this.idleTimer = setTimeout(() => {
      void this.worker?.terminate()
      this.worker = null
    }, this.idleKillMs)
    this.idleTimer.unref?.()
  }

  private send(path: string, req: Omit<WorkerRequest, 'id'>): Promise<unknown> {
    this.guard(path)
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        void this.worker?.terminate()
        this.worker = null
        reject(new Error(`AxiLog parse timed out after ${this.parseTimeoutMs}ms`))
      }, this.parseTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }
}
```

- [ ] **Step 6: Write the worker integration test**

```typescript
// src/main/axilogWorker.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAxilog } from './axilogNative'
import { handle } from './axilogWorker'
import type { AxilogReport } from './axilogEntities'

const FIXTURE = join(__dirname, '__fixtures__', 'wvw-small.anon.zevtc')
const native = loadAxilog()
const describeNative = native ? describe : describe.skip

describeNative('axilogWorker (needs the @axiapps/axilog native binary)', () => {
  it('parses the fixture into the same document the committed JSON holds', () => {
    const fresh = native!.parseFile(FIXTURE, { everything: true }) as AxilogReport
    const committed = JSON.parse(
      readFileSync(join(__dirname, '__fixtures__', 'wvw-small.report.json'), 'utf8')
    ) as AxilogReport
    expect(fresh.axilog.schema).toBe(committed.axilog.schema)
    expect(fresh.entities.length).toBe(committed.entities.length)
    expect(Object.keys(fresh.blocks).sort()).toEqual(Object.keys(committed.blocks).sort())
    expect(fresh.coverage).toEqual(committed.coverage)
  })

  it('builds an overview without leaking the report', async () => {
    const overview = (await handle({
      id: 1,
      kind: 'overview',
      logId: 'fx',
      path: FIXTURE
    })) as Record<string, unknown>
    expect(overview.map).toBeTypeOf('string')
    expect(overview).not.toHaveProperty('blocks')
    expect(overview).not.toHaveProperty('entities')
    expect((overview.squad as unknown[]).length).toBeGreaterThan(0)
  })

  it('caps a runaway jq filter by serialized size', async () => {
    const res = (await handle({
      id: 2,
      kind: 'query',
      logId: 'fx',
      path: FIXTURE,
      filter: '.blocks',
      limit: 50
    })) as { rows: unknown[]; truncated: boolean }
    expect(JSON.stringify(res.rows).length).toBeLessThanOrEqual(70_000)
    expect(res.truncated).toBe(true)
  })
})
```

If the binary is missing the suite skips with its name explaining why — that is intended, and the reason the pure layer carries the real coverage.

- [ ] **Step 7: Build, run tests, typecheck**

```bash
npm run build
npx vitest run --maxWorkers=2 src/main/axilogService.test.ts src/main/axilogWorker.test.ts
npm run typecheck
```

Expected: all PASS. `npm run build` must come first — the service tests resolve the real worker bundle in `out/main/`.

- [ ] **Step 8: Commit**

```bash
git add src/main/axilogWorker.ts src/main/axilogWorker.test.ts \
        src/main/axilogService.ts src/main/axilogService.test.ts \
        src/main/axilogSections.ts electron.vite.config.ts
git commit -m "feat: add axilog parse worker and service facade with guards"
```

---

### Task 4: Section registry — infrastructure, damage, and defenses

Replaces the Task 3 placeholder wholesale. Mirrors `axibridgeSections.ts`'s descriptor shape so the two registries read as one idiom.

**Files:**
- Modify (replace entirely): `src/main/axilogSections.ts`
- Create: `src/main/axilogSections.test.ts`

**Interfaces:**
- Consumes: `AxilogReport`, `EntityIndex`, `buildEntityIndex`, `EntityRef`, `EntityRole` (Task 2); `PassFlags` (Task 3).
- Produces:
  - `interface SectionQuery { granularity?: Granularity; entity?: string; role?: EntityRole; subgroup?: number; sort?: string; limit?: number }`
  - `type Granularity = 'entity' | 'squad'`
  - `interface SectionResult { rows: Array<Record<string, string | number>>; columns: Array<{key: string; label: string}>; note?: string; warnings?: string[] }`
  - `interface SectionDescriptor { key: string; title: string; aliases: string[]; summary: string; block: string; passes: PassFlags; granularities: Granularity[]; fields: SectionField[]; shape(report, index, opts): SectionResult }`
  - `const SECTIONS: SectionDescriptor[]`, `getSection(key): SectionDescriptor | undefined`, `findSections(query): SectionDescriptor[]`, `runSection(report, section, opts): SectionResult`, `DEFAULT_ROW_LIMIT = 25`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/axilogSections.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSection, findSections, getSection, DEFAULT_ROW_LIMIT } from './axilogSections'
import type { AxilogReport } from './axilogEntities'

const report = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'wvw-small.report.json'), 'utf8')
) as AxilogReport

describe('section registry', () => {
  it('finds the damage section by an alias, not just its key', () => {
    expect(findSections('dps')[0].key).toBe('damage')
    expect(findSections('who did the most damage')[0].key).toBe('damage')
  })

  it('returns the whole catalog for an empty or unmatched query', () => {
    expect(findSections('').length).toBeGreaterThan(1)
    expect(findSections('xyzzy').length).toBe(findSections('').length)
  })

  it('declares which parse passes each section needs', () => {
    expect(getSection('damage')!.passes).toEqual({})
  })
})

describe('runSection', () => {
  it('names every row instead of returning raw entity ids', () => {
    const res = runSection(report, 'damage', {})
    expect(res.rows.length).toBeGreaterThan(0)
    for (const row of res.rows) {
      expect(row.name).toBeTypeOf('string')
      expect(String(row.name)).not.toMatch(/^\d+$/)
    }
  })

  it('defaults to a row limit so a 122-entity roster cannot flood context', () => {
    expect(runSection(report, 'damage', {}).rows.length).toBeLessThanOrEqual(DEFAULT_ROW_LIMIT)
  })

  it('sorts descending by the section default so the top performers lead', () => {
    const rows = runSection(report, 'damage', { limit: 5 }).rows
    const values = rows.map((r) => Number(r.total))
    expect([...values].sort((a, b) => b - a)).toEqual(values)
  })

  it('filters to enemy players when asked', () => {
    const enemies = runSection(report, 'damage', { role: 'enemy_player', limit: 100 })
    const squad = runSection(report, 'damage', { role: 'squad', limit: 100 })
    const overlap = enemies.rows.filter((e) => squad.rows.some((s) => s.name === e.name))
    expect(overlap).toEqual([])
  })

  it('reports an absent block as a note rather than empty rows', () => {
    const stripped = { ...report, blocks: {}, coverage: { damage: 'not_computed' } } as AxilogReport
    const res = runSection(stripped, 'damage', {})
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/not_computed|does not carry/i)
  })

  it('throws an actionable error for an unknown section', () => {
    expect(() => runSection(report, 'nonsense', {})).toThrow(/unknown section "nonsense"/i)
  })

  it('shapes defenses with damage taken and downs', () => {
    const res = runSection(report, 'defenses', { limit: 3 })
    expect(res.columns.map((c) => c.key)).toContain('damageTaken')
    expect(res.rows.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogSections.test.ts
```

Expected: FAIL — `runSection` throws "no sections registered yet" from the Task 3 placeholder.

- [ ] **Step 3: Implement the registry with the damage and defenses sections**

```typescript
// src/main/axilogSections.ts
//
// Section registry over axilog's `blocks`. Same descriptor shape as
// axibridgeSections.ts so the two read as one idiom — the difference is the
// source format: axilog keys every statistic by entity id under
// `blocks.<name>.by_entity`, so every shape() resolves ids through EntityIndex
// and never emits a bare id.

import {
  buildEntityIndex,
  type AxilogReport,
  type EntityIndex,
  type EntityRef,
  type EntityRole
} from './axilogEntities'
import type { PassFlags } from './axilogWorker'

export type Granularity = 'entity' | 'squad'
export const DEFAULT_ROW_LIMIT = 25

export interface SectionField {
  key: string
  label: string
  help?: string
}

export interface SectionQuery {
  granularity?: Granularity
  /** Loose name/account of a single entity to filter to. */
  entity?: string
  role?: EntityRole
  subgroup?: number
  /** Column key to sort by, descending. Defaults to the descriptor's first metric. */
  sort?: string
  limit?: number
}

export interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string
  warnings?: string[]
}

export interface SectionDescriptor {
  key: string
  title: string
  aliases: string[]
  summary: string
  /** The `blocks.<name>` this reads; drives the coverage check. */
  block: string
  /** Parse passes this section needs beyond the default set. */
  passes: PassFlags
  granularities: Granularity[]
  fields: SectionField[]
  shape(report: AxilogReport, index: EntityIndex, opts: SectionQuery): SectionResult
}

/** Identity columns every entity-granular section leads with. */
const IDENTITY_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'profession', label: 'Spec' },
  { key: 'subgroup', label: 'Sub' }
]

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function matchesFilters(ref: EntityRef, opts: SectionQuery): boolean {
  if (opts.role && ref.role !== opts.role) return false
  if (opts.subgroup !== undefined && ref.subgroup !== opts.subgroup) return false
  if (opts.entity) {
    const q = opts.entity.trim().toLowerCase()
    if (ref.name.toLowerCase() !== q && ref.account.toLowerCase() !== q) return false
  }
  return true
}

/**
 * The shared entity-granular shaper: walk `by_entity`, resolve each id, project
 * the descriptor's metrics, filter, sort, limit. Every entity section is this
 * plus a metric projection, which is why they stay a few lines each.
 */
function shapeByEntity(
  report: AxilogReport,
  index: EntityIndex,
  opts: SectionQuery,
  descriptor: SectionDescriptor,
  project: (stats: Record<string, unknown>) => Record<string, number>
): SectionResult {
  const coverage = report.coverage?.[descriptor.block]
  const byEntity = report.blocks?.[descriptor.block]?.by_entity
  if (!byEntity || coverage === 'not_computed' || coverage === 'unsupported') {
    return {
      rows: [],
      columns: [],
      note: `This log does not carry ${descriptor.title.toLowerCase()} (coverage: ${coverage ?? 'absent'}).`
    }
  }

  const warnings: string[] = []
  const rows: Array<Record<string, string | number>> = []
  for (const [id, stats] of Object.entries(byEntity)) {
    const ref = index.get(id)
    if (!ref) {
      warnings.push(`Skipped statistics for unresolved entity id ${id}.`)
      continue
    }
    if (!matchesFilters(ref, opts)) continue
    rows.push({
      name: ref.name,
      profession: ref.profession,
      subgroup: ref.subgroup ?? '',
      ...project((stats ?? {}) as Record<string, unknown>)
    })
  }

  const sortKey = opts.sort ?? descriptor.fields[0].key
  rows.sort((a, b) => Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0))
  const limit = opts.limit ?? DEFAULT_ROW_LIMIT
  const limited = rows.slice(0, limit)

  return {
    rows: limited,
    columns: [...IDENTITY_COLUMNS, ...descriptor.fields.map((f) => ({ key: f.key, label: f.label }))],
    note:
      rows.length > limited.length
        ? `Showing ${limited.length} of ${rows.length} rows (raise \`limit\` for more).`
        : coverage === 'empty'
          ? 'This block is present but empty for this fight.'
          : undefined,
    warnings: warnings.length ? warnings : undefined
  }
}

const damageSection: SectionDescriptor = {
  key: 'damage',
  title: 'Damage output',
  aliases: ['dps', 'damage', 'damage out', 'who did the most damage', 'cleave', 'pressure',
    'down contribution', 'downs', 'kills'],
  summary:
    'Per-entity outgoing damage, down contribution, and downs/kills. Filter with `role` for enemy-side output.',
  block: 'damage',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'total', label: 'Damage' },
    { key: 'downContrib', label: 'Down contrib', help: 'damage contributed to enemies going down' },
    { key: 'downs', label: 'Downs' },
    { key: 'kills', label: 'Kills' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, damageSection, (s) => ({
      total: num(s.total),
      downContrib: num(s.down_contribution),
      downs: num(s.downs),
      kills: num(s.kills)
    }))
  }
}

const defensesSection: SectionDescriptor = {
  key: 'defenses',
  title: 'Defenses',
  aliases: ['defense', 'defenses', 'damage taken', 'deaths', 'died', 'downed', 'survivability',
    'who died', 'strips taken', 'boons stripped off us'],
  summary:
    'Per-entity incoming damage, times downed and killed, and boon strips taken. The receiving end of a fight.',
  block: 'defenses',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'damageTaken', label: 'Damage taken' },
    { key: 'downCount', label: 'Times downed' },
    { key: 'deathCount', label: 'Deaths' },
    { key: 'boonStripsTaken', label: 'Strips taken' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, defensesSection, (s) => ({
      damageTaken: num(s.damage_taken),
      downCount: num(s.down_count),
      deathCount: num(s.death_count),
      boonStripsTaken: num(s.boon_strips_taken)
    }))
  }
}

export const SECTIONS: SectionDescriptor[] = [damageSection, defensesSection]

export const getSection = (key: string): SectionDescriptor | undefined =>
  SECTIONS.find((s) => s.key === key)

/** Free-text discovery over the registry. Empty / no match -> full catalog. */
export function findSections(query: string): SectionDescriptor[] {
  const q = query.trim().toLowerCase()
  if (!q) return SECTIONS
  const tokens = q.split(/\s+/).filter(Boolean)
  const scored = SECTIONS.map((s) => {
    const aliasSet = new Set([s.key, ...s.aliases].map((a) => a.toLowerCase()))
    const hay = [s.key, s.title, ...s.aliases, ...s.fields.map((f) => f.label)]
      .join(' ')
      .toLowerCase()
    let score = 0
    if (aliasSet.has(q)) score += 20
    if (hay.includes(q)) score += 10
    for (const t of tokens) {
      if (aliasSet.has(t)) score += 3
      else if (hay.includes(t)) score += 1
    }
    return { s, score }
  })
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  return hits.length ? hits.map((x) => x.s) : SECTIONS
}

export function runSection(
  report: AxilogReport,
  section: string,
  opts: SectionQuery
): SectionResult {
  const descriptor = getSection(section)
  if (!descriptor) {
    throw new Error(
      `Unknown section "${section}". Call axilog_sections_list to see what this log exposes.`
    )
  }
  return descriptor.shape(report, buildEntityIndex(report), opts)
}
```

Field names like `down_contribution` and `boon_strips_taken` come from the spec's reading of axilog's schema. Verify each against the committed fixture before trusting the test — if a name differs, fix the projection, not the test's expectation that values are non-zero.

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/axilogSections.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/axilogSections.ts src/main/axilogSections.test.ts
git commit -m "feat: add axilog section registry with damage and defense sections"
```

---

### Task 5: Support, boon, and CC sections

The sections that answer "how were our strips last fight" — the spec's motivating question. Same shaper, more descriptors.

**Files:**
- Modify: `src/main/axilogSections.ts` (add descriptors, extend `SECTIONS`)
- Modify: `src/main/axilogSections.test.ts` (add cases)

**Interfaces:**
- Consumes: everything Task 4 produced.
- Produces: section keys `support`, `boons`, `cc` — plus `minions` **only if** Task 0's spike found enemy minions attributable.

- [ ] **Step 1: Write the failing tests**

```typescript
// Append to src/main/axilogSections.test.ts
describe('support sections', () => {
  it('answers "how were our strips" with per-player strip counts', () => {
    const res = runSection(report, 'support', { role: 'squad', limit: 5 })
    expect(res.columns.map((c) => c.key)).toEqual(
      expect.arrayContaining(['strips', 'cleanses', 'resurrects'])
    )
    expect(res.rows.length).toBeGreaterThan(0)
    expect(Number(res.rows[0].strips)).toBeGreaterThanOrEqual(Number(res.rows[1]?.strips ?? 0))
  })

  it('exposes strip duration separately from strip count', () => {
    const res = runSection(report, 'support', { limit: 1 })
    expect(res.columns.map((c) => c.key)).toContain('stripDurationSec')
  })

  it('declares that boons need no extra pass but rotations do', () => {
    expect(getSection('boons')!.passes).toEqual({})
    expect(getSection('cc')!.passes).toEqual({})
  })

  it('shapes CC output in seconds, not milliseconds', () => {
    const res = runSection(report, 'cc', { limit: 3 })
    expect(res.columns.map((c) => c.key)).toContain('ccSec')
    for (const row of res.rows) expect(Number(row.ccSec)).toBeLessThan(10_000)
  })

  it('filters boons to a single boon when asked', () => {
    const all = runSection(report, 'boons', { limit: 100 })
    expect(all.rows.length).toBeGreaterThan(0)
    expect(all.columns.map((c) => c.key)).toContain('boon')
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogSections.test.ts
```

Expected: FAIL — `Unknown section "support"`.

- [ ] **Step 3: Add the descriptors**

Insert before the `SECTIONS` array in `src/main/axilogSections.ts`:

```typescript
const msToSec = (ms: unknown): number => Math.round(num(ms) / 100) / 10

const supportSection: SectionDescriptor = {
  key: 'support',
  title: 'Support output',
  aliases: ['support', 'strips', 'boon strips', 'stripped', 'cleanses', 'condi cleanse',
    'cleansing', 'resurrects', 'rezzes', 'how were our strips'],
  summary:
    'Per-entity boon strips, condition cleanses, and resurrects, with strip duration alongside strip count.',
  block: 'support',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'strips', label: 'Strips' },
    { key: 'stripDurationSec', label: 'Strip dur (s)', help: 'boon duration removed, not just count' },
    { key: 'cleanses', label: 'Cleanses' },
    { key: 'cleansesSelf', label: 'Self cleanses' },
    { key: 'resurrects', label: 'Resurrects' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, supportSection, (s) => ({
      strips: num(s.strips),
      stripDurationSec: msToSec(s.strips_duration_ms),
      cleanses: num(s.cleanses),
      cleansesSelf: num(s.cleanses_self),
      resurrects: num(s.resurrects)
    }))
  }
}

const ccSection: SectionDescriptor = {
  key: 'cc',
  title: 'Crowd control',
  aliases: ['cc', 'crowd control', 'hard cc', 'stuns', 'pulls', 'knockdowns', 'stunbreaks',
    'breakbar', 'lockdown'],
  summary: 'Per-entity crowd control applied, in seconds, plus stun breaks used.',
  block: 'cc',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'ccSec', label: 'CC applied (s)' },
    { key: 'stunBreaks', label: 'Stun breaks' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, ccSection, (s) => ({
      ccSec: msToSec(s.cc_duration_ms),
      stunBreaks: num(s.stun_breaks)
    }))
  }
}

/**
 * Boons are one row PER ENTITY PER BOON rather than one row per entity: a
 * single wide row of 20 boon columns is unreadable in a chat table and answers
 * fewer questions than a filterable long form.
 */
const boonsSection: SectionDescriptor = {
  key: 'boons',
  title: 'Boon generation and uptime',
  aliases: ['boons', 'boon', 'uptime', 'stability', 'stab', 'quickness', 'alacrity', 'might',
    'fury', 'protection', 'resistance', 'aegis', 'who gave stability', 'boon gen'],
  summary:
    'Per-entity, per-boon generation and uptime. One row per entity per boon — filter with `sort` to rank a single metric.',
  block: 'boons',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'boon', label: 'Boon' },
    { key: 'uptimePct', label: 'Uptime %' },
    { key: 'squadGenSec', label: 'Squad gen (s)' },
    { key: 'wasteSec', label: 'Wasted (s)' }
  ],
  shape(report, index, opts) {
    const coverage = report.coverage?.boons
    const byEntity = report.blocks?.boons?.by_entity
    if (!byEntity || coverage === 'not_computed' || coverage === 'unsupported') {
      return {
        rows: [],
        columns: [],
        note: `This log does not carry boon generation (coverage: ${coverage ?? 'absent'}).`
      }
    }
    const catalog = report.catalogs?.buffs ?? {}
    const rows: Array<Record<string, string | number>> = []
    for (const [id, perBoon] of Object.entries(byEntity)) {
      const ref = index.get(id)
      if (!ref || !matchesFilters(ref, opts)) continue
      for (const [buffId, stats] of Object.entries(
        (perBoon ?? {}) as Record<string, Record<string, unknown>>
      )) {
        rows.push({
          name: ref.name,
          profession: ref.profession,
          subgroup: ref.subgroup ?? '',
          boon: catalog[buffId]?.name ?? `buff#${buffId}`,
          uptimePct: Math.round(num(stats.uptime_pct) * 10) / 10,
          squadGenSec: msToSec(stats.squad_generation_ms),
          wasteSec: msToSec(stats.wasted_ms)
        })
      }
    }
    const sortKey = opts.sort ?? 'squadGenSec'
    rows.sort((a, b) => Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0))
    const limit = opts.limit ?? DEFAULT_ROW_LIMIT
    const limited = rows.slice(0, limit)
    return {
      rows: limited,
      columns: [
        ...IDENTITY_COLUMNS,
        ...boonsSection.fields.map((f) => ({ key: f.key, label: f.label }))
      ],
      note:
        rows.length > limited.length
          ? `Showing ${limited.length} of ${rows.length} entity-boon rows (raise \`limit\`, or set \`entity\` to focus one player).`
          : undefined
    }
  }
}
```

Then extend the registry:

```typescript
export const SECTIONS: SectionDescriptor[] = [
  damageSection,
  defensesSection,
  supportSection,
  boonsSection,
  ccSection
]
```

- [ ] **Step 4: Apply the Task 0 finding**

If the spike found enemy minions attributable, add a `minions` descriptor reading `blocks.minions.by_entity` with `passes: { minions: true }`, resolving names through `report.catalogs.minions`, plus a test asserting `runSection(report, 'minions', { role: 'enemy_player' })` returns rows.

If it did not, add this to `shapeByEntity`'s note path instead, and a test asserting it:

```typescript
// Inside shapeByEntity, before the coverage return:
if (descriptor.key === 'minions' && opts.role === 'enemy_player') {
  return {
    rows: [],
    columns: [],
    note: 'This log does not attribute minions to enemy players — the question cannot be answered from it.'
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/axilogSections.test.ts
npm run typecheck
```

Expected: all PASS, including Task 4's cases.

- [ ] **Step 6: Commit**

```bash
git add src/main/axilogSections.ts src/main/axilogSections.test.ts
git commit -m "feat: add axilog support, boon, and CC sections"
```

---

### Task 6: Watcher and log registry

Filesystem only. This module never parses a log's contents — labels come from filenames, which is what makes the fight list instant with no cache.

**Files:**
- Create: `src/main/axilogWatcher.ts`
- Create: `src/main/axilogWatcher.test.ts`
- Modify: `src/main/secrets.ts:14-45` (add setting keys)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface LogEntry { logId: string; path: string; startedAt: string; mapFolder: string; bytes: number; source: 'watched' | 'opened' }`
  - `parseLogFilename(name: string): { startedAt: string } | null`
  - `logIdForPath(path: string): string`
  - `defaultLogDirCandidates(home: string): string[]`
  - `class AxilogWatcher` with `scan(): LogEntry[]`, `list(filter?: {since?: string; limit?: number; map?: string}): LogEntry[]`, `registerOpened(path: string): LogEntry`, `resolve(logId: string): LogEntry | null`
  - New `SettingKey`s: `'axilogDir'`, `'axilogMaxBytes'`

- [ ] **Step 1: Add the setting keys**

In `src/main/secrets.ts`, add to the `SettingKey` union, following the existing comment style:

```typescript
  /** Absolute path to the arcdps log folder; '' or unset = auto-detect. */
  | 'axilogDir'
  /** Max compressed log size to attempt, in bytes (default 157286400 = 150 MB). */
  | 'axilogMaxBytes'
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/main/axilogWatcher.test.ts
import { describe, it, expect } from 'vitest'
import {
  AxilogWatcher,
  parseLogFilename,
  logIdForPath,
  defaultLogDirCandidates
} from './axilogWatcher'

/** In-memory fs + clock, so no test touches a real directory. */
function fakeFs(files: Record<string, number>) {
  const state = { ...files }
  return {
    state,
    api: {
      exists: (p: string) => Object.keys(state).some((f) => f.startsWith(p)),
      listFiles: (dir: string) =>
        Object.keys(state)
          .filter((f) => f.startsWith(dir))
          .map((f) => ({ path: f, bytes: state[f] })),
      statSize: (p: string) => state[p] ?? 0
    }
  }
}

describe('parseLogFilename', () => {
  it('reads the arcdps timestamp out of the filename', () => {
    expect(parseLogFilename('20260830-211432.zevtc')).toEqual({ startedAt: '2026-08-30T21:14:32' })
  })

  it('accepts .evtc and .evtc.zip alongside .zevtc', () => {
    expect(parseLogFilename('20260830-211432.evtc')).not.toBeNull()
    expect(parseLogFilename('20260830-211432.evtc.zip')).not.toBeNull()
  })

  it('rejects anything that is not an arcdps log', () => {
    expect(parseLogFilename('notes.txt')).toBeNull()
    expect(parseLogFilename('fight.zevtc')).toBeNull()
  })
})

describe('logIdForPath', () => {
  it('is stable across calls and distinct per path', () => {
    expect(logIdForPath('/a/b.zevtc')).toBe(logIdForPath('/a/b.zevtc'))
    expect(logIdForPath('/a/b.zevtc')).not.toBe(logIdForPath('/a/c.zevtc'))
    expect(logIdForPath('/a/b.zevtc')).toHaveLength(8)
  })
})

describe('defaultLogDirCandidates', () => {
  it('offers the Windows path and a Proton prefix path', () => {
    const candidates = defaultLogDirCandidates('/home/user')
    expect(candidates.some((c) => c.includes('arcdps.cbtlogs'))).toBe(true)
    expect(candidates.some((c) => c.includes('drive_c'))).toBe(true)
  })
})

describe('AxilogWatcher', () => {
  const DIR = '/logs/World vs World'

  it('withholds a log whose size is still changing', () => {
    const fs = fakeFs({ [`${DIR}/20260830-211432.zevtc`]: 1000 })
    let now = Date.parse('2026-08-30T21:14:40Z')
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })

    expect(watcher.scan()).toEqual([])           // first sighting: size unconfirmed
    fs.state[`${DIR}/20260830-211432.zevtc`] = 2000
    expect(watcher.scan()).toEqual([])           // still growing
    expect(watcher.scan()).toHaveLength(1)       // stable across two scans
  })

  it('admits an old file immediately without waiting for a second scan', () => {
    const fs = fakeFs({ [`${DIR}/20260830-211432.zevtc`]: 1000 })
    const now = Date.parse('2026-08-30T23:00:00Z')
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })
    expect(watcher.scan()).toHaveLength(1)
  })

  it('labels a fight with its containing folder', () => {
    const fs = fakeFs({ [`${DIR}/20260830-211432.zevtc`]: 1000 })
    const now = Date.parse('2026-08-30T23:00:00Z')
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })
    expect(watcher.scan()[0].mapFolder).toBe('World vs World')
  })

  it('returns nothing, not an error, when no log dir is configured', () => {
    const fs = fakeFs({})
    const watcher = new AxilogWatcher({ dir: () => null, fs: fs.api, now: () => 0 })
    expect(watcher.scan()).toEqual([])
    expect(watcher.list()).toEqual([])
  })

  it('keeps opened files in the same registry as watched ones', () => {
    const fs = fakeFs({ '/elsewhere/20260830-201000.zevtc': 500 })
    const watcher = new AxilogWatcher({ dir: () => null, fs: fs.api, now: () => 0 })
    const entry = watcher.registerOpened('/elsewhere/20260830-201000.zevtc')
    expect(entry.source).toBe('opened')
    expect(watcher.resolve(entry.logId)).toEqual(entry)
    expect(watcher.list()).toHaveLength(1)
  })

  it('lists newest first and honours limit', () => {
    const fs = fakeFs({
      [`${DIR}/20260830-210000.zevtc`]: 100,
      [`${DIR}/20260830-220000.zevtc`]: 100,
      [`${DIR}/20260830-230000.zevtc`]: 100
    })
    const now = Date.parse('2026-08-31T02:00:00Z')
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })
    watcher.scan()
    const listed = watcher.list({ limit: 2 })
    expect(listed).toHaveLength(2)
    expect(listed[0].startedAt > listed[1].startedAt).toBe(true)
  })
})
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogWatcher.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the watcher**

```typescript
// src/main/axilogWatcher.ts
//
// Filesystem only — this module NEVER parses a log's contents. Fight labels
// come from arcdps's own filenames (20260830-211432.zevtc under a map folder),
// which is what lets the Logs panel list a night's fights instantly with
// nothing cached on disk.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'

export interface LogEntry {
  logId: string
  path: string
  /** Local wall-clock ISO-ish string parsed from the filename (no zone: arcdps writes local time). */
  startedAt: string
  mapFolder: string
  bytes: number
  source: 'watched' | 'opened'
}

/** Injected so tests never touch a real directory. */
export interface WatcherFs {
  exists(path: string): boolean
  listFiles(dir: string): Array<{ path: string; bytes: number }>
  statSize(path: string): number
}

export interface WatcherOptions {
  dir: () => string | null
  fs?: WatcherFs
  now?: () => number
  /** Entries retained in the registry. File metadata only — a few KB at 100. */
  maxEntries?: number
}

const LOG_NAME = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(zevtc|evtc|evtc\.zip)$/i
const SETTLE_AGE_MS = 60_000
export const MAX_REGISTRY_ENTRIES = 100

/** `20260830-211432.zevtc` -> its local start time. Null for anything else. */
export function parseLogFilename(name: string): { startedAt: string } | null {
  const m = LOG_NAME.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return { startedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}` }
}

/** Stable across restarts so a conversation's stored refs still resolve tomorrow. */
export function logIdForPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 8)
}

/**
 * Where arcdps writes logs. On Linux the game runs under a Proton/Wine prefix,
 * so the same relative path hangs off a prefix root — hence the candidate list
 * rather than one path. Finding none is normal; the user picks the folder.
 */
export function defaultLogDirCandidates(home: string): string[] {
  const rel = join('Guild Wars 2', 'addons', 'arcdps', 'arcdps.cbtlogs')
  const winDocs = join(home, 'Documents', rel)
  const prefixDocs = (prefix: string): string =>
    join(prefix, 'drive_c', 'users', 'steamuser', 'Documents', rel)
  return [
    winDocs,
    prefixDocs(join(home, '.steam', 'steam', 'steamapps', 'compatdata', '1284210', 'pfx')),
    prefixDocs(join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata', '1284210', 'pfx')),
    prefixDocs(join(home, 'Games', 'guild-wars-2'))
  ]
}

const realFs: WatcherFs = {
  exists: (p) => existsSync(p),
  listFiles(dir) {
    const out: Array<{ path: string; bytes: number }> = []
    const walk = (d: string, depth: number): void => {
      if (depth > 3) return
      for (const dirent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, dirent.name)
        if (dirent.isDirectory()) walk(full, depth + 1)
        else if (parseLogFilename(dirent.name)) out.push({ path: full, bytes: statSync(full).size })
      }
    }
    try {
      walk(dir, 0)
    } catch {
      // An unreadable log dir is an empty list, never a crash.
    }
    return out
  },
  statSize: (p) => statSync(p).size
}

export class AxilogWatcher {
  private readonly entries = new Map<string, LogEntry>()
  /** Last observed size per path, for the settle check. */
  private readonly sizes = new Map<string, number>()
  private readonly dir: () => string | null
  private readonly fs: WatcherFs
  private readonly now: () => number
  private readonly maxEntries: number

  constructor(opts: WatcherOptions) {
    this.dir = opts.dir
    this.fs = opts.fs ?? realFs
    this.now = opts.now ?? (() => Date.now())
    this.maxEntries = opts.maxEntries ?? MAX_REGISTRY_ENTRIES
  }

  /**
   * Rescan the log dir. A file is admitted only once its size is stable across
   * two scans, or it is older than a minute — arcdps writes the log as the fight
   * ends, and a file caught mid-write parses as corrupt.
   */
  scan(): LogEntry[] {
    const dir = this.dir()
    if (!dir || !this.fs.exists(dir)) return this.watched()

    for (const { path, bytes } of this.fs.listFiles(dir)) {
      const parsed = parseLogFilename(basename(path))
      if (!parsed) continue
      const settledByAge = this.now() - Date.parse(`${parsed.startedAt}Z`) > SETTLE_AGE_MS
      const previous = this.sizes.get(path)
      this.sizes.set(path, bytes)
      if (!settledByAge && (previous === undefined || previous !== bytes)) continue

      const logId = logIdForPath(path)
      if (!this.entries.has(logId)) {
        this.entries.set(logId, {
          logId,
          path,
          startedAt: parsed.startedAt,
          mapFolder: basename(dirname(path)),
          bytes,
          source: 'watched'
        })
      }
    }
    this.prune()
    return this.watched()
  }

  /** A file opened or dropped by the user, in the same registry as watched logs. */
  registerOpened(path: string): LogEntry {
    const logId = logIdForPath(path)
    const parsed = parseLogFilename(basename(path))
    const entry: LogEntry = {
      logId,
      path,
      startedAt: parsed?.startedAt ?? new Date(this.now()).toISOString().slice(0, 19),
      mapFolder: basename(dirname(path)),
      bytes: (() => {
        try {
          return this.fs.statSize(path)
        } catch {
          return 0
        }
      })(),
      source: 'opened'
    }
    this.entries.set(logId, entry)
    this.prune()
    return entry
  }

  resolve(logId: string): LogEntry | null {
    return this.entries.get(logId) ?? null
  }

  list(filter: { since?: string; limit?: number; map?: string } = {}): LogEntry[] {
    let rows = [...this.entries.values()]
    if (filter.since) rows = rows.filter((e) => e.startedAt >= filter.since!)
    if (filter.map) {
      const q = filter.map.toLowerCase()
      rows = rows.filter((e) => e.mapFolder.toLowerCase().includes(q))
    }
    rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    return filter.limit ? rows.slice(0, filter.limit) : rows
  }

  private watched(): LogEntry[] {
    return this.list().filter((e) => e.source === 'watched')
  }

  /** Opened entries survive pruning: the user asked for those explicitly. */
  private prune(): void {
    if (this.entries.size <= this.maxEntries) return
    const watched = this.list().filter((e) => e.source === 'watched')
    for (const stale of watched.slice(this.maxEntries)) this.entries.delete(stale.logId)
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/axilogWatcher.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/axilogWatcher.ts src/main/axilogWatcher.test.ts src/main/secrets.ts
git commit -m "feat: add arcdps log watcher with settle detection and registry"
```

---

### Task 7: The five tools

**Files:**
- Create: `src/main/tools/axilog.ts`
- Create: `src/main/tools/axilog.test.ts`
- Modify: `src/main/tools/shared.ts` (add `axilog` to `ToolDeps`)
- Modify: `src/main/tools/index.ts:1-15,76+` (import and register)
- Modify: `src/main/index.ts:510+` (construct and wire deps)

**Interfaces:**
- Consumes: `AxilogService` (Task 3), `findSections`/`getSection` (Tasks 4–5), `AxilogWatcher` (Task 6).
- Produces:
  - `interface AxilogDeps { watcher: AxilogWatcher; service: AxilogService | null }`
  - `buildAxilogTools(deps: () => AxilogDeps): Array<SdkMcpToolDefinition<any>>`
  - `ToolDeps.axilog: () => AxilogDeps`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/tools/axilog.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildAxilogTools } from './axilog'
import { AxilogWatcher } from '../axilogWatcher'

function deps(overrides: Record<string, unknown> = {}) {
  const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
  const entry = watcher.registerOpened('/logs/20260830-211432.zevtc')
  const service = {
    overview: vi.fn(async () => ({
      logId: entry.logId,
      map: 'Green Alpine Borderlands',
      durationMs: 49_285,
      recordedBy: 'Commander',
      roleCounts: { squad: 38, enemy_player: 60 },
      squad: [{ name: 'A', account: 'a.1234', profession: 'Scourge', subgroup: 1 }],
      coverage: { damage: 'present', minions: 'not_computed' },
      warnings: []
    })),
    section: vi.fn(async () => ({
      rows: [{ name: 'A', profession: 'Scourge', subgroup: 1, strips: 42 }],
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'strips', label: 'Strips' }
      ]
    })),
    query: vi.fn(async () => ({ rows: [1, 2], truncated: false })),
    ...overrides
  }
  return { entry, tools: buildAxilogTools(() => ({ watcher, service: service as never })), service }
}

const call = async (tools: ReturnType<typeof buildAxilogTools>, name: string, args: unknown) => {
  const t = tools.find((x) => x.name === name)!
  return t.handler(args as never, {} as never)
}

describe('axilog tools', () => {
  it('exposes exactly the five read-only tools', () => {
    const { tools } = deps()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'axilog_fight_overview',
      'axilog_logs_list',
      'axilog_query',
      'axilog_section',
      'axilog_sections_list'
    ])
  })

  it('lists logs from the filesystem without parsing', async () => {
    const { tools, service } = deps()
    const res = await call(tools, 'axilog_logs_list', { limit: 5 })
    expect(res.isError).toBeFalsy()
    expect(service.overview).not.toHaveBeenCalled()
    expect(JSON.parse(res.content[0].text).logs).toHaveLength(1)
  })

  it('returns coverage in the overview so the model can refuse honestly', async () => {
    const { tools, entry } = deps()
    const res = await call(tools, 'axilog_fight_overview', { logId: entry.logId })
    expect(JSON.parse(res.content[0].text).coverage.minions).toBe('not_computed')
  })

  it('attaches a table display payload to a section result', async () => {
    const { tools, entry } = deps()
    const res = await call(tools, 'axilog_section', { logId: entry.logId, section: 'support' })
    expect(res.display?.kind).toBe('table')
    expect(res.display?.data.rows).toHaveLength(1)
  })

  it('errors actionably on an unknown logId instead of throwing', async () => {
    const { tools } = deps()
    const res = await call(tools, 'axilog_fight_overview', { logId: 'deadbeef' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/unknown log/i)
  })

  it('reports the feature unavailable when the native module did not load', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    const entry = watcher.registerOpened('/logs/20260830-211432.zevtc')
    const tools = buildAxilogTools(() => ({ watcher, service: null }))
    const res = await call(tools, 'axilog_fight_overview', { logId: entry.logId })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/not available/i)
  })

  it('flags a truncated jq result rather than presenting it as complete', async () => {
    const { tools, entry } = deps({ query: vi.fn(async () => ({ rows: [1], truncated: true })) })
    const res = await call(tools, 'axilog_query', { logId: entry.logId, filter: '.blocks' })
    expect(JSON.parse(res.content[0].text).truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/tools/axilog.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tools**

```typescript
// src/main/tools/axilog.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, safeRich } from './shared'
import type { AxilogService } from '../axilogService'
import type { AxilogWatcher, LogEntry } from '../axilogWatcher'
import { findSections, getSection, DEFAULT_ROW_LIMIT } from '../axilogSections'

export interface AxilogDeps {
  watcher: AxilogWatcher
  /** null when the native module failed to load — every tool then errors kindly. */
  service: AxilogService | null
}

const SCHEMA_MAP =
  'Document shape: entities[] is the roster (roles: squad | friendly_player | enemy_player | npc); ' +
  'per-entity stats live at blocks.<name>.by_entity keyed by entities[].id AS STRINGS; ' +
  'names for skills/buffs/minions live in catalogs.<kind>[<id>].name; ' +
  'coverage maps each block to present | empty | not_computed | unsupported. ' +
  'There is no players[] and no schema_version.'

/** Resolve a logId to its registry entry and a live service, or throw for the model. */
function resolve(deps: AxilogDeps, logId: string): { entry: LogEntry; service: AxilogService } {
  if (!deps.service) {
    throw new Error(
      'AxiLog is not available on this install (the native parser failed to load) — see the Logs panel for details.'
    )
  }
  const entry = deps.watcher.resolve(logId)
  if (!entry) {
    throw new Error(`Unknown log "${logId}". Call axilog_logs_list to see the available fights.`)
  }
  return { entry, service: deps.service }
}

/**
 * AxiLog raw-log tools. All read-only: they parse a local arcdps log and return
 * shaped rows. One .zevtc is ONE FIGHT — night-level trends belong to the
 * axibridge_* family, not here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxilogTools(deps: () => AxilogDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'axilog_logs_list',
      'Recent arcdps fights available to analyze: watched folder plus any log the user opened. Filesystem only — nothing is parsed. Start here to turn "last fight" or "tonight" into a logId.',
      {
        since: z.string().optional().describe('ISO date/time floor, e.g. 2026-08-30T20:00:00'),
        limit: z.number().optional().describe('max fights to return (default 20)'),
        map: z.string().optional().describe('substring match on the map folder, e.g. "World vs World"')
      },
      safeRich(async (args: { since?: string; limit?: number; map?: string }) => {
        const d = deps()
        d.watcher.scan()
        const logs = d.watcher.list({ since: args.since, limit: args.limit ?? 20, map: args.map })
        return {
          value: { logs, note: logs.length === 0 ? 'No logs found. The user may need to set the arcdps log folder in the Logs panel, or drop a .zevtc into the chat.' : undefined },
          display: {
            kind: 'table' as const,
            data: {
              title: 'Recent fights',
              columns: [
                { key: 'startedAt', label: 'Started' },
                { key: 'mapFolder', label: 'Map' },
                { key: 'sizeMb', label: 'Size (MB)' },
                { key: 'source', label: 'Source' }
              ],
              rows: logs.map((l) => ({
                startedAt: l.startedAt.replace('T', ' '),
                mapFolder: l.mapFolder,
                sizeMb: Math.round((l.bytes / 1024 / 1024) * 10) / 10,
                source: l.source
              }))
            }
          }
        }
      })
    ),

    tool(
      'axilog_fight_overview',
      'Parse a fight and return its encounter, team composition, squad roster, and COVERAGE. Call this first for any log. `coverage` is authoritative: a block marked not_computed or unsupported cannot be answered from this log — say so rather than guessing.',
      { logId: z.string().describe('from axilog_logs_list') },
      safe(async (args: { logId: string }) => {
        const { entry, service } = resolve(deps(), args.logId)
        return service.overview(entry.logId, entry.path)
      })
    ),

    tool(
      'axilog_sections_list',
      'The catalog of analysis sections a raw log exposes: keys, what each covers, and its columns. Pass `topic` to find the right section for a question ("strips", "who gave stability").',
      { topic: z.string().optional() },
      safe(async (args: { topic?: string }) => ({
        sections: findSections(args.topic ?? '').map((s) => ({
          key: s.key,
          title: s.title,
          summary: s.summary,
          granularities: s.granularities,
          columns: s.fields.map((f) => ({ key: f.key, label: f.label, help: f.help }))
        }))
      }))
    ),

    tool(
      'axilog_section',
      'The workhorse: one analysis section of one fight, as named rows. Use `role` to separate your squad from the enemy, `entity` to focus one player, `sort` to rank by a column. Prefer this over axilog_query.',
      {
        logId: z.string(),
        section: z.string().describe('a key from axilog_sections_list'),
        granularity: z.enum(['entity', 'squad']).optional(),
        entity: z.string().optional().describe('exact character name or account to filter to'),
        role: z.enum(['squad', 'friendly_player', 'enemy_player', 'npc']).optional(),
        subgroup: z.number().optional(),
        sort: z.string().optional().describe('column key to rank by, descending'),
        limit: z.number().optional().describe(`rows to return (default ${DEFAULT_ROW_LIMIT})`)
      },
      safeRich(
        async (args: {
          logId: string
          section: string
          granularity?: 'entity' | 'squad'
          entity?: string
          role?: 'squad' | 'friendly_player' | 'enemy_player' | 'npc'
          subgroup?: number
          sort?: string
          limit?: number
        }) => {
          const { entry, service } = resolve(deps(), args.logId)
          const descriptor = getSection(args.section)
          if (!descriptor) {
            throw new Error(
              `Unknown section "${args.section}". Call axilog_sections_list to see what a log exposes.`
            )
          }
          const { logId: _l, section: _s, ...opts } = args
          const result = await service.section(
            entry.logId,
            entry.path,
            args.section,
            opts,
            descriptor.passes
          )
          return {
            value: result,
            display: result.rows.length
              ? {
                  kind: 'table' as const,
                  data: {
                    title: `${descriptor.title} — ${entry.mapFolder} ${entry.startedAt.replace('T', ' ')}`,
                    columns: result.columns,
                    rows: result.rows
                  }
                }
              : undefined
          }
        }
      )
    ),

    tool(
      'axilog_query',
      `Run a jq filter over a fight's raw axilog document, for questions no section covers. Output is capped and truncation is reported. ${SCHEMA_MAP}`,
      {
        logId: z.string(),
        filter: z.string().describe('a jq expression, e.g. .encounter.markers'),
        limit: z.number().optional().describe('max jq outputs to keep (default 50)')
      },
      safe(async (args: { logId: string; filter: string; limit?: number }) => {
        const { entry, service } = resolve(deps(), args.logId)
        const res = await service.query(entry.logId, entry.path, args.filter, args.limit ?? 50)
        return {
          ...res,
          note: res.truncated
            ? 'Result truncated — narrow the filter rather than treating this as the complete answer.'
            : undefined
        }
      })
    )
  ]
}
```

- [ ] **Step 4: Register the tools**

In `src/main/tools/shared.ts`, add to `ToolDeps` (with a comment matching the file's style):

```typescript
  /** Raw arcdps log analysis; resolved per-call so a re-detected log folder takes effect. */
  axilog: () => AxilogDeps
```

and the import: `import type { AxilogDeps } from './axilog'`.

In `src/main/tools/index.ts`, add `import { buildAxilogTools } from './axilog'` and, inside `buildOfficerTools`, `...buildAxilogTools(deps.axilog),` alongside the other families. Add nothing to `DESTRUCTIVE_TOOLS` or `ACTION_GATED_TOOLS` — every AxiLog tool is read-only.

In `src/main/index.ts`, near where the AxiBridge service is constructed (around line 510), build the watcher and service once and pass a thunk:

```typescript
  const axilogWatcher = new AxilogWatcher({
    dir: () => store.getSetting('axilogDir') || detectLogDir(app.getPath('home'))
  })
  const axilogNative = loadAxilog()
  const axilogService = axilogNative
    ? new AxilogService({
        workerPath: join(__dirname, 'axilogWorker.js'),
        maxLogBytes: Number(store.getSetting('axilogMaxBytes')) || undefined
      })
    : null
```

and in the `ToolDeps` object literal: `axilog: () => ({ watcher: axilogWatcher, service: axilogService }),`.

Add `detectLogDir` to `axilogWatcher.ts` — the first candidate that exists, or `null`:

```typescript
export function detectLogDir(home: string, fs: Pick<WatcherFs, 'exists'> = realFs): string | null {
  return defaultLogDirCandidates(home).find((c) => fs.exists(c)) ?? null
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/tools/axilog.test.ts src/main/tools.test.ts
npm run typecheck
```

Expected: PASS. `tools.test.ts` may assert the tool roster — update its expected list if so.

- [ ] **Step 6: Commit**

```bash
git add src/main/tools/axilog.ts src/main/tools/axilog.test.ts src/main/tools/shared.ts \
        src/main/tools/index.ts src/main/index.ts src/main/axilogWatcher.ts
git commit -m "feat: add axilog MCP tools and wire them into the officer toolset"
```

---

### Task 8: Logs panel, drag-drop, and conversation refs

**Files:**
- Create: `src/renderer/src/components/panels/Logs.tsx`
- Create: `src/renderer/src/components/panels/LogsNav.tsx`
- Create: `src/renderer/src/components/panels/useLogs.ts`
- Create: `src/renderer/src/components/panels/Logs.test.tsx`
- Modify: `src/main/index.ts` (IPC handlers)
- Modify: `src/preload/index.ts` and `src/preload/index.d.ts` (API surface)
- Modify: `src/renderer/src/App.tsx:29-37,112-114,474,523` (section registration)
- Modify: `src/main/conversationStore.ts:6-25` (log refs)
- Modify: `src/main/conversationStore.test.ts`

**Interfaces:**
- Consumes: `AxilogWatcher`, `LogEntry` (Task 6); `axilogUnavailableReason` (Task 1).
- Produces:
  - IPC: `axilog:list`, `axilog:status`, `axilog:pick-dir`, `axilog:open-file`
  - Preload: `axilogList(filter)`, `axilogStatus()`, `axilogPickDir()`, `axilogOpenFile(path)`
  - `Conversation.logRefs?: Array<{logId: string; path: string; label: string}>`
  - `useLogs(): { logs: LogEntry[]; status: AxilogStatus; refresh(): void; pickDir(): void }`
  - `interface AxilogStatus { dir: string | null; available: boolean; reason: string | null; count: number }`

- [ ] **Step 1: Write the failing conversation-store test**

```typescript
// Append to src/main/conversationStore.test.ts
it('persists log refs on a conversation and survives a reload', () => {
  const store = new ConversationStore(tmpPath())
  const convo = store.create({ title: 'Fight review' })
  store.addLogRef(convo.id, { logId: 'abc12345', path: '/logs/20260830-211432.zevtc', label: 'WvW 21:14' })
  store.flush()

  const reloaded = new ConversationStore(tmpPath())
  expect(reloaded.get(convo.id)!.logRefs).toEqual([
    { logId: 'abc12345', path: '/logs/20260830-211432.zevtc', label: 'WvW 21:14' }
  ])
})

it('does not duplicate a log ref added twice', () => {
  const store = new ConversationStore(tmpPath())
  const convo = store.create({ title: 'x' })
  const ref = { logId: 'abc12345', path: '/logs/a.zevtc', label: 'a' }
  store.addLogRef(convo.id, ref)
  store.addLogRef(convo.id, ref)
  expect(store.get(convo.id)!.logRefs).toHaveLength(1)
})
```

Match the existing test file's helpers for temp paths and store construction — read it before writing this, and adapt names to what is actually there.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/conversationStore.test.ts
```

Expected: FAIL — `store.addLogRef is not a function`.

- [ ] **Step 3: Add log refs to the conversation store**

In `src/main/conversationStore.ts`, extend the interface:

```typescript
/** A raw log this conversation has discussed. Kept so reopening the thread still
 *  resolves the same fight; a since-deleted file shows as unavailable, never
 *  silently vanishes. */
export interface ConversationLogRef {
  logId: string
  path: string
  label: string
}
```

Add `logRefs?: ConversationLogRef[]` to `Conversation`, and the method:

```typescript
  addLogRef(id: string, ref: ConversationLogRef): void {
    const convo = this.get(id)
    if (!convo) return
    const refs = convo.logRefs ?? []
    if (refs.some((r) => r.logId === ref.logId)) return
    convo.logRefs = [...refs, ref]
    this.touch(convo)
  }
```

Use whatever the file's existing mutation helper is called instead of `touch` if it differs — read the neighbouring methods and match them.

- [ ] **Step 4: Add the IPC handlers**

In `src/main/index.ts`, beside the existing `axibridge:*` handlers:

```typescript
  ipcMain.handle('axilog:list', (_e, filter: { since?: string; limit?: number; map?: string }) => {
    axilogWatcher.scan()
    return axilogWatcher.list(filter ?? {})
  })
  ipcMain.handle('axilog:status', () => ({
    dir: store.getSetting('axilogDir') || detectLogDir(app.getPath('home')),
    available: axilogService !== null,
    reason: axilogUnavailableReason(),
    count: axilogWatcher.list().length
  }))
  ipcMain.handle('axilog:pick-dir', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    store.setSetting('axilogDir', res.filePaths[0])
    return res.filePaths[0]
  })
  ipcMain.handle('axilog:open-file', (_e, path: string) => axilogWatcher.registerOpened(path))
```

- [ ] **Step 5: Add the preload API**

In `src/preload/index.ts`, beside the `axibridge*` entries:

```typescript
  axilogList: (filter?: { since?: string; limit?: number; map?: string }) =>
    ipcRenderer.invoke('axilog:list', filter),
  axilogStatus: () => ipcRenderer.invoke('axilog:status'),
  axilogPickDir: () => ipcRenderer.invoke('axilog:pick-dir'),
  axilogOpenFile: (path: string) => ipcRenderer.invoke('axilog:open-file', path),
```

Mirror these in `src/preload/index.d.ts` with the `LogEntry` and `AxilogStatus` shapes, following how `RendererConversation` is declared there.

- [ ] **Step 6: Write the failing panel test**

```typescript
// src/renderer/src/components/panels/Logs.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Logs from './Logs'

const api = {
  axilogList: vi.fn(),
  axilogStatus: vi.fn(),
  axilogPickDir: vi.fn(),
  axilogOpenFile: vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: typeof api }).api = api
})

describe('Logs panel', () => {
  it('lists watched fights with their map and time', async () => {
    api.axilogStatus.mockResolvedValue({ dir: '/logs', available: true, reason: null, count: 1 })
    api.axilogList.mockResolvedValue([
      {
        logId: 'abc12345',
        path: '/logs/20260830-211432.zevtc',
        startedAt: '2026-08-30T21:14:32',
        mapFolder: 'World vs World',
        bytes: 1_500_000,
        source: 'watched'
      }
    ])
    render(<Logs />)
    expect(await screen.findByText(/World vs World/)).toBeTruthy()
    expect(screen.getByText(/21:14/)).toBeTruthy()
  })

  it('offers the folder picker when no log dir was found', async () => {
    api.axilogStatus.mockResolvedValue({ dir: null, available: true, reason: null, count: 0 })
    api.axilogList.mockResolvedValue([])
    render(<Logs />)
    expect(await screen.findByText(/no arcdps log folder found/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /choose folder/i })).toBeTruthy()
  })

  it('explains itself when the native parser is unavailable', async () => {
    api.axilogStatus.mockResolvedValue({
      dir: '/logs',
      available: false,
      reason: 'no prebuilt binary for linux-arm64',
      count: 0
    })
    api.axilogList.mockResolvedValue([])
    render(<Logs />)
    await waitFor(() => expect(screen.getByText(/no prebuilt binary/i)).toBeTruthy())
  })
})
```

- [ ] **Step 7: Implement the panel, nav, and hook**

Build `useLogs.ts` (state + `refresh()` + `pickDir()` calling the preload API on mount), `Logs.tsx` (the three states the test asserts: list, no-folder, unavailable), and `LogsNav.tsx` (left-rail list of recent fights). **Read `Skills.tsx`, `SkillsNav.tsx`, and `useSkills.ts` first and match their structure, prop-passing (`ctl`), and styling conventions exactly** — this panel should be indistinguishable in style from the ones already there.

Register the section in `src/renderer/src/App.tsx`: add `logs: 'Logs'` to `SECTION_TITLES`, `const logsCtl = useLogs()` beside `skillsCtl`, `<LogsNav ctl={logsCtl} />` in the rail, and `{section === 'logs' && <Logs ctl={logsCtl} />}` in the body. Follow the `Section` type wherever it is declared and add `'logs'` to it.

For drag-drop: in the composer component (`InputBar`), accept `.zevtc`/`.evtc` drops, call `window.api.axilogOpenFile(path)`, and seed the message with the returned `logId` so the agent can act on it immediately.

- [ ] **Step 8: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/renderer/src/components/panels/Logs.test.tsx src/main/conversationStore.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/panels/Logs.tsx \
        src/renderer/src/components/panels/LogsNav.tsx \
        src/renderer/src/components/panels/useLogs.ts \
        src/renderer/src/components/panels/Logs.test.tsx \
        src/renderer/src/App.tsx src/preload src/main/index.ts \
        src/main/conversationStore.ts src/main/conversationStore.test.ts
git commit -m "feat: add Logs panel, log drag-drop, and conversation log refs"
```

---

### Task 9: System prompt, seeded skill, and eval case

**Files:**
- Create: `src/main/axilogPrompt.ts`
- Create: `src/main/axilogPrompt.test.ts`
- Modify: `src/main/agent.ts:402-412` (compose the block)
- Modify: `src/main/skillStore.ts` (`DEFAULT_SEED`)
- Modify: `src/main/skillStore.test.ts`
- Modify: `src/main/meta/agent.eval.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildAxilogReference(available: boolean): string` — `''` when unavailable, so an install with no logs pays zero tokens.

- [ ] **Step 1: Write the failing prompt test**

```typescript
// src/main/axilogPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildAxilogReference } from './axilogPrompt'

describe('buildAxilogReference', () => {
  it('costs nothing when there is no log source', () => {
    expect(buildAxilogReference(false)).toBe('')
  })

  it('teaches the container shape so the model does not write axibridge-shaped jq', () => {
    const block = buildAxilogReference(true)
    expect(block).toContain('by_entity')
    expect(block).toMatch(/string/i)
    expect(block).toContain('entities[]')
  })

  it('names the workflow order', () => {
    const block = buildAxilogReference(true)
    expect(block.indexOf('axilog_fight_overview')).toBeLessThan(block.indexOf('axilog_section'))
  })

  it('bounds the scope to one fight and makes coverage authoritative', () => {
    const block = buildAxilogReference(true)
    expect(block).toMatch(/one fight/i)
    expect(block).toMatch(/coverage/i)
    expect(block).toMatch(/axibridge/i)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run --maxWorkers=2 src/main/axilogPrompt.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt block**

```typescript
// src/main/axilogPrompt.ts
//
// The per-turn "raw combat log" block, appended to the system prompt the way
// buildMetaReference is. Returns '' when there is no log source — zero overhead
// on an install that never opens a .zevtc.

export function buildAxilogReference(available: boolean): string {
  if (!available) return ''
  return (
    `\n\n# Raw combat logs (AxiLog)\n` +
    `You can open a single raw arcdps log and analyze it. Workflow: axilog_logs_list ` +
    `to turn "last fight"/"tonight" into a logId, then axilog_fight_overview (always ` +
    `first for a log), then axilog_sections_list if you are unsure which section fits, ` +
    `then axilog_section. Use axilog_query (jq) only when no section covers the question.\n` +
    `FORMAT: this is NOT the AxiBridge shape. The roster is entities[] (roles: squad, ` +
    `friendly_player, enemy_player, npc) — there is no players[]. Per-entity statistics ` +
    `live at blocks.<name>.by_entity keyed by entities[].id AS STRINGS. Names for skills, ` +
    `buffs, and minions live in catalogs.<kind>[<id>].name; no block inlines a name.\n` +
    `COVERAGE IS AUTHORITATIVE: axilog_fight_overview returns a coverage map. A block ` +
    `marked not_computed or unsupported means this log does not carry that data — say so ` +
    `plainly. Never infer a player's or enemy's build from an absent block, and never ` +
    `present a missing metric as zero.\n` +
    `SCOPE: one .zevtc is ONE FIGHT, not a night. Never generalize a single skirmish into ` +
    `a trend — night-level and multi-run questions belong to the axibridge_* tools.`
  )
}
```

- [ ] **Step 4: Compose it into the system prompt**

In `src/main/agent.ts`, add the import and extend the non-local branch beside `buildMemoryReference`:

```typescript
            buildAxilogReference(this.deps.axilogAvailable()) +
```

Add `axilogAvailable: () => boolean` to the agent's deps interface and wire it in `src/main/index.ts` as `() => axilogService !== null && (axilogWatcher.list().length > 0 || detectLogDir(app.getPath('home')) !== null)`.

- [ ] **Step 5: Add the seeded skill**

In `src/main/skillStore.ts`'s `DEFAULT_SEED`, append an entry with `key: 'fight-review'`, `name: 'Fight Review'`, `whenToUse: 'reviewing one specific fight from a raw log — "how did that last fight go", "what happened at 21:14", "why did we lose that push"'`, and instructions in the house style of the `wvw-report` seed:

> Review ONE fight from a raw arcdps log, from real data only.
> 1. Resolve the fight: axilog_logs_list, then axilog_fight_overview. Read `coverage` before planning the review — name any gap in the writeup rather than working around it.
> 2. Lead with what decided the fight: axilog_section on `damage` (down contribution) and `defenses` (deaths, strips taken) for the squad, then `support` (strips, cleanses) and `boons` (stability uptime).
> 3. Headline: one line — what decided it.
> 4. One chart inline: the most telling metric, with {{figure}} on its own line right after you introduce it.
> 5. Two short markdown tables you compose yourself, ≤8 rows each, leading with "N of M": pressure (name | spec | down contrib | deaths) and support (name | spec | strips | cleanses | stability uptime).
> 6. Enemy side: axilog_section with `role: 'enemy_player'` for what they brought — but only what the log actually attributes. If coverage says the data is not there, say so.
> 7. Close with the single highest-leverage fix for the next fight.
> Every number comes from a tool call. This is one fight — never extrapolate to the night.

Add a test to `skillStore.test.ts` asserting `fight-review` seeds once and stays deleted after removal (follow the existing seed tests exactly).

- [ ] **Step 6: Add the eval case**

In `src/main/meta/agent.eval.test.ts`, add a case following the file's existing structure: a fight-review question against the committed fixture, graded on (a) `axilog_fight_overview` called before any `axilog_section`, (b) every number in the answer traceable to a tool result, (c) no night-level claims from a single log. Read the harness in `src/main/meta/__evals__/harness.ts` first — the case shape is defined there, and these are live-model tests run via `npm run eval`, not part of the normal suite.

- [ ] **Step 7: Run tests and typecheck**

```bash
npx vitest run --maxWorkers=2 src/main/axilogPrompt.test.ts src/main/skillStore.test.ts src/main/agent.test.ts
npm run typecheck
```

Expected: PASS. (`npm run eval` is live-model and costs tokens — run it once, deliberately, in Task 10.)

- [ ] **Step 8: Commit**

```bash
git add src/main/axilogPrompt.ts src/main/axilogPrompt.test.ts src/main/agent.ts \
        src/main/skillStore.ts src/main/skillStore.test.ts src/main/meta/agent.eval.test.ts \
        src/main/index.ts
git commit -m "feat: teach the agent about raw logs and seed a fight-review skill"
```

---

### Task 10: Degradation check and real-log smoke test

The last task is verification against reality: everything before this was tested against one anonymized fixture.

**Files:**
- Modify: `RELEASE_NOTES.md`
- Modify: any file where the smoke test finds a defect

**Interfaces:**
- Consumes: everything.
- Produces: a working feature, verified against real logs.

- [ ] **Step 1: Full verification**

```bash
npx vitest run --maxWorkers=2
npm run typecheck
npm run build
```

Expected: green across the board, and `out/main/axilogWorker.js` present after the build.

- [ ] **Step 2: Prove degradation is real**

Temporarily rename the native module directory and confirm the app still starts, the Logs panel explains why AxiLog is unavailable, the five tools are absent from the toolset, and every other feature works:

```bash
mv node_modules/@axiapps/axilog node_modules/@axiapps/axilog.disabled
npm run dev   # exercise the app, then quit
mv node_modules/@axiapps/axilog.disabled node_modules/@axiapps/axilog
```

A crash, a blank panel, or a stack trace in the UI here is a defect — fix it before continuing.

- [ ] **Step 3: Smoke test against real logs**

`npm run dev`, then in the app:

1. Logs panel finds (or lets you pick) the real arcdps folder and lists real fights with correct times and maps.
2. Ask "how were our strips last fight?" — verify it calls `axilog_fight_overview` first, then `axilog_section`, and that the numbers match what axilog's own CLI reports for the same log (`axilog parse <log> --format table`).
3. Drag a `.zevtc` into the composer and ask about it.
4. Run the `Fight Review` skill on a real fight.
5. Ask a question the log cannot answer (an enemy build detail, per Task 0) — confirm it says so instead of guessing.
6. Watch memory: after five idle minutes the worker should exit and RSS should drop.

- [ ] **Step 4: Add release notes**

Add an entry to `RELEASE_NOTES.md` under the next version's `## Version vX.Y.Z` heading — AxiForge/AxiVale releases fail without a section matching the tag.

- [ ] **Step 5: Run the live eval once**

```bash
npm run eval
```

Expected: the `fight-review` case passes. This costs live model tokens — run it deliberately, once.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES.md
git commit -m "docs: release notes for AxiLog raw-log integration"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: goals → Tasks 4–7; the six recorded decisions → Tasks 3 (worker, no cache), 6 (watcher + ingest), 4–5 (sections + jq), 7 (tool addressing), 8 (UI); architecture/modules → Tasks 2–7; the 1.0 container footguns → Task 2 (resolver) and Task 9 (prompt); packaging → Task 1; tool surface (all five) → Task 7; parse passes → Tasks 3–4; watcher/ingest/guards → Tasks 3 and 6; agent integration → Task 9; testing (both layers) → Tasks 2, 3, 4, 5; the open question → Task 0; graceful degradation → Tasks 1 and 10.

**Known gaps, called out rather than hidden:**

- Field names inside axilog's blocks (`down_contribution`, `strips_duration_ms`, `boon_strips_taken`, `uptime_pct`, `cc_duration_ms`) are read from the spec's survey of the Rust schema, not verified against a parsed document. Task 0 Step 3 and Task 4 Step 3 both say to verify them against the fixture and fix the projections. This is the most likely source of friction in Tasks 4–5.
- `ParseOptions`' exact field casing (`skillDamage` vs `skill_damage`) is unverified; Task 0 Step 3 records it and Task 3's `PassFlags` may need renaming to match.
- Task 8's panel steps describe structure rather than showing full component code, deliberately: they instruct the implementer to read the three `Skills*` files and match them. Inventing markup here would produce a panel that looks foreign to the app.
