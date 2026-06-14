# GW2 Meta Fetch (Auto-Knowledge) — Design

**Status:** Approved (design)
**Date:** 2026-06-14
**Builds on:** GW2 Meta Bias (Foundation) — `2026-06-14-gw2-meta-bias-foundation-design.md`

## Goal

AxiVale silently keeps its own GW2 meta knowledge current. In the background it
fetches each configured source, distills the content into tight per-mode summary
notes, and stores them so every conversation's system prompt is biased toward the
*current* meta — with no user interaction. This is infrastructure, not a user
feature: AxiVale just *knows* the meta.

## Why this is non-trivial

Plain `fetch` / WebFetch fails against these sources, for two distinct reasons:

- **SPAs** (Snowcrows, Hardstuck) ship an empty HTML shell and render content
  client-side via JavaScript. A raw fetch gets no usable text.
- **Bot-blocking** (Cloudflare et al.) returns 403 to requests without a real
  browser UA / TLS fingerprint / cookies.

MetaBattle is the exception: it is a MediaWiki and exposes a clean fetchable API.

## Approach (decided)

**A — hidden Electron BrowserWindow as the scrape engine**, with the **MediaWiki
API used directly for MetaBattle**.

We already ship Chromium. An offscreen, hidden `BrowserWindow` in the main process
loads each SPA source like a real browser — JS executes and the real Chromium
UA/TLS/cookies defeat most bot-blocking — then we extract the rendered text. For
MetaBattle we skip the browser and call the MediaWiki API (no reason to scrape a
wiki's DOM when it has an API).

Rejected alternatives:
- **API/fetch-only** — reliable but can't reach the SPAs, so PvE knowledge stays thin.
- **External render/proxy service** — adds a third-party dependency, key, cost, and
  leaks usage; against this app's self-contained, in-your-own-account ethos.

## Scope

**v1:** distilled **summary notes only** (readable prose per mode, backed by a raw
cache). This is what biases the AI.

**Deferred (follow-up):** structured build-list extraction (parsing out build cards).
It is materially more fragile per-site and waits until the fetch engine is proven.

## Architecture

All in the **main process** (the renderer is CSP-locked and cannot fetch external
hosts). Four focused units behind injected interfaces:

```
[scheduler] --stale?--> [orchestrator] --per source--> [fetch engine] --raw--> [distiller] --summary--> [metaStore] --> meta.json
                                                              │                       │
                                                  BrowserWindow / WikiAPI     background Claude call
```

### 1. Fetch engine — `src/main/meta/fetcher.ts`
- Owns a single, reusable, hidden `BrowserWindow` (lazy-created, reused across
  fetches, destroyed on app quit).
- `fetch(source): Promise<FetchResult>` where the source's `kind` selects the path:
  - `kind: 'browser'` — load URL, wait for content to settle, run `executeJavaScript`
    to extract `document.querySelector(selector).innerText` (or body text), return it.
  - `kind: 'wiki'` — skip the browser; call the MediaWiki API
    (`?action=parse&page=<title>&prop=wikitext&format=json`) via `fetch`, return the
    wikitext/extract.
- **Serialized**: one fetch at a time through the single window (never a swarm).
- **Per-source timeout** (~20s): a hung load fails *that* source and releases.
- Returns a typed result: `{ ok: true, text } | { ok: false, error }`. Never throws
  to the orchestrator.
- The BrowserWindow itself is a thin adapter behind a `MetaFetcher` interface so the
  orchestrator can be tested with a fake; the wiki path is testable with mocked `fetch`.

### 2. Source registry — `src/main/meta/sources.ts`
- Pure data: per known host, *how* to fetch and *what* to extract.
  ```ts
  interface SourceConfig {
    host: string                 // matched against MetaSource.url host
    kind: 'browser' | 'wiki'
    selector?: string            // required when kind==='browser'
    wikiApi?: string             // base API URL, required when kind==='wiki'
    wikiPage?: string            // page title, required when kind==='wiki'
  }
  ```
- The *only* place site-specific knowledge lives; adapting to a site redesign is a
  one-file edit. A source URL with no matching config is skipped (status stays
  `never`) — not an error.

### 3. Distiller — `src/main/meta/distill.ts`
- `distill(mode, rawTexts, model): Promise<string | null>` — assembles a prompt
  (mode name + concatenated raw source excerpts) and runs a one-shot Claude call
  (cheap tier, **Haiku**, no tools) that returns a tight summary string.
- The model client is **injected** (a `(prompt) => Promise<string>` callable) so
  tests mock it. Reuses existing Claude auth (saved token or system login).
- Returns `null` on empty/failed model response so the orchestrator leaves the
  previous notes untouched (knowledge never regresses).

### 4. Orchestrator — `src/main/meta/refresh.ts`
- `refreshStale(now): Promise<void>` — for each **stale** mode: fetch each source
  (engine), cache raw (cache), distill the gathered raw (distiller), write back notes
  + provenance (store).
- **Error-isolated**: a failed source keeps the old notes and marks only that
  source `error`; siblings still contribute; the mode still distills from whatever
  succeeded. A mode with zero successful sources keeps its previous notes entirely.
- **No-auth path**: if no Claude auth is available, fetch + cache still run and
  source provenance updates; distill no-ops and notes stay as-is. Graceful, not an error.

### Scheduler
- On app launch (after the main window is shown) the orchestrator runs
  `refreshStale` in the background — **never blocks startup**.
- A long interval timer re-checks so a long-running session stays current.
- **Staleness:** a mode is stale if `refreshedAt` is null or older than **7 days**.
  Only stale modes refresh; a normal launch usually does nothing.

## Data model

`meta.json` stays the source of truth and gains per-source provenance. Bulky raw
text does **not** live in `meta.json` — it goes in a sidecar cache.

```ts
interface MetaSource {
  label: string
  url: string
  status: 'ok' | 'error' | 'never'   // last fetch outcome
  fetchedAt: string | null           // ISO; null = never fetched
  error: string | null               // short reason when status==='error'
}

interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string                // machine-managed: the distilled summary
  refreshedAt: string | null   // last successful distill for this mode
  updatedAt: string
}
```

### Raw cache — `src/main/meta/cache.ts`
- One file per source-URL hash under `userData/meta-cache/`, holding the cleaned
  excerpt + timestamp. Atomic tmp+rename writes; corrupt-file tolerant (mirrors the
  AxiBridge cache / existing store patterns).
- This is what the distiller reads; the panel never shows it.

### MetaStore changes — `src/main/metaStore.ts`
- `notes` flips from user-edited to machine-written.
- Add internal writers used by the orchestrator so provenance + summary writes don't
  clobber each other:
  - `recordFetch(modeId, sourceUrl, result)` — set that source's `status` /
    `fetchedAt` / `error`.
  - `recordDistill(modeId, notes)` — set `notes` + `refreshedAt`.
- **Migration:** on read, backfill missing source fields
  (`status:'never', fetchedAt:null, error:null`) and missing `refreshedAt:null` so
  pre-existing `meta.json` files load cleanly. Existing `addMode`/`updateMode` remain
  for internal/seed use.

## Meta panel (read-only status view)

`src/renderer/src/components/panels/Meta.tsx` becomes a dashboard, not an editor:

- Per mode: the distilled summary (`notes`) as read-only prose + a `refreshedAt`
  relative timestamp ("updated 2 days ago" / "never").
- Per source: the existing external link + a status chip — `ok` (with fetched-ago),
  `error` (title shows the short reason), or `never` (muted).
- The editable textarea, "Save notes" button, and any manual trigger are **removed**
  (baked-in infra).
- Reuses existing `.meta-*` / settings styles; adds a `.meta-chip` style trio.

## Error handling (summary)

- Fetch/timeout/distill failures never throw to the scheduler; the job is
  fire-and-forget.
- Any failure leaves the previous good `notes` intact; only source `status`/`error`
  updates. Knowledge never regresses on a bad night.
- A source with no registry config is silently skipped (`never`), not errored.

## Testing strategy

Behind injected interfaces; the real-Chromium piece is isolated and excluded from
unit tests (covered by the manual in-app smoke test).

- **`sources.test.ts`** — every registry entry has a valid `kind`; `browser` entries
  carry a selector, `wiki` entries carry an API + page.
- **`distill.test.ts`** — fake model-callable: prompt includes raw + mode; summary is
  written through; empty/failed response → notes untouched (returns null).
- **`refresh.test.ts`** (core) — fake fetcher + fake distiller + temp-dir MetaStore:
  stale-only selection (fresh modes skipped); error isolation (one source throws →
  old notes survive, source marked `error`, siblings still distill); no-auth path
  (fetch+cache runs, distill no-ops); provenance writeback correctness.
- **`cache.test.ts`** — round-trip write/read; atomic replace; corrupt-file tolerance.
- **`metaStore.test.ts`** (extend) — old `meta.json` with bare sources loads and
  backfills `status:'never'`.
- **Fetch engine** — BrowserWindow wrapper not unit-tested (needs real Electron);
  thin adapter behind the `MetaFetcher` interface, verified by the manual smoke test.
  The MediaWiki-API path *is* tested with mocked `fetch`.
- **`Meta.test.tsx`** (rewrite) — renders summary + timestamps + status chips; the
  editor is gone.

Total: ~5 new test files + 2 updated.

## Defaults chosen (easy to change)

- Staleness window: **7 days**.
- Distill model: **Haiku** (cheap/fast tier).
- Per-source fetch timeout: **~20s**.

## Manual smoke test (post-implementation)

Launch the app; open Meta (nav 07). Confirm modes show summaries that fill in after
the background refresh, source chips reflect `ok`/`error`/`never`, and timestamps
update. Ask the agent "what's the current WvW zerg meta?" and confirm it reflects the
distilled notes.
