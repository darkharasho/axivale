# GW2 Meta Fetch (Auto-Knowledge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AxiVale silently keeps its GW2 meta knowledge current by fetching configured sources in the background, distilling them into per-mode summary notes, and storing them so every turn's system prompt is biased toward the current meta.

**Architecture:** A main-process pipeline — scheduler → orchestrator → fetch engine (hidden Electron `BrowserWindow` for SPAs, MediaWiki API for MetaBattle) → background Haiku distiller → `MetaStore`. Each unit sits behind an injected interface so the orchestrator is fully unit-testable with fakes; only the real-Chromium adapter is excluded from unit tests.

**Tech Stack:** Electron main process, TypeScript, Node `fetch`, `@anthropic-ai/claude-agent-sdk` `query()`, vitest, React (read-only panel).

**Spec:** `docs/superpowers/specs/2026-06-14-gw2-meta-fetch-design.md`

---

## File Structure

- Create `src/main/meta/sources.ts` — source registry (`SourceConfig`) + `configForUrl`.
- Create `src/main/meta/cache.ts` — `RawCache` interface + `MetaCache` (disk excerpt cache).
- Create `src/main/meta/distill.ts` — `MetaModel` type + `distill()` (pure, injected model).
- Create `src/main/meta/fetcher.ts` — `MetaFetcher` interface, tested `fetchWiki()`, untested `BrowserWindowFetcher`.
- Create `src/main/meta/model.ts` — `runClaudeOnce()` thin one-shot SDK call (untested).
- Create `src/main/meta/refresh.ts` — `MetaRefresher` orchestrator.
- Modify `src/main/metaStore.ts` — extend types, migration backfill, `recordFetch`/`recordDistill`.
- Modify `src/main/index.ts` — construct + schedule the refresher; destroy the window on quit.
- Modify `src/preload/index.d.ts` — extend `RendererMetaSource`/`RendererMetaMode`.
- Rewrite `src/renderer/src/components/panels/Meta.tsx` — read-only status dashboard.
- Rewrite `src/renderer/src/components/panels/Meta.test.tsx`.
- Modify `src/renderer/src/theme.css` — `.meta-chip` / summary styles.

Run tests with `npx vitest run --maxWorkers=2` (per machine memory limits).

---

### Task 1: MetaStore provenance + writers + migration

**Files:**
- Modify: `src/main/metaStore.ts`
- Test: `src/main/metaStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/main/metaStore.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'metastore-')), 'meta.json')
}

describe('MetaStore provenance', () => {
  it('seeds sources with never-fetched provenance', () => {
    const s = new MetaStore(tmpPath())
    const src = s.list()[0].sources[0]
    expect(src.status).toBe('never')
    expect(src.fetchedAt).toBeNull()
    expect(src.error).toBeNull()
    expect(s.list()[0].refreshedAt).toBeNull()
  })

  it('backfills provenance on legacy files missing the fields', () => {
    const p = tmpPath()
    writeFileSync(
      p,
      JSON.stringify({
        modes: [
          {
            id: 'a',
            mode: 'WvW',
            sources: [{ label: 'MB', url: 'https://metabattle.com' }],
            notes: 'old',
            updatedAt: ''
          }
        ]
      })
    )
    const s = new MetaStore(p)
    const m = s.list()[0]
    expect(m.refreshedAt).toBeNull()
    expect(m.sources[0].status).toBe('never')
    expect(m.sources[0].fetchedAt).toBeNull()
    expect(m.sources[0].error).toBeNull()
    expect(m.notes).toBe('old')
  })

  it('recordFetch sets ok status + timestamp, clears error', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    const url = m.sources[0].url
    s.recordFetch(m.id, url, { ok: true })
    const after = s.get(m.id)!.sources[0]
    expect(after.status).toBe('ok')
    expect(after.fetchedAt).toBeTruthy()
    expect(after.error).toBeNull()
  })

  it('recordFetch sets error status + message', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    s.recordFetch(m.id, m.sources[0].url, { ok: false, error: 'timeout' })
    const after = s.get(m.id)!.sources[0]
    expect(after.status).toBe('error')
    expect(after.error).toBe('timeout')
  })

  it('recordDistill sets notes + refreshedAt', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    s.recordDistill(m.id, 'current meta is X')
    const after = s.get(m.id)!
    expect(after.notes).toBe('current meta is X')
    expect(after.refreshedAt).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: FAIL — `status`/`recordFetch`/`recordDistill` do not exist.

- [ ] **Step 3: Implement**

In `src/main/metaStore.ts`, replace the `MetaSource`/`MetaMode` interfaces and add provenance handling:

```ts
export interface MetaSource {
  label: string
  url: string
  status: 'ok' | 'error' | 'never'
  fetchedAt: string | null
  error: string | null
}
export interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string
  refreshedAt: string | null
  updatedAt: string
}

export type MetaModeSeed = { mode: string; sources: Array<{ label: string; url: string }> } & Partial<
  Pick<MetaMode, 'notes'>
>
```

Update `makeMode` to stamp provenance and `refreshedAt`:

```ts
private makeMode(seed: { mode: string; sources: Array<{ label: string; url: string }>; notes?: string }): MetaMode {
  return {
    id: randomUUID(),
    mode: seed.mode,
    sources: seed.sources.map((s) => ({
      label: s.label,
      url: s.url,
      status: 'never' as const,
      fetchedAt: null,
      error: null
    })),
    notes: seed.notes ?? '',
    refreshedAt: null,
    updatedAt: new Date().toISOString()
  }
}
```

Add a `normalize` step and call it from `read()`:

```ts
private read(): FileShape {
  if (!existsSync(this.path)) return { modes: [] }
  try {
    const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
    const modes = Array.isArray(parsed.modes) ? parsed.modes : []
    return { modes: modes.map((m) => this.normalize(m)) }
  } catch {
    return { modes: [] }
  }
}

private normalize(m: MetaMode): MetaMode {
  return {
    ...m,
    refreshedAt: m.refreshedAt ?? null,
    sources: (m.sources ?? []).map((s) => ({
      label: s.label,
      url: s.url,
      status: s.status ?? 'never',
      fetchedAt: s.fetchedAt ?? null,
      error: s.error ?? null
    }))
  }
}
```

In `updateMode`, the `sources` patch arrives as bare `{label,url}` from the existing IPC; normalize it so provenance fields are never dropped:

```ts
if (patch.sources !== undefined)
  mode.sources = patch.sources.map((s) => {
    const prev = mode.sources.find((p) => p.url === s.url)
    return {
      label: s.label,
      url: s.url,
      status: prev?.status ?? 'never',
      fetchedAt: prev?.fetchedAt ?? null,
      error: prev?.error ?? null
    }
  })
```

Add the two writers before `removeMode`:

```ts
recordFetch(modeId: string, url: string, result: { ok: true } | { ok: false; error: string }): void {
  const mode = this.get(modeId)
  if (!mode) return
  const src = mode.sources.find((s) => s.url === url)
  if (!src) return
  src.status = result.ok ? 'ok' : 'error'
  src.error = result.ok ? null : result.error
  src.fetchedAt = new Date().toISOString()
  mode.updatedAt = new Date().toISOString()
  this.scheduleWrite()
}

recordDistill(modeId: string, notes: string): void {
  const mode = this.get(modeId)
  if (!mode) return
  mode.notes = notes
  mode.refreshedAt = new Date().toISOString()
  mode.updatedAt = new Date().toISOString()
  this.scheduleWrite()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: PASS (including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/metaStore.ts src/main/metaStore.test.ts
git commit -m "feat(meta): store source provenance + recordFetch/recordDistill + migration"
```

---

### Task 2: Raw excerpt cache

**Files:**
- Create: `src/main/meta/cache.ts`
- Test: `src/main/meta/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/cache.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaCache } from './cache'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'metacache-'))
}

describe('MetaCache', () => {
  it('round-trips text by url', () => {
    const c = new MetaCache(dir())
    c.put('https://snowcrows.com', 'hello meta')
    expect(c.get('https://snowcrows.com')).toBe('hello meta')
  })

  it('returns null for a missing url', () => {
    expect(new MetaCache(dir()).get('https://nope.com')).toBeNull()
  })

  it('overwrites on re-put', () => {
    const c = new MetaCache(dir())
    c.put('https://x.com', 'a')
    c.put('https://x.com', 'b')
    expect(c.get('https://x.com')).toBe('b')
  })

  it('tolerates a corrupt cache file', () => {
    const d = dir()
    const c = new MetaCache(d)
    c.put('https://x.com', 'a')
    const f = readdirSync(d)[0]
    writeFileSync(join(d, f), '{not json')
    expect(c.get('https://x.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/meta/cache.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./cache`.

- [ ] **Step 3: Implement**

```ts
// src/main/meta/cache.ts
//
// Disk cache of cleaned raw source excerpts, keyed by URL hash. One JSON file
// per source under userData/meta-cache/. Atomic tmp+rename, corrupt-tolerant.
// The distiller reads these; the panel never shows them.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export interface RawCache {
  put(url: string, text: string): void
  get(url: string): string | null
}

interface Entry {
  url: string
  text: string
  at: string
}

export class MetaCache implements RawCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private path(url: string): string {
    return join(this.dir, createHash('sha1').update(url).digest('hex') + '.json')
  }

  put(url: string, text: string): void {
    const target = this.path(url)
    const tmp = `${target}.tmp`
    const body: Entry = { url, text, at: new Date().toISOString() }
    writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 })
    renameSync(tmp, target)
  }

  get(url: string): string | null {
    const target = this.path(url)
    if (!existsSync(target)) return null
    try {
      return (JSON.parse(readFileSync(target, 'utf8')) as Entry).text
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/meta/cache.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/cache.ts src/main/meta/cache.test.ts
git commit -m "feat(meta): disk cache for raw source excerpts"
```

---

### Task 3: Source registry

**Files:**
- Create: `src/main/meta/sources.ts`
- Test: `src/main/meta/sources.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/sources.test.ts
import { describe, it, expect } from 'vitest'
import { SOURCE_CONFIGS, configForUrl } from './sources'

describe('source registry', () => {
  it('every config is well-formed for its kind', () => {
    for (const c of SOURCE_CONFIGS) {
      expect(c.host).toBeTruthy()
      if (c.kind === 'browser') expect(c.selector).toBeTruthy()
      if (c.kind === 'wiki') expect(c.wikiApi).toBeTruthy()
    }
  })

  it('matches snowcrows to a browser config', () => {
    expect(configForUrl('https://snowcrows.com/builds')?.kind).toBe('browser')
  })

  it('matches metabattle to a wiki config', () => {
    expect(configForUrl('https://metabattle.com/wiki/Category:WvW_Zerg_Builds')?.kind).toBe('wiki')
  })

  it('ignores a leading www', () => {
    expect(configForUrl('https://www.guildjen.com/x')?.kind).toBe('browser')
  })

  it('returns null for an unknown host', () => {
    expect(configForUrl('https://example.com')).toBeNull()
  })

  it('returns null for a malformed url', () => {
    expect(configForUrl('not a url')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./sources`.

- [ ] **Step 3: Implement**

```ts
// src/main/meta/sources.ts
//
// The ONLY place site-specific scrape knowledge lives. Per known host: how to
// fetch (real browser vs MediaWiki API) and, for browser sources, which DOM
// node holds the content. A source URL with no config is skipped (not errored).

export interface SourceConfig {
  /** host suffix matched against the source URL's host (www. stripped) */
  host: string
  kind: 'browser' | 'wiki'
  /** required for kind==='browser': element whose innerText we extract */
  selector?: string
  /** required for kind==='wiki': MediaWiki api.php base; page title is parsed from the URL */
  wikiApi?: string
}

export const SOURCE_CONFIGS: SourceConfig[] = [
  { host: 'snowcrows.com', kind: 'browser', selector: 'main' },
  { host: 'hardstuck.gg', kind: 'browser', selector: 'main' },
  { host: 'guildjen.com', kind: 'browser', selector: 'main' },
  { host: 'gw2mists.com', kind: 'browser', selector: 'body' },
  { host: 'metabattle.com', kind: 'wiki', wikiApi: 'https://metabattle.com/api.php' }
]

export function configForUrl(url: string): SourceConfig | null {
  let host: string
  try {
    host = new URL(url).host.replace(/^www\./, '')
  } catch {
    return null
  }
  return SOURCE_CONFIGS.find((c) => host === c.host || host.endsWith(`.${c.host}`)) ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "feat(meta): source registry (browser vs wiki extractors)"
```

---

### Task 4: Distiller

**Files:**
- Create: `src/main/meta/distill.ts`
- Test: `src/main/meta/distill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/distill.test.ts
import { describe, it, expect, vi } from 'vitest'
import { distill } from './distill'

describe('distill', () => {
  it('passes mode + raw text to the model and returns the trimmed summary', async () => {
    const model = vi.fn().mockResolvedValue('  Scourge + Firebrand core.  ')
    const out = await distill('WvW', ['raw one', 'raw two'], model)
    expect(out).toBe('Scourge + Firebrand core.')
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('WvW')
    expect(prompt).toContain('raw one')
    expect(prompt).toContain('raw two')
  })

  it('returns null without calling the model when there is no raw text', async () => {
    const model = vi.fn()
    expect(await distill('PvE', ['', '   '], model)).toBeNull()
    expect(model).not.toHaveBeenCalled()
  })

  it('returns null when the model yields an empty string', async () => {
    expect(await distill('PvE', ['raw'], vi.fn().mockResolvedValue('   '))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/meta/distill.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./distill`.

- [ ] **Step 3: Implement**

```ts
// src/main/meta/distill.ts
//
// Compresses raw source excerpts for one game mode into a tight current-meta
// summary via a single cheap Claude call. Pure: the model is injected so it is
// fully testable, and so a missing/failed model simply yields null (the caller
// then leaves the previous notes intact — knowledge never regresses).

export type MetaModel = (prompt: string) => Promise<string>

export async function distill(
  modeName: string,
  rawTexts: string[],
  model: MetaModel
): Promise<string | null> {
  const joined = rawTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
  if (!joined) return null

  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} meta from community sources.\n` +
    `Write a tight summary (a few sentences, or short bullets) of the builds, professions, ` +
    `and comp staples that are currently meta for ${modeName}. State only what the excerpts ` +
    `support; do not invent specifics. No preamble.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/meta/distill.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/distill.ts src/main/meta/distill.test.ts
git commit -m "feat(meta): distiller (raw excerpts -> summary via injected model)"
```

---

### Task 5: Fetch engine (wiki path tested; browser adapter + model thin)

**Files:**
- Create: `src/main/meta/fetcher.ts`
- Create: `src/main/meta/model.ts`
- Test: `src/main/meta/fetcher.test.ts`

- [ ] **Step 1: Write the failing test (wiki path only)**

```ts
// src/main/meta/fetcher.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWiki } from './fetcher'

const cfg = { host: 'metabattle.com', kind: 'wiki' as const, wikiApi: 'https://metabattle.com/api.php' }

afterEach(() => vi.unstubAllGlobals())

describe('fetchWiki', () => {
  it('parses the page title from the url and returns wikitext', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ parse: { wikitext: 'Zerg builds: Scourge, Firebrand' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchWiki('https://metabattle.com/wiki/Category:WvW_Zerg_Builds', cfg)
    expect(r).toEqual({ ok: true, text: 'Zerg builds: Scourge, Firebrand' })
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('https://metabattle.com/api.php')
    expect(calledUrl).toContain('Category%3AWvW_Zerg_Builds')
  })

  it('returns an error result on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const r = await fetchWiki('https://metabattle.com/wiki/Nope', cfg)
    expect(r.ok).toBe(false)
  })

  it('returns an error result when the payload has no wikitext', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const r = await fetchWiki('https://metabattle.com/wiki/Nope', cfg)
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./fetcher`.

- [ ] **Step 3: Implement the fetcher**

```ts
// src/main/meta/fetcher.ts
//
// Fetch engine. SPA sources load in a hidden Electron BrowserWindow (real
// Chromium UA/TLS/cookies + JS execution defeats both client-rendering and
// most bot-blocking); MediaWiki sources hit api.php directly. The wiki path is
// a pure module function (testable with mocked fetch); the BrowserWindow
// adapter is a thin wrapper verified by the manual smoke test.
import { BrowserWindow } from 'electron'
import { configForUrl, type SourceConfig } from './sources'

export type FetchResult = { ok: true; text: string } | { ok: false; error: string }

export interface MetaFetcher {
  fetch(url: string): Promise<FetchResult>
}

const FETCH_TIMEOUT_MS = 20_000

export async function fetchWiki(url: string, cfg: SourceConfig): Promise<FetchResult> {
  let title: string
  try {
    title = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ''))
  } catch {
    return { ok: false, error: 'bad url' }
  }
  const api = `${cfg.wikiApi}?action=parse&prop=wikitext&format=json&formatversion=2&page=${encodeURIComponent(title)}`
  try {
    const res = await fetch(api, { headers: { 'User-Agent': 'AxiVale' } })
    if (!res.ok) return { ok: false, error: `wiki ${res.status}` }
    const data = (await res.json()) as { parse?: { wikitext?: string } }
    const text = data?.parse?.wikitext
    if (!text) return { ok: false, error: 'wiki: no content' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'wiki: network' }
  }
}

/** Real-Chromium fetcher. Not unit-tested (needs Electron); covered by smoke test. */
export class BrowserWindowFetcher implements MetaFetcher {
  private win: BrowserWindow | null = null
  private chain: Promise<unknown> = Promise.resolve()

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
    })
    return this.win
  }

  /** Serialize all fetches through the single window. */
  fetch(url: string): Promise<FetchResult> {
    const run = this.chain.then(() => this.fetchOne(url))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async fetchOne(url: string): Promise<FetchResult> {
    const cfg = configForUrl(url)
    if (!cfg) return { ok: false, error: 'no extractor' }
    if (cfg.kind === 'wiki') return fetchWiki(url, cfg)

    const win = this.window()
    const selector = cfg.selector ?? 'body'
    try {
      const load = win.loadURL(url)
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)
      )
      await Promise.race([load, timeout])
      const text = (await win.webContents.executeJavaScript(
        `(document.querySelector(${JSON.stringify(selector)})||document.body).innerText`
      )) as string
      const trimmed = (text ?? '').trim()
      return trimmed ? { ok: true, text: trimmed } : { ok: false, error: 'empty' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'browser: failed' }
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
```

- [ ] **Step 4: Implement the one-shot model call**

```ts
// src/main/meta/model.ts
//
// One-shot Claude call for the distiller — no tools, cheap model. Reuses the
// app's Claude auth (saved OAuth token or system login via process.env). Any
// failure (incl. no auth) returns '' so the distiller no-ops and notes stay put.
import { query } from '@anthropic-ai/claude-agent-sdk'

export interface MetaModelConfig {
  oauthToken: string | null
  model: string
}

export async function runClaudeOnce(prompt: string, cfg: MetaModelConfig): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env }
  if (cfg.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = cfg.oauthToken
  try {
    let out = ''
    const q = query({ prompt, options: { model: cfg.model, env, allowedTools: [] } })
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') out += block.text
        }
      }
    }
    return out
  } catch {
    return ''
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2`
Expected: PASS. (The `electron` import resolves under vitest because only `fetchWiki` is exercised; `BrowserWindowFetcher` is never constructed in the test.)

If the bare `electron` import fails to resolve in the test environment, confirm by running the full main suite; if it is a problem, the import is only needed by the class — but do not change the approach without checking, since other main-process files import `electron` directly (e.g. `src/main/index.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/main/meta/fetcher.ts src/main/meta/model.ts src/main/meta/fetcher.test.ts
git commit -m "feat(meta): fetch engine (BrowserWindow + wiki api) and one-shot model call"
```

---

### Task 6: Orchestrator

**Files:**
- Create: `src/main/meta/refresh.ts`
- Test: `src/main/meta/refresh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/refresh.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from '../metaStore'
import { MetaRefresher } from './refresh'
import type { RawCache } from './cache'
import type { MetaFetcher, FetchResult } from './fetcher'

function store(): MetaStore {
  return new MetaStore(join(mkdtempSync(join(tmpdir(), 'refresh-')), 'meta.json'))
}
function fakeCache(): RawCache & { puts: Record<string, string> } {
  const puts: Record<string, string> = {}
  return { puts, put: (u, t) => void (puts[u] = t), get: (u) => puts[u] ?? null }
}
function fetcher(map: Record<string, FetchResult>): MetaFetcher {
  return { fetch: vi.fn(async (url: string) => map[url] ?? { ok: false, error: 'unconfigured' }) }
}
const DAY = 86_400_000

describe('MetaRefresher', () => {
  it('skips modes refreshed within the stale window', async () => {
    const s = store()
    const m = s.list()[0]
    s.recordDistill(m.id, 'fresh notes') // refreshedAt = now
    const f = fetcher({})
    await new MetaRefresher({
      store: s,
      fetcher: f,
      cache: fakeCache(),
      model: vi.fn(),
      now: () => Date.now(),
      staleMs: 7 * DAY
    }).refreshStale()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(s.get(m.id)!.notes).toBe('fresh notes')
  })

  it('fetches, caches, and distills a stale mode; records provenance', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'PvE')! // PvE: single snowcrows source
    const url = m.sources[0].url
    const cache = fakeCache()
    const model = vi.fn().mockResolvedValue('distilled pve meta')
    await new MetaRefresher({
      store: s,
      fetcher: fetcher({ [url]: { ok: true, text: 'raw pve' } }),
      cache,
      model,
      now: () => Date.now()
    }).refreshStale()
    expect(cache.puts[url]).toBe('raw pve')
    const after = s.get(m.id)!
    expect(after.sources[0].status).toBe('ok')
    expect(after.notes).toBe('distilled pve meta')
    expect(after.refreshedAt).toBeTruthy()
  })

  it('isolates a failing source: keeps siblings, marks error, still distills', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'WvW')! // 3 sources incl. 2 metabattle/gw2mists/hardstuck
    const [a, b] = m.sources
    const model = vi.fn().mockResolvedValue('partial meta')
    await new MetaRefresher({
      store: s,
      fetcher: fetcher({
        [a.url]: { ok: true, text: 'good' },
        [b.url]: { ok: false, error: 'timeout' }
      }),
      cache: fakeCache(),
      model,
      now: () => Date.now()
    }).refreshStale()
    const after = s.get(m.id)!
    expect(after.sources[0].status).toBe('ok')
    expect(after.sources[1].status).toBe('error')
    expect(after.sources[1].error).toBe('timeout')
    expect(model.mock.calls[0][0]).toContain('good')
    expect(after.notes).toBe('partial meta')
  })

  it('no-auth path: records fetches but leaves notes intact when the model is empty', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'PvE')!
    const url = m.sources[0].url
    await new MetaRefresher({
      store: s,
      fetcher: fetcher({ [url]: { ok: true, text: 'raw' } }),
      cache: fakeCache(),
      model: vi.fn().mockResolvedValue(''),
      now: () => Date.now()
    }).refreshStale()
    const after = s.get(m.id)!
    expect(after.sources[0].status).toBe('ok')
    expect(after.notes).toBe('') // untouched
    expect(after.refreshedAt).toBeNull()
  })

  it('keeps old notes when every source fails (never calls the model)', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'PvE')!
    s.recordDistill(m.id, 'old but valid') // also makes it fresh, so backdate:
    // force stale by using a huge staleMs=0 path: instead use now far in the future
    const model = vi.fn()
    await new MetaRefresher({
      store: s,
      fetcher: fetcher({ [m.sources[0].url]: { ok: false, error: 'down' } }),
      cache: fakeCache(),
      model,
      now: () => Date.now() + 365 * DAY, // everything is stale
      staleMs: 7 * DAY
    }).refreshStale()
    expect(model).not.toHaveBeenCalled()
    expect(s.get(m.id)!.notes).toBe('old but valid')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./refresh`.

- [ ] **Step 3: Implement**

```ts
// src/main/meta/refresh.ts
//
// Orchestrates a background meta refresh: for each STALE mode, fetch each
// configured source, cache the raw text + record provenance, then distill the
// gathered raw into summary notes. Error-isolated — a failed source never wipes
// good notes, and a mode with zero successful sources is left untouched.
import type { MetaStore, MetaMode } from '../metaStore'
import type { MetaFetcher } from './fetcher'
import type { RawCache } from './cache'
import { distill, type MetaModel } from './distill'
import { configForUrl } from './sources'

const SEVEN_DAYS_MS = 7 * 86_400_000

export interface RefresherDeps {
  store: MetaStore
  fetcher: MetaFetcher
  cache: RawCache
  model: MetaModel
  now: () => number
  staleMs?: number
}

function isStale(mode: MetaMode, now: number, staleMs: number): boolean {
  if (!mode.refreshedAt) return true
  return now - Date.parse(mode.refreshedAt) > staleMs
}

export class MetaRefresher {
  constructor(private readonly deps: RefresherDeps) {}

  async refreshStale(): Promise<void> {
    const { store, fetcher, cache, model, now } = this.deps
    const staleMs = this.deps.staleMs ?? SEVEN_DAYS_MS
    for (const mode of store.list()) {
      if (!isStale(mode, now(), staleMs)) continue
      const raws: string[] = []
      for (const src of mode.sources) {
        if (!configForUrl(src.url)) continue // unknown host: leave status as-is
        const r = await fetcher.fetch(src.url)
        store.recordFetch(mode.id, src.url, r.ok ? { ok: true } : { ok: false, error: r.error })
        if (r.ok) {
          cache.put(src.url, r.text)
          raws.push(r.text)
        }
      }
      if (raws.length === 0) continue // keep previous notes
      const notes = await distill(mode.mode, raws, model)
      if (notes) store.recordDistill(mode.id, notes)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/refresh.ts src/main/meta/refresh.test.ts
git commit -m "feat(meta): refresh orchestrator (stale-only, error-isolated)"
```

---

### Task 7: Wire into the main process + extend preload types

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Extend the renderer types**

In `src/preload/index.d.ts`, replace the two meta interfaces:

```ts
export interface RendererMetaSource {
  label: string
  url: string
  status: 'ok' | 'error' | 'never'
  fetchedAt: string | null
  error: string | null
}
export interface RendererMetaMode {
  id: string
  mode: string
  sources: RendererMetaSource[]
  notes: string
  refreshedAt: string | null
  updatedAt: string
}
```

- [ ] **Step 2: Construct + schedule the refresher**

In `src/main/index.ts`, add imports near the other meta import (line ~40):

```ts
import { MetaCache } from './meta/cache'
import { BrowserWindowFetcher } from './meta/fetcher'
import { MetaRefresher } from './meta/refresh'
import { runClaudeOnce } from './meta/model'
```

After `const meta = new MetaStore(...)` (line ~173), add:

```ts
const metaCache = new MetaCache(join(app.getPath('userData'), 'meta-cache'))
const metaFetcher = new BrowserWindowFetcher()
const metaRefresher = new MetaRefresher({
  store: meta,
  fetcher: metaFetcher,
  cache: metaCache,
  model: (prompt) =>
    runClaudeOnce(prompt, {
      oauthToken: store.getSecret('claudeOauthToken'),
      model: 'claude-haiku-4-5-20251001'
    }),
  now: Date.now
})
let metaTimer: ReturnType<typeof setInterval> | null = null
```

Inside the `app.whenReady().then(async () => { ... })` block, after `createWindow(store)` (line ~699), kick off the background refresh and a periodic re-check (never blocks startup):

```ts
  setTimeout(() => void metaRefresher.refreshStale(), 5_000)
  metaTimer = setInterval(() => void metaRefresher.refreshStale(), 6 * 60 * 60 * 1000)
```

In the `before-quit` handler (line ~219), release the timer and window:

```ts
  if (metaTimer) clearInterval(metaTimer)
  metaFetcher.destroy()
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (node + web projects).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.d.ts
git commit -m "feat(meta): construct + schedule background refresher; extend renderer types"
```

---

### Task 8: Read-only Meta panel + styles

**Files:**
- Rewrite: `src/renderer/src/components/panels/Meta.tsx`
- Rewrite: `src/renderer/src/components/panels/Meta.test.tsx`
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: Rewrite the test**

```tsx
// @vitest-environment jsdom
// src/renderer/src/components/panels/Meta.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Meta from './Meta'

function officer() {
  return {
    metaList: () =>
      Promise.resolve([
        {
          id: '1',
          mode: 'WvW',
          notes: 'Scourge + Firebrand core.',
          refreshedAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '',
          sources: [
            { label: 'MetaBattle', url: 'https://metabattle.com', status: 'ok', fetchedAt: '2026-06-10T00:00:00.000Z', error: null },
            { label: 'Hardstuck', url: 'https://hardstuck.gg', status: 'error', fetchedAt: null, error: 'timeout' },
            { label: 'gw2mists', url: 'https://gw2mists.com', status: 'never', fetchedAt: null, error: null }
          ]
        }
      ])
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Meta panel (read-only)', () => {
  it('renders the distilled summary and source chips', async () => {
    render(<Meta />)
    expect(await screen.findByText('WvW')).toBeTruthy()
    expect(screen.getByText('Scourge + Firebrand core.')).toBeTruthy()
    expect(screen.getByText('MetaBattle')).toBeTruthy()
    // status chips by label text
    expect(screen.getByText('ok')).toBeTruthy()
    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByText('never')).toBeTruthy()
  })

  it('has no editor — no textbox and no save button', async () => {
    render(<Meta />)
    await screen.findByText('WvW')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/components/panels/Meta.test.tsx --maxWorkers=2`
Expected: FAIL — current panel renders a textbox/save button.

- [ ] **Step 3: Rewrite the panel**

```tsx
// src/renderer/src/components/panels/Meta.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return 'never'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `updated ${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `updated ${hrs}h ago`
  return 'updated just now'
}

export default function Meta(): ReactElement {
  const [modes, setModes] = useState<RendererMetaMode[]>([])

  useEffect(() => {
    void window.officer.metaList().then(setModes)
  }, [])

  return (
    <div className="settings meta-panel">
      <div className="sgroup">
        <p className="shelp">
          AxiVale keeps its own read of the current meta per game mode, refreshed
          automatically from these sources in the background. It uses this to bias
          build and comp advice. Nothing to edit — this is what it currently knows.
        </p>
      </div>
      {modes.length === 0 ? (
        <div className="panel-empty">No meta modes.</div>
      ) : (
        modes.map((m) => (
          <div className="sgroup meta-mode" key={m.id}>
            <h2>
              {m.mode} <span className="meta-fresh">{ago(m.refreshedAt)}</span>
            </h2>
            <p className="meta-summary">{m.notes || 'No summary yet — awaiting first refresh.'}</p>
            <div className="meta-sources">
              {m.sources.map((s) => (
                <span className="meta-srcrow" key={s.url}>
                  <a className="meta-src" href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                  <span className={`meta-chip ${s.status}`} title={s.error ?? undefined}>
                    {s.status}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add styles**

Append to `src/renderer/src/theme.css`:

```css
.meta-summary {
  margin: 6px 0 10px;
  color: var(--ink);
  white-space: pre-wrap;
}
.meta-fresh {
  font-size: 11px;
  font-weight: 400;
  color: var(--ink);
  opacity: 0.55;
}
.meta-srcrow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: 12px;
}
.meta-chip {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border: 1px solid var(--rule2);
  border-radius: 2px;
  opacity: 0.75;
}
.meta-chip.ok {
  color: #2c7a3f;
  border-color: #2c7a3f;
}
.meta-chip.error {
  color: #a33;
  border-color: #a33;
}
.meta-chip.never {
  opacity: 0.4;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/components/panels/Meta.test.tsx --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/panels/Meta.tsx src/renderer/src/components/panels/Meta.test.tsx src/renderer/src/theme.css
git commit -m "feat(meta): read-only status panel with freshness + source chips"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS — all files green (prior 442 + the new meta tests).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (node + web).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test (report to user; do not automate)**

Launch the app, open Meta (nav 07). Confirm: modes show source chips (`never` initially), a background refresh fills in summaries + flips chips to `ok`/`error` with timestamps, and asking the agent "what's the current WvW zerg meta?" reflects the distilled notes. Note any source that fails to scrape (its selector in `sources.ts` may need adjusting).

---

## Self-Review

**Spec coverage:**
- Hidden BrowserWindow engine + wiki API → Task 5. ✔
- Source registry (site knowledge in one place) → Task 3. ✔
- Background distiller (Haiku, injected, graceful) → Tasks 4, 5 (model), 7 (wiring). ✔
- Orchestrator (stale-only, error-isolated, no-auth) → Task 6. ✔
- Scheduler (on-launch-if-stale + interval, non-blocking) → Task 7. ✔
- Data model (provenance fields, raw not in meta.json, migration) → Tasks 1, 2. ✔
- Read-only panel (summary, freshness, chips, no editor) → Task 8. ✔
- Testing strategy (5 new test files + 2 updated) → cache, sources, distill, fetcher(wiki), refresh new; metaStore, Meta.test rewritten. ✔
- v1 = notes only, structured builds deferred → no task adds structured extraction. ✔

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `MetaSource`/`MetaMode` (status/fetchedAt/error/refreshedAt) defined in Task 1 and mirrored in preload (Task 7) and the panel mock (Task 8). `FetchResult`/`MetaFetcher` (Task 5) consumed by `MetaRefresher` (Task 6). `RawCache` defined in Task 2, consumed in Task 6. `MetaModel` defined in Task 4, produced by `runClaudeOnce` wiring in Task 7. `recordFetch`/`recordDistill` signatures match between Task 1 and Task 6 call sites.
