# AxiBridge full-section access — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Problem

User reports that boon analysis from axivale is "wonky." Root cause: AxiBridge
publishes a rich, fully-aggregated `report.json` per run, but axivale only reads
a thin slice of it. The model answers boon / mitigation / sustain questions from
comp-role heuristics and system-prompt knowledge instead of the real published
numbers, so its boon analysis is effectively guesswork.

Concretely, the published `report.json` is `{ meta, stats }`, and `stats`
already contains every section AxiBridge computes — `boonTables`,
`defensePlayers`, `supportPlayers`, `healingPlayers`, `offensePlayers`,
`outgoingConditionPlayers` / `incomingConditionPlayers`, `specialTables`,
`leaderboards`, `squadClassData`, and more. axivale's tools
(`src/main/tools/axibridge.ts`) expose only `damage / cleanses / strips /
healing / deaths` from a thin `RunSummary`. Boons, damage mitigation,
conditions, barrier, stun-breaks, strip-to-down contribution, etc. are present
on disk but never surfaced to the agent.

The goal: **if it is a section in AxiBridge, axivale can find it and pull it.**

## Key facts established during exploration

- Published `report.json` shape is `{ meta, stats }`. `meta` =
  `{ id, title, commanders, dateStart, dateEnd, dateLabel, generatedAt, appVersion }`.
  `stats` holds ~50 keys including all the per-player section arrays below.
- The full report is **already fetched and cached on disk** by
  `AxibridgeService` (`cache.readReport(repo, runId)` / `client.fetchReport`).
  Typical size ~1.2 MB. **No 30 MB raw-log parse, no worker thread, and no
  `@axiapps/bridge-metrics` recompute are needed** — every section is read
  directly from the cached `report.json`.
- Per-player section rows are **not tagged with a subgroup/party number**, so
  true per-party-N breakdown is not available from the published data. The
  granularity axes that *are* present:
  - **player** — per account (e.g. 37 rows).
  - **boon category** — `self` / `group` / `squad` generation + waste +
    `activeTimeMs` (in `boonTables[].rows[].categories`).
  - **squad total** — `leaderboards`, `squadClassData`, `stats.total*`,
    `stats.max*`, and axivale-side sums of player rows.

### Relevant `stats` section shapes (from a real report)

- `boonTables: Array<{ id, name, stacking, rows: BoonRow[] }>` where
  `BoonRow = { account, profession, professionList, activeTimeMs, numFights,
  groupSupported, squadSupported, categories: { selfBuffs, groupBuffs,
  squadBuffs : { generationMs, wastedMs } } }`. 12 boons in the sample.
- `defensePlayers: Array<{ account, profession, professionList, activeMs,
  defenseTotals }>` where `defenseTotals` has `damageTaken, damageTakenCount,
  conditionDamageTaken(+Count), powerDamageTaken(+Count), downedDamageTaken(+Count),
  damageBarrier(+Count), blockedCount, evadedCount, missedCount, dodgeCount,
  invulnedCount, interruptedCount, downCount, deadCount, boonStrips,
  conditionCleanses, receivedCrowdControl }`.
- `supportPlayers: Array<{ ..., supportTotals }>` where `supportTotals` has
  `condiCleanse(+Time), condiCleanseSelf(+TimeSelf), boonStrips(+Time),
  boonStripDownContribution(+Time), stunBreak, removedStunDuration,
  resurrects(+Time)`.
- `healingPlayers: Array<{ ..., healingTotals }>` where `healingTotals` has
  `healing, downedHealing, squadHealing, squadDownedHealing, groupHealing,
  groupDownedHealing, selfHealing, selfDownedHealing, offSquadHealing,
  offSquadDownedHealing`.
- `offensePlayers: Array<{ account, profession, professionList, totalFightMs,
  offenseTotals, offenseRateWeights, downs, downContribution }>`.
- `outgoingConditionPlayers / incomingConditionPlayers: Array<{ account,
  profession, professionList, totalFightMs, totalApplications, totalDamage,
  conditions }>`.
- `specialTables: Array<{ id, name, total, rows }>` (136 in the sample — e.g.
  per-special-buff aggregates).
- `leaderboards: Record<metric, Row[]>` keyed by `downContrib, barrier, healing,
  dodges, strips, cleanses, cc, stability, closestToTag, revives, participation,
  dps, damage`.
- `squadClassData: Array<{ name, value, color }>` — class distribution.

## Design

### Component 1 — Section Registry (`src/main/axibridgeSections.ts`)

The single source of truth that makes "every section discoverable" structural
rather than a promise. An array of **section descriptors**:

```ts
interface SectionField { key: string; label: string; help?: string }

interface SectionDescriptor {
  key: string                 // stable friendly id, e.g. "damage_mitigation"
  title: string               // human label, e.g. "Damage Mitigation"
  aliases: string[]           // search terms: ["blocks","evades","dodges","mitigation","damage taken"]
  summary: string             // one-line description for `find`
  granularities: Array<'player' | 'category' | 'squad'>
  fields: SectionField[]      // columns the section can return, with help text
  // Pure shaper: cached report.json (parsed) + opts -> rows + display columns.
  shape(report: ParsedReport, opts: SectionQuery): SectionResult
}

interface SectionQuery {
  granularity?: 'player' | 'category' | 'squad'
  account?: string            // filter to one account (player granularity)
  boon?: string               // for boon section: filter to one boon by name/id
  limit?: number
}

interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string               // e.g. "category granularity: self/group/squad"
}
```

`ParsedReport` here is the parsed `{ meta, stats }`. Shapers read only from
`report.stats.*` — they never recompute.

**Registered sections at launch** (each maps to a `stats` key + shaper):

| key | source | granularities | headline fields |
|---|---|---|---|
| `boons` | `boonTables` | player, category, squad | per-boon generationMs/wastedMs/uptime by self/group/squad |
| `damage_mitigation` | `defensePlayers.defenseTotals` | player, squad | blocked, evaded, missed, dodge, invulned, interrupted |
| `damage_taken` | `defensePlayers.defenseTotals` | player, squad | damageTaken, power/condi split, barrier absorbed, downCount/deadCount |
| `cleanses` | `supportPlayers.supportTotals` | player, squad | condiCleanse(+Self), times |
| `strips` | `supportPlayers.supportTotals` | player, squad | boonStrips, boonStripDownContribution, times |
| `crowd_control` | `defensePlayers` + `supportPlayers` | player, squad | receivedCrowdControl, stunBreak, removedStunDuration |
| `healing` | `healingPlayers.healingTotals` | player, category, squad | self/group/squad/off-squad healing |
| `barrier` | `healingPlayers` + `defensePlayers` | player, squad | barrier output, damageBarrier absorbed |
| `down_contribution` | `offensePlayers` | player, squad | downContribution, downs |
| `conditions_out` | `outgoingConditionPlayers` | player, squad | totalApplications, totalDamage, per-condition |
| `conditions_in` | `incomingConditionPlayers` | player, squad | totalApplications, totalDamage, per-condition |
| `class_distribution` | `squadClassData` | squad | class -> count |
| `leaderboards` | `leaderboards` | squad | per-metric ranked rows |
| `special_buffs` | `specialTables` | player, squad | per-special-buff uptime/total |

Adding a future AxiBridge section = appending one descriptor. No other file
changes.

**Subgroup note:** descriptors expose `category` (self/group/squad) where the
data supports it (boons, healing). True party-N granularity is intentionally
out of scope — it is not in the published data and would require an
AxiBridge-side change. `find`/`section` responses say so when relevant.

### Component 2 — `axibridge_find` tool (discovery / recall corpus)

`src/main/tools/axibridge.ts`. Pure static lookup over the registry — **no
report fetch**.

- Input: `{ query: string }` (free text — `"strips"`, `"who gave stab"`,
  `"damage taken"`, `"boon uptime"`).
- Behavior: case-insensitive keyword/substring match of `query` tokens against
  each descriptor's `key`, `title`, `aliases`, and `fields[].label/help`. Rank
  by number of matched tokens; return all non-zero matches (cap ~8).
- Output: `{ matches: Array<{ section, title, summary, granularities, fields,
  exampleCall }> }` where `exampleCall` shows the `axibridge_section` invocation
  to run next. A `display` table of section/summary/granularities for the rail.
- Empty query or no match → return the full section catalog so the model still
  sees what exists.

This is the "search, then pinpoint a section" flow the user asked for.

### Component 3 — `axibridge_section` tool (generic accessor)

`src/main/tools/axibridge.ts`.

- Input: `{ run_id?: string, from?: string, to?: string, section: string,
  granularity?: 'player'|'category'|'squad', account?: string, boon?: string,
  limit?: number }`. Run selection mirrors `axibridge_positioning`: explicit
  `run_id`, else latest in `from`/`to`, else latest overall.
- Behavior:
  1. Resolve the run + repo, load the cached `report.json` via the service
     (fetch+cache on miss — same path positioning uses).
  2. Look up the descriptor by `section`. Unknown key → error listing valid
     keys (and suggest `axibridge_find`).
  3. Call `descriptor.shape(parsedReport, query)`.
  4. Return `{ value: { run: {id,title,date}, section, granularity, note, rows },
     display: { kind: 'table', data: { title, columns, rows } } }` via
     `safeRich`, consistent with existing tools.
- Stale handling: reuse the service's existing stale flags/age, surfaced like
  the other tools.

### Component 4 — Service support (`src/main/axibridgeService.ts`)

Add one focused method that resolves a run and returns its parsed cached report,
reusing the exact fetch/cache logic already in `positioning()`:

```ts
async reportFor(args: { run_id?: string } & DateRange): Promise<{
  meta: ReportMeta; stats: ReportStats; run: RunIndexEntry;
  stale: boolean; staleSince: string | null
}>
```

`positioning()` is refactored to call `reportFor` so the run-resolution +
fetch-cache logic lives in one place (targeted improvement: removes the
duplicated fetch/cache block). No new cache file, no worker.

### Component 5 — Wire into the tool list & model guidance

- `buildAxibridgeTools` returns the two new tools alongside the existing ones.
- The agent system prompt (`src/main/agent.ts`) gets a short note: for boon /
  mitigation / sustain / condition questions, use `axibridge_find` to locate the
  section then `axibridge_section` to pull real numbers — do not infer from comp
  roles. This directly fixes the "wonky boon analysis" report.
- The `axibridge_query` jq escape-hatch is unchanged; it continues to work over
  summaries. (Sections read raw `stats`, which jq can already reach for power
  users, but the two typed tools are the supported path.)

## Data flow

```
model: "who wasted the most protection?"
  -> axibridge_find { query: "protection boon waste" }
       -> registry keyword match -> [{ section: "boons", granularities, exampleCall }]
  -> axibridge_section { run_id, section: "boons", boon: "Protection", granularity: "player" }
       -> service.reportFor -> cached report.json { meta, stats }
       -> boons.shape(report, {boon:"Protection", granularity:"player"})
            -> reads stats.boonTables[name=Protection].rows -> per-account self/group/squad gen+waste
       -> { value: rows, display: table }
```

## Error handling

- Unknown `section` → error with the valid key list + pointer to `axibridge_find`.
- Section key valid but absent in this report's `stats` (older AxiBridge
  version) → `rows: []` + a `note` saying the publisher did not include it; never
  throw. Mirrors bridge-metrics' "defensive, warnings not silent drops" stance.
- No runs / unresolvable run → same errors the existing tools raise.
- Malformed/missing rows inside a present section → shaper skips the row and adds
  a `warnings` entry; partial data is better than none.
- Stale cache → existing stale flag/age surfaced in `value` and `display`.

## Testing

Unit (vitest, `--maxWorkers=2`):
- `axibridgeSections.test.ts`: feed a captured fixture `report.json` (trimmed
  from a real one) and assert each shaper returns expected rows/columns for each
  declared granularity; assert absent-section → `[]` + note; assert account/boon
  filters.
- `find` matching: `"strips"` → `strips` section; `"damage taken"` →
  `damage_taken`; `"boon uptime"` → `boons`; gibberish → full catalog.
- `axibridge_section` tool handler: unknown key error; run resolution
  (explicit/range/latest); stale passthrough — using the existing service test
  doubles/mocks.
- `reportFor` refactor: positioning tests still pass (behavior unchanged).

Type safety: `npm run typecheck` must pass (vitest/esbuild does not type-check).

## Out of scope

- Per-party-N (subgroup-number) granularity — not in published data; needs an
  AxiBridge-side change.
- Recomputing sections from raw EI logs / bridge-metrics — unnecessary; the data
  is pre-aggregated in `stats`.
- New UI beyond the existing table/chart `display` kinds.
- Cross-run section aggregation — `axibridge_section` is per-run; multi-run
  rollups remain the job of `player_stats` / `attendance` / `query`.

## Files touched

- `src/main/axibridgeSections.ts` — new: registry + descriptors + shapers + types.
- `src/main/tools/axibridge.ts` — add `axibridge_find` + `axibridge_section`.
- `src/main/axibridgeService.ts` — add `reportFor`; refactor `positioning` onto it.
- `src/main/agent.ts` — short guidance note on the find→section flow.
- `src/main/axibridgeSections.test.ts` — new tests.
- Fixture: a trimmed real `report.json` under the test fixtures dir.
```
