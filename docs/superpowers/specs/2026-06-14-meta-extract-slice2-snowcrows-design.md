# Meta Extraction Slice 2 — Snowcrows Static Structured Extractor — Design

**Status:** Approved (design) — owner delegated decisions; structured-only chosen.
**Date:** 2026-06-14
**Part of:** Per-site extractor overhaul (Slice 2 of 2; Slice 1 merged).

## Problem

Snowcrows builds never enter the corpus: its build data is loaded by client-side API
calls that fail in a headless browser (Slice 1 left it empty by design). But the
build is **fully encoded in the static server HTML** as GW2-Armory data attributes,
and the official GW2 API resolves those ids to names server-side with no key. So we
extract Snowcrows without a browser: static-fetch → parse armory embeds → resolve
ids → assemble a structured build doc.

**Scope decision (delegated):** **structured-only.** The prose (Overview/Rotation/
Tips) is *not* in the static HTML (no JSON island, no hydration blob, prose phrases
absent) — it requires the failing client API. We capture the full *structured* build
(specs, traits, skills, gear, stats, runes/sigils → names); no rotation prose.

## Findings (verified)

Static HTML of a build page (`fetch` with a Chrome UA → 200, ~215 KB) contains:
- `<div data-armory-embed="items" data-armory-ids="48081" data-armory-48081-stat="1077" data-armory-48081-upgrades="74978" ...>` — gear: item id + stat id + upgrade (rune/sigil) ids.
- `<div data-armory-embed="specializations" data-armory-ids="31" data-armory-31-traits="296,334,1510">` — spec id + selected major-trait ids.
- `<div data-armory-embed="skills" data-armory-ids="5503,40183,5734,5539,43638">` — skill ids (comma-separated).
- `<h1>` = build title (e.g. "Power Weaver").

GW2 API (public, no key, server-side, batchable by `?ids=`): `/v2/items` → "Zojja's Masque", `/v2/itemstats` → "Berserker's", `/v2/skills`, `/v2/specializations` → "Weaver", `/v2/traits`. All confirmed working from node.

## Architecture

A new `static` extraction method, dispatched from the existing fetcher; all logic in
one focused module with pure parsers (unit-tested) + a thin network crawler (smoke-tested).

### `SourceConfig.kind` gains `'static'`
`src/main/meta/sources.ts`: `kind: 'browser' | 'wiki' | 'static'`. Snowcrows becomes
`{ host: 'snowcrows.com', kind: 'static', crawlDepth: 2 }` (selector/linkSelector no
longer apply to it — static parsing uses the armory attributes + regex hrefs).

### New module `src/main/meta/snowcrows.ts`
Pure, testable units + a thin crawler:

```ts
interface ArmoryItem { id: number; statId: number | null; upgradeIds: number[] }
interface ParsedArmory {
  items: ArmoryItem[]
  skills: number[]
  specs: Array<{ id: number; traitIds: number[] }>
}
interface ArmoryNames {
  items: Record<number, string>
  itemstats: Record<number, string>
  skills: Record<number, string>
  specs: Record<number, string>
  traits: Record<number, string>
}
```

- **`parseArmory(html: string): ParsedArmory`** — pure. Regex over the armory
  attributes: collect `data-armory-embed="items|skills|specializations|traits"` with
  `data-armory-ids`, plus per-item `data-armory-<id>-stat` / `-upgrades`, and per-spec
  `data-armory-<id>-traits`. Dedupe ids. (The attributes are flat and stable; regex
  avoids a new HTML-parser dependency. `jsdom` stays a dev-only dep used in tests if
  needed.)
- **`extractHrefs(html: string, baseUrl: string): string[]`** — pure. Regex `href="…"`
  → absolute URLs (resolved against `baseUrl`).
- **`assembleBuildDoc(title: string, parsed: ParsedArmory, names: ArmoryNames): string`**
  — pure. Produce the structured text doc, e.g.:
  ```
  <title> — Snowcrows
  Specializations: Fire, Air, Weaver
  Traits: <resolved selected-trait names>
  Skills: <resolved skill names>
  Gear: <item name> (<stat prefix>) + <upgrade names>; …
  ```
  Skips lines with no resolved data; never emits raw ids.
- **`resolveArmoryNames(parsed: ParsedArmory, fetchImpl?): Promise<ArmoryNames>`** —
  batches all ids per endpoint to the public GW2 API
  (`/v2/{items,itemstats,skills,specializations,traits}?ids=…&lang=en`, ≤200 ids/call),
  plain `fetch` (no key), with a **module-level id→name cache per type** so common
  skills/items aren't refetched across builds. Injectable `fetchImpl` for tests;
  resilient (a failed batch → those ids resolve to their id-as-string, never throws).
- **`fetchSnowcrowsStatic(url: string, deps?): Promise<FetchResult>`** — the crawler:
  fetch the landing HTML → `extractHrefs` → `pickCrawlLinks` (reuse from fetcher:
  same-origin, deduped, capped) filtered to `/builds/` build pages → BFS to
  `crawlDepth` (reuse caps `MAX_CRAWL_PAGES`/`CRAWL_BUDGET_MS`) → for each build page:
  `parseArmory` → `resolveArmoryNames` → `assembleBuildDoc` → a `FetchedPage`. Returns
  `{ ok: true, text: <joined>, pages }`, or `{ ok: false, error }` when nothing
  parses. `deps` injects `fetchImpl` + a resolver for the crawl unit test.

### Fetcher dispatch
`src/main/meta/fetcher.ts` `fetchOne`: add `if (cfg.kind === 'static') return fetchSnowcrowsStatic(url, { crawlDepth: cfg.crawlDepth })`, alongside the existing `kind === 'wiki'` branch. The orchestrator/`MetaFetcher` interface is unchanged (same `FetchResult`), so ingestion/index/distill all work unchanged.

## Data flow

Background refresh → Snowcrows source (kind static) → `fetchSnowcrowsStatic`:
landing HTML → build-page links → each build page HTML → armory ids → GW2-API names →
structured doc → `pages[]` → existing ingest → chunk → embed → LanceDB. The distiller
and `meta_search` consume it like any other source.

## Error handling

- Landing/build page fetch fails (non-200/network) → that page skipped; if no pages
  parse → `{ ok:false, 'empty' }` (records error, prior chunks survive — existing stance).
- A GW2-API batch fails → those ids fall back to their numeric id in the doc; never throws.
- Cloudflare/UA: use the same Chrome UA; static fetch of Snowcrows returns 200 (verified).
- No new auth dependency (GW2 endpoints are public).

## Testing

- **`snowcrows.test.ts`** (pure units):
  - `parseArmory` — a fixture HTML snippet with items (+stat/upgrades), skills, specs
    (+traits) → correct `ParsedArmory` (ids deduped, per-item stat/upgrades, per-spec traits).
  - `extractHrefs` — relative + absolute anchors → absolute URLs.
  - `assembleBuildDoc` — given parsed + names → expected structured text; unresolved
    lines omitted; no raw ids.
  - `resolveArmoryNames` — injected fake `fetch`: batches ids per endpoint, maps
    id→name, caches (second call doesn't refetch), a failed batch → id-string fallback.
  - `fetchSnowcrowsStatic` — injected fake fetch + resolver over a 2-page fixture:
    crawls landing → build page, returns `pages[]` with assembled docs; empty input → `{ok:false}`.
- **`sources.test.ts`** — Snowcrows `kind === 'static'`, `crawlDepth === 2`.
- Real network crawl + GW2 resolution — **not** unit-tested; manual smoke (Index inspector shows Snowcrows build chunks with resolved gear/skill/trait names).

## Manual smoke test

Dev run → Force re-crawl → Index inspector: Snowcrows now shows chunks per build with
resolved names ("Power Weaver — Specializations: Fire, Air, Weaver; Gear: Zojja's …
(Berserker's) + …; Skills: …"). `meta_search` for a Snowcrows build returns the
structured doc, not chrome/error.

## Dependencies

None new (regex parsing; GW2 API is public; reuses `pickCrawlLinks`/caps + crawl
constants from `fetcher.ts`).
