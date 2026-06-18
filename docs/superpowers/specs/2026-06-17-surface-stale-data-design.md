# Surface Stale AxiBridge Data — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Follow-up to:** `2026-06-17-graceful-degradation-design.md` (data-flow step 7 — "the tool result carries the marker; the agent surfaces it")

## Problem

The graceful-degradation work made AxiBridge serve last-known-good cached data when a live fetch fails, tagging it `stale` + `fetchedAt` at the service boundary. But those markers are dropped at three layers, so the user never learns the data is stale:

1. `runsList` returns `staleRepos`, but the `axibridge_runs_list` tool returns `{ count, runs, errors }` — drops it.
2. `attendance` (no-range) and `commanderStats` call `rollupFor` (which now returns `stale`/`fetchedAt`) but destructure only `{ rollup, source }`.
3. `fetchedAt` is an epoch-ms number from the cache ledger; nothing converts it to something the agent can verbalize or a badge can show.

Result: the "data as of N ago" benefit the degradation work was built for is unreachable.

## Goal

Surface staleness two ways, as approved:

- **(A) Agent-verbalized** — the markers ride in each tool's `value` JSON; the agent tells the reader in prose.
- **(B) Visual badge** — a dashed "spill"-style badge on the AxiBridge table/chart display cards reading `cached · <age> · source unreachable` (variant C, relative age).

## Naming (resolves a value-vs-display ambiguity)

Two consumers need different formats, so the fields are named distinctly:

- **Service + tool `value`** (for the agent): `stale: boolean`, `staleSince: string | null` — an **ISO timestamp** (precise; the agent can reason about recency).
- **Display payload** (for the badge): `stale?: boolean`, `staleAge?: string` — a **relative string** like `"3h ago"` (computed once at response time).

A small helper converts the ledger's epoch ms → ISO and ISO → relative age.

## Architecture

```
AxibridgeCache (epoch ms fetchedAt)
   │  rollupFor / indexFor already return { stale, fetchedAt }   ← graceful-degradation
   ▼
axibridgeService methods  ── thread up ──▶ { ..., stale, staleSince(ISO) }
   │   attendance · commanderStats · playerStats · runsList
   ▼
tools/axibridge.ts handlers
   ├─ value:   { ..., stale, staleSince }            → agent verbalizes
   └─ display: { ..., stale, staleAge("3h ago") }    → badge
   ▼
RichTable / RichChart  ── render ──▶  dashed spill badge in a flex .rich-title-bar
```

Plus one line in `agent.ts` telling the agent how to phrase `stale: true`.

## Component 1: staleness helper

**Location:** `src/main/axibridgeStale.ts` (new, small, pure — independently testable)

```ts
/** Epoch ms → ISO, or null. */
export function staleSinceIso(fetchedAt: number | null): string | null

/** ISO (or null) → a short relative age like "3h ago" / "2d ago" / "just now".
 *  `now` injectable for tests. Returns null when iso is null. */
export function relativeAge(iso: string | null, now?: number): string | null
```

`relativeAge` buckets: `< 60s` → "just now"; minutes → "Nm ago"; hours → "Nh ago"; else "Nd ago".

## Component 2: thread staleness through the service

**Location:** `src/main/axibridgeService.ts`

- **`attendance` (no-range loop, ~line 209):** while iterating repos via `rollupFor`, OR-accumulate `stale` and keep the **oldest** `fetchedAt` (most conservative). Return `{ ..., stale, staleSince }` where `staleSince = staleSinceIso(oldestFetchedAt)`.
- **`attendance` (date-range path):** it uses `runsList` (which carries `staleRepos`); derive `stale`/`staleSince` from runsList (see below) and include them.
- **`commanderStats` (~line 247):** same OR/oldest treatment over `rollupFor`.
- **`playerStats`:** flows through `summariesFor(runs)` ← `runsList`; derive `stale`/`staleSince` from the runsList result and include.
- **`runsList`:** already returns `staleRepos: string[]`. Add `staleSince: string | null` — the oldest `fetchedAt` among the stale repos (so `indexFor` must return enough for runsList to know each stale repo's `fetchedAt`; it already returns `fetchedAt`, so runsList tracks the min over stale repos and converts via `staleSinceIso`).

Aggregation rule everywhere: `stale = any repo stale`; `staleSince = ISO of the oldest stale `fetchedAt`` (null when not stale).

## Component 3: surface in the tools

**Location:** `src/main/tools/axibridge.ts`

For each affected tool, add to `value`: `stale` + `staleSince`. For tools that emit a `table`/`chart` `display`, also set `display.data.stale = true` and `display.data.staleAge = relativeAge(staleSince)` when stale.

- `axibridge_runs_list` → `value` gains `stale`, `staleSince`, keeps `staleRepos`. (No display today — value only.)
- `axibridge_attendance` / `axibridge_commander_stats` / `axibridge_player_stats` (whatever the registered names are) → `value` + their table/chart `display`.
- `axibridge_repos_status` → add a per-row `stale` boolean (data already available via `reposStatus`), and a `stale` column showing `cached · <age>` when a repo's index is stale. (reposStatus must thread per-repo stale/fetchedAt from `indexFor`.)

When not stale, no fields are added beyond `stale: false` — badges only render on `stale === true`.

## Component 4: display-payload type + renderer badge

**Types (must change BOTH files identically — they are hand-duplicated):**
- `src/main/providers/types.ts` — add `stale?: boolean; staleAge?: string` to the `table` and `chart` `data` shapes.
- `src/renderer/src/state.ts` — same change.

**Renderer:**
- `src/renderer/src/components/rich/RichTable.tsx` and `RichChart.tsx` — wrap the existing `.rich-title` in a new `.rich-title-bar` flex container; when `spec.stale`, render `<span class="rich-stale-badge">cached · {spec.staleAge} · source unreachable</span>`. RichChart always shows a title; RichTable's title is optional — when a table is stale but title-less, still render the bar with just the badge.
- `src/renderer/src/theme.css` — add `.rich-title-bar` (flex, space-between, align-center) and `.rich-stale-badge` based on the existing `.spill` pattern: dashed `--rule2` border, `--faint` text, mono 9px uppercase, `rgba(0,0,0,.22)` background.

No change to `RichDisplay.tsx`, `displayBus.ts`, or `shareSanitize.ts` — the router and sanitizer are payload-shape-agnostic, and shares pass `display` through untouched (so a stale badge is preserved in a shared snapshot, which is acceptable — it reflects what was true when shared).

## Component 5: agent prompt

**Location:** `src/main/agent.ts` (system prompt)

Add one rule near the existing source-recency guidance: *"When an AxiBridge tool result includes `stale: true`, its figures are cached from `staleSince` because the live source was unreachable — tell the reader plainly (e.g. 'these numbers are cached from ~3h ago; the live source was down')."*

## Error Handling

- `relativeAge(null)` / `staleSinceIso(null)` → null; when not stale, nothing renders.
- A `fetchedAt` of `0` (file present, ledger entry missing — possible from `readMetaStale`) → `staleSinceIso` guards `<= 0` and returns null, so `value.staleSince` is null. When a result is nonetheless `stale: true`, the tool handler computes `staleAge = relativeAge(staleSince) ?? 'unknown age'`, so the badge reads `cached · unknown age · source unreachable` and the agent is told the cache age is unknown. `staleAge` is therefore never null on a stale display.

## Testing

- **`axibridgeStale`**: `staleSinceIso` (epoch→ISO, null/≤0 → null); `relativeAge` buckets (just now / m / h / d, null passthrough) with injected `now`.
- **service**: `attendance`/`commanderStats`/`playerStats`/`runsList` each return `stale: true` + correct oldest `staleSince` when a repo is stale, and `stale: false` when all fresh (mock-cache pattern from the graceful-degradation tests — direct `AxibridgeService` construction).
- **tools**: affected handlers put `stale`/`staleSince` in `value` and `stale`/`staleAge` in `display.data` when stale; omit/false when fresh.
- **renderer**: RichTable/RichChart render the badge when `stale`, with the exact text, and render nothing extra when not stale (RTL).
- **agent prompt**: a `systemPrompt` test asserts the new stale-surfacing rule string is present.
- Run under the repo's 2-worker vitest cap.

## Scope / YAGNI

- No new display `kind`; the badge is two optional fields on existing `table`/`chart`.
- No per-repo timestamp history, no dashboard (that's feature #4).
- Stale applies only to AxiBridge reads (unchanged from graceful-degradation).

## Open Decisions (resolved)

- Badge style: **variant C** (dashed "spill", `cached · <age> · source unreachable`).
- Age format: **relative** (`"3h ago"`), computed once at response time.
- Field names: `value` → `stale` + `staleSince` (ISO); `display.data` → `stale` + `staleAge` (relative).
