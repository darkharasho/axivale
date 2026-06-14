# Dev Meta-Index (LanceDB) Inspector — Design

**Status:** Approved (design)
**Date:** 2026-06-14

## Goal

A **dev-only** view to inspect the meta RAG corpus (the LanceDB `meta_chunks`
table): see what got indexed (stats + browse) and how retrieval ranks a query
(live test-search). It's a debugging aid for tuning crawl selectors, chunking, and
retrieval quality — never shipped to production users.

## Scope

- **In:** index stats, browse/sample of indexed chunks, and a live test-search that
  runs the real `meta_search` retrieval path — all behind `import.meta.env.DEV` (the
  same gate as the existing "Force re-crawl" dev button), rendered inside the Meta
  panel.
- **Out:** editing/deleting chunks, production exposure, any new nav section.

## Architecture

### MetaIndex read methods (`src/main/meta/rag/index.ts`)
Add two read methods to the `MetaIndex` interface; the test-search reuses the
existing `search(queryText, {mode?, k?})`.

```ts
interface MetaChunkRow {
  id: string
  mode: string
  source: string
  url: string
  title: string
  snippet: string   // text, truncated (~300 chars)
  indexedAt: string
}
interface MetaIndexStats {
  total: number
  byMode: Record<string, number>
  bySource: Record<string, number>
  lastIndexedAt: string | null
}
interface MetaIndex {
  // ...existing: indexedHash, replacePage, search
  stats(): Promise<MetaIndexStats>
  sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]>
}
```

- **`LanceMetaIndex.stats`**: `countRows()` for `total`; a metadata-only column scan
  (`query().select(['mode','source','indexedAt']).toArray()` or equivalent for the
  installed LanceDB version) tallied in JS into `byMode`/`bySource`, with the max
  `indexedAt` as `lastIndexedAt`. Corpus is small (low thousands), so a full scan of
  the small columns is fine.
- **`LanceMetaIndex.sample`**: `query()` with optional `.where("mode = ...")`,
  `.limit(opts.limit)`, `.toArray()`, mapped to `MetaChunkRow` with `snippet =
  text.slice(0, 300)`.
- Both return empty (`{total:0, byMode:{}, bySource:{}, lastIndexedAt:null}` / `[]`)
  when the table doesn't exist yet (wrap table access; never throw).
- **`FakeMetaIndex`** (`src/main/meta/rag/testFake.ts`) gains `stats`/`sample` so it
  still satisfies the interface and can drive consumer tests.
- **Build-time note:** confirm the exact LanceDB column-select / count API for the
  installed `@lancedb/lancedb` version; the `MetaIndex` method signatures stay fixed.

### IPC + preload
- `src/main/index.ts` — handlers alongside the other `meta:*`:
  - `meta:index-stats` → `metaIndex.stats()`
  - `meta:index-sample` → `metaIndex.sample({mode, limit})`
  - `meta:index-search` → `metaIndex.search(query, {mode, k})`
  Each wrapped in try/catch returning the empty shape on failure (so a missing
  LanceDB dir / model-load error can't crash the dev panel).
- `src/preload/index.ts` + `index.d.ts` — `metaIndexStats()`,
  `metaIndexSample({mode?, limit})`, `metaIndexSearch(query, mode?)` on `OfficerApi`,
  plus the `RendererMetaIndexStats` / `RendererMetaChunkRow` types (mirroring the main
  shapes; reuse the existing `RendererMetaSearchHit`-style shape `{source,url,title,snippet,score}`).

### Renderer
- New `src/renderer/src/components/MetaIndexInspector.tsx`, mounted in
  `src/renderer/src/components/panels/Meta.tsx` only under `import.meta.env.DEV`, at
  the bottom of the panel. Sections:
  1. **Stats** — `total` chunks, per-mode counts, per-source counts, last-indexed
     relative time. Loaded on mount + after a search/sample (cheap refresh).
  2. **Test-search** — a query text input + a mode dropdown (All / PvE / WvW / WvW
     Roaming) + a Search button → calls `metaIndexSearch` → renders ranked results
     (`score` · `source` · `title` · `snippet`).
  3. **Browse** — a mode filter + "Load sample" button → calls `metaIndexSample`
     ({mode, limit: 25}) → lists chunks (`source` · `title` · `snippet`).
- Styles: reuse the settings/`.meta-*` classes; add a small `.mi-*` set for the
  rows/stat chips. No new nav entry.

## Data flow

Dev Meta panel mounts inspector → `metaIndexStats` populates the stats line → user
types a query → `metaIndexSearch(query, mode)` runs the real embed+hybrid path →
ranked results render. "Load sample" → `metaIndexSample` → chunk list. Production
builds never mount the inspector (`import.meta.env.DEV` is statically false → tree-shaken).

## Error handling

- Index not built / LanceDB dir missing → stats empty, sample/search `[]`; inspector
  shows "index empty — run a crawl".
- `metaIndexSearch` first call loads the embedder; on model-load/network failure the
  handler returns `[]` and the inspector shows a small "search unavailable" note.
- All three handlers are try/catch'd; the dev panel never throws into the renderer.

## Testing

- **`MetaIndexInspector.test.tsx`** (jsdom, mocked `officer`): stats line renders from
  `metaIndexStats`; entering a query + clicking Search calls `metaIndexSearch(query,
  mode)` and renders the ranked results; "Load sample" calls `metaIndexSample` and
  lists chunks; empty-index (`total:0`, `[]`) renders the clean empty state.
- **`FakeMetaIndex`** updated with `stats`/`sample`; any test constructing it stays green.
- **Real `LanceMetaIndex.stats`/`sample`** — not unit-tested (native LanceDB); behind
  the interface, covered by the manual smoke test.

## Manual smoke test

In a dev run with a populated index: open Meta (nav 07), scroll to the dev inspector.
Confirm stats show real totals/per-mode/per-source counts; run a query (e.g. "condi
alac tempest sigils") and confirm ranked results with scores; "Load sample" lists
chunks. Confirm the section is absent in a production build.

## Dependencies

None new — uses the existing LanceDB index and the dev gate already in place.
