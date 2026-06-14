# Meta RAG (Sub-project 1: Corpus + Hybrid Retrieval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable corpus of the crawled meta-site content (builds + tradeoff prose), hybrid-indexed in LanceDB with local embeddings, exposed as a `meta_search` tool the AI calls for depth beyond the always-on summaries.

**Architecture:** The existing background meta refresh additionally ingests each crawled page (content-hash gate → chunk → embed → LanceDB upsert). A `MetaIndex` wraps LanceDB (native hybrid FTS+vector) and owns a `transformers.js` WASM embedder. A `meta_search` officer tool queries it. Native pieces (LanceDB, embedder) sit behind interfaces; everything else is unit-tested with fakes.

**Tech Stack:** Electron main, TypeScript, `@lancedb/lancedb`, `@xenova/transformers` (WASM, all-MiniLM-L6-v2, 384-dim), vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-meta-rag-retrieval-design.md`

---

## File Structure

- Modify `src/main/meta/fetcher.ts` — `FetchResult` carries per-page `pages[]`; `loadAndExtract` returns `{title,text}`.
- Create `src/main/meta/rag/chunk.ts` — pure chunker (+ test).
- Create `src/main/meta/rag/embedder.ts` — `Embedder` interface + `TransformersEmbedder` (real, smoke-tested).
- Create `src/main/meta/rag/index.ts` — `MetaIndex` interface + `LanceMetaIndex` (real, smoke-tested); owns the embedder.
- Modify `src/main/meta/refresh.ts` — optional `index` dep; ingest pages after fetch (+ test).
- Create `src/main/tools/metaSearch.ts` — `meta_search` tool (+ test).
- Modify `src/main/tools/shared.ts` + `src/main/tools/index.ts` — `ToolDeps.metaIndex` + register the tool.
- Modify `src/main/index.ts` — construct embedder + index, inject into refresher + toolDeps.
- Modify `src/main/agent.ts` — `meta_search` prompt guidance.
- Modify `package.json` + `electron-builder.yml` (or equivalent) — deps + `asarUnpack` for the LanceDB native binary.

Run tests with `npx vitest run <path> --maxWorkers=2` (machine memory limit; never exceed 2).

---

### Task 1: Fetcher returns per-page documents

**Files:**
- Modify: `src/main/meta/fetcher.ts`
- Test: `src/main/meta/fetcher.test.ts`

- [ ] **Step 1: Update the failing tests.** In `src/main/meta/fetcher.test.ts`, the three `fetchWiki` tests assert the success result equals `{ ok: true, text: ... }`. Update the success-case assertion to also expect a single-page `pages` array. Replace the `'parses the page title…'` test's assertion block:

```ts
    const r = await fetchWiki('https://metabattle.com/wiki/Category:WvW_Zerg_Builds', cfg)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('Zerg builds: Scourge, Firebrand')
      expect(r.pages).toEqual([
        { url: 'https://metabattle.com/wiki/Category:WvW_Zerg_Builds', title: 'Category:WvW_Zerg_Builds', text: 'Zerg builds: Scourge, Firebrand' }
      ])
    }
```
(The two error-case `fetchWiki` tests already only check `r.ok === false` — leave them. The `pickCrawlLinks` tests are unaffected.)

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement.** In `src/main/meta/fetcher.ts`:

Add the page type and extend `FetchResult`:
```ts
export interface FetchedPage {
  url: string
  title: string
  text: string
}
export type FetchResult =
  | { ok: true; text: string; pages: FetchedPage[] }
  | { ok: false; error: string }
```

Update `fetchWiki` to return a single page (derive a title from the wiki page path):
```ts
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
    return { ok: true, text, pages: [{ url, title, text }] }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'wiki: network' }
  }
}
```

Change `loadAndExtract` to return title + text. Replace the current method with:
```ts
  /** Load a URL, wait in-page for content to render, return its title + trimmed innerText. Throws on load timeout. */
  private async loadAndExtract(url: string, selector: string): Promise<{ title: string; text: string }> {
    const win = this.window()
    const load = win.loadURL(url)
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)
    )
    await Promise.race([load, timeout])
    const script = `new Promise((resolve) => {
      const sel = ${JSON.stringify(selector)};
      const start = Date.now();
      const tick = () => {
        const el = document.querySelector(sel) || document.body;
        const txt = el && el.innerText ? el.innerText : '';
        if (txt.length >= ${MIN_CONTENT_CHARS} || Date.now() - start > ${CONTENT_WAIT_MS})
          resolve({ title: document.title || '', text: txt });
        else setTimeout(tick, 500);
      };
      tick();
    })`
    const out = (await win.webContents.executeJavaScript(script)) as { title: string; text: string }
    return { title: (out?.title ?? '').trim(), text: (out?.text ?? '').trim() }
  }
```

Rewrite the browser branch of `fetchOne` to build `pages[]` and the joined `text`:
```ts
  private async fetchOne(url: string): Promise<FetchResult> {
    const cfg = configForUrl(url)
    if (!cfg) return { ok: false, error: 'no extractor' }
    if (cfg.kind === 'wiki') return fetchWiki(url, cfg)

    const selector = cfg.selector ?? 'body'
    try {
      const landing = await this.loadAndExtract(url, selector)
      const pages: FetchedPage[] = []
      if (landing.text) pages.push({ url, title: landing.title, text: landing.text.slice(0, MAX_EXTRACT_CHARS) })

      if (cfg.linkSelector) {
        const hrefs = await this.collectLinks(cfg.linkSelector)
        const links = pickCrawlLinks(hrefs, url, MAX_CRAWL_PAGES)
        const crawlStart = Date.now()
        for (const link of links) {
          if (Date.now() - crawlStart > CRAWL_BUDGET_MS) break
          try {
            const p = await this.loadAndExtract(link, selector)
            if (p.text) pages.push({ url: link, title: p.title, text: p.text.slice(0, MAX_EXTRACT_CHARS) })
          } catch {
            /* skip a bad sub-page; keep what we have */
          }
        }
      }

      if (pages.length === 0) return { ok: false, error: 'empty' }
      const text = pages.map((p) => p.text).join('\n\n=== build page ===\n\n').slice(0, MAX_CRAWL_TOTAL_CHARS)
      return { ok: true, text, pages }
    } catch (e) {
      try {
        if (this.win && !this.win.isDestroyed()) this.win.webContents.stop()
      } catch {
        /* ignore */
      }
      return { ok: false, error: e instanceof Error ? e.message : 'browser: failed' }
    }
  }
```
(Per-page text is capped at `MAX_EXTRACT_CHARS`; the joined `text` for distill keeps the existing `MAX_CRAWL_TOTAL_CHARS` cap. `collectLinks`, `pickCrawlLinks`, `window`, `fetch`, `destroy` are unchanged.)

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2`
- [ ] **Step 5: typecheck** — `npm run typecheck`. `refresh.ts` reads `r.ok`/`r.text` only, so it still compiles. Fix any fallout in fetcher.ts only.
- [ ] **Step 6: Commit**
```bash
git add src/main/meta/fetcher.ts src/main/meta/fetcher.test.ts
git commit -m "feat(meta): fetcher returns per-page documents for indexing"
```

---

### Task 2: Chunker

**Files:**
- Create: `src/main/meta/rag/chunk.ts`
- Test: `src/main/meta/rag/chunk.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/main/meta/rag/chunk.test.ts
import { describe, it, expect } from 'vitest'
import { chunkPage } from './chunk'

const meta = { mode: 'PvE', source: 'snowcrows.com', url: 'https://snowcrows.com/builds/x', title: 'Power Tempest' }

describe('chunkPage', () => {
  it('returns one chunk for short text, carrying metadata + stable id + contentHash', () => {
    const chunks = chunkPage('A short build note.', meta)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ ...meta, text: 'A short build note.' })
    expect(chunks[0].id).toBe(chunks[0].id) // present
    expect(chunks[0].id.endsWith(':0')).toBe(true)
    expect(chunks[0].contentHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('splits long text into multiple word-bounded chunks with sequential ids', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ')
    const chunks = chunkPage(text, meta)
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((c, i) => expect(c.id.endsWith(`:${i}`)).toBe(true))
    // every chunk well under a hard ceiling
    chunks.forEach((c) => expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(400))
  })

  it('gives every chunk of a page the same contentHash (page-level)', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkPage(text, meta)
    const hashes = new Set(chunks.map((c) => c.contentHash))
    expect(hashes.size).toBe(1)
  })

  it('returns no chunks for blank text', () => {
    expect(chunkPage('   ', meta)).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/rag/chunk.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement**
```ts
// src/main/meta/rag/chunk.ts
//
// Pure chunker: split a page's text into overlapping word-bounded passages,
// each carrying the page metadata, a stable id, and the page-level contentHash
// (so ingestion can skip unchanged pages). No I/O.
import { createHash } from 'crypto'

export interface ChunkMeta {
  mode: string
  source: string
  url: string
  title: string
}
export interface Chunk extends ChunkMeta {
  id: string
  text: string
  contentHash: string
}

const TARGET_WORDS = 320 // ~250–400 word passages
const OVERLAP_WORDS = 30 // ~1 sentence of overlap so a tradeoff isn't sliced

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

export function chunkPage(text: string, meta: ChunkMeta): Chunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const contentHash = sha1(text)
  const urlHash = sha1(meta.url)
  const chunks: Chunk[] = []
  const step = TARGET_WORDS - OVERLAP_WORDS
  for (let start = 0, idx = 0; start < words.length; start += step, idx++) {
    const slice = words.slice(start, start + TARGET_WORDS)
    chunks.push({ ...meta, id: `${urlHash}:${idx}`, text: slice.join(' '), contentHash })
    if (start + TARGET_WORDS >= words.length) break
  }
  return chunks
}
```

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/rag/chunk.test.ts --maxWorkers=2`
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/rag/chunk.ts src/main/meta/rag/chunk.test.ts
git commit -m "feat(meta): pure chunker for rag corpus"
```

---

### Task 3: Embedder (interface + transformers.js impl)

**Files:**
- Create: `src/main/meta/rag/embedder.ts`
- Test: `src/main/meta/rag/embedder.test.ts`

The real embedder needs the model at runtime (no unit test of inference). We test only that the module exports the interface contract and that the impl is constructable without loading the model (lazy). Inference is covered by the manual smoke test.

- [ ] **Step 1: add the dependency**
```bash
npm install @xenova/transformers
```

- [ ] **Step 2: Write the (light) test**
```ts
// src/main/meta/rag/embedder.test.ts
import { describe, it, expect } from 'vitest'
import { TransformersEmbedder } from './embedder'

describe('TransformersEmbedder', () => {
  it('constructs lazily without loading the model', () => {
    // must not throw or download anything at construction time
    const e = new TransformersEmbedder('/tmp/meta-models-test')
    expect(typeof e.embed).toBe('function')
  })
})
```

- [ ] **Step 3: Run, expect FAIL:** `npx vitest run src/main/meta/rag/embedder.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement** (reference impl — adjust to the installed `@xenova/transformers` version's API; the `Embedder` contract is what matters):
```ts
// src/main/meta/rag/embedder.ts
//
// Local sentence embeddings via transformers.js (all-MiniLM-L6-v2, 384-dim).
// Lazy-loaded; the model is cached under userData. Behind the Embedder interface
// so the index/tests can inject a fake. Prefer the WASM backend to avoid a
// native ONNX dependency (LanceDB is the only native dep).
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

export const EMBED_DIM = 384
const MODEL = 'Xenova/all-MiniLM-L6-v2'

export class TransformersEmbedder implements Embedder {
  // typed loosely: the transformers.js pipeline type is dynamic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: any = null

  constructor(private readonly cacheDir: string) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async pipe(): Promise<any> {
    if (this.extractor) return this.extractor
    const { pipeline, env } = await import('@xenova/transformers')
    env.allowLocalModels = false
    env.cacheDir = this.cacheDir
    this.extractor = await pipeline('feature-extraction', MODEL)
    return this.extractor
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const extractor = await this.pipe()
    const out = await extractor(texts, { pooling: 'mean', normalize: true })
    // out is a Tensor; .tolist() yields number[][]
    return out.tolist() as number[][]
  }
}
```
NOTE for the implementer: if `@xenova/transformers` pulls `onnxruntime-node` (native) and it loads cleanly in Electron, that is acceptable (prebuilt, no rebuild). If it causes issues, force the WASM backend per the installed version's docs. Validate during the smoke test; do not block this task on it.

- [ ] **Step 5: Run, expect PASS:** `npx vitest run src/main/meta/rag/embedder.test.ts --maxWorkers=2`
- [ ] **Step 6: Commit**
```bash
git add src/main/meta/rag/embedder.ts src/main/meta/rag/embedder.test.ts package.json package-lock.json
git commit -m "feat(meta): transformers.js embedder (MiniLM, lazy)"
```

---

### Task 4: MetaIndex (LanceDB)

**Files:**
- Create: `src/main/meta/rag/index.ts`
- Test: `src/main/meta/rag/index.test.ts`

The `LanceMetaIndex` talks to native LanceDB + downloads a model via the embedder — not unit-tested. We unit-test only that the `MetaIndex` interface + a `FakeMetaIndex` test helper behave (the fake is reused by later tasks). The real impl is smoke-tested.

- [ ] **Step 1: add the dependency**
```bash
npm install @lancedb/lancedb
```

- [ ] **Step 2: Write the test** (exercises the shared fake the later tasks use):
```ts
// src/main/meta/rag/index.test.ts
import { describe, it, expect } from 'vitest'
import { FakeMetaIndex } from './testFake'

describe('FakeMetaIndex (test double for MetaIndex)', () => {
  it('records replacePage and returns indexedHash', async () => {
    const idx = new FakeMetaIndex()
    await idx.replacePage('u', [
      { id: 'h:0', mode: 'PvE', source: 's', url: 'u', title: 't', text: 'hello', contentHash: 'abc' }
    ])
    expect(await idx.indexedHash('u')).toBe('abc')
    expect(idx.replaced).toEqual(['u'])
  })

  it('search returns canned hits and records the query + mode', async () => {
    const idx = new FakeMetaIndex([{ source: 's', url: 'u', title: 't', snippet: 'snip', score: 1 }])
    const hits = await idx.search('sigils', { mode: 'WvW', k: 6 })
    expect(hits[0].snippet).toBe('snip')
    expect(idx.queries).toEqual([{ query: 'sigils', mode: 'WvW', k: 6 }])
  })
}
)
```

- [ ] **Step 3: Run, expect FAIL:** `npx vitest run src/main/meta/rag/index.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement the interface + fake**
```ts
// src/main/meta/rag/index.ts
//
// MetaIndex: the corpus's hybrid (keyword + semantic) retrieval surface. The real
// impl wraps LanceDB and owns the Embedder (single owner of the model). Behind
// this interface so the orchestrator + tool are tested with a fake; the real
// LanceDB impl is smoke-tested.
import type { Chunk } from './chunk'
import type { Embedder } from './embedder'

export interface MetaSearchHit {
  source: string
  url: string
  title: string
  snippet: string
  score: number
}

export interface MetaIndex {
  /** The contentHash currently indexed for a url, or null if unindexed. */
  indexedHash(url: string): Promise<string | null>
  /** Embed the chunk texts, delete existing rows for the url, then insert. */
  replacePage(url: string, chunks: Chunk[]): Promise<void>
  /** Hybrid search; embeds the query internally. */
  search(queryText: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]>
}
```

```ts
// src/main/meta/rag/testFake.ts
import type { Chunk } from './chunk'
import type { MetaIndex, MetaSearchHit } from './index'

/** In-memory MetaIndex for unit tests. */
export class FakeMetaIndex implements MetaIndex {
  replaced: string[] = []
  queries: Array<{ query: string; mode?: string; k?: number }> = []
  private hashes = new Map<string, string>()
  constructor(private readonly hits: MetaSearchHit[] = []) {}
  async indexedHash(url: string): Promise<string | null> {
    return this.hashes.get(url) ?? null
  }
  async replacePage(url: string, chunks: Chunk[]): Promise<void> {
    this.replaced.push(url)
    if (chunks[0]) this.hashes.set(url, chunks[0].contentHash)
  }
  async search(query: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]> {
    this.queries.push({ query, mode: opts.mode, k: opts.k })
    return this.hits
  }
}
```

- [ ] **Step 5: Run, expect PASS:** `npx vitest run src/main/meta/rag/index.test.ts --maxWorkers=2`

- [ ] **Step 6: Implement the real LanceDB impl** in the same `index.ts` (reference impl — adjust to the installed `@lancedb/lancedb` version's API; the `MetaIndex` contract is fixed):
```ts
import * as lancedb from '@lancedb/lancedb'
import { EMBED_DIM } from './embedder'

const TABLE = 'meta_chunks'

export class LanceMetaIndex implements MetaIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tbl: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null

  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async table(): Promise<any> {
    if (this.tbl) return this.tbl
    this.db = await lancedb.connect(this.dir)
    const names = await this.db.tableNames()
    if (names.includes(TABLE)) {
      this.tbl = await this.db.openTable(TABLE)
    } else {
      // Create with one seed row's shape (LanceDB infers schema from data); a
      // zero-vector placeholder row is immediately deleted to leave it empty.
      const seed = {
        id: '__seed__', mode: '', source: '', url: '__seed__', title: '',
        text: '', contentHash: '', indexedAt: '', vector: new Array(EMBED_DIM).fill(0)
      }
      this.tbl = await this.db.createTable(TABLE, [seed])
      await this.tbl.createIndex('text', { config: lancedb.Index.fts() })
      await this.tbl.delete("url = '__seed__'")
    }
    return this.tbl
  }

  async indexedHash(url: string): Promise<string | null> {
    const tbl = await this.table()
    const rows = await tbl.query().where(`url = ${quote(url)}`).limit(1).toArray()
    return rows[0]?.contentHash ?? null
  }

  async replacePage(url: string, chunks: Chunk[]): Promise<void> {
    const tbl = await this.table()
    await tbl.delete(`url = ${quote(url)}`)
    if (chunks.length === 0) return
    const vectors = await this.embedder.embed(chunks.map((c) => c.text))
    const indexedAt = new Date().toISOString()
    const rows = chunks.map((c, i) => ({
      id: c.id, mode: c.mode, source: c.source, url: c.url, title: c.title,
      text: c.text, contentHash: c.contentHash, indexedAt, vector: vectors[i]
    }))
    await tbl.add(rows)
  }

  async search(queryText: string, opts: { mode?: string; k?: number }): Promise<MetaSearchHit[]> {
    const tbl = await this.table()
    const k = opts.k ?? 6
    const [vector] = await this.embedder.embed([queryText])
    let q = tbl.query().fullTextSearch(queryText).nearestTo(vector).rerank(await lancedb.rerankers.RRFReranker.create())
    if (opts.mode) q = q.where(`mode = ${quote(opts.mode)}`)
    const rows = await q.limit(k).toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({
      source: r.source, url: r.url, title: r.title,
      snippet: String(r.text).slice(0, 600), score: r._relevance_score ?? r._distance ?? 0
    }))
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
```
NOTE for the implementer: the exact LanceDB hybrid/FTS/reranker API names vary by version — consult the installed `@lancedb/lancedb` docs and adapt (`fullTextSearch`/`nearestTo`/`rerank`/`createIndex`/`Index.fts`/`rerankers.RRFReranker`). Keep the `MetaIndex` method signatures and the returned `MetaSearchHit` shape exactly as specified so the tool + tests are unaffected. Do NOT add a unit test for `LanceMetaIndex` (native + model); it is smoke-tested.

- [ ] **Step 7: typecheck** — `npm run typecheck` PASS.
- [ ] **Step 8: Commit**
```bash
git add src/main/meta/rag/index.ts src/main/meta/rag/testFake.ts src/main/meta/rag/index.test.ts package.json package-lock.json
git commit -m "feat(meta): MetaIndex interface + LanceDB impl + test fake"
```

---

### Task 5: Ingestion in the orchestrator

**Files:**
- Modify: `src/main/meta/refresh.ts`
- Test: `src/main/meta/refresh.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/main/meta/refresh.test.ts` (it already imports `MetaStore`, `MetaRefresher`, `fetcher`, `fakeCache`; add the index fake import):
```ts
import { FakeMetaIndex } from './rag/testFake'

describe('MetaRefresher ingestion', () => {
  it('indexes each fetched page via replacePage', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const url = pve.sources[0].url
    const idx = new FakeMetaIndex()
    await new MetaRefresher({
      store: s,
      fetcher: {
        fetch: async () => ({ ok: true, text: 'raw', pages: [{ url: 'https://snowcrows.com/builds/a', title: 'A', text: 'build a detail' }] })
      },
      cache: fakeCache(),
      model: () => Promise.resolve('notes'),
      now: () => Date.now(),
      index: idx
    }).refreshStale()
    expect(idx.replaced).toContain('https://snowcrows.com/builds/a')
    void url
  })

  it('skips replacePage when the page contentHash is unchanged', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const idx = new FakeMetaIndex()
    const page = { url: 'https://snowcrows.com/builds/a', title: 'A', text: 'same text' }
    const deps = {
      store: s,
      fetcher: { fetch: async () => ({ ok: true, text: 'raw', pages: [page] }) },
      cache: fakeCache(),
      model: () => Promise.resolve('notes'),
      now: () => Date.now(),
      index: idx
    }
    await new MetaRefresher(deps).refreshStale()
    // mark PvE stale again, re-run: same text => no second replace
    s.list().forEach((x) => { if (x.mode === 'PvE') (s as unknown as { state: { modes: Array<{ id: string; refreshedAt: string | null }> } }).state.modes.find((m) => m.id === x.id)!.refreshedAt = null })
    await new MetaRefresher(deps).refreshStale()
    expect(idx.replaced.filter((u) => u === page.url)).toHaveLength(1)
  })

  it('isolates an index failure — summaries still update', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const failingIndex = {
      indexedHash: async () => null,
      replacePage: async () => { throw new Error('disk full') },
      search: async () => []
    }
    await new MetaRefresher({
      store: s,
      fetcher: { fetch: async () => ({ ok: true, text: 'raw', pages: [{ url: 'p', title: 't', text: 'x' }] }) },
      cache: fakeCache(),
      model: () => Promise.resolve('distilled'),
      now: () => Date.now(),
      index: failingIndex
    }).refreshStale()
    expect(s.get(pve.id)!.notes).toBe('distilled')
  })
})
```
NOTE: the unchanged-hash test reaches into `store.state` to force staleness without waiting 7 days — acceptable in a white-box unit test. If `MetaStore` doesn't expose `state`, instead construct a fresh `MetaRefresher` with `now: () => Date.now() + 8 * 86_400_000` on the second run to force staleness, and keep the same `FakeMetaIndex` instance across both runs.

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement.** In `src/main/meta/refresh.ts`:

Add imports + the optional dep:
```ts
import type { MetaIndex } from './rag/index'
import { chunkPage, sha1 } from './rag/chunk'
```
Add to `RefresherDeps`:
```ts
  index?: MetaIndex
```
In `refreshStale`, after `cache.put(src.url, r.text)` and `raws.push(r.text)`, ingest the pages. Replace the `if (r.ok) { ... }` block with:
```ts
          if (r.ok) {
            cache.put(src.url, r.text)
            raws.push(r.text)
            await this.ingest(mode.mode, src.url, r.pages)
          }
```
And add a private method (index-aware, error-isolated per page):
```ts
  private async ingest(mode: string, source: string, pages: { url: string; title: string; text: string }[]): Promise<void> {
    const index = this.deps.index
    if (!index) return
    const host = ((): string => {
      try {
        return new URL(source).host.replace(/^www\./, '')
      } catch {
        return source
      }
    })()
    for (const page of pages) {
      try {
        if ((await index.indexedHash(page.url)) === sha1(page.text)) continue
        const chunks = chunkPage(page.text, { mode, source: host, url: page.url, title: page.title })
        if (chunks.length > 0) await index.replacePage(page.url, chunks)
      } catch {
        /* index failure for one page is isolated; never breaks the refresh */
      }
    }
  }
```
(The `source` column is the host of the mode source URL, matching the spec.)

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`
- [ ] **Step 5: typecheck** PASS.
- [ ] **Step 6: Commit**
```bash
git add src/main/meta/refresh.ts src/main/meta/refresh.test.ts
git commit -m "feat(meta): ingest crawled pages into the rag index (hash-gated, isolated)"
```

---

### Task 6: `meta_search` tool

**Files:**
- Create: `src/main/tools/metaSearch.ts`
- Modify: `src/main/tools/shared.ts`, `src/main/tools/index.ts`
- Test: `src/main/tools/metaSearch.test.ts`

- [ ] **Step 1: add the dep field.** In `src/main/tools/shared.ts`, add to `ToolDeps` (after `loadSkill`):
```ts
  /** Hybrid meta corpus search (lazy; resolved per-call). */
  metaIndex: () => import('../meta/rag/index').MetaIndex
```
NOTE: if a type-only dynamic import in an interface trips the linter, instead add `import type { MetaIndex } from '../meta/rag/index'` at the top of `shared.ts` and use `metaIndex: () => MetaIndex`.

- [ ] **Step 2: Write the failing test**
```ts
// src/main/tools/metaSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildMetaSearchTools } from './metaSearch'
import { FakeMetaIndex } from '../meta/rag/testFake'

function toolFor(idx = new FakeMetaIndex()) {
  const t = buildMetaSearchTools(() => idx)[0]
  return { t, idx }
}

describe('meta_search tool', () => {
  it('returns mapped hits and forwards the mode filter', async () => {
    const idx = new FakeMetaIndex([{ source: 'snowcrows.com', url: 'u', title: 'Power Tempest', snippet: 'runs Force', score: 1 }])
    const t = buildMetaSearchTools(() => idx)[0]
    const res = await t.handler({ query: 'sigils', mode: 'PvE' }, {})
    expect(idx.queries[0]).toMatchObject({ query: 'sigils', mode: 'PvE' })
    expect(res.content[0].text).toContain('Power Tempest')
    expect(res.content[0].text).toContain('snowcrows.com')
  })

  it('returns a clean message when the index is empty', async () => {
    const { t } = toolFor()
    const res = await t.handler({ query: 'anything' }, {})
    expect(res.content[0].text.toLowerCase()).toContain('no indexed meta')
  })
})
```

- [ ] **Step 3: Run, expect FAIL:** `npx vitest run src/main/tools/metaSearch.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement**
```ts
// src/main/tools/metaSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMetaSearchTools(metaIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'meta_search',
      'Search the indexed GW2 community meta corpus (Snowcrows, MetaBattle, Hardstuck, GuildJen) for build detail beyond the per-mode summary — specific builds, weapon/sigil/rune choices, trait lines, and the tradeoffs between variants. Pass the question and, when known, the game mode. Returns community-sourced passages with their source URLs; treat them as recommendations to cite and verify, not mechanical ground truth.',
      {
        query: z.string().describe('What to look up, e.g. "condi alac tempest sigils and why"'),
        mode: z.enum(['PvE', 'WvW', 'WvW Roaming']).optional().describe('Game mode filter')
      },
      safe(async ({ query, mode }: { query: string; mode?: 'PvE' | 'WvW' | 'WvW Roaming' }) => {
        const hits = await metaIndex().search(query, { mode, k: 6 })
        if (hits.length === 0) return { note: 'no indexed meta yet — the background refresh may not have run' }
        return hits.map((h) => ({ source: h.source, url: h.url, title: h.title, snippet: h.snippet }))
      })
    )
  ]
}
```

- [ ] **Step 5: register the tool.** In `src/main/tools/index.ts`, import and append:
```ts
import { buildMetaSearchTools } from './metaSearch'
```
and in the `buildOfficerTools` return array, add:
```ts
    ...buildMetaSearchTools(deps.metaIndex),
```

- [ ] **Step 6: Run, expect PASS:** `npx vitest run src/main/tools/metaSearch.test.ts --maxWorkers=2`; typecheck PASS.
- [ ] **Step 7: Commit**
```bash
git add src/main/tools/metaSearch.ts src/main/tools/metaSearch.test.ts src/main/tools/shared.ts src/main/tools/index.ts
git commit -m "feat(meta): meta_search officer tool over the rag index"
```

---

### Task 7: Wire into the main process + prompt + packaging

**Files:**
- Modify: `src/main/index.ts`, `src/main/agent.ts`, `package.json`, `electron-builder.yml` (or the builder config in use)

- [ ] **Step 1: construct + inject.** In `src/main/index.ts`, near the existing meta construction (after `const metaCache = ...`), add:
```ts
import { TransformersEmbedder } from './meta/rag/embedder'
import { LanceMetaIndex } from './meta/rag/index'
```
```ts
const metaEmbedder = new TransformersEmbedder(join(app.getPath('userData'), 'meta-models'))
const metaIndex = new LanceMetaIndex(join(app.getPath('userData'), 'meta-lance'), metaEmbedder)
```
Pass it to the refresher (add `index: metaIndex` to the `new MetaRefresher({ ... })` options), and add to the `toolDeps` object returned in the `AgentService` deps:
```ts
      metaIndex: () => metaIndex,
```

- [ ] **Step 2: prompt guidance.** In `src/main/agent.ts`, add a bullet to `AXIVALE_SYSTEM_PROMPT` near the meta/figure guidance (keep each sentence on one line to avoid breaking any prompt regex tests):
```
- Meta depth: the per-mode meta reference above is a headline. For specifics —
  exact builds, weapon/sigil/rune choices, trait lines, and the tradeoffs between
  variants — call meta_search with the question and the game mode. Treat results
  as community recommendations: cite the source, still verify mechanics with
  axiforge_catalog and gw2_api before stating them as fact, and never invent build
  specifics meta_search did not return.
```

- [ ] **Step 3: packaging.** Ensure the LanceDB native binary is unpacked from the asar. In the electron-builder config, add `@lancedb/lancedb` (and its platform `.node`) to `asarUnpack`. Locate the builder config (`electron-builder.yml`/`.json` or the `build` key in `package.json`) and add:
```yaml
asarUnpack:
  - "**/node_modules/@lancedb/**"
  - "**/node_modules/@xenova/**"
```
(If an `asarUnpack` list already exists, append these globs.)

- [ ] **Step 4: typecheck + build** — `npm run typecheck` PASS; `npm run build` PASS.
- [ ] **Step 5: Commit**
```bash
git add src/main/index.ts src/main/agent.ts package.json electron-builder.yml
git commit -m "feat(meta): wire rag index + embedder; meta_search prompt guidance; asarUnpack"
```

---

### Task 8: Full verification

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS (all files, including the new chunk/index/metaSearch/refresh tests).
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke test (controller; not automatable).** Launch the app; let the background refresh run (first run downloads the ~25MB model and indexes — give it a few minutes). Then ask a depth question, e.g. "what sigils does the meta condi alac Tempest run and why, vs the power variant?" Confirm: `meta_search` fires, returns relevant passages from the right mode, the reply cites the source URL, and the tool card appears in the Actions rail. Note any source whose passages are irrelevant (selector/chunk tuning candidate). Also confirm the embedder backend loaded without an Electron native error (the WASM/onnxruntime validation point from Task 3).

---

## Self-Review

**Spec coverage:**
- Fetcher `pages[]` (additive, distill unchanged) → Task 1. ✔
- Chunker (passages, overlap, metadata, id, contentHash) → Task 2. ✔
- Embedder (transformers.js WASM MiniLM, lazy, interface) → Task 3. ✔
- LanceDB `meta_chunks` schema + hybrid + delete-by-url + owns embedder → Task 4. ✔
- Ingestion hook (content-hash gate, error-isolated, rides refresh) → Task 5. ✔
- `meta_search` tool (passages, mode filter, empty-index message, non-destructive) → Task 6. ✔
- Wiring + prompt (trust model: cite + verify) + storage paths + asarUnpack → Task 7. ✔
- Reindex content-hash skip → Tasks 2 (hash) + 5 (gate). Recentchanges/patch triggers explicitly deferred (spec). ✔
- Testing strategy (chunk pure; tool + ingestion with fakes; native impls smoke-tested) → Tasks 2/4/5/6/8. ✔

**Placeholder scan:** none — every code step is concrete. Two integration tasks (3, 4) carry explicit "adjust to installed lib API" notes with the interface contract fixed; that's a real integration constraint, not a placeholder.

**Type consistency:** `Chunk`/`ChunkMeta` (Task 2) consumed by `MetaIndex.replacePage` (Task 4) and the ingest path (Task 5). `MetaIndex`/`MetaSearchHit` (Task 4) consumed by `meta_search` (Task 6) and `ToolDeps.metaIndex` (Task 6 shared.ts) + injected in Task 7. `Embedder`/`EMBED_DIM` (Task 3) consumed by `LanceMetaIndex` (Task 4). `FetchedPage`/`FetchResult.pages` (Task 1) consumed by ingest (Task 5). `FakeMetaIndex` (Task 4) reused by Tasks 5 + 6. `sha1` exported from chunk.ts (Task 2) reused in ingest (Task 5).
