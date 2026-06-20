# Positional & Movement Analysis for the AI — Design

**Date:** 2026-06-19
**Status:** Approved design, pending implementation plan

## Summary

Expose AxiBridge's positional/movement data to the AxiVale agent so it can analyze
**what went wrong or right by where people were** — squad cohesion, overextension,
out-of-position deaths, death geography, and commander pathing. The agent gets a
compact numeric summary it can reason over **and** an inline visual (a death/down
map with the commander path, plus a squad-spread-over-time strip).

Positioning is a first-class signal for WvW review. It also reinforces the
existing rule that a commander's low *personal* output can be fine if their
*leadership and positioning* read well.

## Goals

- Surface four positioning insights, when the data supports them:
  1. **Cohesion** — squad spread from the tag over time; peak-spread moments.
  2. **Overextension** — per-player distance-to-tag (avg/peak); commander pushing
     past the squad; out-of-position deaths (distance-to-tag at the moment downed).
  3. **Death geography** — clustered death/down hotspots.
  4. **Command pathing** — tag trajectory and squad-follow lag.
- Give the agent compact JSON (never raw position arrays) plus a `display` figure.
- Work across the **various degrees** of replay data a user's AxiBridge settings
  publish (full trajectories / coarse aggregates / none), degrading gracefully.
- Reuse AxiBridge's existing positional math via the shared package — no drift.

## Non-goals

- A full scrubbable combat-replay viewer (explicitly out of scope; YAGNI for
  "what went wrong").
- Underlaying the real WvW map image in v1 (schematic only; image is a later add).
- Any change to how AxiBridge records or publishes reports. We consume what the
  user's settings already publish.

## Architecture — three touch-points (Approach 1: shared library)

The positional compute currently lives only in AxiBridge's renderer
(`src/renderer/stats/computeDistanceToTag.ts`, `computeTagDistanceDeaths.ts`,
`computeCommanderStats.ts`). The position **types** already live in the shared
`@axiapps/bridge-metrics` package, which AxiVale already depends on.

1. **`@axiapps/bridge-metrics`** (in the AxiBridge repo, `packages/bridge-metrics`):
   add a pure module `positioning.ts` that operates on the report's
   `combatReplayData` (per-player `positions`, `dead`, `down`, `start`),
   `combatReplayMetaData` (`inchToPixel`, `pollingRate`, `sizes`), `hasCommanderTag`,
   and `StatsAll.distToCom`/`stackDist`. Export from the package index. Version
   bump `0.1.x → 0.2.0`.
2. **AxiBridge renderer**: refactor the three `compute*` functions to call the new
   shared functions. No behavior change; this proves the extraction and prevents
   the two apps from drifting. Existing renderer tests must stay green.
3. **AxiVale**: bump the `@axiapps/bridge-metrics` dep; add the
   `axibridge_positioning` tool, the `RichPositioning` figure component, and the
   skill/prompt wiring.

## Shared functions — output shape

The package exposes one entry point, e.g. `computePositioning(report)`, returning a
compact, model-friendly summary (units in game inches; the agent is told the unit):

```
PositioningSummary {
  degree: 'full' | 'coarse' | 'none'   // how much the report's settings published
  squad: {
    avgSpread: number | null           // mean distance of players from the tag
    peakSpread: { value: number, atSec: number } | null
    cohesionNote: string               // short human label, e.g. "tight then scattered"
  }
  perPlayer: Array<{ account, avgDistToTag, peakDistToTag }>  // sorted by peak
  outOfPositionDeaths: Array<{ account, distAtDown: number, atSec: number }>
  commander: {
    account: string | null
    peakLeadFromSquad: { value: number, atSec: number } | null  // overextension
    squadFollowLag: number | null      // how far the squad trailed the tag's path
  }
  deathClusters: Array<{ x: number, y: number, count: number }> // top N, map space
  // Figure payload (only when degree === 'full'):
  figure?: {
    map: { sizes: [number, number], inchToPixel: number }
    tagPath: Array<[number, number]>
    squadMass: { x: number, y: number, r: number }
    deaths: Array<{ x, y, count }>
    downs: Array<[number, number]>
    spread: Array<[sec: number, value: number]>   // for the timeline strip
    peakSpread: { value, atSec }
  }
}
```

The full `positions` arrays are processed inside the package and **never** returned
to the model — only the aggregates above and the down-sampled figure payload.

## The tool — `axibridge_positioning`

- **Name:** `axibridge_positioning` (read-only, joins the other `axibridge_*` tools).
- **Input:** `run_id` (or a date range like the other tools), optional `accounts`,
  optional `commander`.
- **Behavior:** resolve the run(s) via the existing service (cached report), call
  `computePositioning`, return the compact JSON as the model value **plus** a
  `display` payload of `kind: 'positioning'` for the renderer.
- **Description** tells the model: positioning is in game inches; use it to explain
  *what went wrong/right*; it degrades by the report's replay setting.

## The visual — `RichPositioning`

A new renderer figure (sibling to `RichChart`), driven by the tool's `display`
payload, placed inline with a `{{figure}}` marker. Two stacked panels:

1. **Map** — schematic dark canvas: commander path (accent line), squad-mass blob,
   death hotspots sized by count, down markers, an "overextended ~N" connector.
2. **Spread strip** — squad-spread-over-time line with a danger threshold, the
   peak-spread callout, and death ticks clustered at the peak.

Newsprint theme (mono labels, dashed rules, accent colors, Playfair caption).
v1 is schematic (no external map image). Coordinates come from the figure payload
in map space, scaled to the panel by `sizes`/`inchToPixel`.

## Skill & prompt integration (option C — tool + proactive)

- **`commander-review`** and **`night-report`** skills get a **Positioning** step:
  call `axibridge_positioning` when data is present, weave cohesion / overextension
  / death-geography into the verdict, and place one `{{figure}}` of the map.
- A line in the **analytics methodology** (system prompt) so any review uses
  positioning when available, tied to the commander rule (low personal output can
  be fine if positioning/leadership reads well).
- The tool is also directly callable for ad-hoc questions ("did we overextend?",
  "where did we die?").

## Graceful degradation (the "various degrees")

- **`full`** (per-tick `positions` present) → all metrics + the figure.
- **`coarse`** (only `distToCom`/`stackDist` + death events, no trajectories) →
  distances + out-of-position-death summary; **no** map/timeline figure; the tool
  states "coarse positional data — no replay trajectories for this run."
- **`none`** → the tool returns "no positional data for this run — the recorder
  didn't capture combat replay (enable precise replay in AxiBridge)." Never an
  error; just an actionable message.

## Error handling

- Reuse the `axibridge_*` error conventions (no repos linked, run not found, stale
  cache) — the positioning tool inherits them through the shared service.
- Missing/partial replay data is a **degree**, not an error (see above).
- A malformed `combatReplayData` for one player is skipped, not fatal; the summary
  notes how many players contributed.

## Testing

- **`bridge-metrics`**: pure-function unit tests with three fixture reports
  (`full`, `coarse`, `none`) asserting the summary shape, the out-of-position-death
  selection, peak-spread detection, and degree classification.
- **AxiVale**: tool test (compact JSON + `display` payload shape, degradation
  messages); `RichPositioning` render test (snapshot of the two panels).
- **AxiBridge**: the renderer refactor keeps the existing positional tests green —
  the regression guard that proves no behavior drift.

## Risks / open questions

- **Coordinate space & scale.** `positions` are in EI map units; we rely on
  `inchToPixel`/`sizes` to normalize. Fixtures must capture a real report's units.
- **Down-sampling the figure payload.** Tag path and spread series must be
  down-sampled (e.g. ~1 point/sec) so the payload stays small.
- **Thresholds.** "Out of position" / "danger spread" thresholds (e.g. ~1,200–1,800
  inches) should be constants, tunable, and documented — not magic numbers buried
  in the math.
- **Cross-repo release order.** Ship `bridge-metrics 0.2.0` first, then the
  AxiBridge renderer refactor, then the AxiVale feature consuming the new version.
