# Meta RAG — Sub-project 1: Corpus + Hybrid Retrieval — Design

**Status:** Approved (design)
**Date:** 2026-06-14
**Builds on:** GW2 Meta Fetch (`2026-06-14-gw2-meta-fetch-design.md`) and its quality/depth-1 follow-ups.

## Goal

Add a second knowledge layer beneath the always-on per-mode meta *summaries*: a
searchable corpus of the crawled meta-site content (builds + the sites' written
tradeoffs/rationale), indexed for **hybrid keyword + semantic** retrieval, exposed
as a `meta_search` tool the AI calls on demand. The summary answers "what's
roughly meta"; `meta_search` answers the follow-ups that scratch past the surface —
specific builds, weapon/sigil/rune choices, trait lines, and the tradeoffs between
variants.

## Scope

**This sub-project (1):** corpus capture from the existing crawl, chunking, local
embeddings, a LanceDB hybrid index, and the `meta_search` tool. Meta-site *prose*
only. The always-on summaries are unchanged; this strictly *adds* a retrieval layer.

**Deferred to Sub-project 2 (planned back-to-back):** extracting chat-codes /
gw2skills links from build pages → structured `ForgeBuild` (via the AxiForge
decoder) → build cards; and pulling GW2 Wiki skill/trait *facts* (via
`@axiapps/gw2-data` `WikiClient.parseFacts`) for the skills/traits those builds
use, for deep interaction/tradeoff expertise. The index schema and reindex
strategy below are designed so Sub-project 2 layers on without a re-architecture.

## Why this shape

The distill-to-summary layer is inherently lossy — it cannot carry "why Sigil of
Force over Bursting" or the trait tradeoff between an alac variant and its DPS
sibling. Retrieval over the full crawled text preserves that detail and lets the
AI pull exactly what a question needs, instead of cramming everything into a 3-
paragraph summary. Hybrid (not pure-semantic) because GW2 content is proper-noun
heavy (exact spec/build/sigil names → lexical match) *and* conceptual ("sustain
healer for zerg" → semantic). LanceDB because it is embedded, does hybrid (FTS +
vector) natively, filters by metadata, scales to a full wiki ingest, and its
prebuilt N-API binaries drop into Electron without `electron-rebuild`.

## Architecture

All in the **main process**, layered onto the existing meta-fetch pipeline.

```
background refresh (existing)
  └─ crawl source → pages[]  ──┬─→ distill → summary   (layer-1, unchanged)
                               └─→ ingest: contentHash gate → chunk → embed → LanceDB upsert  (NEW)

AI turn:  meta_search(query, mode?) → embed query → LanceDB hybrid search → top-k passages → AI synthesizes
```

### Components (each behind an interface, testable in isolation)

1. **Fetcher change (small, additive).** `BrowserWindowFetcher.fetch(url)` today
   returns one concatenated blob. Extend the success result to also carry the
   individual crawled pages:
   ```ts
   type FetchResult =
     | { ok: true; text: string; pages: FetchedPage[] }
     | { ok: false; error: string }
   interface FetchedPage { url: string; title: string; text: string }
   ```
   `distill` keeps using the joined `text` (unchanged behavior); ingestion uses
   `pages`. `title` comes from the page `document.title` (collected alongside the
   existing in-page extraction). The wiki path (`fetchWiki`) returns a single-page
   `pages` array of length 1.

2. **Chunker** — `src/main/meta/rag/chunk.ts`, pure:
   ```ts
   interface ChunkMeta { mode: string; source: string; url: string; title: string }
   interface Chunk extends ChunkMeta { id: string; text: string; contentHash: string }
   function chunkPage(text: string, meta: ChunkMeta): Chunk[]
   ```
   Splits on paragraph/heading boundaries, packs into ~250–400-word passages with
   ~1-sentence overlap so a tradeoff explanation is not sliced mid-thought.
   `id = ${sha1(url)}:${index}`. `contentHash = sha1(page text)` (same value on
   every chunk of a page) so ingestion can skip unchanged pages. Unit-tested.

3. **Embedder** — `src/main/meta/rag/embedder.ts`:
   ```ts
   interface Embedder { embed(texts: string[]): Promise<number[][]> }  // 384-dim
   ```
   Real impl wraps `transformers.js` (`Xenova/all-MiniLM-L6-v2`, ~25MB, 384-dim)
   on the **WASM backend** (no native ONNX dep; LanceDB is the only native dep).
   Lazy-loads the pipeline; model caches under `userData/meta-models/`. Batches for
   indexing, embeds the single query at search time. Behind the `Embedder`
   interface so consumers inject a fake in tests.
   - **Risk to validate in build:** forcing transformers.js onto WASM in the
     Electron main process. Fallback if it misbehaves: `onnxruntime-node`'s prebuilt
     binary (still no rebuild).

4. **MetaIndex** — `src/main/meta/rag/index.ts`, wraps LanceDB and **owns the
   `Embedder`** (single owner of the model; the orchestrator and tool never embed
   directly):
   ```ts
   interface MetaSearchHit { source: string; url: string; title: string; snippet: string; score: number }
   interface MetaIndex {
     indexedHash(url: string): Promise<string | null>   // for the contentHash gate
     replacePage(url: string, chunks: Chunk[]): Promise<void> // embeds chunk texts, delete-by-url, then insert
     search(queryText: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]> // embeds the query internally
   }
   ```
   LanceDB table `meta_chunks`:
   ```
   id: string            // `${urlHash}:${chunkIndex}` — stable; enables delete-by-url
   mode: string          // 'PvE' | 'WvW' | 'WvW Roaming'
   source: string        // host, e.g. 'snowcrows.com'
   url: string           // source page
   title: string         // page/build title
   text: string          // the chunk
   contentHash: string   // sha1 of the page text (change detection)
   indexedAt: string     // ISO
   vector: float32[384]
   ```
   FTS index on `text` + the vector column → LanceDB hybrid (vector + FTS, RRF-
   fused). `search` applies `.where("mode = ...")` when `mode` is given, `k`
   defaults to 6. `replacePage` deletes existing rows `WHERE url = ?` then inserts
   (delete-then-insert → re-runs replace, never duplicate). Behind the interface;
   the thin real LanceDB impl is smoke-tested, fakes drive unit tests.

5. **Ingestion hook** (in the existing orchestrator, `src/main/meta/refresh.ts`).
   After a source's `pages[]` come back, for each page:
   - if `MetaIndex.indexedHash(url) === contentHash(page)` → **skip** (no embed);
   - else chunk → `MetaIndex.replacePage(url, chunks)` (the index embeds internally).
   Error-isolated: a page-level index failure is caught and logged; siblings still
   index; the crawl/distill flow is never broken. A source that fails to fetch
   keeps its prior chunks (knowledge never regresses).

6. **`meta_search` tool** — `src/main/tools/metaSearch.ts`, registered in
   `buildOfficerTools`:
   ```
   meta_search(query: string, mode?: 'PvE' | 'WvW' | 'WvW Roaming')
   ```
   Handler embeds `query`, calls `MetaIndex.search`, returns
   `{ source, url, title, snippet }[]` via the existing `safe()` wrapper. A
   read/lookup tool (non-destructive) → auto-allowed like `axiforge_catalog`, no
   confirm gate. Empty/unavailable index → a clean "no indexed meta yet" result,
   never a throw. `ToolDeps` gains `metaIndex: () => MetaIndex` (lazy, like
   `axibridge`); the handler is just `metaIndex().search(query, { mode })` — the
   index embeds internally, so the tool carries no embedder dependency.

## Reindex strategy

- **Content-hash skip (this sub-project).** Every page carries a `contentHash`;
  ingestion re-fetches on the 7-day sweep but skips the expensive chunk→embed→upsert
  when the hash is unchanged. Makes a blanket sweep cost ~nothing for unchanged
  pages (embedding is the cost).
- **Phase-1 cadence:** the existing 7-day background refresh, now hash-gated — fine
  for a handful of meta sources.
- **Deferred to Sub-project 2 (schema already supports it):**
  - **MediaWiki recentchanges incremental sync** — `WikiClient.refresh()` polls
    recently-changed pages, so the wiki re-indexes only what changed since
    `lastSync`, never a blanket re-crawl of thousands of pages.
  - **Patch-aware trigger** — GW2 `/v2/build` exposes the current build id; when it
    changes (a balance patch dropped), trigger a fuller meta-site refresh then —
    stale-by-patch rather than stale-by-calendar.

## Trust model (consistent with the base prompt)

`meta_search` results are **community recommendations**, not mechanical ground
truth. The system prompt instructs the AI to: use the per-mode summary as the
headline; call `meta_search` for depth (builds, weapons, sigils, traits, tradeoffs)
with the game mode; cite the source; and still verify mechanics via
`axiforge_catalog` / `gw2_api` before stating them as fact; never invent specifics
`meta_search` didn't return. This preserves the existing "never design a build from
memory" rule — meta_search says *what the community runs and why*; the catalog/API
remain the source of mechanical truth. Results are passages (not a synthesized
answer); the AI synthesizes in its reply and (Sub-project 2) can render build cards.

## Storage & lifecycle

- LanceDB at `userData/meta-lance/`; model cache at `userData/meta-models/`; both
  created lazily on first ingest.
- `MetaIndex` + `Embedder` constructed once in `src/main/index.ts` alongside the
  existing `metaStore`/`metaRefresher`; injected into the orchestrator (ingestion)
  and `ToolDeps` (search).
- No new window/timer — ingestion rides the existing background refresh. Close the
  LanceDB handle on quit (minimal; file-based).
- First run: empty index → `meta_search` returns "no indexed meta yet"; the
  background refresh populates it; first ingest downloads the ~25MB model in the
  background.

## Error handling (same "never regress" stance as summaries)

- Embedder model load/download failure → that ingest run no-ops (logged once),
  summaries still update; `meta_search` reports "meta index unavailable" cleanly.
- A chunk/embed/upsert failure for one page is isolated; siblings still index.
- `replacePage` delete-then-insert means a mid-failure can't leave dupes on the
  next clean run.
- `meta_search` on an empty/unavailable index → typed empty result, never throws
  into the turn.

## Testing

- **`chunk.test.ts`** (pure) — passage sizing, overlap, boundary splitting,
  metadata + `id` + `contentHash` propagation.
- **`metaSearch.test.ts`** — tool handler against a **fake `MetaIndex`**: query
  embeds, `mode` filter passes through, results map to `{source,url,title,snippet}`,
  empty-index path returns the clean message.
- **Ingestion test** (extend `refresh.test.ts`) — **fake `MetaIndex`** (the
  orchestrator no longer embeds directly): a refreshed source's pages get hash-gated
  then `replacePage`; an unchanged `contentHash` is skipped (no `replacePage` call);
  a `replacePage` failure is isolated and leaves summaries intact.
- **Real LanceDB + transformers.js** are **not** unit-tested (native + model
  download); both sit behind interfaces (`MetaIndex`, `Embedder`) and the thin real
  impls are verified by a manual smoke test (ask a deep build question; confirm
  `meta_search` returns relevant passages).

## Manual smoke test (post-implementation)

After a background refresh populates the index: ask the agent a depth question it
couldn't answer from the summary (e.g. "what sigils does the meta condi alac
Tempest run and why, vs the power variant?"). Confirm `meta_search` fires, returns
relevant passages from the right mode, the reply cites the source, and the result
card shows in the Actions rail.

## New dependencies

- `@lancedb/lancedb` (embedded vector DB; prebuilt N-API binaries — `asarUnpack`
  the `.node`, no `electron-rebuild`).
- `transformers.js` (`@xenova/transformers`) for local embeddings (WASM backend).
- Both add to the packaged app size (model downloaded at runtime, not bundled).
