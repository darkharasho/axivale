# GW2 Wiki Reference Corpus — Design

**Status:** Approved (design)
**Date:** 2026-06-14

## Goal

Give the AI grounded GW2 *game-mechanics knowledge* by ingesting a curated set of
official-wiki **concept/reference pages** (classes, stats, armor, weapons, upgrades,
boons/conditions, combos, core mechanics) into a searchable corpus, exposed via a
`gw2_wiki_search` tool. Prompt guidance routes the AI: concepts → `gw2_wiki_search`,
specific skill/trait numbers + WvW splits → `gw2_wiki_facts` (live), builds →
`meta_search`.

## Scope

- **In:** a hand-maintained registry of ~100–150 concept page titles; a background
  ingester (fetch wikitext → clean → chunk → embed → store) into a dedicated LanceDB
  table; a `gw2_wiki_search` tool; prompt routing.
- **Out:** full category membership (every skill/trait/item page) — those stay
  on-demand via `gw2_wiki_facts` + the GW2 API. No new wiki dev-inspector. No
  recentchanges incremental sync (overkill for ~100 pages; content-hash gate suffices).

## Architecture

Maximal reuse of the meta RAG plumbing (chunker, embedder, LanceDB index); the only
genuinely new pieces are the page registry, the ingester, and the search tool.

### Page registry — `src/main/meta/wiki/refPages.ts`
```ts
export interface WikiRefPage { category: string; title: string }
export const WIKI_REF_PAGES: WikiRefPage[]   // ~100–150 entries
```
Categories (`category` values): `classes`, `specializations`, `stats`, `armor`,
`weapons`, `upgrades`, `boons-conditions`, `mechanics`. `title` is the exact wiki page
title (e.g. `Concentration`, `Armor`, `Combo`, `Might`, `Greatsword`). Page URL is
derived as `https://wiki.guildwars2.com/wiki/<title with spaces→underscores>`.

### Index reuse — `src/main/meta/rag/index.ts`
Generalize `LanceMetaIndex` with a **table-name constructor param** (default
`'meta_chunks'` so existing callers are unchanged). A second instance uses table
`'wiki_chunks'` in its own dir (`userData/wiki-lance/`). All methods
(`replacePage`/`indexedHash`/`search`/`stats`/`sample`) are reused. Chunk metadata
maps onto the existing schema: `mode` = the page's `category`, `source` =
`'wiki.guildwars2.com'`, `url`/`title` = the page.

### Ingester — `src/main/meta/wiki/ingest.ts`
`WikiRefIngester` (or a function) with injected deps `{ wiki, index, now? }`:
- For each registry page (batched ≤50 via `WikiClient.getWikitextBatch`):
  - `stripWikiMarkup(wikitext)` (from `@axiapps/gw2-data`) → readable text.
  - content-hash gate: if `index.indexedHash(url) === sha1(text)` → skip (no re-embed).
  - else `chunkPage(text, { mode: category, source: 'wiki.guildwars2.com', url, title })`
    (reused chunker) → `index.replacePage(url, chunks)`.
  - per-page try/catch — a failed/missing page is skipped; never breaks the run.
- `ingest()` resolves when all pages processed.

### Tool — `src/main/tools/gw2WikiSearch.ts`
```
gw2_wiki_search({ query: string, category?: string })
```
- `buildGw2WikiSearchTools(wikiIndex: () => MetaIndex)` → registered in
  `buildOfficerTools`; `ToolDeps.wikiIndex` added (lazy, like `metaIndex`).
- Handler: `wikiIndex().search(query, { mode: category, k: 6 })` → returns
  `{ category, url, title, snippet }[]` (map `source`/`mode` accordingly) via `safe()`.
  Empty/unbuilt index → clean "no wiki reference indexed yet". Non-destructive →
  auto-allowed.

### Wiring + scheduling — `src/main/index.ts`, `src/main/agent.ts`
- Construct `wikiIndex = new LanceMetaIndex(userData/wiki-lance, metaEmbedder, 'wiki_chunks')`
  (reuses the embedder already built for meta) + `new WikiRefIngester({ wiki: new WikiClient(), index: wikiIndex })`.
- Schedule `ingester.ingest()` in the background on launch (after a short delay, never
  blocks startup) + a long interval (e.g. weekly). Inject `wikiIndex` into `toolDeps`.
- `agent.ts` `AXIVALE_SYSTEM_PROMPT` bullet (sentences single-line — prompt regex):
  > For GW2 game mechanics and concepts (how attributes/boons/conditions/combos/armor weights/upgrades work) call gw2_wiki_search.
  > For a specific skill or trait's exact numbers and WvW/PvP splits call gw2_wiki_facts; for builds call meta_search.

## Data flow

Background launch → `WikiRefIngester.ingest()` → per page: wikitext → `stripWikiMarkup`
→ hash-gate → chunk → embed → `wiki_chunks` (LanceDB). AI turn → `gw2_wiki_search(query)`
→ concept passages → grounded reasoning, with the prompt nudging `gw2_wiki_facts` for
specifics.

## Error handling

- Page fetch/clean failure → that page skipped; ingest continues.
- Empty/never-built wiki index → `gw2_wiki_search` returns the clean empty message;
  never throws into a turn.
- Content-hash gate → unchanged pages skip the expensive embed on later runs.
- Embedder/model failure → ingest no-ops for that run (logged); search reports empty.
- No GW2 auth needed (public wiki + embeddings).

## Testing

- `refPages.test.ts` — registry non-empty; every entry has `category` + `title`;
  expected categories present.
- **ingest test** — fake `WikiClient` (canned wikitext) + fake index: pages hash-gated
  → `stripWikiMarkup` → `chunkPage` → `replacePage`; unchanged hash skipped; a failing
  page isolated.
- `gw2WikiSearch.test.ts` — fake index: maps results to `{category,url,title,snippet}`,
  passes the `category` filter, empty-index message.
- `LanceMetaIndex` table-param — assert the configured table name is honored (the meta
  `FakeMetaIndex` is unaffected; existing tests stay green).
- Real `WikiClient` + LanceDB ingest = manual smoke.

## Manual smoke test

Dev run: after the background ingest, ask a concept question ("how does Concentration
affect boon duration?" / "what's the difference between the armor weight classes?").
Confirm `gw2_wiki_search` fires and returns the relevant wiki concept passages, and
that a specific-skill question still routes to `gw2_wiki_facts`.

## Dependencies

None new — reuses `@axiapps/gw2-data` (`WikiClient`, `stripWikiMarkup`), the existing
chunker/embedder/LanceDB index, and the GW2 wiki public API.
