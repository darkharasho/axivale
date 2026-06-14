# Meta Fetch Quality v2: render-wait extraction + browser MetaBattle

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Fix shallow/blocked meta scrapes. Wait for SPA content to render before extracting, route MetaBattle through the real browser (its api.php is Cloudflare-blocked), and tighten the distiller so summaries list the actual meta builds/specs per mode.

**Root causes (observed):** (1) extraction ran on `did-finish-load`, before SPA build data populated the DOM → we captured nav/headers only; (2) MetaBattle used a plain-`fetch` wiki API path that Cloudflare blocks → every MetaBattle source errored; (3) distiller had no guidance to ignore boilerplate and name specs.

**Tech Stack:** Electron main (`BrowserWindow.webContents.executeJavaScript`), TS, vitest.

---

### Task 1: Render-wait extraction in the fetch engine

**Files:** Modify `src/main/meta/fetcher.ts` (no unit test — Electron-only; manual smoke).

The fix: after load, run a single in-page async script that polls the target selector until its text is substantial (or a wait cap), then extract and truncate. This handles both SPA (waits for hydration) and server-rendered pages (returns immediately).

- [ ] **Step 1: implement.** In `src/main/meta/fetcher.ts`, add constants near `FETCH_TIMEOUT_MS`:
```ts
const CONTENT_WAIT_MS = 12_000 // max in-page wait for SPA content to render
const MIN_CONTENT_CHARS = 400 // consider the page "rendered" past this much text
const MAX_EXTRACT_CHARS = 8_000 // cap the excerpt handed to the distiller
```

Replace the browser branch of `fetchOne` (the part after `if (cfg.kind === 'wiki') return fetchWiki(url, cfg)`) with:
```ts
    const win = this.window()
    const selector = cfg.selector ?? 'body'
    try {
      const load = win.loadURL(url)
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)
      )
      await Promise.race([load, timeout])
      // Wait IN-PAGE for content to populate (SPA hydration), then extract.
      const script = `new Promise((resolve) => {
        const sel = ${JSON.stringify(selector)};
        const start = Date.now();
        const tick = () => {
          const el = document.querySelector(sel) || document.body;
          const txt = el && el.innerText ? el.innerText : '';
          if (txt.length >= ${MIN_CONTENT_CHARS} || Date.now() - start > ${CONTENT_WAIT_MS}) resolve(txt);
          else setTimeout(tick, 500);
        };
        tick();
      })`
      const text = (await win.webContents.executeJavaScript(script)) as string
      const trimmed = (text ?? '').trim().slice(0, MAX_EXTRACT_CHARS)
      return trimmed ? { ok: true, text: trimmed } : { ok: false, error: 'empty' }
    } catch (e) {
      try {
        if (this.win && !this.win.isDestroyed()) this.win.webContents.stop()
      } catch {
        /* ignore */
      }
      return { ok: false, error: e instanceof Error ? e.message : 'browser: failed' }
    }
```
(Keep the existing `fetch`/window/destroy and the wiki path unchanged.)

- [ ] **Step 2: typecheck + sanity** `npm run typecheck` PASS; `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2` still 3 PASS (wiki path untouched).
- [ ] **Step 3: commit**
```bash
git add src/main/meta/fetcher.ts
git commit -m "fix(meta): wait for in-page content to render before extracting"
```

---

### Task 2: Route MetaBattle through the browser

**Files:** Modify `src/main/meta/sources.ts`; Test `src/main/meta/sources.test.ts`

MetaBattle's api.php is Cloudflare-blocked, but its category pages are server-rendered and load fine in Chromium. Switch it to a browser source targeting the MediaWiki content container.

- [ ] **Step 1: update the test.** In `src/main/meta/sources.test.ts`, change the metabattle expectation from wiki to browser. Replace the test `'matches metabattle to a wiki config'` with:
```ts
  it('matches metabattle to a browser config with the wiki content selector', () => {
    const c = configForUrl('https://metabattle.com/wiki/Category:WvW_Zerg_Builds')
    expect(c?.kind).toBe('browser')
    expect(c?.selector).toBe('#mw-content-text')
  })
```
The `'every config is well-formed for its kind'` test already asserts browser configs have a selector — leave it.

- [ ] **Step 2: run, expect FAIL:** `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`

- [ ] **Step 3: implement.** In `src/main/meta/sources.ts`, change the metabattle entry in `SOURCE_CONFIGS` from:
```ts
  { host: 'metabattle.com', kind: 'wiki', wikiApi: 'https://metabattle.com/api.php' }
```
to:
```ts
  { host: 'metabattle.com', kind: 'browser', selector: '#mw-content-text' }
```
Leave the `SourceConfig` interface and the `'wiki'` kind in place (still a valid capability; `fetchWiki` remains available even though no seeded source uses it now).

- [ ] **Step 4: run, expect PASS:** `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
- [ ] **Step 5: commit**
```bash
git add src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "fix(meta): fetch MetaBattle via browser (api.php is Cloudflare-blocked)"
```

---

### Task 3: Tighten the distiller prompt

**Files:** Modify `src/main/meta/distill.ts`; Test `src/main/meta/distill.test.ts`

Guide the model to ignore site boilerplate and name the actual meta specs/builds.

- [ ] **Step 1: update the test.** In `src/main/meta/distill.test.ts`, the first test asserts the prompt contains the mode + raws — keep it. Add a new assertion test:
```ts
  it('instructs the model to ignore navigation boilerplate and name specs', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ['raw'], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('ignore')
    expect(prompt.toLowerCase()).toContain('elite spec')
  })
```

- [ ] **Step 2: run, expect FAIL:** `npx vitest run src/main/meta/distill.test.ts --maxWorkers=2`

- [ ] **Step 3: implement.** In `src/main/meta/distill.ts`, replace the `prompt` assignment with:
```ts
  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} meta from community sources.\n` +
    `The excerpts are raw page text and contain navigation menus, ads, and headings — ` +
    `IGNORE that boilerplate. Extract the meta builds: name the profession and ELITE SPEC ` +
    `for each, its role (e.g. heal/quickness, power DPS, condi DPS, boon support), and any ` +
    `tier/rating if present. Group by role or tier. Be specific and concise; state only what ` +
    `the excerpts support and do not invent traits or gear. No preamble.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`
```
(Leave the empty-raw and empty-output null-returning behavior unchanged.)

- [ ] **Step 4: run, expect PASS (all distill tests):** `npx vitest run src/main/meta/distill.test.ts --maxWorkers=2`
- [ ] **Step 5: commit**
```bash
git add src/main/meta/distill.ts src/main/meta/distill.test.ts
git commit -m "feat(meta): sharpen distiller prompt (ignore boilerplate, name specs/tiers)"
```

---

### Task 4: Full verification

- [ ] `npx vitest run --maxWorkers=2` → PASS.
- [ ] `npm run typecheck` → PASS.
- [ ] `npm run build` → PASS.
- [ ] Manual smoke: `npm run dev`, open Meta (nav 07). Force a refresh by clearing staleness if needed (delete `~/.config/axivale/meta.json`'s `refreshedAt`s, or just relaunch after 7 days isn't practical — instead temporarily confirm via a fresh meta.json). Confirm: MetaBattle sources now go `ok` (not error); summaries name actual specs/builds per role (not "navigation and headers"); console stays quiet.

NOTE for the tester (controller): to force an immediate refresh for the smoke test without waiting 7 days, the simplest path is to delete `~/.config/axivale/meta.json` so it reseeds with `refreshedAt: null` (all stale) on next launch.

---

## Self-Review

**Coverage:** SPA-too-early → Task 1 (in-page render wait). MetaBattle blocked → Task 2 (browser + `#mw-content-text`). Thin summaries → Tasks 1+3 (real content + sharper prompt). Truncation/cost → Task 1 (`MAX_EXTRACT_CHARS`).
**Placeholders:** none.
**Type consistency:** `fetchOne` still returns `FetchResult`; `SourceConfig`/`configForUrl` unchanged in shape (only the metabattle data row changes kind→browser + selector). `fetchWiki` + `'wiki'` kind retained (no dead-type removal). Distiller signature unchanged.
**Deferred:** depth-1 crawl of individual build pages (full trait/gear detail) — only if single-page proves too thin after a real run.
