# Entity Autolinking + Hover Cards — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

Make Guild Wars 2 game entities — **skills, traits, and items** — interactive wherever
prose is rendered in AxiVale. Each detected entity becomes a color-coded inline link
(leading icon + dotted underline) that:

- shows a **hover card** with the entity's icon, name, type, description, and key facts,
- **opens the GW2 Wiki page externally** on click.

Detection is **hybrid (Option C)**: explicit authored markers always win; a conservative
exact-match text scanner fills in high-confidence bare-text matches.

Locations are **out of scope** for v1 (thin/absent data source). An in-app detail panel and
fuzzy matching are also out of scope.

## Context / Existing Infrastructure

This feature extends patterns the app already has:

- **Hover previews:** `@axiapps/forge-render` exposes `createHoverPreview(host)` +
  `renderEntityHoverHtml(entity)`, used today for rune/relic cells in
  `src/renderer/src/components/rich/ForgeCard.tsx`.
- **Entity-in-text decoration:** `rehypeClassIcons` / `rehypeEmojiIcons`
  (`src/renderer/src/components/rehype*.ts`) already scan rendered markdown and emit marker
  spans rendered by `renderRichSpan` (`src/renderer/src/components/richSpan.tsx`).
- **Markdown pipeline:** `src/renderer/src/components/Article.tsx` renders prose with
  `ReactMarkdown` + `remarkGfm` + the rehype plugins above.
- **Entity data sources (main process):**
  - Items / runes / relics → AxiForge catalog (`src/main/forgeCatalog.ts`,
    `axiforgeClient.catalogUpgrades()`).
  - Skills / traits → GW2 Wiki via `WikiClient` and the LanceDB RAG index
    (`src/main/meta/wikiFacts.ts`, `src/main/meta/rag/index.ts`).

## Architecture

### 1. Entity resolution (main process)

Normalized card shape returned to the renderer:

```ts
type EntityType = 'skill' | 'trait' | 'item'
interface EntityCard {
  type: EntityType
  name: string
  icon?: string          // url or data-uri
  subtitle?: string      // e.g. "Guardian · Skill"
  description?: string
  facts: { label: string; value?: string }[]
  wikiUrl?: string
}
```

- **IPC `entity:resolve`** — input `{ type, name?, id? }` → `EntityCard | null`.
  - `item` → AxiForge catalog lookup, reuse `renderEntityHoverHtml` source data.
  - `skill` / `trait` → `wikiFacts.ts` (WikiClient) + LanceDB RAG facts, normalized to
    `EntityCard`.
  - Results memoized in a main-process LRU keyed by `type:name`.
- **IPC `entity:dictionary`** — returns `{ skills: string[]; traits: string[]; items: string[] }`,
  the known-name list for the text matcher. Built once and cached; rebuilt when the AxiForge
  catalog refreshes. Names normalized for matching (trim, canonical casing).

### 2. Detection (renderer rehype plugin)

New `rehypeEntityLinks` plugin, sibling to `rehypeClassIcons`, configured with the dictionary.
Two passes over the HAST:

1. **Marker pass (always wins):** resolve `[[type:Name]]` syntax and any `data-entity` spans
   emitted by the LLM or wiki importer → wrapped entity span.
2. **Text pass (conservative fallback):** match remaining bare text nodes against the
   dictionary using:
   - **exact, case-sensitive** match,
   - **longest-match-first** (so "Superior Rune of the Monk" wins over "Rune"),
   - **whole-token boundaries** (no mid-word matches),
   - **skip** text already inside a link, an entity marker, inline/block code, or a heading.

Output: `<span class="axi-entity axi-entity--{type}" data-entity-type="{type}"
data-entity-name="{name}">{label}</span>`, consumed by an extension to `renderRichSpan`.

The conservative guards (exact/longest/token-boundary/skip-zones) are the core defense against
the false-positive problem (e.g. the skill "Shelter" vs. the common word).

### 3. Hover + click (renderer)

- `createEntityHover(host)` — a single delegated helper (mirrors forge-render's
  `createHoverPreview`) bound once per rendered container. On hover of an `.axi-entity`:
  1. show a **skeleton** card immediately,
  2. call IPC `entity:resolve`,
  3. render the card,
  4. cache the `EntityCard` in a renderer-side `Map` keyed by `type:name` so re-hovers are
     instant.
- **Card rendering:** `item` reuses forge-render's card look; `skill`/`trait` use a new
  lightweight card component (icon + name + subtitle + facts list + "Open wiki ↗" footer).
- **Click:** `shell.openExternal(wikiUrl)` (via existing external-link IPC).

### 4. Wiring

- Register `rehypeEntityLinks` in the rehype plugin list in `Article.tsx` and any other
  `ReactMarkdown` prose render sites.
- Add `.axi-entity` variant styles + hover-card styles to `src/renderer/src/theme.css`.
- Color coding: skills blue, traits purple, items gold.

## Data Flow

```
authored text / LLM output / wiki content
      │  (ReactMarkdown + remarkGfm)
      ▼
  rehypeEntityLinks  ──uses──►  entity:dictionary (cached, main)
      │  marker pass → text pass
      ▼
  <span class="axi-entity" data-entity-type data-entity-name>
      │  renderRichSpan
      ▼
  createEntityHover(host)  ──hover──►  entity:resolve (LRU, main)
      │  skeleton → card → renderer cache (Map)
      ▼
  hover card  ──click──►  shell.openExternal(wikiUrl)
```

## Error Handling

- `entity:resolve` returns `null` (not found / fetch error) → hover card shows a minimal
  "no data" state; the inline link still renders and click falls back to a wiki search URL.
- Dictionary build failure → matcher runs marker-only (degrade gracefully; markers still work).
- Network/wiki timeout on resolve → skeleton resolves to the "no data" state; result is **not**
  cached as success so a later hover retries.

## Testing

Unit tests (the matcher is the riskiest surface, so it gets the most coverage):

- **Matcher:** exact match; longest-match-first; whole-token boundary (no mid-word);
  skip text inside links / code / headings / existing markers; marker precedence over text.
- **Dictionary build:** merges catalog + skill/trait names; normalization/dedupe.
- **Resolve normalization:** each of `skill` / `trait` / `item` maps its source data to the
  `EntityCard` shape; `null` on miss.

Per global instruction, run vitest with `--maxWorkers=2` (or honor an existing ≤2 config).

## Out of Scope (YAGNI)

- Locations (deferred — thin data source).
- In-app entity detail panel/route (click goes to external wiki for now).
- Fuzzy / approximate name matching.
