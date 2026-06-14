# Meta Extraction Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the meta crawl from indexing chrome (cookie/filter/list pages) by requiring each source's content selector (no `body` fallback), and retune selectors so the crawl pulls clean per-build data from Hardstuck, gw2mists, and GuildJen.

**Architecture:** One behavioral change in `BrowserWindowFetcher.loadAndExtract` (extract only the configured selector; empty if it never renders), plus per-source `selector`/`linkSelector`/`crawlDepth` updates. List pages contribute nothing but still drive link discovery; build pages yield clean content.

**Tech Stack:** Electron main, TS, `@lancedb/lancedb` (unchanged), vitest. (Implementation uses the Playwright MCP browser tools to confirm two live selectors.)

**Spec:** `docs/superpowers/specs/2026-06-14-meta-extract-slice1-design.md`

---

### Task 1: Fetcher — require the content selector (no `body` fallback)

**Files:**
- Modify: `src/main/meta/fetcher.ts`
- Test: `src/main/meta/fetcher.test.ts` (existing tests must stay green; the change is in the native in-page script)

- [ ] **Step 1: Implement.** In `src/main/meta/fetcher.ts`, in `loadAndExtract`, replace the `tick` function inside the `script` template literal. Current:
```js
      const tick = () => {
        const el = document.querySelector(sel) || document.body;
        const txt = el && el.innerText ? el.innerText : '';
        if (txt.length >= ${MIN_CONTENT_CHARS} || Date.now() - start > ${CONTENT_WAIT_MS}) {
          const labels = harvest(el);
          const extra = labels.length ? '\\n\\n[components] ' + labels.join(' · ') : '';
          resolve({ title: document.title || '', text: txt + extra });
        } else setTimeout(tick, 500);
      };
```
Replace with (no `|| document.body`; resolve empty on timeout when the selector never yields content):
```js
      const tick = () => {
        const el = document.querySelector(sel);
        const txt = el && el.innerText ? el.innerText : '';
        if (txt.length >= ${MIN_CONTENT_CHARS}) {
          const labels = harvest(el);
          const extra = labels.length ? '\\n\\n[components] ' + labels.join(' · ') : '';
          resolve({ title: document.title || '', text: txt + extra });
        } else if (Date.now() - start > ${CONTENT_WAIT_MS}) {
          // Selector never rendered enough content (list/cookie/filter page) — yield nothing.
          resolve({ title: document.title || '', text: '' });
        } else setTimeout(tick, 500);
      };
```
(Everything else in `loadAndExtract` — the load/timeout race, the `harvest` helper, the `executeJavaScript` call, the trim — stays identical. `harvest(el)` now only runs when `el` exists with content, so it's always scoped to the selector element.)

- [ ] **Step 2: Run the existing fetcher tests, expect PASS:** `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2`
Expected: PASS (the `pickCrawlLinks`/`normalizeUrl`/`fetchWiki` tests don't touch the browser path).

- [ ] **Step 3: typecheck:** `npm run typecheck` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/main/meta/fetcher.ts
git commit -m "fix(meta): require content selector in scrape (drop body fallback)"
```

---

### Task 2: Source configs — per-site selectors + crawl into build pages

**Files:**
- Modify: `src/main/meta/sources.ts`
- Test: `src/main/meta/sources.test.ts`

- [ ] **Step 1: Confirm the two live selectors via the Playwright MCP browser tools.** Before editing, verify the exact selectors on live build pages (the design pinned the approach; confirm the literals):
  - **gw2mists**: navigate to a build page (e.g. `https://gw2mists.com/en/builds/guardian/power-dragonhunter`), and find the element holding the build (traits/skills/sigils) — investigation matched an element with a `build` class. Determine the precise, stable selector (prefer an exact class like `.build-page`/`.build-detail` over a fuzzy `[class*="build"]` if one exists). Record it as `GW2MISTS_SELECTOR`.
  - **GuildJen**: from `https://guildjen.com/gw2-wvw-builds/`, find the href pattern of *individual build-post* links (not category pages) to use as `GUILDJEN_LINK` (a `linkSelector`). `.entry-content` is the confirmed content container.
  If the browser tools are unavailable in this run, use `GW2MISTS_SELECTOR = '[class*="build"]'` and `GUILDJEN_LINK = 'a[href*="guildjen.com/gw2-"]'` as the documented fallbacks and note it in the commit.

- [ ] **Step 2: Write the failing test.** In `src/main/meta/sources.test.ts`, add:
```ts
  it('uses tight per-build content selectors (slice 1)', () => {
    const hs = configForUrl('https://hardstuck.gg/gw2/builds/mesmer/power-virtuoso')
    expect(hs?.selector).toBe('section.gw2-build-page')
    const gj = configForUrl('https://guildjen.com/gw2-wvw-builds/')
    expect(gj?.selector).toBe('.entry-content')
    expect(gj?.linkSelector).toBeTruthy()
    expect(gj?.crawlDepth).toBe(2)
    const gm = configForUrl('https://gw2mists.com/en/builds?mode=zerg')
    expect(gm?.selector).toBeTruthy()
    expect(gm?.selector).not.toBe('body')
    expect(gm?.linkSelector).toBeTruthy()
    expect(gm?.crawlDepth).toBe(2)
    // MetaBattle unchanged
    expect(configForUrl('https://metabattle.com/wiki/Build:X')?.selector).toBe('#mw-content-text')
  })
```

- [ ] **Step 3: Run, expect FAIL:** `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement.** In `src/main/meta/sources.ts`, update `SOURCE_CONFIGS` to (substituting the Step-1 confirmed literals for `GW2MISTS_SELECTOR` / `GUILDJEN_LINK`):
```ts
export const SOURCE_CONFIGS: SourceConfig[] = [
  // Snowcrows: build data is API-loaded (fails headless) — yields empty under the
  // no-body-fallback rule until Slice 2 gives it a static extractor. Left as-is.
  { host: 'snowcrows.com', kind: 'browser', selector: 'main', linkSelector: 'a[href*="/builds/"]', crawlDepth: 2 },
  { host: 'hardstuck.gg', kind: 'browser', selector: 'section.gw2-build-page', linkSelector: 'main a[href*="/gw2/builds/"]', crawlDepth: 2 },
  { host: 'guildjen.com', kind: 'browser', selector: '.entry-content', linkSelector: 'a[href*="guildjen.com/gw2-"]', crawlDepth: 2 },
  { host: 'gw2mists.com', kind: 'browser', selector: '[class*="build"]', linkSelector: 'a[href*="/builds/"]', crawlDepth: 2 },
  { host: 'metabattle.com', kind: 'browser', selector: '#mw-content-text', linkSelector: '#mw-content-text a[href*="/wiki/"]' }
]
```
(Replace `'guildjen.com/gw2-'` and `'[class*="build"]'` with the Step-1 literals if you confirmed tighter ones.)

- [ ] **Step 5: Run, expect PASS:** `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`; `npm run typecheck` PASS.

- [ ] **Step 6: Commit**
```bash
git add src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "feat(meta): tight per-source build selectors + crawl into gw2mists/guildjen builds"
```

---

### Task 3: Full verification

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS.
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke (controller).** Dev run → Force re-crawl → open the Index inspector. Confirm: chunks now come from individual build pages (Hardstuck/gw2mists/GuildJen build URLs, with traits/sigils/rotation text); the filter/cookie/list noise is gone; MetaBattle stays clean; Snowcrows shows `error`/empty (expected until Slice 2). Run a `meta_search` query and confirm the results are build content, not chrome.

---

## Self-Review

**Spec coverage:**
- No-body-fallback (selector required; empty on timeout; harvest scoped to selector; collectLinks unchanged) → Task 1. ✔
- List pages drive crawl but contribute nothing; zero-content source → error, prior chunks survive → inherent in existing `fetchOne` + Task 1 (empty pages not pushed). ✔
- Hardstuck `section.gw2-build-page`; GuildJen `.entry-content` + linkSelector + depth 2; gw2mists build selector + linkSelector + depth 2; MetaBattle unchanged; Snowcrows left (empty until Slice 2) → Task 2. ✔
- Confirm gw2mists/GuildJen literal selectors via live inspection → Task 2 Step 1. ✔
- Tests: sources.test config assertions; fetcher native change covered by smoke → Tasks 2/3. ✔

**Placeholder scan:** none — Task 1 has complete before/after code; Task 2 has the full config with documented fallback literals + a live-confirm step (a real implementation action, not a TODO).

**Type consistency:** No type/interface changes — `SourceConfig` already has `selector`/`linkSelector`/`crawlDepth`; only data values change. `loadAndExtract`'s return shape (`{title, text}`) is unchanged (empty `text` is a valid existing case the caller already handles by not pushing empty pages).
