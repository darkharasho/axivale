# Meta Phase 2b — `gw2_wiki_facts` on-demand tool — Design

**Status:** Approved (design)
**Date:** 2026-06-14
**Part of:** Phase 2 (after Phase 1 RAG corpus + retrieval). Phase 2 was re-scoped during brainstorming to **2b (this) → 2a (structured build cards)**; the originally-sketched 2c (numeric-ID resolution) and 2d (smarter reindex) were dropped — see Background.

## Goal

Give the AI accurate, on-demand mechanical facts for a GW2 skill or trait — **including the WvW/PvP balance splits the official GW2 API does not expose** — via a new `gw2_wiki_facts` tool. The AI calls it when reasoning about a build's skill/trait choices, interactions, or tradeoffs (especially for WvW/roaming), grounding the numbers in the wiki rather than its own (split-unaware) knowledge or the PvE-only API.

## Background / why this shape

- The GW2 API (`/v2/skills`, `/v2/traits`) returns only **PvE** values; it has **no WvW/PvP balance splits**. WvW balance genuinely differs (damage coefficients, boon/condition durations, recharges). This was a known pain point in AxiForge.
- The GW2 **wiki** encodes those splits (`| split = …`, game-mode-tagged `{{skill fact}}`/`{{trait fact}}` templates), and the existing `@axiapps/gw2-data` `WikiClient` already parses them — `parseFacts` → fact objects, and the resolver's `parseFactsByMode` → facts grouped into PvE/WvW/PvP plus per-mode recharge/activation.
- Phase 1 already surfaces skill/trait/spec **names** in the corpus (the `[components]` icon-harvest + build prose), so a name-driven on-demand lookup needs no extra ingestion.
- **On-demand tool (not bulk ingest):** mechanical facts are reference data best looked up per question. A tool keeps the index small, the data always-current, and needs no re-index infrastructure (this is why 2d was dropped). It mirrors the existing `gw2_api` / `load_skill` on-demand patterns.

## Scope

- **In:** skills and traits (the domain of `parseFacts`/`parseFactsByMode`), returned as mode-split mechanical facts.
- **Out:** items (sigils/runes/relics) — different wiki templates `parseFacts` doesn't handle; the AI already has `gw2_api` (`/v2/items`) for their effect text. (Items-with-splits could be a later enhancement; not in 2b.)

## Architecture

A single new officer tool plus an injected client, following the established tool patterns.

### Tool — `src/main/tools/gw2Wiki.ts`
```
gw2_wiki_facts({ name: string })
```
- `buildGw2WikiTools(wikiFacts: WikiFacts): SdkMcpToolDefinition[]` — registered in `buildOfficerTools`.
- Handler (wrapped in `safe()`): `const r = await wikiFacts.lookup(name)` → returns `r` (the model gets the JSON). Non-destructive → auto-allowed, no confirm gate.
- Description (verbatim intent): "Look up official GW2 wiki mechanical facts for a SKILL or TRAIT by name — damage coefficients, recharge, boon/condition durations, combo fields — with the PvE/WvW/PvP balance splits the GW2 API does NOT provide. Use this to ground WvW/roaming or any mechanics/tradeoff reasoning in real numbers; names come from meta_search results or build pages."

### Injected interface — `WikiFacts`
```ts
export interface WikiFactsResult {
  name: string
  found: boolean
  hasSplit: boolean
  pve: unknown[]   // parsed fact objects (PvE / universal)
  wvw: unknown[]   // WvW-split facts
  pvp: unknown[]   // PvP-split facts
  recharge: { pve: number | null; wvw: number | null; pvp: number | null }
  activation: { pve: number | null; wvw: number | null; pvp: number | null }
}
export interface WikiFacts {
  lookup(name: string): Promise<WikiFactsResult>
}
```
- Behind this interface so the tool is unit-tested with a fake; the real impl is smoke-tested.

### Real impl — `WikiFactsClient` (same file or `src/main/meta/wikiFacts.ts`)
- Wraps one reused `@axiapps/gw2-data` `WikiClient` (public wiki API root, no key; internal cache + a TTL).
- `lookup(name)`:
  1. `getWikitext(name)`. If null/empty, `prefixSearch(name, 1)` → retry `getWikitext(bestMatch)`.
  2. If still nothing → `{ name, found: false, hasSplit: false, pve: [], wvw: [], pvp: [], recharge: {…null}, activation: {…null} }`.
  3. Else `parseFactsByMode(wikitext)` → map into `WikiFactsResult` (`found: true`).
- **Build-time verification:** confirm the exact import path + return shape of `parseFactsByMode` in the installed `@axiapps/gw2-data` and adapt the mapping; the `WikiFacts`/`WikiFactsResult` contract above stays fixed so the tool + tests are unaffected. (Reference from earlier exploration: resolver exports `parseFactsByMode(wikitext) → { pve, wvw, pvp, hasSplit, recharge:{pve,wvw,pvp}, activation:{pve,wvw,pvp} }`.)

### Wiring
- `ToolDeps` gains `wikiFacts: WikiFacts` (`src/main/tools/shared.ts`).
- `src/main/index.ts` constructs `new WikiFactsClient()` once and adds `wikiFacts` to the `toolDeps` object.
- `buildOfficerTools` adds `...buildGw2WikiTools(deps.wikiFacts)`.
- `src/main/agent.ts` `AXIVALE_SYSTEM_PROMPT` gains a bullet (each sentence on one line to protect prompt regex tests):
  > The GW2 API returns only PvE values — it has NO WvW/PvP balance splits. For the real WvW/PvP mechanics of a skill or trait (damage, recharge, boon/condi duration), call gw2_wiki_facts with the name. Use it whenever reasoning about WvW/roaming builds or any mechanics tradeoff; skill/trait names come from meta_search results.

## Data flow

AI answering a deep or WvW question → reads skill/trait names from `meta_search` results → calls `gw2_wiki_facts(name)` for the relevant ones → receives mode-split facts → reasons with WvW-accurate numbers instead of PvE-only/API or stale priors.

## Error handling

- Name not found (after `prefixSearch` fallback) → `{ found: false, … }` (clean, not an error).
- Wiki/network failure → `safe()` turns a throw into a typed MCP error result; never throws into the turn.
- No auth dependency (public wiki API).
- Caching: one `WikiClient` instance with its built-in cache + TTL so repeated lookups in a session don't refetch.

## Testing

- **`gw2Wiki.test.ts`** — the tool handler against a **fake `WikiFacts`**: a found result maps through (including a `wvw` value that differs from `pve`, proving splits surface); a `found:false` lookup returns the clean result; the `name` arg passes to `lookup`.
- **Real `WikiFactsClient`** — **not** unit-tested (network + `@axiapps/gw2-data`); behind the `WikiFacts` interface, verified by the manual smoke test.
- **`inventory.test.ts`** — add `gw2_wiki_facts` to the tool-name snapshot.
- **Full-`ToolDeps` mocks** (e.g. `agent.test.ts`, `tools.test.ts`, and the per-tool suites) — add a `wikiFacts` stub.

## Manual smoke test (post-implementation)

Ask a WvW mechanics question (e.g. "what's the WvW recharge and coefficient on <a zerg-meta skill>?"). Confirm `gw2_wiki_facts` fires and returns WvW-split numbers that differ from the PvE/API values; confirm an unknown name returns a clean "not found".

## New dependencies

- None new to install — `@axiapps/gw2-data` is already a dependency (transitively via forge-render; will be imported directly here).
