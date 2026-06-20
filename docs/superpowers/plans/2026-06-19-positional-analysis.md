# Positional & Movement Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose AxiBridge positional/movement data to the AxiVale agent as a compact numeric summary plus an inline figure, so it can analyze WvW cohesion, overextension, out-of-position deaths, death geography, and command pathing.

**Architecture:** Promote the positional math into the shared `@axiapps/bridge-metrics` package (Approach 1), refactor AxiBridge's renderer to consume it (no behavior change), then add an `axibridge_positioning` tool + a `RichPositioning` figure + skill/prompt wiring in AxiVale. Graceful degradation across the report's replay "degrees" (full / coarse / none).

**Tech Stack:** TypeScript, Zod (tool schemas), Vitest (capped at 2 workers), React (renderer figure), tsup (bridge-metrics package build), `@anthropic-ai/claude-agent-sdk` `tool()`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-19-positional-analysis-design.md` — verbatim source of truth.
- Distances are in GW2 **inches**; the tool/figure must say so. Thresholds are tunable constants: `DANGER_SPREAD = 1200`, `OUT_OF_POSITION = 1200` (document; do not bury as magic numbers).
- Vitest runs with `--maxWorkers=2` (per repo CLAUDE.md). Verification also runs `npm run typecheck` (esbuild tests do not catch type errors).
- The full per-tick `positions` arrays are processed **inside** `bridge-metrics` and **never** returned to the model — only aggregates and a down-sampled figure payload (~1 point/sec).
- Cross-repo release order: ship `bridge-metrics 0.2.0` → AxiBridge renderer refactor → AxiVale feature. AxiVale's `package.json` dep is `file:../axibridge/packages/bridge-metrics` in dev, so local linking sees changes immediately.
- Repo paths: AxiVale = `/var/home/mstephens/Documents/GitHub/axivale`; AxiBridge = `/var/home/mstephens/Documents/GitHub/axibridge`; shared pkg = `axibridge/packages/bridge-metrics`.

---

## Phase 1 — `@axiapps/bridge-metrics`: positioning module

### Task 1: `PositioningSummary` types + degree classifier

**Files:**
- Create: `axibridge/packages/bridge-metrics/src/positioning.ts`
- Test: `axibridge/packages/bridge-metrics/src/positioning.test.ts`
- Modify: `axibridge/packages/bridge-metrics/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `dpsReportTypes.ts` (`Player`, `StatsAll`, `combatReplayData`, `combatReplayMetaData`, `hasCommanderTag`).
- Produces:
  - `type ReplayDegree = 'full' | 'coarse' | 'none'`
  - `classifyDegree(report: ParsedReport): ReplayDegree`
  - `interface PositioningSummary { degree; squad; perPlayer; outOfPositionDeaths; commander; deathClusters; figure? }` (full shape in the spec "Shared functions — output shape" section — copy it verbatim).
  - `computePositioning(report: ParsedReport): PositioningSummary`

`ParsedReport` is the existing report type the package already aggregates over (the same object passed to `aggregatePlayers`' summaries). If no single type exists, define `ParsedReport = { details?: { players?: Player[]; combatReplayMetaData?: CombatReplayMetaData; durationMS?: number } }` and reuse the `Player`/`StatsAll` types already in `dpsReportTypes.ts`.

- [ ] **Step 1: Write the failing test for `classifyDegree`**

```ts
import { describe, it, expect } from 'vitest'
import { classifyDegree } from './positioning'

const player = (over: Record<string, unknown>) => ({ notInSquad: false, statsAll: [{}], ...over })

describe('classifyDegree', () => {
  it('returns "full" when a commander has replay positions', () => {
    const report = { details: { combatReplayMetaData: { pollingRate: 150, inchToPixel: 0.01 }, players: [
      player({ hasCommanderTag: true, combatReplayData: { positions: [[0,0],[1,1]] } }),
      player({ combatReplayData: { positions: [[2,2]] } }),
    ] } }
    expect(classifyDegree(report)).toBe('full')
  })
  it('returns "coarse" when only distToCom aggregates exist (no positions)', () => {
    const report = { details: { players: [ player({ statsAll: [{ distToCom: 420 }] }) ] } }
    expect(classifyDegree(report)).toBe('coarse')
  })
  it('returns "none" when neither positions nor distToCom exist', () => {
    const report = { details: { players: [ player({}) ] } }
    expect(classifyDegree(report)).toBe('none')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts`
Expected: FAIL — `classifyDegree is not a function`.

- [ ] **Step 3: Implement `positioning.ts` types + `classifyDegree`**

```ts
// src/positioning.ts
export type ReplayDegree = 'full' | 'coarse' | 'none'

type AnyPlayer = { notInSquad?: boolean; hasCommanderTag?: boolean; account?: string; profession?: string
  statsAll?: Array<{ distToCom?: number; stackDist?: number }>
  combatReplayData?: { positions?: Array<[number, number]>; dead?: Array<[number, number]>; down?: Array<[number, number]>; start?: number } }
export type ParsedReport = { details?: { players?: AnyPlayer[]
  combatReplayMetaData?: { pollingRate?: number; inchToPixel?: number; sizes?: [number, number] }
  durationMS?: number } }

const squadOf = (r: ParsedReport): AnyPlayer[] => (r.details?.players ?? []).filter((p) => !p?.notInSquad)

export function classifyDegree(report: ParsedReport): ReplayDegree {
  const squad = squadOf(report)
  const meta = report.details?.combatReplayMetaData ?? {}
  const commander = squad.find((p) => p?.hasCommanderTag)
  const tagPositions = commander?.combatReplayData?.positions ?? []
  if (commander && tagPositions.length > 0 && (meta.pollingRate ?? 0) > 0 && (meta.inchToPixel ?? 0) > 0) return 'full'
  if (squad.some((p) => typeof p?.statsAll?.[0]?.distToCom === 'number')) return 'coarse'
  return 'none'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export + commit**

Add `export * from './positioning.js'` to `src/index.ts`. Then:

```bash
cd axibridge
git add packages/bridge-metrics/src/positioning.ts packages/bridge-metrics/src/positioning.test.ts packages/bridge-metrics/src/index.ts
git commit -m "feat(bridge-metrics): positioning types + degree classifier"
```

### Task 2: Port distance-to-tag + out-of-position deaths into `computePositioning`

**Files:**
- Modify: `axibridge/packages/bridge-metrics/src/positioning.ts`
- Modify: `axibridge/packages/bridge-metrics/src/positioning.test.ts`

**Interfaces:**
- Produces: `computePositioning(report): PositioningSummary` populating `perPlayer` (avg/peak distance-to-tag) and `outOfPositionDeaths` (`{ account, distAtDown, atSec }` over `OUT_OF_POSITION`).

**Porting note:** the math already exists in AxiBridge's renderer — `axibridge/src/renderer/stats/computeDistanceToTag.ts` (`ingestLogDistanceToTag` → per-tick distance samples → avg/percentiles) and `computeTagDistanceDeaths.ts` (`ingestLogTagDistanceDeaths` → per-death `distanceFromTag` + `timeIntoFightSec`). Move the **pure** per-fight ingest helpers into `positioning.ts`, dropping the renderer-only label/utils dependencies (`buildFightLabelV2`, etc.) — `computePositioning` works on one report's fights and needs only `account`, `distance`, `timeSec`, `isCommander`. Keep the existing `clamp`, the commander/`pollingRate`/`inchToPixel` gating, and the squad filter verbatim.

- [ ] **Step 1: Write the failing test**

```ts
import { computePositioning, OUT_OF_POSITION } from './positioning'
// helper `player` from Task 1; build a 2-tick replay where one player strays far at the down tick
it('reports per-player distance-to-tag and out-of-position deaths', () => {
  const report = { details: { durationMS: 10000, combatReplayMetaData: { pollingRate: 150, inchToPixel: 0.01, sizes: [1000,1000] }, players: [
    { notInSquad: false, hasCommanderTag: true, account: 'Tag.1', combatReplayData: { positions: [[0,0],[0,0]] } },
    { notInSquad: false, account: 'Stray.2', combatReplayData: { positions: [[0,0],[2000,0]], down: [[2000,0]], dead: [] } },
  ] } }
  const s = computePositioning(report)
  expect(s.degree).toBe('full')
  const stray = s.perPlayer.find(p => p.account === 'Stray.2')!
  expect(stray.peakDistToTag).toBeGreaterThan(OUT_OF_POSITION)
  expect(s.outOfPositionDeaths.some(d => d.account === 'Stray.2')).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts -t "out-of-position"`
Expected: FAIL — `computePositioning is not a function`.

- [ ] **Step 3: Implement `computePositioning` (distance + deaths)**

Add `OUT_OF_POSITION = 1200` and the per-fight distance/death ingest ported from the renderer functions named above; aggregate per account into `perPlayer` (`avgDistToTag`, `peakDistToTag`, sorted by peak desc) and collect downs/deaths whose distance-from-tag exceeds `OUT_OF_POSITION` into `outOfPositionDeaths`. Distance at a position = `hypot(px-tx, py-ty) * inchToPixel` against the commander's position at the same tick index. Fill `degree` via `classifyDegree`, and stub `squad`/`commander`/`deathClusters`/`figure` for now (`null`/`[]`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd axibridge && git add packages/bridge-metrics/src/positioning.ts packages/bridge-metrics/src/positioning.test.ts
git commit -m "feat(bridge-metrics): distance-to-tag + out-of-position deaths"
```

### Task 3: Cohesion (spread timeline), commander overextension, death clusters

**Files:**
- Modify: `axibridge/packages/bridge-metrics/src/positioning.ts`
- Modify: `axibridge/packages/bridge-metrics/src/positioning.test.ts`

**Interfaces:**
- Produces: populated `squad` (`avgSpread`, `peakSpread {value, atSec}`, `cohesionNote`), `commander` (`account`, `peakLeadFromSquad {value, atSec}`, `squadFollowLag`), and `deathClusters` (top-N `{x, y, count}` by grid-bucketing death/down coords).

- [ ] **Step 1: Write the failing test**

```ts
it('computes peak spread, commander overextension, and death clusters', () => {
  const report = { details: { durationMS: 6000, combatReplayMetaData: { pollingRate: 1000, inchToPixel: 1, sizes: [3000,3000] }, players: [
    { notInSquad:false, hasCommanderTag:true, account:'Tag.1', combatReplayData:{ positions:[[0,0],[100,0],[1800,0]] } },
    { notInSquad:false, account:'A.2', combatReplayData:{ positions:[[0,0],[100,0],[0,0]], dead:[[0,0]] } },
    { notInSquad:false, account:'B.3', combatReplayData:{ positions:[[0,0],[100,0],[0,0]], dead:[[0,0]] } },
  ] } }
  const s = computePositioning(report)
  expect(s.squad.peakSpread!.value).toBeGreaterThan(1000)      // tag bolted at the last tick
  expect(s.commander.peakLeadFromSquad!.value).toBeGreaterThan(1000)
  expect(s.deathClusters[0].count).toBe(2)                      // both died at ~[0,0]
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts -t "peak spread"`
Expected: FAIL (assertions on `null`).

- [ ] **Step 3: Implement spread/overextension/clusters**

Per tick: squad centroid = mean of squad positions; spread = mean player distance to the tag; tag-lead = distance(tag, centroid). Track the max of each with its `atSec` (`tickIndex * pollingRate / 1000`). `squadFollowLag` = mean over ticks of (centroid distance behind the tag along the tag's heading); a simple mean tag-to-centroid distance is acceptable for v1 — document it. `deathClusters`: bucket all `dead`/`down` coords into a grid (cell = 150 inches), count per cell, return top 6 cell centroids as `{x,y,count}`. `cohesionNote`: derive a short label from peakSpread vs avgSpread (e.g. `peak/avg > 2.5` → "tight then scattered").

- [ ] **Step 4: Run to verify it passes**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd axibridge && git add packages/bridge-metrics/src/positioning.ts packages/bridge-metrics/src/positioning.test.ts
git commit -m "feat(bridge-metrics): squad spread, commander overextension, death clusters"
```

### Task 4: Figure payload + graceful degradation, build, version bump

**Files:**
- Modify: `axibridge/packages/bridge-metrics/src/positioning.ts`
- Modify: `axibridge/packages/bridge-metrics/src/positioning.test.ts`
- Modify: `axibridge/packages/bridge-metrics/package.json` (version `0.1.x` → `0.2.0`)

**Interfaces:**
- Produces: `figure` populated only when `degree === 'full'` (`map {sizes, inchToPixel}`, down-sampled `tagPath`, `squadMass`, `deaths`, `downs`, `spread [[sec,value]]`, `peakSpread`). When `coarse`/`none`, `figure` is `undefined`.

- [ ] **Step 1: Write failing tests for degradation + figure**

```ts
it('omits the figure for coarse data but still gives distances', () => {
  const report = { details: { players: [ { notInSquad:false, account:'A.2', statsAll:[{ distToCom: 800 }] } ] } }
  const s = computePositioning(report)
  expect(s.degree).toBe('coarse'); expect(s.figure).toBeUndefined()
  expect(s.perPlayer.find(p=>p.account==='A.2')!.avgDistToTag).toBe(800)
})
it('down-samples the figure tag path to <= ~1 point/sec', () => {
  const positions = Array.from({length: 600}, (_,i)=>[i,0] as [number,number]) // 600 ticks @ 100ms = 60s
  const report = { details:{ durationMS:60000, combatReplayMetaData:{ pollingRate:100, inchToPixel:1, sizes:[1000,1000] }, players:[
    { notInSquad:false, hasCommanderTag:true, account:'Tag.1', combatReplayData:{ positions } } ] } }
  const s = computePositioning(report)
  expect(s.figure!.tagPath.length).toBeLessThanOrEqual(70)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run src/positioning.test.ts -t "figure"`
Expected: FAIL.

- [ ] **Step 3: Implement figure payload + coarse path**

When `degree === 'coarse'`, populate `perPlayer.avgDistToTag` from `statsAll[0].distToCom` (peak = avg), leave `squad`/`commander` nulls, `outOfPositionDeaths`/`deathClusters` `[]`, `figure` undefined. When `full`, build `figure` and down-sample `tagPath`/`spread` to one point per second (`Math.ceil(1000 / pollingRate)` stride).

- [ ] **Step 4: Run package tests + typecheck + build**

Run: `cd axibridge/packages/bridge-metrics && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS; `dist/` rebuilt with `positioning` exports.

- [ ] **Step 5: Bump version + commit**

Set `packages/bridge-metrics/package.json` version to `0.2.0`. Then:

```bash
cd axibridge && git add packages/bridge-metrics
git commit -m "feat(bridge-metrics): positioning figure payload + graceful degradation; v0.2.0"
```

---

## Phase 2 — AxiBridge renderer: consume the shared functions

### Task 5: Refactor renderer compute to delegate (no behavior change)

**Files:**
- Modify: `axibridge/src/renderer/stats/computeDistanceToTag.ts`
- Modify: `axibridge/src/renderer/stats/computeTagDistanceDeaths.ts`
- Test: existing `axibridge/src/renderer/stats/*.test.ts` (must stay green)

**Interfaces:**
- Consumes: the per-fight ingest helpers now exported from `@axiapps/bridge-metrics`.

- [ ] **Step 1: Run the existing renderer tests to capture the baseline**

Run: `cd axibridge && npx vitest run src/renderer/stats --maxWorkers=2`
Expected: PASS (record the count — this is the regression guard).

- [ ] **Step 2: Point the renderer at the shared helpers**

Re-implement `ingestLogDistanceToTag` / `ingestLogTagDistanceDeaths` in the renderer as thin wrappers that call the shared package's ported equivalents (re-export or delegate). Keep the renderer-only labelling (`buildFightLabelV2`) in the renderer; only the pure distance/death math moves to the package. Do NOT change public signatures the renderer's stats sections rely on.

- [ ] **Step 3: Run the existing renderer tests again**

Run: `cd axibridge && npx vitest run src/renderer/stats --maxWorkers=2`
Expected: PASS, same count as Step 1 (proves no behavior drift).

- [ ] **Step 4: Typecheck + commit**

Run: `cd axibridge && npm run typecheck`

```bash
cd axibridge && git add src/renderer/stats
git commit -m "refactor(stats): delegate positional math to @axiapps/bridge-metrics"
```

---

## Phase 3 — AxiVale: the `axibridge_positioning` tool

### Task 6: Service method `positioning(args)`

**Files:**
- Modify: `axivale/src/main/axibridgeService.ts`
- Test: `axivale/src/main/axibridgeService.test.ts` (or a new `axibridgePositioning.test.ts` if the former is large)

**Interfaces:**
- Consumes: `computePositioning` from `@axiapps/bridge-metrics`; the existing `runsList` / report cache.
- Produces: `async positioning(args: { run_id?: string } & DateRange): Promise<PositioningSummary & { runsConsidered: number; stale: boolean; staleSince: string | null }>`

- [ ] **Step 1: Bump the dep + relink**

In `axivale/package.json` set `@axiapps/bridge-metrics` to `^0.2.0` (or the `file:` path already used). Run `cd axivale && npm install`. Verify: `node -e "console.log(typeof require('@axiapps/bridge-metrics').computePositioning)"` prints `function`.

- [ ] **Step 2: Write the failing service test**

```ts
// stub the report cache/client to return a single full-replay report, then:
it('positioning() summarizes a run from the cached report', async () => {
  const svc = makeService({ /* stub: one report w/ commander + a stray death */ })
  const res = await svc.positioning({ run_id: '20260618-2000' })
  expect(res.degree).toBe('full')
  expect(res.outOfPositionDeaths.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd axivale && npx vitest run src/main/axibridgeService.test.ts -t positioning --maxWorkers=2`
Expected: FAIL — `positioning is not a function`.

- [ ] **Step 4: Implement `positioning()`**

Mirror `runSummary`: resolve the run via `runsList`, fetch/parse the report (reuse the same cache/parse path `summariesFor` uses to get the raw report object), call `computePositioning(report)`, and fold in `runsConsidered`/`stale`/`staleSince`. For a date range, compute per-run then merge `perPlayer` (max peak, mean avg) and concatenate `outOfPositionDeaths` — v1 may scope to a single `run_id` and treat a range as "summarize the latest run in range, note the rest"; document the choice.

- [ ] **Step 5: Run to verify it passes + commit**

Run: `cd axivale && npx vitest run src/main/axibridgeService.test.ts --maxWorkers=2`

```bash
cd axivale && git add package.json package-lock.json src/main/axibridgeService.ts src/main/axibridgeService.test.ts
git commit -m "feat(axibridge): positioning() service method"
```

### Task 7: The `axibridge_positioning` tool (value + display payload)

**Files:**
- Modify: `axivale/src/main/tools/axibridge.ts`
- Modify: `axivale/src/main/tools/axibridge.test.ts`

**Interfaces:**
- Consumes: `deps.axibridge().positioning(...)`; `safeRich`.
- Produces: tool `axibridge_positioning`; returns `{ value: <compact summary minus figure>, display: { kind: 'positioning', ...figure, degree } }` (display only when `degree === 'full'`).

- [ ] **Step 1: Write the failing tool test**

```ts
it('axibridge_positioning returns compact value + positioning display', async () => {
  const tools = buildAxibridgeTools(() => stubServiceWithFullReplay())
  const t = tools.find(x => x.name === 'axibridge_positioning')!
  const res = await t.handler({ run_id: '20260618-2000' }, {})
  const value = JSON.parse(res.content[0].text)
  expect(value.outOfPositionDeaths).toBeDefined()
  expect(value.figure).toBeUndefined()                 // raw figure never in the model value
  expect((res as any).display.kind).toBe('positioning')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd axivale && npx vitest run src/main/tools/axibridge.test.ts -t positioning --maxWorkers=2`
Expected: FAIL — tool not found.

- [ ] **Step 3: Implement the tool**

Add a `tool('axibridge_positioning', <description noting inches + degradation>, { run_id: z.string().optional(), from: z.string().optional(), to: z.string().optional(), accounts: z.array(z.string()).optional() }, safeRich(async (args) => { const r = await service().positioning(args); const { figure, ...value } = r; return { value, display: figure ? { kind: 'positioning', degree: r.degree, ...figure } : undefined } }))`. Description tells the model: positioning is in game inches; use it to explain what went wrong/right; degrades by the report's replay setting; when `degree` is `coarse`/`none` say so and rely on the numbers.

- [ ] **Step 4: Run to verify it passes + commit**

Run: `cd axivale && npx vitest run src/main/tools/axibridge.test.ts --maxWorkers=2`

```bash
cd axivale && git add src/main/tools/axibridge.ts src/main/tools/axibridge.test.ts
git commit -m "feat(tools): axibridge_positioning tool"
```

---

## Phase 4 — AxiVale: the `RichPositioning` figure

### Task 8: `RichPositioning` component + display wiring

**Files:**
- Create: `axivale/src/renderer/src/components/rich/RichPositioning.tsx`
- Create: `axivale/src/renderer/src/components/rich/RichPositioning.test.tsx`
- Modify: wherever `display.kind` figures are dispatched to components (find by `grep -rn "kind === 'chart'" src/renderer` — mirror that switch), and the `DisplayPayload` type union (search `RichChart` import + the kind union).

**Interfaces:**
- Consumes: the `display` payload `{ kind: 'positioning', degree, map, tagPath, squadMass, deaths, downs, spread, peakSpread }`.
- Produces: a React figure mirroring the approved mock (map panel + spread strip) using the newsprint theme tokens.

- [ ] **Step 1: Write the failing render test**

```tsx
import { render } from '@testing-library/react'
import RichPositioning from './RichPositioning'
it('renders the map + spread strip with death markers', () => {
  const { container } = render(<RichPositioning data={{
    kind:'positioning', degree:'full', map:{sizes:[1000,1000], inchToPixel:1},
    tagPath:[[0,0],[500,500]], squadMass:{x:200,y:200,r:40},
    deaths:[{x:800,y:800,count:7}], downs:[[700,700]],
    spread:[[0,200],[6,1800],[10,400]], peakSpread:{value:1800, atSec:6},
  }} />)
  expect(container.querySelector('svg')).toBeTruthy()
  expect(container.textContent).toMatch(/peak/i)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd axivale && npx vitest run src/renderer/src/components/rich/RichPositioning.test.tsx --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RichPositioning`**

Build the two-panel SVG figure from the approved mock in the spec (map: tag path polyline, squad-mass ellipse, death circles sized by `count`, down dots; strip: spread line, danger threshold, peak callout, death ticks). Scale map coords by `map.sizes` into the panel viewBox. Use the existing theme classes/tokens (`--accent`, `--accent-b`, `--amber`, `--faint`, Playfair caption). Render nothing meaningful (a small "no replay trajectories" note) if `degree !== 'full'` — though the tool only emits a display for `full`.

- [ ] **Step 4: Run to verify it passes + commit**

Run: `cd axivale && npx vitest run src/renderer/src/components/rich/RichPositioning.test.tsx --maxWorkers=2`

```bash
cd axivale && git add src/renderer/src/components/rich/RichPositioning.tsx src/renderer/src/components/rich/RichPositioning.test.tsx <dispatch+type files>
git commit -m "feat(rich): RichPositioning inline figure"
```

---

## Phase 5 — Skill & prompt integration

### Task 9: Positioning step in the review skills + analytics methodology

**Files:**
- Modify: `axivale/src/main/skillStore.ts` (`night-report`, `commander-review`)
- Modify: `axivale/src/main/agent.ts` (analytics methodology block)
- Modify: `axivale/src/main/systemPrompt.test.ts`, `axivale/src/main/skillStore.test.ts`

- [ ] **Step 1: Write the failing prompt/skill tests**

```ts
// systemPrompt.test.ts
it('tells reviews to use positioning when available', () => {
  expect(AXIVALE_SYSTEM_PROMPT).toMatch(/axibridge_positioning/)
  expect(AXIVALE_SYSTEM_PROMPT).toMatch(/positioning.*when (it'?s )?available/i)
})
// skillStore.test.ts
it('commander-review and night-report reference positioning', () => {
  const keys = Object.fromEntries(SKILLS.map(s => [s.key, s.instructions]))
  expect(keys['commander-review']).toMatch(/axibridge_positioning/)
  expect(keys['night-report']).toMatch(/axibridge_positioning/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd axivale && npx vitest run src/main/systemPrompt.test.ts src/main/skillStore.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Add the positioning guidance**

In each review skill, add a Positioning step: "Call `axibridge_positioning` for the run(s); when `degree` is `full`, weave cohesion / overextension / out-of-position deaths / death geography into the verdict and place ONE `{{figure}}` of the positioning map; when `coarse`, use the distances only; when `none`, skip it. Tie low personal stats to positioning — a commander with low personal output but tight squad cohesion and few out-of-position deaths led well." Add a one-line analytics-methodology rule in `agent.ts` referencing `axibridge_positioning` and "use positioning when it's available."

- [ ] **Step 4: Run to verify they pass + commit**

Run: `cd axivale && npx vitest run src/main/systemPrompt.test.ts src/main/skillStore.test.ts --maxWorkers=2`

```bash
cd axivale && git add src/main/skillStore.ts src/main/agent.ts src/main/systemPrompt.test.ts src/main/skillStore.test.ts
git commit -m "feat(agent): proactively use positioning in WvW reviews"
```

### Task 10: Full verification

- [ ] **Step 1: AxiVale full suite + typecheck**

Run: `cd axivale && npm run typecheck && npx vitest run --maxWorkers=2`
Expected: all green.

- [ ] **Step 2: AxiBridge full suite + typecheck**

Run: `cd axibridge && npm run typecheck && npx vitest run --maxWorkers=2`
Expected: all green (renderer stats unchanged in behavior).

- [ ] **Step 3: In-app smoke (manual)**

`cd axivale && npm run dev`; in a WvW review, confirm `axibridge_positioning` runs and the `RichPositioning` figure renders for a full-replay run, and that a coarse/none run degrades with a clear message.

---

## Self-Review

- **Spec coverage:** cohesion (Task 3), overextension + out-of-position deaths (Tasks 2-3), death geography/clusters (Task 3), command pathing (Task 3); tool (Tasks 6-7); visual (Task 8); skill integration C (Task 9); degradation full/coarse/none (Tasks 1,4,6-7,9); shared-lib home + renderer refactor (Tasks 1-5); testing across all phases. All spec sections map to a task.
- **Placeholder scan:** porting steps reference exact existing files/functions to move, not "implement later"; thresholds are named constants; every code step shows code or an exact command.
- **Type consistency:** `PositioningSummary`, `ReplayDegree`, `computePositioning`, `classifyDegree`, `positioning()`, `axibridge_positioning`, `RichPositioning`, and `display.kind === 'positioning'` are used consistently across tasks.
