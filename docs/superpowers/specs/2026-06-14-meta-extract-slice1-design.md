# Meta Extraction Slice 1 — Per-Source Selectors + No-Body-Fallback — Design

**Status:** Approved (design)
**Date:** 2026-06-14
**Part of:** "Per-site extractor overhaul" (Slice 1 of 2). Slice 2 = Snowcrows full-structured static extractor (separate spec).

## Problem

The meta corpus is polluted with non-build content — cookie-consent walls, persistent filter sidebars ("ELEMENTALIST ENGINEER… Any Gamemode… Select difficulty"), and profession/list pages — because the fetcher extracts `document.body` whenever the configured content selector is absent, and the SPA sources carry that chrome on every page. Investigation (live Playwright DOM inspection) found that the actual build data DOES render on most sources but lives in a specific container, distinct from the chrome.

## Findings (live DOM inspection)

| Source | Build container | Notes |
|---|---|---|
| MetaBattle | `#mw-content-text` | Server-rendered wiki; already clean. Unchanged. |
| Hardstuck | `section.gw2-build-page` | WordPress; build data renders, but `main` includes the filter bar. |
| GuildJen | `.entry-content` | WordPress, SSR, ~11.7k clean chars. |
| gw2mists | build container (element with a `build`-ish class; exact class confirmed at implementation time on a live build page) | SPA, renders clean (≈1 console error). |
| Snowcrows | (none in DOM) | Build data is API-loaded and fails headless — **deferred to Slice 2** (static HTML + armory-embed parse). |

## Scope

- **In:** make the fetcher require the per-source content selector (no `body` fallback), tune the selectors above, and add `linkSelector` + `crawlDepth: 2` to gw2mists and GuildJen so the crawl reaches individual build pages.
- **Out:** Snowcrows (Slice 2). No new extraction *method* type yet — all Slice 1 sources use the existing `browser` path; the change is behavioral (selector-required) + config.

## Architecture

### Fetcher: require the content selector (no body fallback)
`src/main/meta/fetcher.ts`, `BrowserWindowFetcher.loadAndExtract`. Today the in-page render-wait script extracts `(document.querySelector(sel) || document.body).innerText` and the `harvest` runs against that. Change so:

- The render-wait polls **`document.querySelector(sel)`** (the configured selector, no body fallback). It resolves when that element exists AND its `innerText.length >= MIN_CONTENT_CHARS`, OR the `CONTENT_WAIT_MS` cap is hit.
- On resolve, if the selector element is **absent or its text is below a small floor**, return **empty** (`{ title, text: '' }`) — the page contributes no content.
- The `[components]` icon-harvest scopes to the selector element (when present), not `body`.
- `collectLinks(linkSelector)` is unchanged and still runs against the whole document — link discovery must keep working on list/landing pages that have no build container.

Downstream is already correct: `fetchOne` only pushes pages with non-empty text, and still calls `collectLinks` when `level < depth` regardless of whether content was extracted — so list pages drive the crawl while contributing nothing to the corpus. A source whose every page is empty returns `{ ok: false, error: 'empty' }`, which records an error and leaves prior chunks intact (existing no-regress behavior).

### Source config updates (`src/main/meta/sources.ts`)
- **Hardstuck**: `selector: 'section.gw2-build-page'` (keep `linkSelector: 'main a[href*="/gw2/builds/"]'`, `crawlDepth: 2`).
- **GuildJen**: `selector: '.entry-content'`, add `linkSelector: 'a[href*="guildjen.com/gw2-"]'` (build-post links), add `crawlDepth: 2`.
- **gw2mists**: `selector: '<build-container>'` (confirm exact class on a live build page during implementation; investigation matched an element with a `build` class), add `linkSelector: 'a[href*="/builds/"]'`, add `crawlDepth: 2`.
- **MetaBattle**: unchanged (`#mw-content-text`, depth 1).
- **Snowcrows**: unchanged config; under no-body-fallback it will yield empty (recorded as `error`) until Slice 2 gives it the static extractor. This is acceptable — empty beats chrome.

(Implementation will confirm the gw2mists literal selector and the GuildJen build-post link pattern via the same live DOM inspection used in design; the `MetaIndex`/crawl contracts are unchanged.)

## Data flow

Crawl visits the source landing/list page → no build container there → contributes nothing, but its links are collected → crawl walks into individual build pages → those have the build container → clean per-build text (+ `[components]` names) indexed. Filter/cookie/list chrome never enters the corpus.

## Error handling

- Selector never appears (timeout) → empty text → page skipped (not indexed).
- Source with zero non-empty pages → `{ ok:false, 'empty' }` → recorded `error`; previously-indexed chunks survive.
- Existing per-page timeout, crawl page/time caps, Cloudflare challenge handling, and serialization are unchanged.

## Testing

- `src/main/meta/sources.test.ts` — assert the updated configs: Hardstuck `selector === 'section.gw2-build-page'`; GuildJen and gw2mists each have a non-empty `selector`, a `linkSelector`, and `crawlDepth === 2`; MetaBattle unchanged.
- `pickCrawlLinks` / `normalizeUrl` / `fetchWiki` tests — unaffected; stay green.
- The `loadAndExtract` no-body-fallback change is in the in-page `executeJavaScript` string (native, not unit-testable) — verified by the manual smoke test, consistent with how all BrowserWindow logic is covered.

## Manual smoke test

Dev run → Force re-crawl → open the Index inspector. Confirm: chunks now come from **individual build pages** (Hardstuck/gw2mists/GuildJen build URLs, with traits/sigils/rotation text), the filter/cookie/list noise is gone, and MetaBattle stays clean. Snowcrows shows as `error`/empty (expected until Slice 2).

## Dependencies

None new.
