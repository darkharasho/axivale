# Sources Tab + Wiki/General Recall Corpora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Meta tab into a Sources tab grouped as meta / wiki / general, expand the wiki corpus to holistic coverage with a live fallback, and add a new general-guides corpus — all reachable by the chat assistant via model-callable retrieval tools.

**Architecture:** Three LanceDB-backed corpora (`meta_chunks`, `wiki_chunks`, `general_chunks`) each exposed as a `*_search` tool the model chooses to call. A single `corpusForUrl()` routing function decides which corpus a fetched page lands in. The existing `MetaRefresher` crawl loop is extended to route pages per-corpus and to drive a new "General" source group; the existing `WikiRefIngester` gets more crawl targets plus a query-time live-fetch fallback. The Sources tab renders the three groups from store data.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, LanceDB (`@lancedb/lancedb`), Anthropic Claude Agent SDK (`tool()`), Zod, Vitest.

## Global Constraints

- Vitest parallelism: run with `--pool=forks --poolOptions.forks.maxForks=2` (machine memory limit).
- New chunks reuse the existing `MetaIndex`/`LanceMetaIndex` interface and `chunkPage()` — do not invent a parallel storage format.
- Tool results go into model context: keep them compact (reuse `safe()` + `ok()`), no pretty-print.
- Error isolation is mandatory in all ingest/crawl loops: one failed source/page never aborts the run and never wipes good data (match existing `try/catch` + `continue` patterns).
- `group` values are exactly `'meta' | 'wiki' | 'general'`. Corpus values are exactly `'meta' | 'wiki' | 'general'`.
- Backward compatibility: existing `meta.json` files lack `group`; normalize missing `group` to `'meta'`.

---

## File Structure

**New files:**
- `src/main/meta/corpus.ts` — `Corpus` type + `corpusForUrl(url)` routing (the single source of truth for page→corpus).
- `src/main/tools/generalSearch.ts` — `general_search` tool builder.
- `src/main/meta/wiki/liveSearch.ts` — query-time MediaWiki search + page fetch for the wiki fallback.
- Test files alongside (see each task).

**Modified files:**
- `src/main/metaStore.ts` — `group` on `MetaSource`; seed/normalize/reconcile carry it; new "General" seed mode.
- `src/main/meta/sources.ts` — configs for general guide hosts (Discretize, guide paths).
- `src/main/meta/refresh.ts` — route ingested pages per-corpus via `corpusForUrl`.
- `src/main/meta/wiki/refPages.ts` — add legendary/mastery/mechanics registry pages.
- `src/main/meta/wiki/ingest.ts` — add legendary/achievement/mastery crawl targets to `DEFAULT_CRAWL_TARGETS`.
- `src/main/tools/gw2WikiSearch.ts` — broaden description; add live fallback when index returns nothing.
- `src/main/tools/shared.ts` — `generalIndex` on `ToolDeps`.
- `src/main/tools/index.ts` — wire `buildGeneralSearchTools`.
- `src/main/agent.ts` — system-prompt guidance for the three groups; add `general_search` to `LOCAL_TOOL_ALLOWLIST`.
- `src/main/index.ts` — construct `generalIndex`, pass to refresher + tool deps, IPC for general index, wire wiki live-search dep.
- `src/preload/index.ts`, `src/preload/index.d.ts` — `group` on `RendererMetaSource`; `general:*` index passthroughs.
- `src/renderer/src/components/meta/MetaNav.tsx` — header "Sources"; group sections.
- `src/renderer/src/components/meta/Meta.tsx` — group the Sources card by `group`.
- `src/renderer/src/App.tsx` — `SECTION_TITLES['meta']` → "Sources".

---

## Task 1: Corpus routing function

**Files:**
- Create: `src/main/meta/corpus.ts`
- Test: `src/main/meta/corpus.test.ts`

**Interfaces:**
- Produces: `export type Corpus = 'meta' | 'wiki' | 'general'` and `export function corpusForUrl(url: string): Corpus`.

Routing rules (host with `www.` stripped):
- `wiki.guildwars2.com` → `'wiki'`.
- `discretize.eu` / `next.discretize.eu` → `'general'`.
- any host with a path segment `/guides/` or `/guide/` → `'general'` (covers Snowcrows `/guides/`, GuildJen, Hardstuck guides).
- everything else (build pages, tier lists) → `'meta'`.
- unparseable URL → `'meta'` (safe default; build corpus is the historical default).

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/meta/corpus.test.ts
import { describe, it, expect } from 'vitest'
import { corpusForUrl } from './corpus'

describe('corpusForUrl', () => {
  it('routes the GW2 wiki to wiki', () => {
    expect(corpusForUrl('https://wiki.guildwars2.com/wiki/Twilight')).toBe('wiki')
  })
  it('routes Discretize (both subdomains) to general', () => {
    expect(corpusForUrl('https://discretize.eu/guides/')).toBe('general')
    expect(corpusForUrl('https://next.discretize.eu/fractals/')).toBe('general')
  })
  it('routes /guides/ paths to general regardless of host', () => {
    expect(corpusForUrl('https://snowcrows.com/guides/wvw/wvw-basics')).toBe('general')
    expect(corpusForUrl('https://hardstuck.gg/gw2/guides/something')).toBe('general')
  })
  it('routes build pages to meta', () => {
    expect(corpusForUrl('https://snowcrows.com/builds/raids')).toBe('meta')
    expect(corpusForUrl('https://metabattle.com/wiki/Raid_Builds')).toBe('meta')
    expect(corpusForUrl('https://guildjen.com/gw2-raid-builds/')).toBe('meta')
  })
  it('defaults unparseable input to meta', () => {
    expect(corpusForUrl('not a url')).toBe('meta')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/corpus.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — cannot find module `./corpus`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/meta/corpus.ts
//
// The single source of truth for which retrieval corpus a fetched page belongs
// to. Used by the refresher to route each crawled page's chunks into meta_chunks,
// wiki_chunks, or general_chunks. Path-based so one host can split builds vs guides.

export type Corpus = 'meta' | 'wiki' | 'general'

export function corpusForUrl(url: string): Corpus {
  let host: string
  let path: string
  try {
    const u = new URL(url)
    host = u.host.replace(/^www\./, '')
    path = u.pathname
  } catch {
    return 'meta'
  }
  if (host === 'wiki.guildwars2.com') return 'wiki'
  if (host === 'discretize.eu' || host.endsWith('.discretize.eu')) return 'general'
  if (/\/guides?\//.test(path)) return 'general'
  return 'meta'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/corpus.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/corpus.ts src/main/meta/corpus.test.ts
git commit -m "feat(meta): add corpusForUrl routing (meta/wiki/general)"
```

---

## Task 2: `group` field on MetaSource + General seed mode

**Files:**
- Modify: `src/main/metaStore.ts`
- Test: `src/main/metaStore.test.ts` (add cases; create file if absent)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MetaSource` gains `group: 'meta' | 'wiki' | 'general'`. `SeedShape.sources[]` entries gain optional `group?`. New `DEFAULT_SEED` entry `mode: 'General'`. `makeMode`, `normalize`, `reconcile`, `updateMode` all carry `group` (default `'meta'`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/metaStore.test.ts  (add these; keep existing tests if file exists)
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from './metaStore'

const dirs: string[] = []
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'meta-'))
  dirs.push(d)
  return join(d, 'meta.json')
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('MetaStore groups', () => {
  it('seeds a General mode whose sources are group=general', () => {
    const store = new MetaStore(tmpFile())
    const general = store.list().find((m) => m.mode === 'General')
    expect(general).toBeTruthy()
    expect(general!.sources.length).toBeGreaterThan(0)
    expect(general!.sources.every((s) => s.group === 'general')).toBe(true)
  })

  it('tags WvW GW2-wiki sources as group=wiki and build sources as group=meta', () => {
    const store = new MetaStore(tmpFile())
    const wvw = store.list().find((m) => m.mode === 'WvW')!
    const wikiSrc = wvw.sources.find((s) => s.url.includes('wiki.guildwars2.com'))!
    const buildSrc = wvw.sources.find((s) => s.url.includes('metabattle.com'))!
    expect(wikiSrc.group).toBe('wiki')
    expect(buildSrc.group).toBe('meta')
  })

  it('normalizes a legacy source with no group to meta', () => {
    const path = tmpFile()
    writeFileSync(path, JSON.stringify({
      modes: [{
        id: 'x', mode: 'PvE',
        sources: [{ label: 'L', url: 'https://snowcrows.com/builds/raids', status: 'ok', fetchedAt: null, error: null }],
        notes: '', playbook: {}, refreshedAt: null, updatedAt: 'now'
      }]
    }))
    const store = new MetaStore(path)
    const pve = store.list().find((m) => m.mode === 'PvE')!
    expect(pve.sources[0].group).toBe('meta')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/metaStore.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `group` undefined / no `General` mode.

- [ ] **Step 3: Write minimal implementation**

In `src/main/metaStore.ts`:

Add `group` to the interface:

```typescript
export interface MetaSource {
  label: string
  url: string
  group: 'meta' | 'wiki' | 'general'
  status: 'ok' | 'error' | 'never'
  fetchedAt: string | null
  error: string | null
}
```

Extend the seed shape:

```typescript
type SeedShape = {
  mode: string
  sources: Array<{ label: string; url: string; group?: 'meta' | 'wiki' | 'general' }>
  notes?: string
  playbook?: { principles?: string; blessed?: boolean }
}
```

Tag existing WvW wiki sources and add the General seed mode. Replace the two GW2-Wiki lines in the `WvW` seed with `group: 'wiki'`, e.g.:

```typescript
      { label: 'GW2 Wiki (Squad)', url: 'https://wiki.guildwars2.com/wiki/Squad', group: 'wiki' },
      { label: 'GW2 Wiki (Boon)', url: 'https://wiki.guildwars2.com/wiki/Boon', group: 'wiki' },
```

Add a new entry to `DEFAULT_SEED` after `WvW Roaming`:

```typescript
  ,{
    mode: 'General',
    sources: [
      { label: 'Snowcrows (Guides)', url: 'https://snowcrows.com/guides', group: 'general' },
      { label: 'GuildJen (Guides)', url: 'https://guildjen.com/category/guides/', group: 'general' },
      { label: 'Hardstuck (Guides)', url: 'https://hardstuck.gg/gw2/guides/', group: 'general' },
      { label: 'Discretize (Fractals)', url: 'https://next.discretize.eu/fractals/', group: 'general' },
      { label: 'Discretize (Guides)', url: 'https://next.discretize.eu/guides/', group: 'general' }
    ]
  }
```

Carry `group` everywhere a source object is built. In `makeMode`:

```typescript
      sources: seed.sources.map((s) => ({
        label: s.label,
        url: s.url,
        group: s.group ?? 'meta',
        status: 'never' as const,
        fetchedAt: null,
        error: null
      })),
```

In `normalize` (per source): add `group: s.group ?? 'meta',`.

In `reconcile`, both branches must set `group`:

```typescript
      const synced: MetaSource[] = seed.sources.map((s) => {
        const prev = existing.sources.find((p) => p.url === s.url)
        const group = s.group ?? 'meta'
        return prev
          ? { ...prev, label: s.label, group }
          : { label: s.label, url: s.url, group, status: 'never', fetchedAt: null, error: null }
      })
```

In `updateMode`'s source mapping, preserve/default group:

```typescript
        return {
          label: s.label,
          url: s.url,
          group: prev?.group ?? 'meta',
          status: prev?.status ?? 'never',
          fetchedAt: prev?.fetchedAt ?? null,
          error: prev?.error ?? null
        }
```

(Note: `updateMode`/`addMode` seed inputs come from IPC `{label,url}` only; group defaults to meta there — acceptable, the seed file is authoritative for grouping.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/metaStore.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/metaStore.ts src/main/metaStore.test.ts
git commit -m "feat(meta): add source group field and General seed mode"
```

---

## Task 3: Source configs for general guide hosts

**Files:**
- Modify: `src/main/meta/sources.ts`
- Test: `src/main/meta/sources.test.ts` (add cases; create if absent)

**Interfaces:**
- Consumes: existing `SourceConfig`, `configForUrl`.
- Produces: `configForUrl` resolves Discretize and the new guide-index seed URLs so the refresher will crawl them (a source with no config is silently skipped today).

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/meta/sources.test.ts  (add)
import { describe, it, expect } from 'vitest'
import { configForUrl } from './sources'

describe('configForUrl general sources', () => {
  it('resolves Discretize', () => {
    expect(configForUrl('https://next.discretize.eu/fractals/')).not.toBeNull()
  })
  it('resolves the Snowcrows guides index', () => {
    expect(configForUrl('https://snowcrows.com/guides')).not.toBeNull()
  })
  it('resolves Hardstuck guides', () => {
    expect(configForUrl('https://hardstuck.gg/gw2/guides/')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/sources.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — Discretize returns null.

- [ ] **Step 3: Write minimal implementation**

Add to `SOURCE_CONFIGS` in `src/main/meta/sources.ts` (hardstuck.gg/guildjen.com/snowcrows.com hosts already match; add Discretize and confirm guide crawling works via existing host entries). Add:

```typescript
  // Discretize [dT] — fractal/CM, mechanics, and profession guides (general corpus).
  { host: 'discretize.eu', kind: 'browser', selector: 'main, article', linkSelector: 'a[href*="/fractals/"], a[href*="/guides/"]', crawlDepth: 2 },
```

The existing `snowcrows.com`, `hardstuck.gg`, and `guildjen.com` host entries already match their guide URLs, so `configForUrl` resolves them. (Page→corpus split is handled by `corpusForUrl` in Task 4, not here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/sources.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "feat(meta): add Discretize source config for general guides"
```

---

## Task 4: Route ingested pages per-corpus in the refresher

**Files:**
- Modify: `src/main/meta/refresh.ts`
- Test: `src/main/meta/refresh.test.ts` (add a routing case; create if absent)

**Interfaces:**
- Consumes: `corpusForUrl` (Task 1), `MetaIndex`.
- Produces: `RefresherDeps` gains `wikiIndex?: MetaIndex` and `generalIndex?: MetaIndex`. `ingest()` routes each page to the index for `corpusForUrl(page.url)`, falling back to the meta `index` when the matching corpus index is not provided.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/meta/refresh.test.ts  (add)
import { describe, it, expect } from 'vitest'
import { MetaRefresher } from './refresh'
import type { MetaIndex } from './rag/index'

function fakeIndex(): MetaIndex & { pages: string[] } {
  const pages: string[] = []
  return {
    pages,
    indexedHash: async () => null,
    replacePage: async (url) => { pages.push(url) },
    search: async () => [],
    stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
    sample: async () => []
  } as MetaIndex & { pages: string[] }
}

describe('MetaRefresher corpus routing', () => {
  it('routes guide pages to generalIndex and build pages to meta index', async () => {
    const metaIdx = fakeIndex()
    const generalIdx = fakeIndex()
    const r = new MetaRefresher({
      // minimal deps; only ingest() is exercised here
      store: {} as never, fetcher: {} as never, cache: {} as never,
      model: (async () => null) as never, now: () => 0,
      index: metaIdx, generalIndex: generalIdx
    })
    // @ts-expect-error exercise private ingest directly
    await r.ingest('PvE', 'https://snowcrows.com/guides', [
      { url: 'https://snowcrows.com/guides/fractals/cm', title: 'CM', text: 'a'.repeat(400) },
      { url: 'https://snowcrows.com/builds/raids', title: 'Raids', text: 'b'.repeat(400) }
    ])
    expect(generalIdx.pages).toContain('https://snowcrows.com/guides/fractals/cm')
    expect(metaIdx.pages).toContain('https://snowcrows.com/builds/raids')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/refresh.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — all pages go to `metaIdx`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/meta/refresh.ts`, import the router and add deps:

```typescript
import { corpusForUrl, type Corpus } from './corpus'
```

Add to `RefresherDeps`:

```typescript
  index?: MetaIndex
  wikiIndex?: MetaIndex
  generalIndex?: MetaIndex
```

Rewrite `ingest()` to pick the index per page:

```typescript
  private indexFor(corpus: Corpus): MetaIndex | undefined {
    if (corpus === 'wiki') return this.deps.wikiIndex ?? this.deps.index
    if (corpus === 'general') return this.deps.generalIndex ?? this.deps.index
    return this.deps.index
  }

  private async ingest(mode: string, source: string, pages: { url: string; title: string; text: string }[]): Promise<void> {
    const host = ((): string => {
      try { return new URL(source).host.replace(/^www\./, '') } catch { return source }
    })()
    for (const page of pages) {
      const index = this.indexFor(corpusForUrl(page.url))
      if (!index) continue
      try {
        if ((await index.indexedHash(page.url)) === sha1(page.text)) {
          console.log('[meta] skip (unchanged):', page.url)
          continue
        }
        const chunks = chunkPage(page.text, { mode, source: host, url: page.url, title: page.title })
        if (chunks.length > 0) await index.replacePage(page.url, chunks)
        console.log('[meta] indexed', chunks.length, 'chunks:', page.url)
      } catch (e) {
        console.warn('[meta] index failed:', page.url, e)
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/refresh.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/refresh.ts src/main/meta/refresh.test.ts
git commit -m "feat(meta): route refreshed pages per-corpus (meta/wiki/general)"
```

---

## Task 5: general_search tool

**Files:**
- Create: `src/main/tools/generalSearch.ts`
- Test: `src/main/tools/generalSearch.test.ts`
- Modify: `src/main/tools/shared.ts` (add `generalIndex` to `ToolDeps`)
- Modify: `src/main/tools/index.ts` (wire builder)

**Interfaces:**
- Consumes: `MetaIndex`, `safe`, `tool`.
- Produces: `export function buildGeneralSearchTools(generalIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>>` exposing tool name `general_search` with `{ query: string }` (no mode filter — general is topic-keyed).

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/tools/generalSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildGeneralSearchTools } from './generalSearch'
import type { MetaIndex } from '../meta/rag/index'

const idx = (hits: unknown[]): MetaIndex => ({
  indexedHash: async () => null, replacePage: async () => {},
  search: async () => hits as never, stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
  sample: async () => []
}) as MetaIndex

describe('general_search', () => {
  it('returns shaped hits from the general corpus', async () => {
    const tools = buildGeneralSearchTools(() => idx([{ source: 'discretize.eu', url: 'u', title: 't', snippet: 's' }]))
    const t = tools.find((x) => x.name === 'general_search')!
    const res = await t.handler({ query: 'fractal cm' }, {})
    expect(res.content[0].text).toContain('discretize.eu')
  })
  it('reports empty corpus instead of throwing', async () => {
    const tools = buildGeneralSearchTools(() => idx([]))
    const t = tools.find((x) => x.name === 'general_search')!
    const res = await t.handler({ query: 'x' }, {})
    expect(res.content[0].text).toContain('no')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/tools/generalSearch.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/tools/generalSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGeneralSearchTools(generalIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'general_search',
      'Search the indexed GW2 general-guides corpus (Snowcrows guides, GuildJen, Hardstuck, Discretize) for long-form how-to content — boss/encounter and fractal CM strategy, open-world/farming, and "how to get good at X" guides. Use for strategy and approach questions; for exact builds use meta_search, for game mechanics/legendaries/achievements use wiki_search. Returns community-sourced passages with their source URLs; cite and verify, never present as mechanical ground truth.',
      {
        query: z.string().describe('What to look up, e.g. "how to do Sunqua Peak CM mechanics"')
      },
      safe(async ({ query }: { query: string }) => {
        const hits = await generalIndex().search(query, { k: 6 })
        if (hits.length === 0) return { note: 'no indexed general guides yet — the background refresh may not have run' }
        return hits.map((h) => ({ source: h.source, url: h.url, title: h.title, snippet: h.snippet }))
      })
    )
  ]
}
```

In `src/main/tools/shared.ts`, add to `ToolDeps` (after `wikiIndex`):

```typescript
  /** General-guides corpus search (lazy; resolved per-call). */
  generalIndex: () => MetaIndex
```

In `src/main/tools/index.ts`, import and append in `buildOfficerTools`:

```typescript
import { buildGeneralSearchTools } from './generalSearch'
// ...
    ...buildGw2WikiSearchTools(deps.wikiIndex),
    ...buildGeneralSearchTools(deps.generalIndex)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/tools/generalSearch.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/generalSearch.ts src/main/tools/generalSearch.test.ts src/main/tools/shared.ts src/main/tools/index.ts
git commit -m "feat(tools): add general_search retrieval tool"
```

---

## Task 6: Live wiki search fallback helper

**Files:**
- Create: `src/main/meta/wiki/liveSearch.ts`
- Test: `src/main/meta/wiki/liveSearch.test.ts`

**Interfaces:**
- Produces: `export async function liveWikiSearch(query: string, deps: { fetchJson: (url: string) => Promise<any>; getWikitext: (title: string) => Promise<string | null> }, opts?: { limit?: number }): Promise<Array<{ title: string; url: string; snippet: string }>>`.
- Uses the MediaWiki `list=search` API to find top page titles, then compresses each page's wikitext via the existing `cleanWikiText(stripWikiMarkup(...))` path. Pure (deps injected) so it is testable without network.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/meta/wiki/liveSearch.test.ts
import { describe, it, expect } from 'vitest'
import { liveWikiSearch } from './liveSearch'

describe('liveWikiSearch', () => {
  it('searches titles then fetches+cleans each page', async () => {
    const fetchJson = async () => ({ query: { search: [{ title: 'Twilight' }, { title: 'Sunrise' }] } })
    const getWikitext = async (t: string) => `Wikitext body for ${t} that is definitely longer than fifty characters of content.`
    const res = await liveWikiSearch('how to craft twilight', { fetchJson, getWikitext }, { limit: 2 })
    expect(res.map((r) => r.title)).toEqual(['Twilight', 'Sunrise'])
    expect(res[0].url).toBe('https://wiki.guildwars2.com/wiki/Twilight')
    expect(res[0].snippet.length).toBeGreaterThan(0)
  })
  it('skips pages whose wikitext is missing', async () => {
    const fetchJson = async () => ({ query: { search: [{ title: 'Ghost' }] } })
    const getWikitext = async () => null
    const res = await liveWikiSearch('x', { fetchJson, getWikitext })
    expect(res).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/wiki/liveSearch.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/meta/wiki/liveSearch.ts
//
// Query-time fallback for wiki_search: when the pre-ingested index has no good
// hit, search the live GW2 wiki (MediaWiki list=search), fetch the top pages'
// wikitext, and return cleaned snippets. Covers the long tail (legendaries,
// achievements, obscure pages) without pre-ingesting 100k+ pages.
import { stripWikiMarkup } from '@axiapps/gw2-data'
import { cleanWikiText } from './cleanText'
import { wikiPageUrl } from './ingest'

const API = 'https://wiki.guildwars2.com/api.php'

export interface LiveWikiDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchJson: (url: string) => Promise<any>
  getWikitext: (title: string) => Promise<string | null>
}

export async function liveWikiSearch(
  query: string,
  deps: LiveWikiDeps,
  opts: { limit?: number } = {}
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const limit = opts.limit ?? 3
  const searchUrl =
    `${API}?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`
  let titles: string[]
  try {
    const json = await deps.fetchJson(searchUrl)
    titles = (json?.query?.search ?? []).map((s: { title: string }) => s.title)
  } catch {
    return []
  }
  const out: Array<{ title: string; url: string; snippet: string }> = []
  for (const title of titles) {
    try {
      const raw = await deps.getWikitext(title)
      if (!raw) continue
      const text = cleanWikiText(stripWikiMarkup(raw))
      if (!text || text.trim().length < 50) continue
      out.push({ title, url: wikiPageUrl(title), snippet: text.slice(0, 600) })
    } catch {
      /* one page failing never breaks the fallback */
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/wiki/liveSearch.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/wiki/liveSearch.ts src/main/meta/wiki/liveSearch.test.ts
git commit -m "feat(wiki): add live MediaWiki search fallback helper"
```

---

## Task 7: Wire live fallback into wiki_search and broaden it

**Files:**
- Modify: `src/main/tools/gw2WikiSearch.ts`
- Test: `src/main/tools/gw2WikiSearch.test.ts` (create if absent)

**Interfaces:**
- Consumes: `liveWikiSearch` (Task 6), `MetaIndex`.
- Produces: `buildGw2WikiSearchTools(wikiIndex, liveSearch?)` — same tool name `gw2_wiki_search`, broadened description; when the index returns 0 hits and `liveSearch` is provided, fall back to it. Signature: `liveSearch?: (query: string) => Promise<Array<{ title: string; url: string; snippet: string }>>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/tools/gw2WikiSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildGw2WikiSearchTools } from './gw2WikiSearch'
import type { MetaIndex } from '../meta/rag/index'

const idx = (hits: unknown[]): MetaIndex => ({
  indexedHash: async () => null, replacePage: async () => {},
  search: async () => hits as never, stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
  sample: async () => []
}) as MetaIndex

describe('gw2_wiki_search fallback', () => {
  it('falls back to live search when the index is empty', async () => {
    const live = async () => [{ title: 'Twilight', url: 'https://wiki.guildwars2.com/wiki/Twilight', snippet: 'craft' }]
    const tools = buildGw2WikiSearchTools(() => idx([]), live)
    const t = tools.find((x) => x.name === 'gw2_wiki_search')!
    const res = await t.handler({ query: 'how to craft twilight' }, {})
    expect(res.content[0].text).toContain('Twilight')
  })
  it('uses index hits when present (no fallback)', async () => {
    let called = false
    const live = async () => { called = true; return [] }
    const tools = buildGw2WikiSearchTools(() => idx([{ source: 'wiki', url: 'u', title: 'Boon', snippet: 's' }]), live)
    const t = tools.find((x) => x.name === 'gw2_wiki_search')!
    await t.handler({ query: 'boon duration' }, {})
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/tools/gw2WikiSearch.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — builder takes one arg; no fallback.

- [ ] **Step 3: Write minimal implementation**

Replace `src/main/tools/gw2WikiSearch.ts` body:

```typescript
// src/main/tools/gw2WikiSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

type LiveSearch = (query: string) => Promise<Array<{ title: string; url: string; snippet: string }>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2WikiSearchTools(wikiIndex: () => MetaIndex, liveSearch?: LiveSearch): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_wiki_search',
      'Search the indexed GW2 wiki for game knowledge — mechanics and concepts (attributes/boons/conditions/combos/armor/upgrades), profession skills/traits, AND broader content like legendary crafting, achievements, collections, and masteries (e.g. "how do I make Twilight", "what do I need for this achievement"). Use for "how does X work" and "how do I get/make X" questions; for a SPECIFIC skill or trait\'s exact numbers and WvW/PvP splits use gw2_wiki_facts; for builds use meta_search; for long-form strategy guides use general_search. If nothing is pre-indexed, this falls back to a live wiki lookup. Optional category: classes, specializations, stats, armor, weapons, upgrades, boons-conditions, mechanics, skills, traits, legendaries, achievements, masteries.',
      {
        query: z.string().describe('What to look up, e.g. "how to craft the legendary Twilight"'),
        category: z.string().optional().describe('Optional category filter')
      },
      safe(async ({ query, category }: { query: string; category?: string }) => {
        const hits = await wikiIndex().search(query, { mode: category, k: 6 })
        if (hits.length > 0) return hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
        if (liveSearch) {
          const live = await liveSearch(query)
          if (live.length > 0) return live
        }
        return { note: 'no wiki match indexed or found live' }
      })
    )
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/tools/gw2WikiSearch.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/gw2WikiSearch.ts src/main/tools/gw2WikiSearch.test.ts
git commit -m "feat(wiki): broaden gw2_wiki_search + live fallback"
```

---

## Task 8: Expand wiki pre-ingest coverage (registry + crawl targets)

**Files:**
- Modify: `src/main/meta/wiki/refPages.ts`
- Modify: `src/main/meta/wiki/ingest.ts`
- Test: `src/main/meta/wiki/refPages.test.ts` (create if absent)

**Interfaces:**
- Consumes: existing `WIKI_REF_PAGES`, `DEFAULT_CRAWL_TARGETS`, `CrawlTarget`.
- Produces: new registry pages (legendary overview, mastery, key mechanics) and new crawl targets for legendary weapons/armor/trinkets, masteries, and a bounded achievements set.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/meta/wiki/refPages.test.ts
import { describe, it, expect } from 'vitest'
import { WIKI_REF_PAGES } from './refPages'
import { DEFAULT_CRAWL_TARGETS } from './ingest'

describe('expanded wiki coverage', () => {
  it('includes legendary + mastery registry pages', () => {
    const titles = WIKI_REF_PAGES.map((p) => p.title)
    expect(titles).toContain('Legendary weapon')
    expect(titles).toContain('Mastery')
  })
  it('crawls legendary and mastery categories', () => {
    const cats = DEFAULT_CRAWL_TARGETS.map((t) => t.category)
    expect(cats).toContain('Legendary weapons')
    expect(cats).toContain('Masteries')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/wiki/refPages.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — pages/targets absent.

- [ ] **Step 3: Write minimal implementation**

Append to `WIKI_REF_PAGES` in `src/main/meta/wiki/refPages.ts`:

```typescript
  ,{ category: 'legendaries', title: 'Legendary weapon' },
  { category: 'legendaries', title: 'Legendary armor' },
  { category: 'legendaries', title: 'Legendary trinket' },
  { category: 'legendaries', title: 'Gift of Maguuma Mastery' },
  { category: 'masteries', title: 'Mastery' },
  { category: 'masteries', title: 'Mastery point' },
  { category: 'achievements', title: 'Achievement' },
  { category: 'achievements', title: 'Collections' }
```

Append to `DEFAULT_CRAWL_TARGETS` in `src/main/meta/wiki/ingest.ts`:

```typescript
  ,{ category: 'Legendary weapons', label: 'legendaries' },
  { category: 'Legendary armor', label: 'legendaries' },
  { category: 'Legendary trinkets', label: 'legendaries' },
  { category: 'Masteries', label: 'masteries' }
```

(Achievements are intentionally NOT added as a full crawl target — there are tens of thousands; the registry pages above plus the Task 6/7 live fallback cover specific achievement questions. This bound is deliberate; see spec "Open implementation details".)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/wiki/refPages.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/wiki/refPages.ts src/main/meta/wiki/ingest.ts src/main/meta/wiki/refPages.test.ts
git commit -m "feat(wiki): expand pre-ingest to legendaries and masteries"
```

---

## Task 9: Main-process wiring (generalIndex, refresher deps, IPC, prompt)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/agent.ts`

**Interfaces:**
- Consumes: `LanceMetaIndex`, `MetaRefresher` (now corpus-aware), `buildGeneralSearchTools` (via toolDeps), `liveWikiSearch`, `WikiClient`.
- Produces: a `generalIndex` instance backed by `general_chunks`; refresher receives `wikiIndex`/`generalIndex`; tool deps receive `generalIndex`; `gw2_wiki_search` wired with a live-search callback; `general:index-*` IPC; `general_search` in the local allowlist.

This task has no isolated unit test (it is app wiring); it is verified by typecheck + the smoke test in Task 11. Keep it one commit.

- [ ] **Step 1: Construct the general index**

In `src/main/index.ts`, after the `wikiIndex` line (~205):

```typescript
  const generalIndex = new LanceMetaIndex(join(app.getPath('userData'), 'general-lance'), metaEmbedder, 'general_chunks')
```

- [ ] **Step 2: Pass corpus indexes to the refresher**

In the `new MetaRefresher({ ... })` deps (~236), add alongside `index: metaIndex,`:

```typescript
    wikiIndex,
    generalIndex,
```

- [ ] **Step 3: Provide generalIndex to tool deps**

In `toolDeps: () => ({ ... })` (~381), after `wikiIndex: () => wikiIndex,`:

```typescript
      generalIndex: () => generalIndex,
```

- [ ] **Step 4: Wire the wiki live-search fallback**

`buildGw2WikiSearchTools` is called inside `buildOfficerTools` (Task 7 changed its signature). Provide the live-search callback by constructing it where tools are built. In `src/main/tools/index.ts`, update the wiki line to pass a live searcher sourced from deps. Add an optional dep `wikiLiveSearch?: (q: string) => Promise<Array<{title:string;url:string;snippet:string}>>` to `ToolDeps` in `shared.ts`, then:

```typescript
    ...buildGw2WikiSearchTools(deps.wikiIndex, deps.wikiLiveSearch),
```

In `src/main/index.ts` toolDeps, add (reusing the existing `WikiClient` import and a `fetch` with the required User-Agent):

```typescript
      wikiLiveSearch: (q: string) => liveWikiSearch(q, {
        fetchJson: (url) => fetch(url, { headers: { 'User-Agent': 'AxiVale/0.4 (https://github.com/darkharasho)' } }).then((r) => r.json()),
        getWikitext: async (title) => (await new WikiClient().getWikitextBatch([title])).get(title) ?? null
      }),
```

Add the import at top of `index.ts`: `import { liveWikiSearch } from './meta/wiki/liveSearch'`.

- [ ] **Step 5: Add general index IPC**

After the `wiki:index-search` handler (~993) in `src/main/index.ts`:

```typescript
  ipcMain.handle('general:index-stats', async () => {
    try { return await generalIndex.stats() } catch { return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null } }
  })
  ipcMain.handle('general:index-sample', async (_e, opts: { mode?: string; limit: number }) => {
    try { return await generalIndex.sample(opts) } catch { return [] }
  })
  ipcMain.handle('general:index-search', async (_e, query: string) => {
    try { return await generalIndex.search(query, { k: 8 }) } catch { return [] }
  })
```

- [ ] **Step 6: System-prompt guidance + local allowlist**

In `src/main/agent.ts`, update the wiki/meta guidance block (~155-156) to add a line for general guides:

```typescript
- For long-form strategy and how-to guides — boss/encounter and fractal CM strategy, open-world/farming approaches, "how to get good at X" — call general_search.
- For broad wiki knowledge — game mechanics, AND legendary crafting, achievements, collections, masteries — call gw2_wiki_search (it falls back to a live wiki lookup when nothing is pre-indexed).
```

Add `'general_search'` to `LOCAL_TOOL_ALLOWLIST` (~178) right after `'gw2_wiki_search',`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit -p tsconfig.json` if no script).
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts src/main/agent.ts src/main/tools/index.ts src/main/tools/shared.ts
git commit -m "feat(main): wire general corpus, wiki live fallback, and prompt guidance"
```

---

## Task 10: Sources tab UI (rename + grouped rail + grouped sources card)

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/meta/MetaNav.tsx`
- Modify: `src/renderer/src/components/meta/Meta.tsx`
- Modify: `src/preload/index.d.ts` (add `group` to `RendererMetaSource`)

**Interfaces:**
- Consumes: `RendererMetaMode`/`RendererMetaSource` (now with `group`).
- Produces: rail header reads "Sources"; section title reads "Sources"; the per-mode Sources card renders chips grouped under meta/wiki/general subheaders.

This task is verified by the Task 11 in-app smoke test (renderer has no unit harness here). One commit.

- [ ] **Step 1: Add `group` to the renderer source type**

In `src/preload/index.d.ts`, add to `RendererMetaSource` (~26):

```typescript
  group: 'meta' | 'wiki' | 'general'
```

- [ ] **Step 2: Rename the section title**

In `src/renderer/src/App.tsx`, change `SECTION_TITLES['meta']` value from `'Meta'` to `'Sources'` (search `SECTION_TITLES`).

- [ ] **Step 3: Rail header → "Sources"**

In `src/renderer/src/components/meta/MetaNav.tsx`, change `<div className="snav-h">Meta</div>` to `<div className="snav-h">Sources</div>`.

- [ ] **Step 4: Group the Sources card by group**

In `src/renderer/src/components/meta/Meta.tsx`, replace the `<Card title="Sources">` body's flat map with a grouped render:

```tsx
        <Card title="Sources">
          {(['meta', 'wiki', 'general'] as const).map((g) => {
            const srcs = m.sources.filter((s) => s.group === g)
            if (srcs.length === 0) return null
            return (
              <div key={g} className="meta-srcgroup">
                <div className="meta-srcgroup-h">{g}</div>
                <div className="meta-srcs">
                  {srcs.map((s) => {
                    const isFetching = fetching[m.id] === s.url
                    const cls = isFetching ? 'fetching' : s.status
                    return (
                      <a key={s.url} className={`meta-srcchip ${cls}`} href={s.url} target="_blank" rel="noreferrer" title={s.error ?? undefined}>
                        <span className="led" />
                        {s.label}
                        {isFetching ? ' · fetching…' : ''}
                      </a>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </Card>
```

- [ ] **Step 5: Typecheck + run the app**

Run: `npm run typecheck` — expect no errors.
Then build/launch per Task 11.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/meta/MetaNav.tsx src/renderer/src/components/meta/Meta.tsx src/preload/index.d.ts
git commit -m "feat(ui): rename Meta tab to Sources and group sources by corpus"
```

---

## Task 11: Full verification (typecheck, tests, in-app smoke)

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`
Expected: all green, including the new corpus/store/refresh/tool/wiki tests.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Launch the app and smoke-test the Sources tab**

Run: `npm run dev`
Verify in-app:
- The left-rail header reads "Sources"; the folio title reads "Sources".
- The rail lists modes including the new "General" entry.
- Opening WvW shows the Sources card with `meta` / `wiki` / `general` subheaders and chips under each.
- Dev "Force re-crawl" runs without errors; status LEDs update.

- [ ] **Step 4: Smoke-test recall routing in chat**

Ask the assistant three questions and confirm the right tool fires (watch tool calls / logs):
- "How do I make Twilight?" → `gw2_wiki_search` (index hit or live fallback).
- "Best condi virtuoso raid build?" → `meta_search`.
- "How do I approach Sunqua Peak CM?" → `general_search`.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test: verify Sources tab and three-corpus recall"
```

---

## Self-Review notes

- **Spec coverage:** Routing-by-tools (existing pattern, extended in Tasks 5/7/9); wiki hybrid pre-ingest + live fallback (Tasks 6/7/8); general corpus + sources + no-double-ingest (Tasks 1/3/4/5); Sources tab UI grouping (Task 10); data-model `group` + `general_chunks` + `SourceConfig` (Tasks 2/3/9). Discretize included; Phoenix Uprising deferred (easy config add).
- **Deliberate bounds (logged, not silent):** achievements are not a full crawl target (Task 8 note) — covered by registry pages + live fallback.
- **Type consistency:** `Corpus`/`group` values identical across store, routing, refresher, and UI; `MetaIndex` reused unchanged for all three corpora.
