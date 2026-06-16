# WvW Comp Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AxiVale a per-mode, curated, multi-factor "comp playbook" — a derived baseline from the guild's AxiBridge fight reports plus curated expert principles — that the agent treats as top-priority ground truth when building WvW comps, framed as a baseline to iterate from (not an optimizer).

**Architecture:** Phase A (backend brain): a pure `compDerive` aggregator over AxiBridge report comp-slices, a sticky `playbook` field on `MetaMode` (never clobbered by the build-distill refresh, seeded with WvW principles), prompt surfacing of the *blessed* playbook, and a `comp_check` rule fix. Phase B (curation surface): a derivation runner over the linked repos, IPC + preload methods, and a Meta-panel Playbook UI to view/edit/refresh/bless.

**Tech Stack:** TypeScript, Electron main + preload + React renderer, Vitest (`--maxWorkers=2`), existing `MetaStore`/`metaPrompt`/`AxibridgeClient`.

---

## Background the implementer must know

- **AxiBridge report data.** Each linked repo publishes `reports/index.json` (`{ entries: [{ id, dateStart, ... }] }`) and `reports/<id>/report.json` (~13 MB). The comp data lives at `report.stats`:
  - `squadClassData`: `[{ name, value }]` — profession → headcount in the squad.
  - `roleClassifications`: `[{ profession, role, ... }]` — per player; `role` ∈ `'support' | 'damage' | ...`.
  - `squadCompByFight`: `[{ id, label, parties: [{ party, players: [{ profession, isCommander }] }] }]` — per-fight subgroups.
- **AxiBridge client** (`src/main/axibridgeClient.ts`): `new AxibridgeClient(getToken)`; `await client.fetchIndex(repo)` → `ReportIndexEntry[]` (each has `id`, `dateStart`); `await client.fetchReport(repo, id)` → `unknown` (the parsed report JSON). `RepoRef = { owner, repo }`.
- **Linked repos** (`src/main/index.ts:316`): `listLinkedRepos(store.getSetting('axibridgeRepos'))` → `RepoRef[]`. The `meta` store and `axibridgeClient` are both already constructed in `index.ts`.
- **Meta store** (`src/main/metaStore.ts`): `MetaMode { id, mode, sources, notes, refreshedAt, updatedAt }`. `recordDistill(id, notes)` overwrites `notes` only. `DEFAULT_SEED` is authoritative; `normalize()` fills defaults on load; `reconcile()` syncs sources. `updateMode` patches.
- **Prompt** (`src/main/metaPrompt.ts` `buildMetaReference(modes)`, appended in `src/main/agent.ts` at the `buildMetaReference(this.deps.meta())` call).
- **Preload** (`src/preload/index.ts` `officer` object; `src/preload/index.d.ts` `RendererMetaMode` + the `officer` interface). Renderer calls `window.officer.<method>()`.
- **Meta panel**: `src/renderer/src/components/panels/Meta.tsx` (no existing test — UI verified manually).
- Vitest cap: always `--maxWorkers=2`.
- Commits end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. Already on branch `wvw-comp-playbook`.

---

# PHASE A — Brain (backend)

## Task 1: `compDerive` — the pure comp aggregator

**Files:**
- Create: `src/main/meta/compDerive.ts`
- Test: `src/main/meta/compDerive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/compDerive.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { compDerive, extractReportComp, type ReportComp } from './compDerive'

const report = (profs: Record<string, number>, roles: Array<[string, string]>, parties: string[][]): ReportComp => ({
  squadClassData: Object.entries(profs).map(([name, value]) => ({ name, value })),
  roleClassifications: roles.map(([profession, role]) => ({ profession, role })),
  parties
})

describe('compDerive', () => {
  it('returns lowConfidence + zeros for an empty pool', () => {
    const d = compDerive([], { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' })
    expect(d.sampleSize).toBe(0)
    expect(d.lowConfidence).toBe(true)
    expect(d.professions).toEqual([])
  })

  it('aggregates profession counts, presence, and run-as across reports', () => {
    const r1 = report(
      { Firebrand: 2, Reaper: 2, Druid: 1 },
      [['Firebrand', 'support'], ['Firebrand', 'support'], ['Reaper', 'damage'], ['Reaper', 'damage'], ['Druid', 'support']],
      [['Firebrand', 'Druid', 'Reaper', 'Reaper', 'Firebrand']]
    )
    const r2 = report(
      { Firebrand: 1, Reaper: 3 },
      [['Firebrand', 'support'], ['Reaper', 'damage'], ['Reaper', 'damage'], ['Reaper', 'damage']],
      [['Firebrand', 'Reaper', 'Reaper', 'Reaper', 'Druid']]
    )
    const d = compDerive([r1, r2], { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' })
    expect(d.sampleSize).toBe(2)
    expect(d.lowConfidence).toBe(true) // 2 < MIN_SAMPLE(3)
    const fb = d.professions.find((p) => p.name === 'Firebrand')!
    expect(fb.avgPerSquad).toBeCloseTo(1.5, 1) // (2+1)/2
    expect(fb.presencePct).toBe(100)
    expect(fb.runAs).toBe('support')
    const reaper = d.professions.find((p) => p.name === 'Reaper')!
    expect(reaper.runAs).toBe('damage')
    // support% across all roleClassifications: r1 3sup/2dmg, r2 1sup/3dmg => 4/9
    expect(d.supportPct).toBe(44)
    // professions sorted by avgPerSquad desc
    expect(d.professions[0].avgPerSquad).toBeGreaterThanOrEqual(d.professions[1].avgPerSquad)
  })

  it('marks subgroup core = profession in >=50% of 5-player parties', () => {
    const mk = (parties: string[][]): ReportComp => report({}, [], parties)
    const d = compDerive(
      [mk([['Firebrand', 'Druid', 'Reaper', 'Troubadour', 'Specter'], ['Firebrand', 'Druid', 'Reaper', 'Troubadour', 'Berserker']])],
      { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' }
    )
    expect(d.subgroup.core).toEqual(expect.arrayContaining(['Firebrand', 'Druid', 'Reaper', 'Troubadour']))
    expect(d.subgroup.core).not.toContain('Specter') // only 1/2 parties = 50% exactly excluded by >50%? see impl
    expect(d.subgroup.flex).toEqual(expect.arrayContaining(['Specter', 'Berserker']))
  })

  it('extractReportComp pulls the largest fight as the representative parties', () => {
    const raw = {
      stats: {
        squadClassData: [{ name: 'Reaper', value: 1 }],
        roleClassifications: [{ profession: 'Reaper', role: 'damage' }],
        squadCompByFight: [
          { parties: [{ players: [{ profession: 'Reaper' }] }] },
          { parties: [{ players: [{ profession: 'Reaper' }, { profession: 'Druid' }] }] }
        ]
      }
    }
    const rc = extractReportComp(raw)!
    expect(rc.parties).toEqual([['Reaper', 'Druid']]) // the 2-player fight wins
  })

  it('extractReportComp returns null when comp slices are absent', () => {
    expect(extractReportComp({ stats: {} })).toBeNull()
    expect(extractReportComp(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/compDerive.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/main/meta/compDerive.ts`:

```ts
// src/main/meta/compDerive.ts
//
// Pure aggregator: roll a pool of AxiBridge report comp-slices into a DerivedComp
// (profession mix, support ratio, modal subgroup). No I/O — the runner fetches
// reports and feeds slices here, so this is fully fixture-testable.

export interface ReportComp {
  squadClassData: Array<{ name: string; value: number }>
  roleClassifications: Array<{ profession: string; role: string }>
  /** Representative fight: each party is a list of professions. */
  parties: string[][]
}

export interface DerivedProfession {
  name: string
  avgPerSquad: number
  presencePct: number
  runAs: 'support' | 'damage' | 'mixed'
}

export interface DerivedComp {
  window: { fromISO: string; toISO: string; days: number }
  sampleSize: number
  sourceRepos: string[]
  lowConfidence: boolean
  avgSquadSize: number
  supportPct: number
  professions: DerivedProfession[]
  subgroup: { core: string[]; flex: string[] }
}

const MIN_SAMPLE = 3
const round1 = (n: number): number => Math.round(n * 10) / 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractReportComp(raw: any): ReportComp | null {
  const s = raw?.stats
  if (!s || !Array.isArray(s.squadClassData) || !Array.isArray(s.roleClassifications)) return null
  // Representative fight = the one with the most players across its parties.
  let best: string[][] = []
  let bestN = -1
  for (const f of Array.isArray(s.squadCompByFight) ? s.squadCompByFight : []) {
    const parties = (Array.isArray(f?.parties) ? f.parties : []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => (Array.isArray(p?.players) ? p.players : []).map((pl: any) => String(pl?.profession ?? '')).filter(Boolean)
    )
    const n = parties.reduce((a: number, p: string[]) => a + p.length, 0)
    if (n > bestN) {
      bestN = n
      best = parties
    }
  }
  return {
    squadClassData: s.squadClassData.map((d: { name: string; value: number }) => ({ name: String(d.name), value: Number(d.value) || 0 })),
    roleClassifications: s.roleClassifications.map((r: { profession: string; role: string }) => ({ profession: String(r.profession), role: String(r.role) })),
    parties: best
  }
}

export function compDerive(
  reports: ReportComp[],
  opts: { repos: string[]; days: number; fromISO: string; toISO: string }
): DerivedComp {
  const base: DerivedComp = {
    window: { fromISO: opts.fromISO, toISO: opts.toISO, days: opts.days },
    sampleSize: reports.length,
    sourceRepos: opts.repos,
    lowConfidence: reports.length < MIN_SAMPLE,
    avgSquadSize: 0,
    supportPct: 0,
    professions: [],
    subgroup: { core: [], flex: [] }
  }
  if (reports.length === 0) return base

  // Squad size = total headcount per report (sum of squadClassData values).
  const squadSizes = reports.map((r) => r.squadClassData.reduce((a, d) => a + d.value, 0))
  base.avgSquadSize = Math.round(squadSizes.reduce((a, b) => a + b, 0) / reports.length)

  // Support ratio across every classified player in the pool.
  let sup = 0
  let dmg = 0
  for (const r of reports)
    for (const rc of r.roleClassifications) {
      if (rc.role === 'support') sup++
      else if (rc.role === 'damage') dmg++
    }
  base.supportPct = sup + dmg === 0 ? 0 : Math.round((100 * sup) / (sup + dmg))

  // Per-profession totals, presence, and role lean.
  const total: Record<string, number> = {}
  const presence: Record<string, number> = {}
  const roleLean: Record<string, { support: number; damage: number }> = {}
  for (const r of reports) {
    for (const d of r.squadClassData) {
      total[d.name] = (total[d.name] ?? 0) + d.value
      presence[d.name] = (presence[d.name] ?? 0) + 1
    }
    for (const rc of r.roleClassifications) {
      const l = (roleLean[rc.profession] = roleLean[rc.profession] ?? { support: 0, damage: 0 })
      if (rc.role === 'support') l.support++
      else if (rc.role === 'damage') l.damage++
    }
  }
  base.professions = Object.keys(total)
    .map((name) => {
      const l = roleLean[name] ?? { support: 0, damage: 0 }
      const runAs: DerivedProfession['runAs'] =
        l.support === l.damage ? 'mixed' : l.support > l.damage ? 'support' : 'damage'
      return {
        name,
        avgPerSquad: round1(total[name] / reports.length),
        presencePct: Math.round((100 * presence[name]) / reports.length),
        runAs
      }
    })
    .sort((a, b) => b.avgPerSquad - a.avgPerSquad)

  // Subgroup: across all 5-player parties, core = profession appearing in >50% of them.
  const fives = reports.flatMap((r) => r.parties.filter((p) => p.length === 5))
  if (fives.length > 0) {
    const partyPresence: Record<string, number> = {}
    for (const party of fives) for (const prof of new Set(party)) partyPresence[prof] = (partyPresence[prof] ?? 0) + 1
    const core: string[] = []
    const flex: string[] = []
    for (const [prof, count] of Object.entries(partyPresence)) {
      const pct = count / fives.length
      if (pct > 0.5) core.push(prof)
      else if (pct >= 0.15) flex.push(prof)
    }
    base.subgroup = { core, flex }
  }
  return base
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/compDerive.test.ts --maxWorkers=2`
Expected: PASS. (Note: in the core/flex test, Specter appears in 1 of 2 parties = 50%, which is not `> 0.5`, so it lands in flex — matches the assertions.)

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/compDerive.ts src/main/meta/compDerive.test.ts
git commit -m "feat(meta): compDerive aggregator for AxiBridge comp rollups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Sticky `playbook` field on the meta store

**Files:**
- Modify: `src/main/metaStore.ts`
- Test: `src/main/metaStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/metaStore.test.ts` (reuse the existing temp-file helper):

```ts
import type { DerivedComp } from './meta/compDerive'

const fakeDerived = (): DerivedComp => ({
  window: { fromISO: '2026-05-15', toISO: '2026-06-15', days: 30 },
  sampleSize: 5,
  sourceRepos: ['a/b'],
  lowConfidence: false,
  avgSquadSize: 36,
  supportPct: 49,
  professions: [{ name: 'Reaper', avgPerSquad: 6, presencePct: 100, runAs: 'damage' }],
  subgroup: { core: ['Firebrand'], flex: ['Specter'] }
})

it('seeds WvW playbook with principles and blessed=true', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  expect(wvw.playbook).toBeTruthy()
  expect(wvw.playbook!.blessed).toBe(true)
  expect(wvw.playbook!.principles).toMatch(/cleanse/i)
  expect(wvw.playbook!.derived).toBeNull()
})

it('recordDerivedComp sets derived without touching principles/blessed', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  store.recordDerivedComp(wvw.id, fakeDerived())
  const after = store.get(wvw.id)!
  expect(after.playbook!.derived!.avgSquadSize).toBe(36)
  expect(after.playbook!.derivedAt).toBeTruthy()
  expect(after.playbook!.blessed).toBe(true) // unchanged
  expect(after.playbook!.principles).toMatch(/cleanse/i) // unchanged
})

it('recordDistill never touches the playbook', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  store.recordDerivedComp(wvw.id, fakeDerived())
  store.recordDistill(wvw.id, 'new build summary')
  const after = store.get(wvw.id)!
  expect(after.notes).toBe('new build summary')
  expect(after.playbook!.derived!.avgSquadSize).toBe(36) // survived
})

it('updatePlaybook patches curation fields', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  store.updatePlaybook(wvw.id, { overrides: 'prefer reaper', blessed: false })
  const after = store.get(wvw.id)!
  expect(after.playbook!.overrides).toBe('prefer reaper')
  expect(after.playbook!.blessed).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: FAIL — `playbook` undefined, methods missing.

- [ ] **Step 3: Implement**

In `src/main/metaStore.ts`:

Add the import and types near the top (after the existing imports):

```ts
import type { DerivedComp } from './meta/compDerive'

export interface Playbook {
  derived: DerivedComp | null
  derivedAt: string | null
  principles: string
  overrides: string
  blessed: boolean
}
```

Add `playbook` to `MetaMode`:

```ts
export interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string
  playbook: Playbook
  refreshedAt: string | null
  updatedAt: string
}
```

Extend `SeedShape` to carry optional seed principles:

```ts
type SeedShape = {
  mode: string
  sources: Array<{ label: string; url: string }>
  notes?: string
  playbook?: { principles?: string; blessed?: boolean }
}
```

Add the WvW seed principles constant (above `DEFAULT_SEED`):

```ts
const WVW_PRINCIPLES = `### WvW comp principles (per Veridian [rdux], top comp-maker)
- ~2 stability supports per subgroup is normal (not wasteful).
- At least 1 cleanse support per subgroup is required.
- Normal comp = reliable boon-rip + reliable burst, at ~2:1 boon-rip:burst DPS (up to 3:1 by damage rate).
- Outlier-stacking: when a build is a broken outlier, stacking it can BE the comp (all-Untamed, Soulbeast stacks).
- The meta is iteration-heavy — treat any comp as a baseline to refine, not gospel.`
```

In `DEFAULT_SEED`, add `playbook` to the WvW entry (append after its `sources`):

```ts
  {
    mode: 'WvW',
    sources: [ /* ...unchanged... */ ],
    playbook: { principles: WVW_PRINCIPLES, blessed: true }
  },
```

Add a default-playbook helper and use it in `makeMode` and `normalize`:

```ts
function defaultPlaybook(seed?: { principles?: string; blessed?: boolean }): Playbook {
  return {
    derived: null,
    derivedAt: null,
    principles: seed?.principles ?? '',
    overrides: '',
    blessed: seed?.blessed ?? false
  }
}
```

In `makeMode`, set `playbook: defaultPlaybook(seed.playbook)`. In `normalize`, set `playbook: m.playbook ?? defaultPlaybook()` (preserve on-disk playbook, fill default if absent) — and make sure the returned object includes `playbook`.

Add the two methods (near `recordDistill`):

```ts
  recordDerivedComp(modeId: string, derived: DerivedComp): void {
    const mode = this.get(modeId)
    if (!mode) return
    mode.playbook.derived = derived
    mode.playbook.derivedAt = new Date().toISOString()
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  updatePlaybook(modeId: string, patch: Partial<Pick<Playbook, 'principles' | 'overrides' | 'blessed'>>): void {
    const mode = this.get(modeId)
    if (!mode) return
    if (patch.principles !== undefined) mode.playbook.principles = patch.principles
    if (patch.overrides !== undefined) mode.playbook.overrides = patch.overrides
    if (patch.blessed !== undefined) mode.playbook.blessed = patch.blessed
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }
```

Leave `recordDistill` exactly as-is (it must continue to touch only `notes`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: PASS (new tests + existing). If an existing test deep-equals a whole `MetaMode`, update it to include the new `playbook` field.

- [ ] **Step 5: Commit**

```bash
git add src/main/metaStore.ts src/main/metaStore.test.ts
git commit -m "feat(meta): sticky per-mode playbook (seeded WvW principles)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Surface the blessed playbook in the system prompt

**Files:**
- Create: `src/main/playbookPrompt.ts`
- Modify: `src/main/agent.ts` (the line that appends `buildMetaReference`)
- Test: `src/main/playbookPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/playbookPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPlaybookReference } from './playbookPrompt'
import type { MetaMode } from './metaStore'

const mode = (over: Partial<MetaMode['playbook']>): MetaMode => ({
  id: '1',
  mode: 'WvW',
  sources: [],
  notes: '',
  refreshedAt: null,
  updatedAt: '',
  playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false, ...over }
})

describe('buildPlaybookReference', () => {
  it('returns empty string when no mode has a blessed playbook', () => {
    expect(buildPlaybookReference([mode({ blessed: false, principles: 'x' })])).toBe('')
  })

  it('emits a baseline-to-iterate block with principles when blessed', () => {
    const out = buildPlaybookReference([mode({ blessed: true, principles: '- 1 cleanse per subgroup' })])
    expect(out).toMatch(/comp playbook/i)
    expect(out).toMatch(/baseline/i)
    expect(out).toMatch(/not.*optimal/i)
    expect(out).toContain('1 cleanse per subgroup')
  })

  it('includes derived provenance and core builds when present', () => {
    const out = buildPlaybookReference([
      mode({
        blessed: true,
        principles: 'p',
        derived: {
          window: { fromISO: '2026-05-15', toISO: '2026-06-15', days: 30 },
          sampleSize: 20,
          sourceRepos: ['Fibbs23/Agg-Report'],
          lowConfidence: false,
          avgSquadSize: 36,
          supportPct: 49,
          professions: [{ name: 'Troubadour', avgPerSquad: 7.7, presencePct: 100, runAs: 'support' }],
          subgroup: { core: ['Firebrand', 'Druid', 'Reaper', 'Troubadour'], flex: ['Specter'] }
        }
      })
    ])
    expect(out).toMatch(/20 reports/)
    expect(out).toContain('Fibbs23/Agg-Report')
    expect(out).toContain('Troubadour')
    expect(out).toMatch(/49% support/)
  })

  it('flags low confidence', () => {
    const out = buildPlaybookReference([
      mode({
        blessed: true,
        principles: 'p',
        derived: {
          window: { fromISO: '2026-05-15', toISO: '2026-06-15', days: 30 },
          sampleSize: 2, sourceRepos: ['a/b'], lowConfidence: true,
          avgSquadSize: 30, supportPct: 50, professions: [], subgroup: { core: [], flex: [] }
        }
      })
    ])
    expect(out).toMatch(/low confidence/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/playbookPrompt.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/main/playbookPrompt.ts`:

```ts
// src/main/playbookPrompt.ts
//
// Builds the per-turn "comp playbook" block appended to the system prompt: the
// guild's blessed, curated comp baseline + principles, surfaced as top-priority
// ground truth. Framed as a BASELINE TO ITERATE, never an optimal comp. Returns
// '' when no mode has a blessed playbook — zero overhead.

import type { MetaMode } from './metaStore'

export function buildPlaybookReference(modes: MetaMode[]): string {
  const blocks = modes
    .filter((m) => m.playbook?.blessed && (m.playbook.principles.trim() || m.playbook.derived))
    .map((m) => {
      const p = m.playbook
      const lines: string[] = [`## ${m.mode} comp playbook — guild baseline (a starting point to ITERATE from, NOT an optimal comp)`]
      const d = p.derived
      if (d) {
        lines.push(
          `Derived from ${d.sampleSize} fight reports (${d.window.fromISO}–${d.window.toISO}, last ${d.window.days}d) across ${d.sourceRepos.join(', ')}.${d.lowConfidence ? ' LOW CONFIDENCE — thin sample; weight the principles over the numbers.' : ''}`,
          `Squad ~${d.avgSquadSize}, ${d.supportPct}% support.`
        )
        if (d.professions.length) {
          const top = d.professions.slice(0, 12).map((x) => `${x.name} ${x.avgPerSquad}/squad (${x.presencePct}%, ${x.runAs})`)
          lines.push(`Builds actually run: ${top.join('; ')}.`)
        }
        if (d.subgroup.core.length) {
          lines.push(`Modal subgroup: ${d.subgroup.core.join(' + ')}${d.subgroup.flex.length ? ` + 1 flex (${d.subgroup.flex.join(' / ')})` : ''}.`)
        }
      }
      if (p.principles.trim()) lines.push(p.principles.trim())
      if (p.overrides.trim()) lines.push(`Guild overrides: ${p.overrides.trim()}`)
      lines.push(
        `When building or critiquing a ${m.mode} comp: start from this baseline, apply the principles, and prefer these builds over a generic DPS tier list. Explain tradeoffs and invite iteration; never present it as the single optimal comp.`
      )
      return lines.join('\n')
    })
  if (blocks.length === 0) return ''
  return `\n\n# Comp playbook\n${blocks.join('\n\n')}`
}
```

In `src/main/agent.ts`, add the import near the other meta imports:

```ts
import { buildPlaybookReference } from './playbookPrompt'
```

Then change the system-prompt assembly so the playbook is appended after the meta reference. Find:

```ts
        systemPrompt:
          buildTurnSystemPrompt(AXIVALE_SYSTEM_PROMPT, skills, forced) +
          buildMetaReference(this.deps.meta()),
```

Replace with:

```ts
        systemPrompt:
          buildTurnSystemPrompt(AXIVALE_SYSTEM_PROMPT, skills, forced) +
          buildMetaReference(this.deps.meta()) +
          buildPlaybookReference(this.deps.meta()),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/playbookPrompt.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/playbookPrompt.ts src/main/agent.ts src/main/playbookPrompt.test.ts
git commit -m "feat(agent): surface blessed comp playbook as top-priority ground truth

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Fix `comp_check` to match the expert principles

**Files:**
- Modify: `src/main/meta/compCheck.ts`
- Test: `src/main/meta/compCheck.test.ts`, `src/main/meta/compCheck.eval.test.ts`

- [ ] **Step 1: Update the tests first (red)**

In `src/main/meta/compCheck.test.ts`:

1. DELETE the test `'flags doubled Primary Support in one subgroup as a warning'`.
2. ADD these tests:

```ts
it('does NOT flag two stability supports in a subgroup (2 stab is normal)', () => {
  const roster: Roster = {
    subgroups: [subgroup(['Primary Support', 'Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS'])]
  }
  const r = checkComp(roster)
  expect(r.findings.some((f) => /doubl/i.test(f.message))).toBe(false)
})

it('warns when a subgroup has no cleanse support', () => {
  const roster: Roster = {
    subgroups: [subgroup(['Primary Support', 'Tertiary Support', 'Pure DPS', 'Pure DPS', 'Boon Strip DPS'])]
  }
  const r = checkComp(roster)
  expect(r.findings.some((f) => /cleanse/i.test(f.message) && f.subgroup === 0)).toBe(true)
})
```

3. In the existing `'passes a covered subgroup'` test, ensure the subgroup includes a `Secondary Support` (it already does) so the new per-subgroup cleanse check keeps it at zero findings. Leave the `toHaveLength(0)` assertion.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/meta/compCheck.test.ts --maxWorkers=2`
Expected: FAIL — the new cleanse test fails (no per-subgroup cleanse check yet); the deleted doubling test is gone.

- [ ] **Step 3: Implement**

In `src/main/meta/compCheck.ts`, inside the per-subgroup checks (the block after the empty/oversized early-returns, where `hasPureDps`/`hasStability` are computed):

1. DELETE the doubling block entirely:

```ts
    const stabilityProviders = sg.filter((e) => providesStability(e.role)).length
    if (stabilityProviders >= 2) {
      findings.push({ /* doubles its stability source ... */ })
    }
```

2. ADD a per-subgroup cleanse check right after the stability error block:

```ts
    const hasCleanse = sg.some((e) => providesCleanse(e.role))
    if (!hasCleanse) {
      findings.push({
        severity: 'warning',
        subgroup: i,
        message: `Subgroup ${i + 1} has no cleanse support — at least 1 cleanse per subgroup is expected.`
      })
    }
```

(Keep `providesCleanse`, `providesStability`, `isStripper`, the squad-wide strip check, and all early-returns unchanged. The squad-wide "no Secondary Support anywhere" check may now be redundant with per-subgroup cleanse, but leave it — it still catches the zero-subgroup edge and is harmless.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/meta/compCheck.test.ts src/main/meta/compCheck.eval.test.ts src/main/tools/compCheck.test.ts --maxWorkers=2`
Expected: PASS. If the eval set's "clean two-subgroup zerg core" lacks a `Secondary Support` in any subgroup it will now warn (not error) — verify it still has zero *errors* (the eval asserts `hasError`, which checks `severity === 'error'`, so cleanse warnings don't break it). If any subgroup in the good eval case has no cleanse, add a `Secondary Support` to it to reflect a realistic comp.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/compCheck.ts src/main/meta/compCheck.test.ts src/main/meta/compCheck.eval.test.ts
git commit -m "fix(meta): comp_check — 2 stab is normal, require 1 cleanse per subgroup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE B — Curation surface

## Task 5: Derivation runner over linked repos

**Files:**
- Create: `src/main/meta/deriveComp.ts`
- Test: `src/main/meta/deriveComp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/deriveComp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveCompFromRepos, type CompClientLike } from './deriveComp'

const mkReport = (profs: string[]) => ({
  stats: {
    squadClassData: profs.map((p) => ({ name: p, value: 1 })),
    roleClassifications: profs.map((p) => ({ profession: p, role: p === 'Reaper' ? 'damage' : 'support' })),
    squadCompByFight: [{ parties: [{ players: profs.map((p) => ({ profession: p })) }] }]
  }
})

const client: CompClientLike = {
  async fetchIndex(repo) {
    return [
      { id: 'recent', dateStart: '2026-06-10T00:00:00.000Z' },
      { id: 'old', dateStart: '2026-01-01T00:00:00.000Z' }
    ] as never
  },
  async fetchReport(_repo, id) {
    return id === 'recent' ? mkReport(['Firebrand', 'Reaper']) : mkReport(['Guardian'])
  }
}

describe('deriveCompFromRepos', () => {
  it('aggregates only reports inside the window and skips old ones', async () => {
    const d = await deriveCompFromRepos(client, [{ owner: 'a', repo: 'b' }], { now: Date.parse('2026-06-15'), days: 30 })
    expect(d).not.toBeNull()
    expect(d!.sampleSize).toBe(1) // only "recent"
    expect(d!.sourceRepos).toEqual(['a/b'])
    expect(d!.professions.map((p) => p.name)).toEqual(expect.arrayContaining(['Firebrand', 'Reaper']))
  })

  it('returns null when no reports fall in the window', async () => {
    const d = await deriveCompFromRepos(client, [{ owner: 'a', repo: 'b' }], { now: Date.parse('2020-01-01'), days: 30 })
    expect(d).toBeNull()
  })

  it('isolates a failing repo (continues with the rest)', async () => {
    const flaky: CompClientLike = {
      fetchIndex: async (repo) => {
        if (repo.repo === 'bad') throw new Error('boom')
        return client.fetchIndex(repo)
      },
      fetchReport: client.fetchReport
    }
    const d = await deriveCompFromRepos(flaky, [{ owner: 'a', repo: 'bad' }, { owner: 'a', repo: 'b' }], { now: Date.parse('2026-06-15'), days: 30 })
    expect(d!.sampleSize).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/meta/deriveComp.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/main/meta/deriveComp.ts`:

```ts
// src/main/meta/deriveComp.ts
//
// Orchestrates a comp derivation: fetch each linked repo's index, keep reports in
// the last N days, fetch them, extract comp slices, and roll up via compDerive.
// Client is injected (a slice of AxibridgeClient) so it is testable without I/O.

import type { RepoRef } from '../axibridgeRepos'
import { repoKey } from '../axibridgeRepos'
import { compDerive, extractReportComp, type DerivedComp } from './compDerive'

export interface CompClientLike {
  fetchIndex(repo: RepoRef): Promise<Array<{ id: string; dateStart: string | null }>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchReport(repo: RepoRef, id: string): Promise<any>
}

export async function deriveCompFromRepos(
  client: CompClientLike,
  repos: RepoRef[],
  opts: { now: number; days: number }
): Promise<DerivedComp | null> {
  const cutoff = opts.now - opts.days * 86_400_000
  const fromISO = new Date(cutoff).toISOString().slice(0, 10)
  const toISO = new Date(opts.now).toISOString().slice(0, 10)
  const slices = []
  const usedRepos: string[] = []
  for (const repo of repos) {
    try {
      const index = await client.fetchIndex(repo)
      const recent = index.filter((e) => e.dateStart && Date.parse(e.dateStart) >= cutoff)
      if (recent.length === 0) continue
      usedRepos.push(repoKey(repo))
      for (const e of recent) {
        try {
          const raw = await client.fetchReport(repo, e.id)
          const rc = extractReportComp(raw)
          if (rc) slices.push(rc)
        } catch {
          /* one report failing is isolated */
        }
      }
    } catch {
      /* one repo failing is isolated */
    }
  }
  if (slices.length === 0) return null
  return compDerive(slices, { repos: usedRepos, days: opts.days, fromISO, toISO })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/meta/deriveComp.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/deriveComp.ts src/main/meta/deriveComp.test.ts
git commit -m "feat(meta): derivation runner over linked AxiBridge repos (last 30d)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: IPC + preload for derive / update-playbook

**Files:**
- Modify: `src/main/index.ts` (meta IPC block, ~line 735), `src/preload/index.ts`, `src/preload/index.d.ts`
- Test: none (thin wiring — verified via the manual smoke in Task 7's final step)

- [ ] **Step 1: Add IPC handlers**

In `src/main/index.ts`, add the import near the other axibridge imports:

```ts
import { deriveCompFromRepos } from './meta/deriveComp'
```

In the meta IPC block (next to `ipcMain.handle('meta:update-mode', ...)`), add:

```ts
  ipcMain.handle('meta:update-playbook', (_e, id: string, patch: { principles?: string; overrides?: string; blessed?: boolean }) => {
    meta.updatePlaybook(id, patch)
    return meta.get(id)
  })

  ipcMain.handle('meta:derive-comp', async (_e, id: string) => {
    const repos = listLinkedRepos(store.getSetting('axibridgeRepos'))
    if (repos.length === 0) return { ok: false, error: 'No linked AxiBridge repos. Add one in Settings.' }
    const derived = await deriveCompFromRepos(axibridgeClient, repos, { now: Date.now(), days: 30 })
    if (!derived) return { ok: false, error: 'No fight reports in the last 30 days.' }
    meta.recordDerivedComp(id, derived)
    return { ok: true, mode: meta.get(id) }
  })
```

(`axibridgeClient` is already constructed in `index.ts`; its `fetchIndex`/`fetchReport` satisfy `CompClientLike`.)

- [ ] **Step 2: Add preload methods**

In `src/preload/index.ts`, inside the `officer` object (next to `metaUpdateMode`):

```ts
  metaUpdatePlaybook: (id: string, patch: { principles?: string; overrides?: string; blessed?: boolean }) =>
    ipcRenderer.invoke('meta:update-playbook', id, patch),
  metaDeriveComp: (id: string) => ipcRenderer.invoke('meta:derive-comp', id),
```

- [ ] **Step 3: Add types**

In `src/preload/index.d.ts`:

Extend `RendererMetaMode` to include the playbook (mirror the main `Playbook`/`DerivedComp` shapes structurally — keep it self-contained so the renderer has no main imports):

```ts
export interface RendererDerivedComp {
  window: { fromISO: string; toISO: string; days: number }
  sampleSize: number
  sourceRepos: string[]
  lowConfidence: boolean
  avgSquadSize: number
  supportPct: number
  professions: Array<{ name: string; avgPerSquad: number; presencePct: number; runAs: 'support' | 'damage' | 'mixed' }>
  subgroup: { core: string[]; flex: string[] }
}
export interface RendererPlaybook {
  derived: RendererDerivedComp | null
  derivedAt: string | null
  principles: string
  overrides: string
  blessed: boolean
}
```

Add `playbook: RendererPlaybook` to `RendererMetaMode`. Add to the `officer` interface:

```ts
  metaUpdatePlaybook(id: string, patch: { principles?: string; overrides?: string; blessed?: boolean }): Promise<RendererMetaMode | null>
  metaDeriveComp(id: string): Promise<{ ok: boolean; error?: string; mode?: RendererMetaMode }>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no NEW errors beyond the known pre-existing `fetchBuildPageRaw` ones. (If `RendererMetaMode` is constructed anywhere in tests without `playbook`, update those usages.)

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(ipc): meta derive-comp + update-playbook channels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Meta-panel Playbook UI

**Files:**
- Modify: `src/renderer/src/components/panels/Meta.tsx`
- (Styling: reuse existing `meta-*`/`sbtn` classes; no new CSS required for function.)

- [ ] **Step 1: Add the Playbook section component**

In `src/renderer/src/components/panels/Meta.tsx`, add a `PlaybookSection` component above `export default function Meta`:

```tsx
function PlaybookSection({ mode, onChange }: { mode: RendererMetaMode; onChange: () => void }): ReactElement {
  const pb = mode.playbook
  const [principles, setPrinciples] = useState(pb.principles)
  const [overrides, setOverrides] = useState(pb.overrides)
  const [deriving, setDeriving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setPrinciples(pb.principles)
    setOverrides(pb.overrides)
  }, [pb.principles, pb.overrides])

  const save = (patch: { principles?: string; overrides?: string; blessed?: boolean }): void => {
    void window.officer.metaUpdatePlaybook(mode.id, patch).then(onChange)
  }
  const derive = (): void => {
    setDeriving(true)
    setMsg(null)
    void window.officer.metaDeriveComp(mode.id).then((r) => {
      setDeriving(false)
      setMsg(r.ok ? 'Derived from AxiBridge reports.' : r.error ?? 'Failed.')
      onChange()
    })
  }

  const d = pb.derived
  return (
    <div className="meta-playbook">
      <div className="srow">
        <strong>Comp playbook</strong>
        <label className="meta-bless">
          <input type="checkbox" checked={pb.blessed} onChange={(e) => save({ blessed: e.target.checked })} /> blessed (used by AI)
        </label>
        <button className="sbtn" disabled={deriving} onClick={derive}>
          {deriving ? 'Deriving…' : 'Refresh from AxiBridge'}
        </button>
      </div>
      {msg && <p className="shelp">{msg}</p>}
      {d ? (
        <div className="meta-derived">
          <p className="shelp">
            {d.sampleSize} reports · {d.window.fromISO}–{d.window.toISO} · {d.sourceRepos.join(', ')}
            {d.lowConfidence ? ' · low confidence' : ''} · squad ~{d.avgSquadSize}, {d.supportPct}% support
          </p>
          <p className="shelp">
            Subgroup: {d.subgroup.core.join(' + ')}
            {d.subgroup.flex.length ? ` + flex (${d.subgroup.flex.join(' / ')})` : ''}
          </p>
          <div className="meta-sources">
            {d.professions.slice(0, 12).map((p) => (
              <span className="meta-srcrow" key={p.name}>
                {p.name}: {p.avgPerSquad}/squad ({p.presencePct}%, {p.runAs})
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="shelp">No derived baseline yet — click “Refresh from AxiBridge”.</p>
      )}
      <label className="shelp">Principles</label>
      <textarea className="meta-edit" rows={6} value={principles} onChange={(e) => setPrinciples(e.target.value)} onBlur={() => save({ principles })} />
      <label className="shelp">Guild overrides</label>
      <textarea className="meta-edit" rows={3} value={overrides} onChange={(e) => setOverrides(e.target.value)} onBlur={() => save({ overrides })} />
    </div>
  )
}
```

- [ ] **Step 2: Render it per mode**

In the `modes.map((m) => ...)` block, after `<ModeSummary notes={m.notes} />`, add:

```tsx
            <PlaybookSection mode={m} onChange={refresh} />
```

- [ ] **Step 3: Typecheck + build the renderer**

Run: `npm run typecheck`
Expected: no new errors. (`RendererMetaMode` now has `playbook`, added in Task 6.)

- [ ] **Step 4: Manual smoke (the verification for Phase B)**

Run: `npm run dev`. In the app: open the Meta panel → WvW mode shows the seeded principles + “blessed”. With an AxiBridge repo linked in Settings, click **Refresh from AxiBridge** → the derived baseline (squad size, support%, builds, subgroup) appears. Toggle **blessed** off/on. Then ask the agent for a WvW comp and confirm it cites the playbook baseline (Reaper-primary, support-heavy, ~3 supports/line) rather than core Necro/Harbinger.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/panels/Meta.tsx
git commit -m "feat(ui): Meta-panel comp playbook (view/edit/refresh/bless)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full suite: `npx vitest run --maxWorkers=2` — all green.
- [ ] Typecheck: `npm run typecheck` — no new errors beyond the pre-existing `fetchBuildPageRaw` ones.
- [ ] Manual: derive → bless → ask for a WvW comp → confirm it reflects the guild baseline + principles and is framed as a baseline to iterate.

---

## Self-review notes (author)

- **Spec coverage:** Factor 1 derived baseline → Tasks 1 + 5; sticky playbook store + seeded principles → Task 2; prompt surfacing of blessed playbook (baseline framing, provenance, lowConfidence) → Task 3; comp_check fix (drop doubling, per-subgroup cleanse) → Task 4; curation UI + IPC → Tasks 6–7; 30-day window → Task 5. Deferred items (background auto-derive, donated pool) intentionally absent.
- **Type consistency:** `DerivedComp`/`ReportComp`/`DerivedProfession` defined in Task 1 and reused verbatim in Tasks 2/3/5; `Playbook` defined in Task 2 and mirrored as `RendererPlaybook`/`RendererDerivedComp` in Task 6; `CompClientLike` (Task 5) is satisfied by `AxibridgeClient` (Task 6 wiring). Store methods `recordDerivedComp`/`updatePlaybook` named consistently across Tasks 2/6.
- **comp_check interaction:** `providesCleanse` already exists from the prior feature; Task 4 reuses it. Removing the doubling rule is safe — the only test asserting it is deleted in the same task.
