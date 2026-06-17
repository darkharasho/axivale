# Sources Tab + Wiki/General Recall Corpora — Design

**Date:** 2026-06-16
**Status:** Approved design, pre-implementation

## Summary

Convert the **Meta** tab into a **Sources** tab organized around three knowledge
groups — **meta**, **wiki**, **general** — and expand the chat assistant's
retrieval ("recall") to draw from all three. Two new corpora are introduced:

- **wiki** — holistic GW2 wiki coverage (legendaries, achievements, masteries,
  mechanics) so the assistant can answer questions like *"how do I make
  Twilight?"* or *"help me with this achievement."*
- **general** — long-form guides (encounter/CM strategy, fractals, open-world,
  "how to get good at X") from Snowcrows guides, GuildJen, Hardstuck, and
  Discretize.

The existing `meta` corpus (build/tier data, mode-keyed) is unchanged in
substance; it becomes one of the three groups in the new UI.

## Goals

- Three model-callable retrieval tools so the assistant chooses what to search.
- Wiki recall that covers the long tail without ingesting the entire wiki.
- A `general` corpus distinct from `meta`, with no double-ingestion of pages.
- A Sources tab UI that groups and manages all three corpora.

## Non-Goals

- No intent classifier or always-search-all routing — the model routes via tools.
- No re-architecture of the provider/tool-calling infrastructure (already exists).
- No change to how meta build distillation works today.

## Retrieval routing: model-chooses-via-tools (option C)

The chat already uses tool-calling (`src/main/tools/index.ts`,
`src/main/agent.ts`), and already exposes `meta_search` and `gw2_wiki_search`.
We extend this pattern rather than add a classifier.

Final tool surface (names may align to existing ones where sensible):

- `meta_search` — existing. Build/meta corpus, optional `mode` filter.
- `wiki_search` — wiki corpus (see Hybrid below). Replaces/extends the current
  `gw2_wiki_search`, broadening its description and corpus scope.
- `general_search` — new. Guide corpus, topic-keyed (no mode filter).

Each tool's description tells the model when to reach for it. System-prompt
guidance in `AXIVALE_SYSTEM_PROMPT` (`src/main/agent.ts`) is updated to describe
the three groups and when each applies. New tools are added to the local-model
allowlist if they qualify as high-value reads.

## Wiki corpus: hybrid (option C)

**Pre-ingested curated set** (extends the existing weekly crawl in
`src/main/meta/wiki/ingest.ts`, stored in `wiki_chunks` via `LanceMetaIndex`):

- Existing: profession skills, traits, upgrades (runes/sigils/relics).
- New curated categories: Legendary weapons / armor / trinkets, Masteries, key
  game mechanics, and major Achievement/Collection pages.

**On-demand live fallback:** when the pre-ingested index returns no good hit,
`wiki_search` falls back to the live MediaWiki search + page fetch
(`fetchWiki()` in `src/main/meta/fetcher.ts`, compression via
`compressWikiPage()` in `src/main/meta/wiki/skillCrawl.ts`), returning the
top matching page(s) compressed at query time.

This gives instant semantic recall for high-value content and full coverage for
the long tail without ingesting 100k+ pages. The "no good hit" threshold is a
relevance-score floor on the index search; tune during implementation.

## General corpus: new guide ingestion

New corpus stored in its own `LanceMetaIndex` table (e.g. `general_chunks`),
fed by guide pages. Sources for the initial set:

- **Snowcrows guides** — `/guides/` paths (already flagged by `resolveContent()`).
- **GuildJen** — guide content.
- **Hardstuck** — guide content.
- **Discretize** (`discretize.eu` / `next.discretize.eu`) — fractal/CM,
  mechanics, and profession guides. The authoritative fractal source and a gap
  in the current set. Verified current (data updated for April 14 2026 patch).

Deferred but easy to add later via a config entry: **Phoenix Uprising**
(`phoenixuprising.net`) endgame/achievement guides.

**Routing / no double-ingest:** a page lands in exactly one corpus, routed by
URL pattern. Build pages → `meta`; guide pages (`/guides/`, guide namespaces)
→ `general`. The split extends the existing `resolveContent()` logic in
`src/main/meta/sources.ts`. Source configs gain enough metadata to express
"this host/path contributes to corpus X."

General is **topic-keyed, not mode-keyed** — no `PvE/WvW/Roaming` filter on
`general_search`.

## Sources tab UI

`Meta` → `Sources`. Left rail (`MetaNav.tsx`, `SECTION_TITLES` in `App.tsx`)
header becomes "Sources" with three collapsible **group sections**:

- **Meta** — keeps today's per-mode breakdown (PvE / WvW / Roaming) and the
  build-tier distillation cards. Effectively the current Meta view nested under
  this group.
- **Wiki** — shows curated categories being ingested (legendaries, achievements,
  masteries, mechanics, skills/traits/upgrades) and a note that uncovered pages
  fall back to live fetch.
- **General** — guide sources (Snowcrows guides, GuildJen, Hardstuck,
  Discretize) with per-source status LEDs (ok/error/never) and last-fetched
  timestamps, matching today's Sources card.

Each group has its own refresh action. Fetch-progress events
(`window.officer.onMetaProgress`, refresh events in `src/main/meta/refresh.ts`)
extend to cover wiki and general refreshes.

## Data model changes

- `MetaSource` (`src/main/metaStore.ts`) gains a `group: 'meta' | 'wiki' |
  'general'` field; `DEFAULT_SEED` entries are tagged. Existing entries default
  to `meta` for backward compatibility.
- `SourceConfig` (`src/main/meta/sources.ts`) gains corpus/routing metadata so a
  host or path maps to a corpus.
- New `general_chunks` LanceDB table (new `LanceMetaIndex` instance wired into
  `AgentDeps` in `src/main/index.ts`). Wiki continues using `wiki_chunks`.

## Affected files (reference)

- UI: `src/renderer/src/components/meta/Meta.tsx`, `MetaNav.tsx`,
  `src/renderer/src/App.tsx`
- Store/config: `src/main/metaStore.ts`, `src/main/meta/sources.ts`
- Ingestion: `src/main/meta/refresh.ts`, `src/main/meta/wiki/ingest.ts`,
  `src/main/meta/wiki/skillCrawl.ts`, `src/main/meta/fetcher.ts`
- RAG: `src/main/meta/rag/index.ts`
- Tools/prompt: `src/main/tools/index.ts`, new `src/main/tools/generalSearch.ts`,
  `src/main/tools/gw2WikiSearch.ts` (broaden), `src/main/agent.ts`
- Wiring: `src/main/index.ts`, `src/preload/index.ts`

## Testing

- Unit: corpus-routing function (URL → corpus) covers meta vs general split and
  no-double-ingest invariant; wiki fallback threshold logic.
- Unit: new wiki curated-category crawl targets resolve to expected pages.
- Tool tests: `general_search` / `wiki_search` return shaped hits; wiki falls
  back to live fetch when the index is empty/low-score.
- Manual in-app smoke: Sources tab renders three groups, each refresh runs and
  reports progress; ask the assistant a legendary, an achievement, and a fractal
  guide question and confirm the right tool fires.

## Open implementation details (decide during plan)

- Exact wiki curated category list (which Achievement/Collection pages — all vs.
  major meta-relevant ones).
- Relevance-score floor that triggers the live wiki fallback.
- Whether `general` ingestion crawls each site's guide index or uses seed URLs.
