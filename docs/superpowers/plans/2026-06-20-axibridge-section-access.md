# AxiBridge full-section access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent discover and pull every section AxiBridge publishes (boons, damage mitigation, conditions, sustain, leaderboards…) via two new read-only tools backed by a section registry, fixing "wonky" boon analysis caused by the model guessing instead of reading the published numbers.

**Architecture:** AxiBridge's published `report.json` is `{ meta, stats }` and `stats` already holds every section fully aggregated. axivale already fetches+caches that file. We add (1) a **section registry** of pure shapers that read slices of `stats`, (2) an `axibridge_find` tool (static keyword lookup over the registry), and (3) an `axibridge_section` tool that resolves a run, loads the cached report, and returns a shaped section. No worker, no raw-log parse, no recompute.

**Tech Stack:** TypeScript (Node ESM), `@anthropic-ai/claude-agent-sdk` `tool()`, `zod`, vitest. Existing modules: `src/main/axibridgeService.ts`, `src/main/tools/axibridge.ts`, `src/main/tools/shared.ts` (`safeRich`), `src/main/agent.ts`.

## Global Constraints

- Run vitest with `--maxWorkers=2` (machine memory limit).
- Verification MUST include `npm run typecheck` — vitest/esbuild does not type-check.
- All new tools are read-only; never mutate repos or cache semantics.
- Tool handlers return `{ value, display? }` wrapped in `safeRich(...)`; `display` uses existing kinds (`table`).
- Reuse the run-resolution + fetch/cache path already in `AxibridgeService.positioning`; do not duplicate it.
- Defensive reads: a section key absent from a given report's `stats` returns `rows: []` + a `note`, never throws (older AxiBridge versions).
- Time fields in `stats` are milliseconds; display generation/uptime in seconds (1 decimal) and uptime as a percentage of `activeTimeMs`.

---

## File Structure

- `src/main/axibridgeSections.ts` — **new.** Registry types, `SECTIONS` array, all shapers, `findSections`, `getSection`. One responsibility: turn a parsed `{meta,stats}` report + query into shaped rows/columns, and answer "what sections exist."
- `src/main/axibridgeSections.test.ts` — **new.** Unit tests for shapers + `findSections`, driven by an inline trimmed `stats` fixture.
- `src/main/axibridgeService.ts` — **modify.** Add `reportFor`; refactor `positioning` to use it.
- `src/main/tools/axibridge.ts` — **modify.** Add `axibridge_find` + `axibridge_section`.
- `src/main/tools/axibridge.test.ts` — **modify.** Add tests for the two new tools (fake service).
- `src/main/agent.ts` — **modify.** Add find→section guidance; add tool names to the local allowlist.

---

## Task 1: Section registry skeleton + boons shaper

**Files:**
- Create: `src/main/axibridgeSections.ts`
- Test: `src/main/axibridgeSections.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type Granularity = 'player' | 'category' | 'squad'`
  - `interface SectionField { key: string; label: string; help?: string }`
  - `interface SectionQuery { granularity?: Granularity; account?: string; boon?: string; limit?: number }`
  - `interface SectionResult { rows: Array<Record<string, string | number>>; columns: Array<{ key: string; label: string }>; note?: string; warnings?: string[] }`
  - `interface ParsedReport { meta?: Record<string, unknown>; stats?: Record<string, unknown> }`
  - `interface SectionDescriptor { key: string; title: string; aliases: string[]; summary: string; granularities: Granularity[]; fields: SectionField[]; shape(report: ParsedReport, opts: SectionQuery): SectionResult }`
  - `const SECTIONS: SectionDescriptor[]`
  - `function getSection(key: string): SectionDescriptor | undefined`
  - helper `secondsFromMs(ms: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/axibridgeSections.test.ts
import { describe, it, expect } from 'vitest'
import { SECTIONS, getSection } from './axibridgeSections'

const boonReport = {
  meta: { id: 'r1', title: 'Run 1' },
  stats: {
    boonTables: [
      {
        id: 'b717', name: 'Protection', stacking: false,
        rows: [
          { account: 'A.1', profession: 'Firebrand', professionList: ['Firebrand'], activeTimeMs: 300000, numFights: 3,
            groupSupported: 15, squadSupported: 111,
            categories: {
              selfBuffs: { generationMs: 50000, wastedMs: 40000 },
              groupBuffs: { generationMs: 120000, wastedMs: 90000 },
              squadBuffs: { generationMs: 130000, wastedMs: 92000 }
            } },
          { account: 'B.2', profession: 'Scrapper', professionList: ['Scrapper'], activeTimeMs: 300000, numFights: 3,
            groupSupported: 5, squadSupported: 20,
            categories: {
              selfBuffs: { generationMs: 10000, wastedMs: 5000 },
              groupBuffs: { generationMs: 30000, wastedMs: 6000 },
              squadBuffs: { generationMs: 32000, wastedMs: 7000 }
            } }
        ]
      }
    ]
  }
}

describe('boons shaper', () => {
  it('returns per-account self/group/squad generation+waste+uptime for a named boon', () => {
    const boons = getSection('boons')!
    const res = boons.shape(boonReport, { granularity: 'player', boon: 'Protection' })
    expect(res.rows).toHaveLength(2)
    const a = res.rows.find((r) => r.account === 'A.1')!
    expect(a.boon).toBe('Protection')
    expect(a.groupGenSec).toBe(120) // 120000ms -> 120.0s
    expect(a.groupWasteSec).toBe(90)
    // uptime = groupGenerationMs / activeTimeMs as a %
    expect(a.groupUptimePct).toBe(40) // 120000/300000
  })

  it('sums squad generation across players when no boon filter and granularity=squad', () => {
    const boons = getSection('boons')!
    const res = boons.shape(boonReport, { granularity: 'squad' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].squadGenSec).toBe(162) // (130000+32000)/1000
  })

  it('lists boons as a section', () => {
    expect(SECTIONS.some((s) => s.key === 'boons')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeSections.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./axibridgeSections`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/axibridgeSections.ts
export type Granularity = 'player' | 'category' | 'squad'

export interface SectionField { key: string; label: string; help?: string }
export interface SectionQuery {
  granularity?: Granularity
  account?: string
  boon?: string
  limit?: number
}
export interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string
  warnings?: string[]
}
export interface ParsedReport {
  meta?: Record<string, unknown>
  stats?: Record<string, unknown>
}
export interface SectionDescriptor {
  key: string
  title: string
  aliases: string[]
  summary: string
  granularities: Granularity[]
  fields: SectionField[]
  shape(report: ParsedReport, opts: SectionQuery): SectionResult
}

/** ms -> seconds, 1 decimal. */
export const secondsFromMs = (ms: number): number => Math.round((Number(ms) || 0) / 100) / 10
/** numerator/denominator as a 0–100 percentage, 1 decimal; 0 when denom is 0. */
const pct = (num: number, denom: number): number =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0

type BoonCat = { generationMs?: number; wastedMs?: number }
interface BoonRow {
  account: string
  profession: string
  professionList?: string[]
  activeTimeMs: number
  numFights: number
  groupSupported: number
  squadSupported: number
  categories: Record<'selfBuffs' | 'groupBuffs' | 'squadBuffs', BoonCat>
}
interface BoonTable { id: string; name: string; stacking: boolean; rows: BoonRow[] }

const boonsSection: SectionDescriptor = {
  key: 'boons',
  title: 'Boon generation',
  aliases: ['boon', 'boons', 'boon uptime', 'boon generation', 'boon waste', 'wasted boons',
    'might', 'fury', 'quickness', 'alacrity', 'protection', 'stability', 'resistance',
    'regeneration', 'aegis', 'swiftness', 'vigor', 'resolution', 'who gave', 'uptime'],
  summary: 'Per-player boon generation, waste, and uptime, split by self / group / squad. Filter to one boon with `boon`.',
  granularities: ['player', 'category', 'squad'],
  fields: [
    { key: 'boon', label: 'Boon' },
    { key: 'selfGenSec', label: 'Self gen (s)', help: 'self-only boon generation' },
    { key: 'groupGenSec', label: 'Group gen (s)', help: 'generation to own subgroup' },
    { key: 'squadGenSec', label: 'Squad gen (s)', help: 'generation across the squad' },
    { key: 'groupWasteSec', label: 'Group waste (s)', help: 'overcapped/wasted group generation' },
    { key: 'groupUptimePct', label: 'Group uptime %', help: 'groupGen / activeTime' }
  ],
  shape(report, opts) {
    const tables = (report.stats?.boonTables as BoonTable[] | undefined) ?? []
    if (tables.length === 0) {
      return { rows: [], columns: [], note: 'This report did not include boonTables.' }
    }
    const wanted = opts.boon?.toLowerCase()
    const selected = wanted ? tables.filter((t) => t.name.toLowerCase() === wanted) : tables
    if (wanted && selected.length === 0) {
      return {
        rows: [], columns: [],
        note: `No boon named "${opts.boon}". Available: ${tables.map((t) => t.name).join(', ')}.`
      }
    }

    const columns = [
      { key: 'account', label: 'Account' },
      { key: 'profession', label: 'Profession' },
      { key: 'boon', label: 'Boon' },
      { key: 'selfGenSec', label: 'Self gen (s)' },
      { key: 'groupGenSec', label: 'Group gen (s)' },
      { key: 'squadGenSec', label: 'Squad gen (s)' },
      { key: 'groupWasteSec', label: 'Group waste (s)' },
      { key: 'groupUptimePct', label: 'Group uptime %' }
    ]

    const perAccount: Array<Record<string, string | number>> = []
    for (const table of selected) {
      for (const row of table.rows ?? []) {
        if (opts.account && row.account !== opts.account) continue
        const c = row.categories ?? ({} as BoonRow['categories'])
        perAccount.push({
          account: row.account,
          profession: row.profession,
          boon: table.name,
          selfGenSec: secondsFromMs(c.selfBuffs?.generationMs ?? 0),
          groupGenSec: secondsFromMs(c.groupBuffs?.generationMs ?? 0),
          squadGenSec: secondsFromMs(c.squadBuffs?.generationMs ?? 0),
          groupWasteSec: secondsFromMs(c.groupBuffs?.wastedMs ?? 0),
          groupUptimePct: pct(c.groupBuffs?.generationMs ?? 0, row.activeTimeMs || 0)
        })
      }
    }

    if (opts.granularity === 'squad') {
      const sum = (k: keyof (typeof perAccount)[number]) =>
        perAccount.reduce((acc, r) => acc + (Number(r[k]) || 0), 0)
      return {
        rows: [{
          scope: 'squad total',
          boon: wanted ? selected[0].name : 'all boons',
          selfGenSec: Math.round(sum('selfGenSec') * 10) / 10,
          groupGenSec: Math.round(sum('groupGenSec') * 10) / 10,
          squadGenSec: Math.round(sum('squadGenSec') * 10) / 10,
          groupWasteSec: Math.round(sum('groupWasteSec') * 10) / 10
        }],
        columns: [
          { key: 'scope', label: 'Scope' },
          { key: 'boon', label: 'Boon' },
          { key: 'selfGenSec', label: 'Self gen (s)' },
          { key: 'groupGenSec', label: 'Group gen (s)' },
          { key: 'squadGenSec', label: 'Squad gen (s)' },
          { key: 'groupWasteSec', label: 'Group waste (s)' }
        ],
        note: 'Squad totals summed across players. Self/group/squad are the available granularity axes; party-number breakdown is not in the published data.'
      }
    }

    const limited = opts.limit ? perAccount.slice(0, opts.limit) : perAccount
    return {
      rows: limited,
      columns,
      note: wanted ? undefined : 'Multiple boons returned; pass `boon` to focus one. Uptime/waste are group-category figures.'
    }
  }
}

export const SECTIONS: SectionDescriptor[] = [boonsSection]

export const getSection = (key: string): SectionDescriptor | undefined =>
  SECTIONS.find((s) => s.key === key)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeSections.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeSections.ts src/main/axibridgeSections.test.ts
git commit -m "feat(axibridge): section registry + boons shaper"
```

---

## Task 2: Player-totals shaper + defense/support/healing/offense/condition sections

**Files:**
- Modify: `src/main/axibridgeSections.ts`
- Test: `src/main/axibridgeSections.test.ts`

**Interfaces:**
- Consumes: types from Task 1 (`SectionDescriptor`, `SectionQuery`, `SectionResult`, `secondsFromMs`).
- Produces: a private `shapePlayerTotals(...)` helper and new descriptors registered in `SECTIONS` with keys: `damage_mitigation`, `damage_taken`, `cleanses`, `strips`, `crowd_control`, `healing`, `barrier`, `down_contribution`, `conditions_out`, `conditions_in`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/main/axibridgeSections.test.ts
import { getSection as gs } from './axibridgeSections'

const totalsReport = {
  meta: { id: 'r1' },
  stats: {
    defensePlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], activeMs: 300000,
        defenseTotals: { damageTaken: 500000, powerDamageTaken: 300000, conditionDamageTaken: 200000,
          blockedCount: 40, evadedCount: 20, missedCount: 5, dodgeCount: 12, invulnedCount: 3,
          interruptedCount: 2, downCount: 1, deadCount: 0, damageBarrier: 80000,
          boonStrips: 50, conditionCleanses: 10, receivedCrowdControl: 7 } }
    ],
    supportPlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], activeMs: 300000,
        supportTotals: { condiCleanse: 60, condiCleanseSelf: 10, boonStrips: 120,
          boonStripDownContribution: 9000, stunBreak: 4, removedStunDuration: 8000, resurrects: 2 } }
    ],
    healingPlayers: [
      { account: 'H.1', profession: 'Druid', professionList: ['Druid'], activeMs: 300000,
        healingTotals: { healing: 400000, squadHealing: 250000, groupHealing: 120000,
          selfHealing: 30000, offSquadHealing: 0 } }
    ],
    offensePlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], totalFightMs: 300000,
        offenseTotals: {}, offenseRateWeights: {}, downs: 5, downContribution: 22000 }
    ],
    outgoingConditionPlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], totalFightMs: 300000,
        totalApplications: 900, totalDamage: 120000, conditions: {} }
    ],
    incomingConditionPlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], totalFightMs: 300000,
        totalApplications: 700, totalDamage: 90000, conditions: {} }
    ]
  }
}

describe('player-totals sections', () => {
  it('damage_mitigation pulls block/evade/etc from defenseTotals', () => {
    const res = gs('damage_mitigation')!.shape(totalsReport, { granularity: 'player' })
    const a = res.rows.find((r) => r.account === 'A.1')!
    expect(a.blocked).toBe(40)
    expect(a.evaded).toBe(20)
    expect(a.interrupted).toBe(2)
  })

  it('strips includes boonStripDownContribution', () => {
    const res = gs('strips')!.shape(totalsReport, { granularity: 'player' })
    expect(res.rows[0].boonStrips).toBe(120)
    expect(res.rows[0].stripDownContribution).toBe(9000)
  })

  it('squad granularity sums the numeric columns into one row', () => {
    const res = gs('damage_mitigation')!.shape(totalsReport, { granularity: 'squad' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].blocked).toBe(40)
  })

  it('absent section returns empty rows + note, never throws', () => {
    const res = gs('healing')!.shape({ meta: {}, stats: {} }, {})
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/did not include/i)
  })

  it('account filter narrows to one player', () => {
    const res = gs('strips')!.shape(totalsReport, { account: 'A.1' })
    expect(res.rows).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeSections.test.ts --maxWorkers=2`
Expected: FAIL — `gs('damage_mitigation')` is `undefined` (cannot read `.shape`).

- [ ] **Step 3: Write minimal implementation**

Add this helper and descriptors to `src/main/axibridgeSections.ts`, and extend the `SECTIONS` array.

```ts
// --- generic per-player totals sections ------------------------------------
interface PlayerTotalsRow {
  account: string
  profession: string
  professionList?: string[]
  activeMs?: number
  totalFightMs?: number
}

/**
 * Shape a `<domain>Players` array whose rows carry a `<totalsKey>` object.
 * `fields` maps output column key -> the key inside the totals object.
 * Squad granularity collapses to one summed row.
 */
function shapePlayerTotals(
  rows: Array<PlayerTotalsRow & Record<string, unknown>> | undefined,
  totalsKey: string,
  fields: Array<{ key: string; label: string; from: string }>,
  opts: SectionQuery,
  absentNote: string
): SectionResult {
  if (!rows || rows.length === 0) return { rows: [], columns: [], note: absentNote }

  const mapRow = (r: PlayerTotalsRow & Record<string, unknown>): Record<string, string | number> => {
    const totals = (r[totalsKey] as Record<string, number>) ?? {}
    const out: Record<string, string | number> = { account: r.account, profession: r.profession }
    for (const f of fields) out[f.key] = Number(totals[f.from] ?? 0)
    return out
  }

  let mapped = rows.filter((r) => !opts.account || r.account === opts.account).map(mapRow)

  const columns = [
    { key: 'account', label: 'Account' },
    { key: 'profession', label: 'Profession' },
    ...fields.map((f) => ({ key: f.key, label: f.label }))
  ]

  if (opts.granularity === 'squad') {
    const total: Record<string, string | number> = { account: 'squad total', profession: '—' }
    for (const f of fields) total[f.key] = mapped.reduce((acc, r) => acc + (Number(r[f.key]) || 0), 0)
    return { rows: [total], columns }
  }

  if (opts.limit) mapped = mapped.slice(0, opts.limit)
  return { rows: mapped, columns }
}

function playerTotalsSection(
  key: string, title: string, aliases: string[], summary: string,
  statsKey: string, totalsKey: string,
  fields: Array<{ key: string; label: string; from: string; help?: string }>
): SectionDescriptor {
  return {
    key, title, aliases, summary,
    granularities: ['player', 'squad'],
    fields: fields.map((f) => ({ key: f.key, label: f.label, help: f.help })),
    shape: (report, opts) =>
      shapePlayerTotals(
        report.stats?.[statsKey] as Array<PlayerTotalsRow & Record<string, unknown>> | undefined,
        totalsKey, fields, opts,
        `This report did not include ${statsKey}.`
      )
  }
}

const mitigationSection = playerTotalsSection(
  'damage_mitigation', 'Damage mitigation',
  ['mitigation', 'blocks', 'blocked', 'evades', 'evaded', 'dodge', 'dodges', 'miss', 'missed',
    'invuln', 'invulned', 'block', 'avoidance', 'defense'],
  'Per-player active defense: blocks, evades, misses, dodges, invulns, interrupts.',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'blocked', label: 'Blocked', from: 'blockedCount' },
    { key: 'evaded', label: 'Evaded', from: 'evadedCount' },
    { key: 'missed', label: 'Missed', from: 'missedCount' },
    { key: 'dodged', label: 'Dodged', from: 'dodgeCount' },
    { key: 'invulned', label: 'Invulned', from: 'invulnedCount' },
    { key: 'interrupted', label: 'Interrupted', from: 'interruptedCount' }
  ]
)

const damageTakenSection = playerTotalsSection(
  'damage_taken', 'Damage taken',
  ['damage taken', 'incoming damage', 'tanked', 'damage received', 'barrier absorbed', 'downs taken', 'deaths'],
  'Per-player incoming damage split into power/condition, barrier absorbed, and down/dead counts.',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'damageTaken', label: 'Damage taken', from: 'damageTaken' },
    { key: 'powerTaken', label: 'Power taken', from: 'powerDamageTaken' },
    { key: 'condiTaken', label: 'Condi taken', from: 'conditionDamageTaken' },
    { key: 'barrierAbsorbed', label: 'Barrier absorbed', from: 'damageBarrier' },
    { key: 'downCount', label: 'Downs', from: 'downCount' },
    { key: 'deadCount', label: 'Deaths', from: 'deadCount' }
  ]
)

const cleansesSection = playerTotalsSection(
  'cleanses', 'Condition cleanses',
  ['cleanse', 'cleanses', 'condi cleanse', 'condition cleanse', 'clears', 'condi clear'],
  'Per-player condition cleanses (total and self) with cleanse time.',
  'supportPlayers', 'supportTotals',
  [
    { key: 'cleanses', label: 'Cleanses', from: 'condiCleanse' },
    { key: 'cleanseTimeMs', label: 'Cleanse time (ms)', from: 'condiCleanseTime' },
    { key: 'selfCleanses', label: 'Self cleanses', from: 'condiCleanseSelf' }
  ]
)

const stripsSection = playerTotalsSection(
  'strips', 'Boon strips',
  ['strip', 'strips', 'boon strip', 'boon removal', 'corrupt', 'rip', 'strip to down', 'down contribution from strips'],
  'Per-player boon strips, strip-to-down contribution, and stun-breaks.',
  'supportPlayers', 'supportTotals',
  [
    { key: 'boonStrips', label: 'Strips', from: 'boonStrips' },
    { key: 'stripTimeMs', label: 'Strip time (ms)', from: 'boonStripsTime' },
    { key: 'stripDownContribution', label: 'Strip→down contrib', from: 'boonStripDownContribution' },
    { key: 'stunBreaks', label: 'Stun breaks', from: 'stunBreak' }
  ]
)

const crowdControlSection = playerTotalsSection(
  'crowd_control', 'Crowd control (received)',
  ['cc', 'crowd control', 'received cc', 'stunned', 'stun break', 'hard cc', 'soft cc', 'disabled'],
  'Per-player crowd control received plus stun-breaks and stun duration removed.',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'receivedCC', label: 'CC received', from: 'receivedCrowdControl' },
    { key: 'downCount', label: 'Downs', from: 'downCount' },
    { key: 'deadCount', label: 'Deaths', from: 'deadCount' }
  ]
)

const healingSection: SectionDescriptor = {
  key: 'healing', title: 'Healing output',
  aliases: ['healing', 'heals', 'healer', 'hps', 'squad healing', 'group healing', 'self healing'],
  summary: 'Per-player healing split by self / group / squad / off-squad.',
  granularities: ['player', 'category', 'squad'],
  fields: [
    { key: 'healing', label: 'Total healing' },
    { key: 'squadHealing', label: 'Squad healing' },
    { key: 'groupHealing', label: 'Group healing' },
    { key: 'selfHealing', label: 'Self healing' },
    { key: 'offSquadHealing', label: 'Off-squad healing' }
  ],
  shape: (report, opts) =>
    shapePlayerTotals(
      report.stats?.healingPlayers as Array<PlayerTotalsRow & Record<string, unknown>> | undefined,
      'healingTotals',
      [
        { key: 'healing', label: 'Total healing', from: 'healing' },
        { key: 'squadHealing', label: 'Squad healing', from: 'squadHealing' },
        { key: 'groupHealing', label: 'Group healing', from: 'groupHealing' },
        { key: 'selfHealing', label: 'Self healing', from: 'selfHealing' },
        { key: 'offSquadHealing', label: 'Off-squad healing', from: 'offSquadHealing' }
      ],
      opts, 'This report did not include healingPlayers.'
    )
}

const barrierSection = playerTotalsSection(
  'barrier', 'Barrier',
  ['barrier', 'barriers', 'damage barrier', 'shielding', 'absorbed'],
  'Per-player barrier absorbed (incoming damage soaked by barrier).',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'barrierAbsorbed', label: 'Barrier absorbed', from: 'damageBarrier' },
    { key: 'barrierHitCount', label: 'Barrier hits', from: 'damageBarrierCount' }
  ]
)

const downContribSection = playerTotalsSection(
  'down_contribution', 'Down contribution',
  ['down contribution', 'downs', 'down contrib', 'pressure', 'who downed'],
  'Per-player downs caused and down-contribution damage.',
  'offensePlayers', '__row__', // sentinel: read top-level row fields, see note below
  [
    { key: 'downs', label: 'Downs', from: 'downs' },
    { key: 'downContribution', label: 'Down contrib', from: 'downContribution' }
  ]
)

const conditionsOutSection = playerTotalsSection(
  'conditions_out', 'Outgoing conditions',
  ['conditions', 'outgoing conditions', 'condi', 'condition damage', 'condi applications', 'applications', 'condi pressure'],
  'Per-player outgoing condition applications and condition damage.',
  'outgoingConditionPlayers', '__row__',
  [
    { key: 'applications', label: 'Applications', from: 'totalApplications' },
    { key: 'condiDamage', label: 'Condi damage', from: 'totalDamage' }
  ]
)

const conditionsInSection = playerTotalsSection(
  'conditions_in', 'Incoming conditions',
  ['incoming conditions', 'conditions taken', 'condi taken', 'condition pressure received'],
  'Per-player incoming condition applications and condition damage taken.',
  'incomingConditionPlayers', '__row__',
  [
    { key: 'applications', label: 'Applications', from: 'totalApplications' },
    { key: 'condiDamage', label: 'Condi damage', from: 'totalDamage' }
  ]
)
```

Because `offensePlayers` / `*ConditionPlayers` keep their numbers at the **row top level** (not under a `<totalsKey>` object), teach `shapePlayerTotals` to read the row itself when `totalsKey === '__row__'`. Update its `mapRow`:

```ts
  const mapRow = (r: PlayerTotalsRow & Record<string, unknown>): Record<string, string | number> => {
    const totals = totalsKey === '__row__'
      ? (r as Record<string, number>)
      : ((r[totalsKey] as Record<string, number>) ?? {})
    const out: Record<string, string | number> = { account: r.account, profession: r.profession }
    for (const f of fields) out[f.key] = Number(totals[f.from] ?? 0)
    return out
  }
```

Finally extend the registry:

```ts
export const SECTIONS: SectionDescriptor[] = [
  boonsSection,
  mitigationSection,
  damageTakenSection,
  cleansesSection,
  stripsSection,
  crowdControlSection,
  healingSection,
  barrierSection,
  downContribSection,
  conditionsOutSection,
  conditionsInSection
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeSections.test.ts --maxWorkers=2`
Expected: PASS (all boon + player-totals tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeSections.ts src/main/axibridgeSections.test.ts
git commit -m "feat(axibridge): defense/support/healing/offense/condition section shapers"
```

---

## Task 3: Squad-only sections + `findSections`

**Files:**
- Modify: `src/main/axibridgeSections.ts`
- Test: `src/main/axibridgeSections.test.ts`

**Interfaces:**
- Consumes: Task 1/2 types and `SECTIONS`.
- Produces:
  - descriptors `class_distribution`, `leaderboards` registered in `SECTIONS`.
  - `function findSections(query: string): SectionDescriptor[]` — keyword/substring rank over `key`/`title`/`aliases`/`fields`; empty/no-match returns the full `SECTIONS` list.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/main/axibridgeSections.test.ts
import { findSections } from './axibridgeSections'

const squadReport = {
  meta: { id: 'r1' },
  stats: {
    squadClassData: [
      { name: 'Firebrand', value: 8, color: '#fff' },
      { name: 'Scourge', value: 6, color: '#000' }
    ],
    leaderboards: {
      strips: [{ account: 'A.1', value: 120 }, { account: 'B.2', value: 90 }],
      cleanses: [{ account: 'H.1', value: 200 }]
    }
  }
}

describe('squad-only sections', () => {
  it('class_distribution returns class -> count rows', () => {
    const res = gs('class_distribution')!.shape(squadReport, {})
    expect(res.rows).toContainEqual({ class: 'Firebrand', count: 8 })
  })

  it('leaderboards returns one metric when account/boon-less query names it via limit', () => {
    const res = gs('leaderboards')!.shape(squadReport, {})
    // flattened: metric + rank + account + value
    expect(res.rows.some((r) => r.metric === 'strips' && r.account === 'A.1')).toBe(true)
  })
})

describe('findSections', () => {
  it('maps "strips" to the strips section', () => {
    expect(findSections('strips').map((s) => s.key)).toContain('strips')
  })
  it('maps "damage taken" to damage_taken', () => {
    expect(findSections('damage taken')[0].key).toBe('damage_taken')
  })
  it('maps "boon uptime" to boons', () => {
    expect(findSections('boon uptime').map((s) => s.key)).toContain('boons')
  })
  it('returns the full catalog for gibberish', () => {
    expect(findSections('zzzz').length).toBe(SECTIONS.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeSections.test.ts --maxWorkers=2`
Expected: FAIL — `gs('class_distribution')` undefined / `findSections` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to src/main/axibridgeSections.ts
const classDistributionSection: SectionDescriptor = {
  key: 'class_distribution', title: 'Class distribution',
  aliases: ['classes', 'class distribution', 'comp', 'composition', 'professions', 'spec count', 'roster'],
  summary: 'Squad class/spec counts for the run.',
  granularities: ['squad'],
  fields: [{ key: 'class', label: 'Class' }, { key: 'count', label: 'Count' }],
  shape(report) {
    const data = report.stats?.squadClassData as Array<{ name: string; value: number }> | undefined
    if (!data || data.length === 0) return { rows: [], columns: [], note: 'This report did not include squadClassData.' }
    return {
      rows: data.map((d) => ({ class: d.name, count: Number(d.value) || 0 })),
      columns: [{ key: 'class', label: 'Class' }, { key: 'count', label: 'Count' }]
    }
  }
}

const leaderboardsSection: SectionDescriptor = {
  key: 'leaderboards', title: 'Leaderboards',
  aliases: ['leaderboard', 'leaderboards', 'top', 'ranking', 'rankings', 'best', 'mvp', 'who is top'],
  summary: 'Published per-metric leaderboards (downContrib, barrier, healing, dodges, strips, cleanses, cc, stability, dps, damage, …).',
  granularities: ['squad'],
  fields: [
    { key: 'metric', label: 'Metric' },
    { key: 'rank', label: 'Rank' },
    { key: 'account', label: 'Account' },
    { key: 'value', label: 'Value' }
  ],
  shape(report, opts) {
    const lb = report.stats?.leaderboards as Record<string, Array<Record<string, unknown>>> | undefined
    if (!lb || Object.keys(lb).length === 0) return { rows: [], columns: [], note: 'This report did not include leaderboards.' }
    const rows: Array<Record<string, string | number>> = []
    for (const [metric, list] of Object.entries(lb)) {
      ;(list ?? []).forEach((entry, i) => {
        rows.push({
          metric, rank: i + 1,
          account: String(entry.account ?? entry.name ?? '—'),
          value: Number(entry.value ?? 0)
        })
      })
    }
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows
    return {
      rows: limited,
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'rank', label: 'Rank' },
        { key: 'account', label: 'Account' },
        { key: 'value', label: 'Value' }
      ]
    }
  }
}
```

Add both to the `SECTIONS` array (after `conditionsInSection`), then add the finder:

```ts
/** Free-text discovery over the registry. Empty / no match -> full catalog. */
export function findSections(query: string): SectionDescriptor[] {
  const q = query.trim().toLowerCase()
  if (!q) return SECTIONS
  const tokens = q.split(/\s+/).filter(Boolean)
  const scored = SECTIONS.map((s) => {
    const hay = [
      s.key, s.title, ...s.aliases,
      ...s.fields.map((f) => f.label), ...s.fields.map((f) => f.help ?? '')
    ].join(' ').toLowerCase()
    // whole-query substring is the strongest signal, then per-token hits
    let score = 0
    if (hay.includes(q)) score += 10
    for (const t of tokens) if (hay.includes(t)) score += 1
    return { s, score }
  })
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  return hits.length ? hits.map((x) => x.s) : SECTIONS
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeSections.test.ts --maxWorkers=2`
Expected: PASS (all section + finder tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeSections.ts src/main/axibridgeSections.test.ts
git commit -m "feat(axibridge): class-distribution + leaderboards sections and findSections"
```

---

## Task 4: Service `reportFor` + refactor `positioning`

**Files:**
- Modify: `src/main/axibridgeService.ts`
- Test: `src/main/axibridgeService.test.ts`

**Interfaces:**
- Consumes: `ParsedReport` from `axibridgeSections`; existing `RunListEntry`, `DateRange`, `cache`, `client`.
- Produces:
  - `async reportFor(args: { run_id?: string } & DateRange): Promise<{ meta: Record<string, unknown>; stats: Record<string, unknown>; run: RunListEntry; stale: boolean; staleSince: string | null }>`
  - `positioning` refactored to obtain its raw report through the same resolve+fetch+cache used by `reportFor` (behavior unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/main/axibridgeService.test.ts (reuse existing harness/builders in the file)
import { describe as describe2, it as it2, expect as expect2 } from 'vitest'

describe2('reportFor', () => {
  it2('resolves the latest run and returns parsed meta+stats from cache', async () => {
    // Build a service exactly like the positioning tests in this file do, with a
    // client whose fetchReport returns a { meta, stats } report and a temp cache.
    const { service } = makeServiceWithReport({
      meta: { id: '20260601-2000-aa', title: 'R' },
      stats: { boonTables: [], defensePlayers: [{ account: 'A.1', profession: 'X', defenseTotals: { blockedCount: 3 } }] }
    })
    const res = await service.reportFor({})
    expect2(res.stats.defensePlayers).toBeTruthy()
    expect2(res.run.id).toBe('20260601-2000-aa')
  })
})
```

> Implementation note for the engineer: this file already constructs an
> `AxibridgeService` with a fake `client`, a real `AxibridgeCache` over a
> `mkdtempSync` dir, and stub `repos`. Add a small local `makeServiceWithReport(report)`
> helper near the top of the file that mirrors the existing positioning-test
> setup but has `client.fetchReport` resolve `report` and `repos()` return
> `[repoA]`, and an index listing a single run id matching `report.meta.id`.
> Reuse the existing index/stale stub builders already present in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeService.test.ts --maxWorkers=2`
Expected: FAIL — `service.reportFor is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `axibridgeService.ts`:

```ts
import type { ParsedReport } from './axibridgeSections'
```

Add the method (place it directly above `positioning`):

```ts
  /**
   * Resolve a single run (explicit id, else latest in range, else latest overall)
   * and return its parsed published report ({ meta, stats }). Reads the on-disk
   * cache when present, otherwise fetches once and caches. Shared by positioning
   * and the section tools so the fetch/cache logic lives in one place.
   */
  async reportFor(
    args: { run_id?: string } & DateRange
  ): Promise<ParsedReport & { meta: Record<string, unknown>; stats: Record<string, unknown>; run: RunListEntry; stale: boolean; staleSince: string | null }> {
    const { runs, stale, staleSince } = await this.runsList(args)
    const repos = new Map(this.deps.repos().map((r) => [repoKey(r), r]))

    let targetRun: RunListEntry | undefined
    if (args.run_id) {
      targetRun = runs.find((r) => r.id === args.run_id)
      if (!targetRun) throw new Error(`Run ${args.run_id} not found in any linked repo — call axibridge_runs_list for valid ids.`)
    } else {
      targetRun = runs[0]
      if (!targetRun) throw new Error('No runs found in the specified range.')
    }

    const repo = repos.get(targetRun.repo)
    if (!repo) throw new Error(`Repo ${targetRun.repo} is no longer linked.`)

    let body = this.deps.cache.readReport(repo, targetRun.id)
    if (!body) {
      body = JSON.stringify(await this.deps.client.fetchReport(repo, targetRun.id))
      this.deps.cache.putReport(repo, targetRun.id, body)
    }
    const parsed = JSON.parse(body) as { meta?: Record<string, unknown>; stats?: Record<string, unknown> }
    return {
      meta: parsed.meta ?? {},
      stats: parsed.stats ?? {},
      run: targetRun,
      stale,
      staleSince
    }
  }
```

Then refactor `positioning` to fetch through the same cache path. Replace its body's resolve+fetch block with a call that reuses `reportFor`'s raw body. Minimal change: keep `positioning` as-is but, since `computePositioning` needs the full report object (with `.details`), have `reportFor` not strip it — note `parsed.meta/stats` are returned but the **raw** object positioning needs includes `.details`. To avoid a second parse, expose the raw too:

Change the return type/shape of `reportFor` to also include the raw parsed object:

```ts
    return {
      meta: parsed.meta ?? {},
      stats: parsed.stats ?? {},
      raw: parsed as unknown,
      run: targetRun,
      stale,
      staleSince
    }
```

(Adjust the return type to add `raw: unknown`.) Then in `positioning`, replace the manual resolve+fetch+parse with:

```ts
    const { raw, stale, staleSince } = await this.reportFor(args)
    const summary = computePositioning(raw as Parameters<typeof computePositioning>[0])
    return { ...summary, runsConsidered: 1, stale, staleSince }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeService.test.ts --maxWorkers=2`
Expected: PASS — new `reportFor` test green AND all existing positioning tests still green (refactor preserved behavior).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeService.ts src/main/axibridgeService.test.ts
git commit -m "feat(axibridge): service.reportFor; positioning reuses it"
```

---

## Task 5: `axibridge_find` + `axibridge_section` tools

**Files:**
- Modify: `src/main/tools/axibridge.ts`
- Test: `src/main/tools/axibridge.test.ts`

**Interfaces:**
- Consumes: `findSections`, `getSection`, `SECTIONS` from `../axibridgeSections`; `service().reportFor` from Task 4; `safeRich`, `localRunDate`.
- Produces: two `tool(...)` entries appended to the array returned by `buildAxibridgeTools`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/main/tools/axibridge.test.ts
// Extend the existing `fakeService` object with a reportFor stub:
//   reportFor: vi.fn(async () => ({
//     meta: { id: 'r1', title: 'Run 1' },
//     stats: {
//       defensePlayers: [{ account: 'A.1', profession: 'Spellbreaker', defenseTotals: { blockedCount: 40, evadedCount: 20, missedCount: 0, dodgeCount: 3, invulnedCount: 0, interruptedCount: 1 } }],
//       boonTables: []
//     },
//     run: { id: 'r1', title: 'Run 1', repo: 'o/a', commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: null },
//     raw: {}, stale: false, staleSince: null
//   }))
// (add this property to the fakeService literal at the top of the file)

describe('axibridge_find', () => {
  it('returns matching sections for a term', async () => {
    const res = await byName('axibridge_find').handler({ query: 'blocks' }, {})
    const out = parse(res)
    expect(out.matches.some((m: { section: string }) => m.section === 'damage_mitigation')).toBe(true)
  })
})

describe('axibridge_section', () => {
  it('shapes the requested section from the cached report', async () => {
    const res = await byName('axibridge_section').handler(
      { run_id: 'r1', section: 'damage_mitigation', granularity: 'player' }, {}
    )
    const out = parse(res)
    expect(out.rows[0].blocked).toBe(40)
    expect(out.section).toBe('damage_mitigation')
  })

  it('errors helpfully on an unknown section', async () => {
    const res = await byName('axibridge_section').handler({ run_id: 'r1', section: 'nope' }, {})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/unknown section/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/tools/axibridge.test.ts --maxWorkers=2`
Expected: FAIL — `byName('axibridge_find')` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Add imports at the top of `src/main/tools/axibridge.ts`:

```ts
import { findSections, getSection, SECTIONS, type Granularity } from '../axibridgeSections'
```

Append these two tools inside the array returned by `buildAxibridgeTools` (before the closing `]`):

```ts
    tool(
      'axibridge_find',
      [
        'Discover which AxiBridge section answers a question. Free-text in (e.g. "strips", "who gave stability", "damage taken", "boon uptime");',
        'returns matching section keys with a summary, available granularities, fields, and the exact axibridge_section call to run next.',
        'Use this first for boon / mitigation / sustain / condition questions, then call axibridge_section — do not infer these numbers from comp roles.'
      ].join(' '),
      { query: z.string().describe('What you want to know, in plain words') },
      safeRich(async ({ query }) => {
        const matches = findSections(query).slice(0, 8).map((s) => ({
          section: s.key,
          title: s.title,
          summary: s.summary,
          granularities: s.granularities,
          fields: s.fields.map((f) => f.key),
          exampleCall: { tool: 'axibridge_section', section: s.key, granularity: s.granularities[0] }
        }))
        return {
          value: { count: matches.length, matches },
          display: {
            kind: 'table',
            data: {
              title: `Sections for "${query}"`,
              columns: [
                { key: 'section', label: 'Section' },
                { key: 'title', label: 'What' },
                { key: 'granularities', label: 'Granularity' }
              ],
              rows: matches.map((m) => ({ section: m.section, title: m.title, granularities: m.granularities.join(', ') }))
            }
          }
        }
      })
    ),
    tool(
      'axibridge_section',
      [
        'Pull one fully-aggregated AxiBridge section for a run: boons, damage_mitigation, damage_taken, cleanses, strips,',
        'crowd_control, healing, barrier, down_contribution, conditions_out, conditions_in, class_distribution, leaderboards.',
        'Call axibridge_find first if unsure which section. granularity is player (default), category (self/group/squad, boons & healing), or squad (totals).',
        'For boons, pass `boon` (e.g. "Stability") to focus one. Run selection mirrors axibridge_positioning: run_id, else latest in from/to, else latest overall.'
      ].join(' '),
      {
        section: z.string().describe('Section key, e.g. "boons" or "damage_mitigation" (see axibridge_find)'),
        run_id: z.string().optional().describe('Run id from axibridge_runs_list; omit to use the latest run'),
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD'),
        granularity: z.enum(['player', 'category', 'squad']).optional().describe('player (default) | category | squad'),
        account: z.string().optional().describe('Filter to one GW2 account'),
        boon: z.string().optional().describe('For section "boons": focus one boon by name'),
        limit: z.number().int().positive().optional().describe('Max rows (default: all)')
      },
      safeRich(async ({ section, run_id, from, to, granularity, account, boon, limit }) => {
        const descriptor = getSection(section)
        if (!descriptor) {
          throw new Error(
            `Unknown section "${section}". Valid: ${SECTIONS.map((s) => s.key).join(', ')}. Use axibridge_find to search.`
          )
        }
        const report = await service().reportFor({ run_id, from, to })
        const result = descriptor.shape(
          { meta: report.meta, stats: report.stats },
          { granularity: granularity as Granularity | undefined, account, boon, limit }
        )
        const runDate = localRunDate(String(report.meta.id ?? ''), (report.meta.dateStart as string) ?? null)
        return {
          value: {
            run: { id: report.meta.id, title: report.meta.title, date: runDate },
            section: descriptor.key,
            title: descriptor.title,
            granularity: granularity ?? 'player',
            note: result.note,
            warnings: result.warnings,
            rowCount: result.rows.length,
            rows: result.rows,
            stale: report.stale,
            staleSince: report.staleSince
          },
          display: result.rows.length
            ? {
                kind: 'table',
                data: {
                  title: `${descriptor.title} — ${report.meta.title ?? report.meta.id}`,
                  columns: result.columns,
                  rows: result.rows,
                  ...staleDisplay(report.stale, report.staleSince)
                }
              }
            : undefined
        }
      })
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/tools/axibridge.test.ts --maxWorkers=2`
Expected: PASS (find + section tool tests, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/axibridge.ts src/main/tools/axibridge.test.ts
git commit -m "feat(axibridge): axibridge_find + axibridge_section tools"
```

---

## Task 6: Agent guidance + local-model allowlist wiring

**Files:**
- Modify: `src/main/agent.ts`

**Interfaces:**
- Consumes: tool names `axibridge_find`, `axibridge_section` from Task 5.
- Produces: updated system prompt guidance + `LOCAL_TOOL_ALLOWLIST` entries (no new exports).

- [ ] **Step 1: Add the two tools to the local allowlist**

In `src/main/agent.ts`, in the `LOCAL_TOOL_ALLOWLIST` array, add after `'axibridge_player_stats',`:

```ts
  'axibridge_find',
  'axibridge_section',
```

- [ ] **Step 2: Add find→section guidance to the system prompt**

In the analytics-methodology section (near line 173–184, the `axibridge_*` methodology bullets), add a bullet:

```ts
  '- Boons, damage mitigation, cleanses, strips, healing, barrier, crowd control, and conditions are PUBLISHED per run. Never infer them from comp roles or general knowledge: call axibridge_find with what you want (e.g. "stability uptime", "boon strips"), then axibridge_section to pull the real numbers. Boons & healing support self/group/squad granularity; there is no party-number breakdown.',
```

(Match the surrounding array/string-join style exactly — if the section is a template string, append a line; if it is an array of bullet strings, add an element.)

- [ ] **Step 3: Verify the whole suite + types**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: All tests PASS; typecheck reports no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent.ts
git commit -m "feat(axibridge): guide agent to find+section for boon/mitigation data; allowlist tools"
```

---

## Task 7: In-app smoke verification

**Files:** none (manual verification of the running app).

- [ ] **Step 1: Build and launch**

Run: `npm run dev` (or the project's standard launch). Wait for the app window.

- [ ] **Step 2: Exercise the flow**

In a conversation with a provider that has the full toolset (not local), ask:
"Who wasted the most Protection last run, and who stripped the most boons?"
Expected: the agent calls `axibridge_find` then `axibridge_section` (section `boons` with `boon: "Protection"`, and section `strips`), and reports real per-account numbers with a table card — not comp-role guesses.

- [ ] **Step 3: Confirm absent-section grace**

Ask for a section on a run whose report predates it (or a repo without it). Expected: a clear "this report did not include …" note, no error/crash.

- [ ] **Step 4: Record outcome**

Note pass/fail in the session. If it passes, the feature is complete; if not, capture the failing tool call + result for debugging.

---

## Self-Review

**Spec coverage:**
- Section Registry → Task 1 (types + first shaper), extended in Tasks 2–3. ✓
- `axibridge_find` → Task 5. ✓
- `axibridge_section` (run resolution, granularity, account/boon filter, table display, stale) → Task 5, backed by Task 4 `reportFor`. ✓
- Service `reportFor` + positioning refactor → Task 4. ✓
- All registry sections in the spec table (boons, damage_mitigation, damage_taken, cleanses, strips, crowd_control, healing, barrier, down_contribution, conditions_out, conditions_in, class_distribution, leaderboards) → Tasks 1–3. `special_buffs` from the spec table is intentionally deferred (136 rows of raw special tables add noise; `specialTables` remains reachable via `axibridge_query`); noted here so the omission is explicit, not silent. ✓
- Agent guidance + allowlist → Task 6. ✓
- Error handling (unknown section, absent section, stale) → Tasks 2/5. ✓
- Testing incl. typecheck → Tasks 1–6 + Global Constraints. ✓
- Out-of-scope (party-N, recompute, new UI, cross-run) → respected; notes surfaced in shapers/guidance. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The `makeServiceWithReport` helper in Task 4 is described against the file's existing, inspectable harness rather than reproduced blind — the engineer adapts the present builders. The `__row__` sentinel is fully specified.

**Type consistency:** `SectionDescriptor.shape(report, opts)` signature is identical across Tasks 1–3 and the call site in Task 5. `reportFor` return shape (`meta/stats/raw/run/stale/staleSince`) defined in Task 4 matches its consumption in Task 5 (`report.meta/stats/stale/staleSince`) and positioning (`raw`). `Granularity` union (`player|category|squad`) is consistent in the registry, the zod enum, and the cast in Task 5.
