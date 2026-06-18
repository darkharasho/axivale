# Surface Stale AxiBridge Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AxiBridge's stale-cache markers reach the user — in the agent's prose (via tool `value` JSON) and as a dashed "cached · <age> · source unreachable" badge on AxiBridge table/chart cards.

**Architecture:** A small pure helper converts the cache's epoch-ms `fetchedAt` to an ISO `staleSince` (for the agent) and a relative `staleAge` (for the badge). The service threads `stale`/`staleSince` up through `runsList`/`attendance`/`commanderStats`/`playerStats`/`reposStatus`; the tool layer puts those in each result's `value` and, for table/chart results, in `display.data`; `RichTable`/`RichChart` render the badge; one system-prompt line tells the agent how to phrase it.

**Tech Stack:** TypeScript, Electron main + React renderer, Vitest (`vi`, RTL with `// @vitest-environment jsdom`).

## Global Constraints

- Vitest under a 2-worker cap: `npx vitest run --maxWorkers=2 <path>`.
- No new runtime dependencies.
- Field names are fixed: tool `value` + service use `stale: boolean` and `staleSince: string | null` (ISO); display payloads use `stale?: boolean` and `staleAge?: string` (relative, e.g. `"3h ago"`).
- Badge text is exactly: `cached · <staleAge> · source unreachable` (separator is " · ", a U+00B7 middle dot with spaces).
- Stale markers are additive/optional everywhere — non-stale results omit them or set `stale: false`; badges render only when `stale === true`.
- `DisplayPayload` is hand-duplicated in `src/main/providers/types.ts` and `src/renderer/src/state.ts` — any change must be made identically in BOTH.
- Stale applies only to AxiBridge reads (unchanged). All existing tests stay green.

---

### Task 1: `axibridgeStale` helper

**Files:**
- Create: `src/main/axibridgeStale.ts`
- Test: `src/main/axibridgeStale.test.ts`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces:
  - `staleSinceIso(fetchedAt: number | null): string | null`
  - `relativeAge(iso: string | null, now?: number): string | null`
  - `interface StaleAgg { stale: boolean; oldest: number | null }`
  - `const emptyStaleAgg: StaleAgg`
  - `foldStale(agg: StaleAgg, stale: boolean, fetchedAt: number | null): StaleAgg`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/axibridgeStale.test.ts
import { describe, it, expect } from 'vitest'
import { staleSinceIso, relativeAge, foldStale, emptyStaleAgg } from './axibridgeStale'

describe('staleSinceIso', () => {
  it('converts epoch ms to ISO, guards null and <= 0', () => {
    expect(staleSinceIso(1_750_000_000_000)).toBe('2025-06-15T16:26:40.000Z')
    expect(staleSinceIso(null)).toBeNull()
    expect(staleSinceIso(0)).toBeNull()
    expect(staleSinceIso(-5)).toBeNull()
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-06-17T12:00:00.000Z')
  it('buckets just-now / minutes / hours / days', () => {
    expect(relativeAge('2026-06-17T11:59:30.000Z', now)).toBe('just now')
    expect(relativeAge('2026-06-17T11:40:00.000Z', now)).toBe('20m ago')
    expect(relativeAge('2026-06-17T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeAge('2026-06-15T12:00:00.000Z', now)).toBe('2d ago')
  })
  it('returns null for null or unparseable input', () => {
    expect(relativeAge(null, now)).toBeNull()
    expect(relativeAge('not-a-date', now)).toBeNull()
  })
})

describe('foldStale', () => {
  it('ORs stale and keeps the oldest positive fetchedAt', () => {
    let agg = emptyStaleAgg
    agg = foldStale(agg, false, 100) // fresh repo: ignored
    expect(agg).toEqual({ stale: false, oldest: null })
    agg = foldStale(agg, true, 5000)
    agg = foldStale(agg, true, 2000) // older wins
    agg = foldStale(agg, true, 9000)
    expect(agg).toEqual({ stale: true, oldest: 2000 })
  })
  it('marks stale even when a stale repo has no usable timestamp', () => {
    let agg = foldStale(emptyStaleAgg, true, 0)
    expect(agg).toEqual({ stale: true, oldest: null })
    agg = foldStale(agg, true, 4000)
    expect(agg).toEqual({ stale: true, oldest: 4000 }) // known age still surfaces
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeStale.test.ts`
Expected: FAIL — `Cannot find module './axibridgeStale'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/axibridgeStale.ts
//
// Pure helpers for surfacing AxiBridge stale-cache age. The cache stores
// fetchedAt as epoch ms; the agent wants a precise ISO timestamp (staleSince)
// and the badge wants a short relative age (staleAge). foldStale aggregates
// per-repo staleness across a multi-repo loop, keeping the OLDEST known age.

/** Epoch ms → ISO. null/<= 0 (unknown) → null. */
export function staleSinceIso(fetchedAt: number | null): string | null {
  if (fetchedAt === null || fetchedAt <= 0) return null
  return new Date(fetchedAt).toISOString()
}

/** ISO → short relative age ("just now" / "Nm ago" / "Nh ago" / "Nd ago").
 *  null or unparseable → null. `now` injectable for tests. */
export function relativeAge(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const s = Math.max(0, Math.floor((now - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export interface StaleAgg {
  stale: boolean
  /** Oldest known (> 0) fetchedAt across stale repos; null when none knowable. */
  oldest: number | null
}

export const emptyStaleAgg: StaleAgg = { stale: false, oldest: null }

/** Fold one repo's stale state into the running aggregate. Fresh repos are
 *  ignored; a stale repo with a non-positive fetchedAt still flips `stale`. */
export function foldStale(agg: StaleAgg, stale: boolean, fetchedAt: number | null): StaleAgg {
  if (!stale) return agg
  const oldest =
    fetchedAt !== null && fetchedAt > 0
      ? agg.oldest === null
        ? fetchedAt
        : Math.min(agg.oldest, fetchedAt)
      : agg.oldest
  return { stale: true, oldest }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeStale.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeStale.ts src/main/axibridgeStale.test.ts
git commit -m "feat(axibridge): add stale-age helpers (ISO + relative + fold)"
```

---

### Task 2: Thread `stale`/`staleSince` through the service

**Files:**
- Modify: `src/main/axibridgeService.ts` — `reposStatus` (71-94), `runsList` (96-122), `playerStats` (163-167), `attendance` (209-245), `commanderStats` (247-256)
- Test: `src/main/axibridgeService.test.ts` (add cases)

**Interfaces:**
- Consumes: `staleSinceIso`, `foldStale`, `emptyStaleAgg` from Task 1; `indexFor`/`rollupFor` already return `{ ..., stale, fetchedAt }`.
- Produces:
  - `runsList(...)` adds `stale: boolean; staleSince: string | null` (keeps `staleRepos`).
  - `attendance(...)`, `commanderStats(...)`, `playerStats(...)` add `stale: boolean; staleSince: string | null`.
  - `reposStatus()` rows add `stale: boolean; staleSince: string | null`.

- [ ] **Step 1: Write the failing test** (append to `axibridgeService.test.ts`; reuse the direct-construction mock-cache pattern already used by the stale-fallback tests — `vi` is imported)

```ts
  it('attendance (no range) reports stale + oldest staleSince when a repo serves cached rollup', async () => {
    const repo = { owner: 'o', repo: 'r' }
    const rollupBody = JSON.stringify({ rollup: { playerRows: [{ account: 'P.1', runs: 1, combatTimeMs: 1, squadTimeMs: 1 }], commanderRows: [] }, source: 'published' })
    const cache = {
      readMeta: vi.fn().mockReturnValue(null),
      putMeta: vi.fn(),
      readMetaStale: vi.fn().mockReturnValue({ body: rollupBody, fetchedAt: 1_750_000_000_000 })
    }
    const client = { fetchRollup: vi.fn().mockRejectedValue(new Error('down')) }
    const svc = new AxibridgeService({ cache, client, repos: () => [repo] } as never)

    const out = await svc.attendance({})
    expect(out.stale).toBe(true)
    expect(out.staleSince).toBe('2025-06-15T16:26:40.000Z')
  })

  it('runsList reports stale + staleSince from a stale index', async () => {
    const repo = { owner: 'o', repo: 'r' }
    const cache = {
      readMeta: vi.fn().mockReturnValue(null),
      putMeta: vi.fn(),
      readMetaStale: vi.fn().mockReturnValue({ body: JSON.stringify([{ id: 'r1', dateStart: '2026-06-01' }]), fetchedAt: 1_750_000_000_000 })
    }
    const client = { fetchIndex: vi.fn().mockRejectedValue(new Error('down')) }
    const svc = new AxibridgeService({ cache, client, repos: () => [repo] } as never)

    const out = await svc.runsList({})
    expect(out.stale).toBe(true)
    expect(out.staleSince).toBe('2025-06-15T16:26:40.000Z')
    expect(out.staleRepos).toEqual(['o/r'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeService.test.ts`
Expected: FAIL — `out.stale`/`out.staleSince` are undefined.

- [ ] **Step 3: Write minimal implementation**

Add the import near the top of `src/main/axibridgeService.ts` (with the other local imports):

```ts
import { staleSinceIso, foldStale, emptyStaleAgg } from './axibridgeStale'
```

In `reposStatus`, change the success branch (lines 78-84) to capture and emit per-repo staleness, and the error branch to emit defaults:

```ts
      try {
        const { entries, stale, fetchedAt } = await this.indexFor(repo)
        const dates = entries.map((e) => e.dateStart).filter((d): d is string => !!d).sort()
        out.push({
          repo: repoKey(repo), runs: entries.length,
          firstRun: dates[0] ?? null, lastRun: dates[dates.length - 1] ?? null,
          cachedReports: stats.cachedReports, lastIndexFetch: stats.lastIndexFetch, error: null,
          stale, staleSince: staleSinceIso(fetchedAt)
        })
      } catch (err) {
        out.push({
          repo: repoKey(repo), runs: 0, firstRun: null, lastRun: null,
          cachedReports: stats.cachedReports, lastIndexFetch: stats.lastIndexFetch,
          error: err instanceof Error ? err.message : String(err),
          stale: false, staleSince: null
        })
      }
```

Update `reposStatus`'s return-type annotation (lines 71-73) to add the two fields to each row:

```ts
  async reposStatus(): Promise<{
    repos: Array<{ repo: string; runs: number; firstRun: string | null; lastRun: string | null; cachedReports: number; lastIndexFetch: number | null; error: string | null; stale: boolean; staleSince: string | null }>
  }> {
```

In `runsList`, track the aggregate and add the fields to the return. Replace the body's loop bookkeeping and return (lines 100-121):

```ts
    const runs: RunListEntry[] = []
    const errors: string[] = []
    const staleRepos: string[] = []
    let agg = emptyStaleAgg
    for (const repo of repos) {
      try {
        const { entries, stale, fetchedAt } = await this.indexFor(repo)
        if (stale) staleRepos.push(repoKey(repo))
        agg = foldStale(agg, stale, fetchedAt)
        for (const entry of entries) {
          if (inRange(entry, filter)) runs.push({ ...entry, repo: repoKey(repo) })
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err)) // other repos unaffected
      }
    }
    // Newest first by local date, then by run id (carries HHMMSS) within a day.
    runs.sort((a, b) => {
      const da = localRunDate(a.id, a.dateStart) ?? ''
      const db = localRunDate(b.id, b.dateStart) ?? ''
      if (da !== db) return db.localeCompare(da)
      return String(b.id ?? '').localeCompare(String(a.id ?? ''))
    })
    return { runs, errors, staleRepos, stale: agg.stale, staleSince: staleSinceIso(agg.oldest) }
```

Update `runsList`'s return-type annotation (lines 96-98):

```ts
  async runsList(
    filter: DateRange & { repo?: string }
  ): Promise<{ runs: RunListEntry[]; errors: string[]; staleRepos: string[]; stale: boolean; staleSince: string | null }> {
```

Replace `playerStats` (163-167):

```ts
  async playerStats(args: DateRange & { accounts?: string[] }) {
    const { runs, errors, stale, staleSince } = await this.runsList(args)
    const { summaries, skippedRuns } = await this.summariesFor(runs)
    return { players: aggregatePlayers(summaries, args.accounts), runsConsidered: summaries.length, skippedRuns, errors, stale, staleSince }
  }
```

In `attendance`, the no-range branch (211-219) becomes:

```ts
    if (!args.from && !args.to) {
      const rows: RollupData['playerRows'] = []
      let rollupSource: 'published' | 'computed-locally' = 'published'
      let agg = emptyStaleAgg
      for (const repo of this.requireRepos()) {
        const { rollup, source, stale, fetchedAt } = await this.rollupFor(repo)
        if (source === 'computed-locally') rollupSource = source
        agg = foldStale(agg, stale, fetchedAt)
        rows.push(...rollup.playerRows)
      }
      return { attendance: rows, rollupSource, range: args, stale: agg.stale, staleSince: staleSinceIso(agg.oldest) }
    }
```

And the attendance date-range path (223-244) threads staleness from `runsList`:

```ts
    const { runs, errors, stale, staleSince } = await this.runsList(args)
    const { summaries, skippedRuns } = await this.summariesFor(runs)
    const rows = aggregatePlayers(summaries).map((p) => {
      const profession =
        Object.entries(p.professionTimeMs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      return {
        account: p.account,
        profession,
        runs: p.runsJoined,
        combatTimeMs: p.combatTimeMs,
        squadTimeMs: p.squadTimeMs,
        lastSeenTs: p.lastSeen ? Date.parse(p.lastSeen) || 0 : 0
      }
    })
    return {
      attendance: rows,
      rollupSource: 'computed-locally' as const,
      range: args,
      runsConsidered: summaries.length,
      skippedRuns,
      errors,
      stale,
      staleSince
    }
```

Replace `commanderStats` (247-256):

```ts
  async commanderStats(args: DateRange) {
    const rows: RollupData['commanderRows'] = []
    let rollupSource: 'published' | 'computed-locally' = 'published'
    let agg = emptyStaleAgg
    for (const repo of this.requireRepos()) {
      const { rollup, source, stale, fetchedAt } = await this.rollupFor(repo)
      if (source === 'computed-locally') rollupSource = source
      agg = foldStale(agg, stale, fetchedAt)
      rows.push(...rollup.commanderRows)
    }
    return { commanders: rows, rollupSource, range: args, stale: agg.stale, staleSince: staleSinceIso(agg.oldest) }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeService.test.ts`
Expected: PASS (new cases + all existing — the existing tests destructure only pre-existing fields, so additive fields don't break them).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeService.ts src/main/axibridgeService.test.ts
git commit -m "feat(axibridge): thread stale/staleSince through service reads"
```

---

### Task 3: Display-payload type + renderer badge

**Files:**
- Modify: `src/main/providers/types.ts` (table + chart `data` shapes)
- Modify: `src/renderer/src/state.ts` (identical change)
- Modify: `src/renderer/src/components/rich/RichTable.tsx`
- Modify: `src/renderer/src/components/rich/RichChart.tsx`
- Modify: `src/renderer/src/theme.css`
- Test: `src/renderer/src/components/rich/RichTable.test.tsx`, `src/renderer/src/components/rich/RichChart.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (renderer reads `spec.stale`/`spec.staleAge` strings only).
- Produces: `table` and `chart` `DisplayPayload` data shapes gain `stale?: boolean; staleAge?: string`. `RichTable`/`RichChart` render a `.rich-stale-badge` when `spec.stale`.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/components/rich/RichTable.test.tsx`:

```ts
  it('renders a stale badge with the exact text when stale', () => {
    const { getByText, queryByText } = render(
      <RichTable spec={{ ...spec, stale: true, staleAge: '3h ago' }} />
    )
    expect(getByText('cached · 3h ago · source unreachable')).toBeTruthy()
    const { queryByText: q2 } = render(<RichTable spec={spec} />)
    expect(q2(/source unreachable/)).toBeNull() // no badge when fresh
    expect(queryByText).toBeTruthy()
  })

  it('renders the badge even when the table has no title', () => {
    const { getByText } = render(
      <RichTable spec={{ columns: spec.columns, rows: spec.rows, stale: true, staleAge: 'unknown age' }} />
    )
    expect(getByText('cached · unknown age · source unreachable')).toBeTruthy()
  })
```

Append to `src/renderer/src/components/rich/RichChart.test.tsx` (match that file's existing `spec` + render imports; if it lacks a base spec, build a minimal one: `{ type: 'line', title: 'DPS', xKey: 'run', series: [{ key: 'dps', label: 'DPS' }], rows: [{ run: 'r1', dps: 5 }] }`):

```ts
  it('renders a stale badge when stale', () => {
    const base = { type: 'line' as const, title: 'DPS', xKey: 'run', series: [{ key: 'dps', label: 'DPS' }], rows: [{ run: 'r1', dps: 5 }] }
    const { getByText } = render(<RichChart spec={{ ...base, stale: true, staleAge: '2d ago' }} />)
    expect(getByText('cached · 2d ago · source unreachable')).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --maxWorkers=2 src/renderer/src/components/rich/RichTable.test.tsx src/renderer/src/components/rich/RichChart.test.tsx`
Expected: FAIL — badge text not found (and a TS error on `stale`/`staleAge` until the type is widened).

- [ ] **Step 3: Write minimal implementation**

In `src/main/providers/types.ts`, widen the `table` and `chart` members of the `DisplayPayload` union to add the two optional fields. Change the `chart` member's `data` to end with `...; stale?: boolean; staleAge?: string }` and the `table` member's `data` likewise:

```ts
  | { kind: 'chart'; data: { type: 'line' | 'bar' | 'area'; title: string; xKey: string; series: ChartSeriesSpec[]; rows: Array<Record<string, string | number>>; stale?: boolean; staleAge?: string } }
  | { kind: 'table'; data: { title?: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string | number>>; stale?: boolean; staleAge?: string } }
```

Make the identical edit to the `chart` and `table` members in `src/renderer/src/state.ts`.

In `src/renderer/src/components/rich/RichTable.tsx`, replace the title line (line 34) with a title-bar that also carries the badge:

```tsx
      {(spec.title || spec.stale) && (
        <div className="rich-title-bar">
          {spec.title && <div className="rich-title">{spec.title}</div>}
          {spec.stale && (
            <span className="rich-stale-badge">cached · {spec.staleAge} · source unreachable</span>
          )}
        </div>
      )}
```

In `src/renderer/src/components/rich/RichChart.tsx`, replace the title line (line 115) with:

```tsx
      <div className="rich-title-bar">
        <div className="rich-title">{spec.title}</div>
        {spec.stale && (
          <span className="rich-stale-badge">cached · {spec.staleAge} · source unreachable</span>
        )}
      </div>
```

In `src/renderer/src/theme.css`, add (next to the existing `.rich .rich-title` rule):

```css
.rich .rich-title-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--rule);padding-bottom:5px;margin-bottom:8px}
.rich .rich-title-bar .rich-title{border-bottom:0;padding-bottom:0;margin-bottom:0}
.rich .rich-stale-badge{display:inline-flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);border:1px dashed var(--rule2);background:rgba(0,0,0,.22);padding:3px 7px;white-space:nowrap}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/renderer/src/components/rich/RichTable.test.tsx src/renderer/src/components/rich/RichChart.test.tsx`
Expected: PASS (new badge cases + all existing renderer cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/types.ts src/renderer/src/state.ts src/renderer/src/components/rich/RichTable.tsx src/renderer/src/components/rich/RichChart.tsx src/renderer/src/theme.css src/renderer/src/components/rich/RichTable.test.tsx src/renderer/src/components/rich/RichChart.test.tsx
git commit -m "feat(rich): stale badge on table/chart cards"
```

---

### Task 4: Surface stale in the tool handlers

**Files:**
- Modify: `src/main/tools/axibridge.ts` — `axibridge_repos_status` (34-66), `axibridge_runs_list` (67-90), `axibridge_player_stats` (152-196), `axibridge_attendance` (197-241), `axibridge_commander_stats` (268-…)
- Test: `src/main/tools/axibridge.test.ts` (add cases; update `fakeService` mocks to include the new fields)

**Interfaces:**
- Consumes: service results now carrying `stale`/`staleSince` (Task 2); `relativeAge` (Task 1); display `stale`/`staleAge` fields (Task 3).
- Produces: each affected tool's `value` carries `stale`/`staleSince`; table-bearing tools' `display.data` carries `stale`/`staleAge` when stale; `repos_status` gains a per-row stale column.

- [ ] **Step 1: Write the failing tests** (append to `axibridge.test.ts`)

```ts
  it('attendance surfaces stale in value and display when the service reports stale', async () => {
    fakeService.attendance.mockResolvedValueOnce({
      attendance: [{ account: 'P.1', characterNames: [], profession: 'Scourge', runs: 2, combatTimeMs: 1, squadTimeMs: 2, lastSeenTs: 1 }],
      rollupSource: 'published', range: {}, stale: true, staleSince: '2025-06-15T16:26:40.000Z'
    })
    const res = (await byName('axibridge_attendance').handler({}, {})) as never as {
      content: Array<{ text: string }>
      display?: { kind: string; data: { stale?: boolean; staleAge?: string } }
    }
    expect(parse(res).stale).toBe(true)
    expect(parse(res).staleSince).toBe('2025-06-15T16:26:40.000Z')
    expect(res.display?.data.stale).toBe(true)
    expect(typeof res.display?.data.staleAge).toBe('string') // e.g. "Nd ago"
  })

  it('attendance omits stale markers when fresh', async () => {
    const res = (await byName('axibridge_attendance').handler({}, {})) as never as {
      content: Array<{ text: string }>; display?: { data: { stale?: boolean } }
    }
    expect(parse(res).stale).toBe(false)
    expect(res.display?.data.stale).toBeUndefined()
  })

  it('runs_list passes stale + staleRepos into value', async () => {
    fakeService.runsList.mockResolvedValueOnce({
      runs: [], errors: [], staleRepos: ['o/a'], stale: true, staleSince: '2025-06-15T16:26:40.000Z'
    })
    const res = (await byName('axibridge_runs_list').handler({}, {})) as never as { content: Array<{ text: string }> }
    expect(parse(res).stale).toBe(true)
    expect(parse(res).staleRepos).toEqual(['o/a'])
  })
```

Update the `fakeService` literal (top of file, lines 5-13) so the default (fresh) mocks include the new fields, keeping existing assertions valid:
- `runsList` default → add `staleRepos: [], stale: false, staleSince: null`.
- `playerStats` default → add `stale: false, staleSince: null`.
- `attendance` default → add `stale: false, staleSince: null`.
- `commanderStats` default → add `stale: false, staleSince: null`.
- `reposStatus` default repo row → add `stale: false, staleSince: null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --maxWorkers=2 src/main/tools/axibridge.test.ts`
Expected: FAIL — value lacks `stale`; `display.data.stale` undefined on the stale case.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/main/tools/axibridge.ts`:

```ts
import { relativeAge } from '../axibridgeStale'
```

Add a small local helper near `msToHours` (after line 17) to build the optional display markers once:

```ts
/** Optional table/chart display markers for a stale result (omitted when fresh). */
function staleDisplay(stale: boolean, staleSince: string | null): { stale: true; staleAge: string } | Record<string, never> {
  return stale ? { stale: true, staleAge: relativeAge(staleSince) ?? 'unknown age' } : {}
}
```

In `axibridge_attendance` (handler ~204-240), add the markers to `value` and spread `staleDisplay(...)` into `display.data`:

```ts
        return {
          value: {
            attendance: rows,
            rollupSource: result.rollupSource,
            stale: result.stale,
            staleSince: result.staleSince,
            ...('range' in result ? { range: result.range } : {}),
            ...('runsConsidered' in result ? { runsConsidered: result.runsConsidered } : {}),
            ...('skippedRuns' in result && result.skippedRuns?.length
              ? { skippedRuns: result.skippedRuns }
              : {})
          },
          display: {
            kind: 'table',
            data: {
              title: from || to ? `Attendance · ${from ?? '…'} – ${to ?? '…'}` : 'Attendance',
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'profession', label: 'Main profession' },
                { key: 'runs', label: 'Runs' },
                { key: 'combatHours', label: 'Combat h' },
                { key: 'squadHours', label: 'Squad h' },
                { key: 'lastSeen', label: 'Last seen' }
              ],
              rows,
              ...staleDisplay(result.stale, result.staleSince)
            }
          }
        }
```

In `axibridge_player_stats` (handler ~160-195), add to `value` and `display.data`:

```ts
        return {
          value: { players: rows, runsConsidered: result.runsConsidered, skippedRuns: result.skippedRuns, errors: result.errors, stale: result.stale, staleSince: result.staleSince },
          display: {
            kind: 'table',
            data: {
              title: 'Player stats',
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'runs', label: 'Runs' },
                { key: 'dps', label: 'DPS' },
                { key: 'cleanses', label: 'Cleanses' },
                { key: 'strips', label: 'Strips' },
                { key: 'healing', label: 'Healing' },
                { key: 'deaths', label: 'Deaths' },
                { key: 'combatHours', label: 'Combat h' }
              ],
              rows,
              ...staleDisplay(result.stale, result.staleSince)
            }
          }
        }
```

In `axibridge_commander_stats` (find its handler; it maps `result.commanders` to rows and returns a table display) add `stale`/`staleSince` to `value` and `...staleDisplay(result.stale, result.staleSince)` to `display.data` — mirroring attendance.

In `axibridge_runs_list` (handler 81-89), thread the value markers (no display on this tool):

```ts
        return { value: { count: rows.length, runs: rows, errors: result.errors, staleRepos: result.staleRepos, stale: result.stale, staleSince: result.staleSince } }
```

In `axibridge_repos_status` (handler 40-65), add a `stale` column and per-row value. Add a column entry `{ key: 'stale', label: 'Live?' }` (place it before `error`), and in the row map add:

```ts
              rows: status.repos.map((r) => ({
                repo: r.repo,
                runs: r.runs,
                firstRun: r.firstRun ?? '—',
                lastRun: r.lastRun ?? '—',
                cachedReports: r.cachedReports,
                stale: r.stale ? `cached · ${relativeAge(r.staleSince) ?? 'unknown age'}` : 'live',
                error: r.error ?? ''
              }))
```

(The `value: status` already carries each row's `stale`/`staleSince` from Task 2, so the agent sees them; no extra value change needed here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/main/tools/axibridge.test.ts`
Expected: PASS (new stale cases + all existing — the "registers exactly the spec table" and fresh-path assertions still hold).

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/axibridge.ts src/main/tools/axibridge.test.ts
git commit -m "feat(axibridge): surface stale markers in tool value + display"
```

---

### Task 5: Agent prompt line + final full-suite gate

**Files:**
- Modify: `src/main/agent.ts` (the `AXIVALE_SYSTEM_PROMPT` string — near its source-recency / honesty guidance)
- Test: `src/main/systemPrompt.test.ts` (add an assertion)

**Interfaces:**
- Consumes: nothing (documentation-of-behavior change).
- Produces: a system-prompt rule instructing the agent to surface `stale: true` AxiBridge results.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe` in `systemPrompt.test.ts`)

```ts
  it('instructs the agent to surface stale AxiBridge data', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/stale/i)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/cached/i)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/systemPrompt.test.ts`
Expected: FAIL — the prompt has no stale-surfacing rule yet.

- [ ] **Step 3: Write minimal implementation**

In `src/main/agent.ts`, add this sentence to the `AXIVALE_SYSTEM_PROMPT` near the existing recency/source guidance (keep the surrounding string formatting/escaping consistent with adjacent lines):

```
When an AxiBridge tool result includes "stale": true, its figures are cached from "staleSince" because the live source was unreachable — tell the reader plainly (e.g. "these numbers are cached from ~3h ago; the live source was down"), don't present them as current.
```

- [ ] **Step 4: Run the focused test, then the full suite gate**

Run: `npx vitest run --maxWorkers=2 src/main/systemPrompt.test.ts`
Expected: PASS.

Then the whole-feature regression gate (both processes):

Run: `npx vitest run --maxWorkers=2 src/main src/renderer`
Expected: PASS — entire main + renderer suite green. Report the totals. If anything outside this feature fails, report it (do not fix unrelated failures).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent.ts src/main/systemPrompt.test.ts
git commit -m "feat(agent): instruct surfacing of stale AxiBridge data"
```

---

## Self-Review

**Spec coverage:**
- Helper (`staleSinceIso`/`relativeAge` + `foldStale`) → Task 1. ✓
- Service threads `stale`/`staleSince` through attendance/commanderStats/playerStats/runsList/reposStatus, oldest-conservative aggregation → Task 2. ✓
- Display-payload `stale?`/`staleAge?` in BOTH type files + variant-C badge in RichTable/RichChart + CSS → Task 3. ✓
- Tools put markers in `value` (agent) and `display.data` (badge); repos_status stale column; `fetchedAt<=0 → 'unknown age'` via `relativeAge(...) ?? 'unknown age'` → Task 4. ✓
- Agent prompt line → Task 5. ✓
- Tests under 2-worker cap; full main+renderer gate → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 4 asks the implementer to locate the `commander_stats` handler and mirror attendance — the mirror pattern is fully specified (same two value fields + `...staleDisplay(...)`), not a placeholder.

**Type consistency:** `stale`/`staleSince` (ISO) flow service→value across Tasks 2/4; `stale`/`staleAge` (relative) flow Task 3 types → Task 4 `staleDisplay`/`relativeAge`. `foldStale`/`emptyStaleAgg`/`staleSinceIso` defined in Task 1, consumed in Task 2. `relativeAge` defined Task 1, consumed Tasks 3-data(no)/4. Badge text string identical in Task 3 components and Task 3/4 tests: `cached · <age> · source unreachable`. ✓
