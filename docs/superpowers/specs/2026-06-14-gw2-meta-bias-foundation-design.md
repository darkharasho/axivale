# GW2 Meta Bias (Foundation) — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

Bias the AI toward **current GW2 metas** by giving it a maintained, per-game-mode
reference to the authoritative community sources (Snowcrows for PvE; MetaBattle /
gw2mists / Hardstuck / GuildJen for WvW & roaming) plus editable "current meta"
notes. The reference is injected into the agent's per-turn system prompt so that,
for build/comp/squad advice, the AI defers to and **cites** those sources instead
of its (stale) training data. Offline and deterministic.

This is the **foundation** sub-project of the broader meta-bias work. A follow-up
("Fetch") will add a web tool to pull fresh detail from the fetchable sources and
auto-populate the notes — out of scope here.

## Goals

- Steer all build/comp/squad advice toward current meta, with correct source
  citations per game mode.
- Ship usable defaults (the canonical sites per mode) out of the box.
- Let the user maintain notes + sources in a panel; give the Fetch sub-project a
  clean place to write refreshed notes.
- Zero overhead when empty; never break offline.

## Non-goals

- Live web fetching / scraping (the Fetch sub-project).
- Auto-updating notes (Fetch).
- Replacing the existing "never build from memory; ground in catalog + gw2_api"
  rule — the meta reference complements it.

## Data model & storage

New `src/main/metaStore.ts` owns `meta.json` in userData (atomic tmp+rename,
debounced, corrupt-safe — same pattern as `skillStore.ts`).

```ts
export interface MetaSource {
  label: string
  url: string
}
export interface MetaMode {
  id: string          // uuid
  mode: string        // "PvE", "WvW", "WvW Roaming", "PvP"
  sources: MetaSource[]
  notes: string       // editable current-meta summary (may be empty)
  updatedAt: string   // ISO
}
// file shape: { modes: MetaMode[] }
```

`MetaStore` methods: `list()`, `get(id)`, `addMode(seed)`, `updateMode(id, patch)`,
`removeMode(id)`.

**Seeded defaults** — when `meta.json` is missing/empty, the store seeds:
- **PvE** — sources: Snowcrows (`https://snowcrows.com`).
- **WvW** — sources: MetaBattle WvW (`https://metabattle.com/wiki/Category:WvW_Zerg_Builds`),
  gw2mists (`https://gw2mists.com`), Hardstuck (`https://hardstuck.gg`).
- **WvW Roaming** — sources: MetaBattle (`https://metabattle.com/wiki/Category:WvW_Roaming_Builds`),
  GuildJen (`https://guildjen.com`), Hardstuck (`https://hardstuck.gg`).

`notes` start empty (the user/Fetch fills them). Seeding writes the file on first
run so the panel shows the defaults.

## Injection (the bias)

A pure helper `buildMetaReference(modes: MetaMode[]): string` produces a compact
block, e.g.:

```
# GW2 meta reference
For build/comp/squad advice, treat these per-mode sources as the current-meta
ground truth — prefer and cite them, and flag when a build differs from meta.
- PvE — sources: Snowcrows (https://snowcrows.com)
  notes: <notes if any>
- WvW — sources: MetaBattle (…), gw2mists (…), Hardstuck (…)
  notes: <notes if any>
```

Returns `''` when there are no modes (zero overhead).

Wiring (mirrors how skills are injected):
- `AgentDeps` gains `meta: () => MetaMode[]` (read fresh per turn).
- `runTurn` appends `buildMetaReference(this.deps.meta())` to the assembled
  system prompt (after the base + skills registry).
- Constructed in `index.ts`: `meta: () => metaStore.list()`.

A short system-prompt rule reinforces it: *a "GW2 meta reference" lists the
current-meta ground-truth sources per game mode; for build/comp/squad advice
prefer and cite them, flag off-meta choices, still verify specifics via
`axiforge_catalog`/`gw2_api`, and never invent.* (Existing "never build from
memory" rule stays.)

## UI & IPC

- A **"Meta"** nav section (a panel like Skills): lists each mode with editable
  **notes** (textarea) and add/remove **source** rows (label + url); an "Add mode"
  control; remove a mode.
- IPC/preload: `meta:list`, `meta:addMode`, `meta:updateMode`, `meta:removeMode`
  → `metaList` / `metaAddMode` / `metaUpdateMode` / `metaRemoveMode`; a
  `RendererMetaMode` type mirroring `MetaMode`.

## Error handling

- Missing/corrupt `meta.json` → seeded defaults, never throws.
- Empty modes → no injected block; agent behaves as today.
- `updateMode`/`removeMode` with unknown id → no-op (returns null / nothing).

## Testing

- `MetaStore` — seeds defaults on first read; add/update/remove round-trips;
  atomic persistence; corrupt-file safety.
- `buildMetaReference` — empty modes → `''`; populated → includes each mode, its
  source URLs, and notes; omits a notes line when notes are empty.
- Prompt assembly — `runTurn`'s system prompt includes the meta block when modes
  exist (via the same helper used in a unit test).
- IPC/preload type alignment; a light Meta-panel render/CRUD test.

Run vitest with `--maxWorkers=2`.
