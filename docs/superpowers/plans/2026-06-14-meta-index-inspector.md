# Dev Meta-Index (LanceDB) Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only inspector in the Meta panel to see what's in the LanceDB `meta_chunks` corpus (stats + browse) and how retrieval ranks a query (live test-search).

**Architecture:** Add `stats()`/`sample()` read methods to `MetaIndex` (LanceDB `countRows` + column scan + `where`/`limit`); expose them plus the existing `search()` over IPC; render a dev-gated `MetaIndexInspector` component in the Meta panel.

**Tech Stack:** Electron main, TS, `@lancedb/lancedb` (`countRows`, `query().select().where().limit().toArray()`), React, vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-meta-index-inspector-design.md`

---

## File Structure
- Modify `src/main/meta/rag/index.ts` — `MetaChunkRow`/`MetaIndexStats` types, `MetaIndex.stats`/`sample`, `LanceMetaIndex` impls.
- Modify `src/main/meta/rag/testFake.ts` — `FakeMetaIndex.stats`/`sample` (+ test in `index.test.ts`).
- Modify `src/main/index.ts` — `meta:index-stats|sample|search` IPC handlers.
- Modify `src/preload/index.ts` + `index.d.ts` — `metaIndexStats`/`metaIndexSample`/`metaIndexSearch` + renderer types.
- Create `src/renderer/src/components/MetaIndexInspector.tsx` (+ test).
- Modify `src/renderer/src/components/panels/Meta.tsx` — mount under `import.meta.env.DEV`.
- Modify `src/renderer/src/theme.css` — `.mi-*` styles.
- Modify `src/renderer/src/App.test.tsx` — add the 3 methods to `makeOfficer`.

Run tests with `npx vitest run <path> --maxWorkers=2` (never exceed 2).

---

### Task 1: MetaIndex `stats` + `sample`

**Files:**
- Modify: `src/main/meta/rag/index.ts`, `src/main/meta/rag/testFake.ts`
- Test: `src/main/meta/rag/index.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/main/meta/rag/index.test.ts`:
```ts
import { FakeMetaIndex } from './testFake'

describe('FakeMetaIndex stats + sample', () => {
  it('stats tallies rows by mode and source', async () => {
    const idx = new FakeMetaIndex()
    idx.sampleRows = [
      { id: 'a:0', mode: 'PvE', source: 'snowcrows.com', url: 'a', title: 'A', snippet: 'x', indexedAt: '2026-06-14T00:00:00.000Z' },
      { id: 'b:0', mode: 'PvE', source: 'metabattle.com', url: 'b', title: 'B', snippet: 'y', indexedAt: '2026-06-14T01:00:00.000Z' },
      { id: 'c:0', mode: 'WvW', source: 'snowcrows.com', url: 'c', title: 'C', snippet: 'z', indexedAt: '2026-06-13T00:00:00.000Z' }
    ]
    const s = await idx.stats()
    expect(s.total).toBe(3)
    expect(s.byMode).toEqual({ PvE: 2, WvW: 1 })
    expect(s.bySource).toEqual({ 'snowcrows.com': 2, 'metabattle.com': 1 })
    expect(s.lastIndexedAt).toBe('2026-06-14T01:00:00.000Z')
  })

  it('sample filters by mode and caps to limit', async () => {
    const idx = new FakeMetaIndex()
    idx.sampleRows = [
      { id: 'a:0', mode: 'PvE', source: 's', url: 'a', title: 'A', snippet: 'x', indexedAt: '' },
      { id: 'b:0', mode: 'WvW', source: 's', url: 'b', title: 'B', snippet: 'y', indexedAt: '' }
    ]
    expect((await idx.sample({ limit: 25 })).length).toBe(2)
    const pve = await idx.sample({ mode: 'PvE', limit: 25 })
    expect(pve.map((r) => r.id)).toEqual(['a:0'])
    expect((await idx.sample({ limit: 1 })).length).toBe(1)
  })

  it('empty index → zero stats', async () => {
    const s = await new FakeMetaIndex().stats()
    expect(s).toEqual({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null })
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/rag/index.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement types + interface** in `src/main/meta/rag/index.ts` — after `MetaSearchHit`:
```ts
export interface MetaChunkRow {
  id: string
  mode: string
  source: string
  url: string
  title: string
  snippet: string
  indexedAt: string
}
export interface MetaIndexStats {
  total: number
  byMode: Record<string, number>
  bySource: Record<string, number>
  lastIndexedAt: string | null
}
```
And add to the `MetaIndex` interface (after `search`):
```ts
  /** Index stats for the dev inspector. */
  stats(): Promise<MetaIndexStats>
  /** Browse a sample of indexed chunks (dev inspector). */
  sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]>
```

- [ ] **Step 4: Implement `LanceMetaIndex.stats`/`sample`** in the same file (add as methods on the class; reuse the existing private `table()` + `quote()` helpers). Wrap table access so a missing index returns empty:
```ts
  async stats(): Promise<MetaIndexStats> {
    try {
      const tbl = await this.table()
      const total = await tbl.countRows()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await tbl.query().select(['mode', 'source', 'indexedAt']).limit(100_000).toArray()) as any[]
      const byMode: Record<string, number> = {}
      const bySource: Record<string, number> = {}
      let lastIndexedAt: string | null = null
      for (const r of rows) {
        byMode[r.mode] = (byMode[r.mode] ?? 0) + 1
        bySource[r.source] = (bySource[r.source] ?? 0) + 1
        if (r.indexedAt && (!lastIndexedAt || r.indexedAt > lastIndexedAt)) lastIndexedAt = r.indexedAt
      }
      return { total, byMode, bySource, lastIndexedAt }
    } catch {
      return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }
    }
  }

  async sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]> {
    try {
      const tbl = await this.table()
      let q = tbl.query().select(['id', 'mode', 'source', 'url', 'title', 'text', 'indexedAt'])
      if (opts.mode) q = q.where(`mode = ${quote(opts.mode)}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await q.limit(opts.limit).toArray()) as any[]
      return rows.map((r) => ({
        id: r.id,
        mode: r.mode,
        source: r.source,
        url: r.url,
        title: r.title,
        snippet: String(r.text ?? '').slice(0, 300),
        indexedAt: r.indexedAt ?? ''
      }))
    } catch {
      return []
    }
  }
```
NOTE: confirm `select`/`countRows`/`where`/`limit`/`toArray` exist for the installed `@lancedb/lancedb` (verified: `Table.countRows`, `QueryBase.select`/`.where`/`.limit`/`.toArray`). If `select(['text'])` on a non-FTS plain query needs a different call in this version, adapt — the `MetaChunkRow`/`MetaIndexStats` shapes stay fixed.

- [ ] **Step 5: Implement `FakeMetaIndex.stats`/`sample`** in `src/main/meta/rag/testFake.ts` (add a public `sampleRows` field + the two methods; import the new types):
```ts
import type { MetaIndex, MetaSearchHit, MetaChunkRow, MetaIndexStats } from './index'
```
```ts
  sampleRows: MetaChunkRow[] = []
  async stats(): Promise<MetaIndexStats> {
    const byMode: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    let lastIndexedAt: string | null = null
    for (const r of this.sampleRows) {
      byMode[r.mode] = (byMode[r.mode] ?? 0) + 1
      bySource[r.source] = (bySource[r.source] ?? 0) + 1
      if (r.indexedAt && (!lastIndexedAt || r.indexedAt > lastIndexedAt)) lastIndexedAt = r.indexedAt
    }
    return { total: this.sampleRows.length, byMode, bySource, lastIndexedAt }
  }
  async sample(opts: { mode?: string; limit: number }): Promise<MetaChunkRow[]> {
    return this.sampleRows.filter((r) => !opts.mode || r.mode === opts.mode).slice(0, opts.limit)
  }
```

- [ ] **Step 6: Run, expect PASS:** `npx vitest run src/main/meta/rag/index.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 7: Commit**
```bash
git add src/main/meta/rag/index.ts src/main/meta/rag/testFake.ts src/main/meta/rag/index.test.ts
git commit -m "feat(meta): MetaIndex stats + sample read methods for dev inspector"
```

---

### Task 2: IPC + preload

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/App.test.tsx`

- [ ] **Step 1: IPC handlers.** In `src/main/index.ts`, near the other `meta:*` handlers, add (each try/catch'd to the empty shape so the dev panel never throws):
```ts
  ipcMain.handle('meta:index-stats', async () => {
    try {
      return await metaIndex.stats()
    } catch {
      return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }
    }
  })
  ipcMain.handle('meta:index-sample', async (_e, opts: { mode?: string; limit: number }) => {
    try {
      return await metaIndex.sample(opts)
    } catch {
      return []
    }
  })
  ipcMain.handle('meta:index-search', async (_e, query: string, mode?: string) => {
    try {
      return await metaIndex.search(query, { mode, k: 8 })
    } catch {
      return []
    }
  })
```

- [ ] **Step 2: preload bridge.** In `src/preload/index.ts`, add to the exposed `officer` object (near the other `meta*` methods):
```ts
  metaIndexStats: () => ipcRenderer.invoke('meta:index-stats'),
  metaIndexSample: (opts: { mode?: string; limit: number }) => ipcRenderer.invoke('meta:index-sample', opts),
  metaIndexSearch: (query: string, mode?: string) => ipcRenderer.invoke('meta:index-search', query, mode),
```

- [ ] **Step 3: preload types.** In `src/preload/index.d.ts`, add:
```ts
export interface RendererMetaChunkRow {
  id: string
  mode: string
  source: string
  url: string
  title: string
  snippet: string
  indexedAt: string
}
export interface RendererMetaIndexStats {
  total: number
  byMode: Record<string, number>
  bySource: Record<string, number>
  lastIndexedAt: string | null
}
export interface RendererMetaSearchHit {
  source: string
  url: string
  title: string
  snippet: string
  score: number
}
```
and to `OfficerApi`:
```ts
  metaIndexStats(): Promise<RendererMetaIndexStats>
  metaIndexSample(opts: { mode?: string; limit: number }): Promise<RendererMetaChunkRow[]>
  metaIndexSearch(query: string, mode?: string): Promise<RendererMetaSearchHit[]>
```

- [ ] **Step 4: keep typecheck green.** In `src/renderer/src/App.test.tsx`, add to `makeOfficer` (beside the other `meta*` stubs):
```ts
    metaIndexStats: vi.fn().mockResolvedValue({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
    metaIndexSample: vi.fn().mockResolvedValue([]),
    metaIndexSearch: vi.fn().mockResolvedValue([]),
```

- [ ] **Step 5: verify:** `npm run typecheck` PASS; `npx vitest run src/renderer/src/App.test.tsx --maxWorkers=2` PASS.
- [ ] **Step 6: Commit**
```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/App.test.tsx
git commit -m "feat(meta): IPC + preload for dev index inspector (stats/sample/search)"
```

---

### Task 3: MetaIndexInspector component

**Files:**
- Create: `src/renderer/src/components/MetaIndexInspector.tsx`
- Modify: `src/renderer/src/components/panels/Meta.tsx`, `src/renderer/src/theme.css`
- Test: `src/renderer/src/components/MetaIndexInspector.test.tsx`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MetaIndexInspector from './MetaIndexInspector'

function officer(over: Record<string, unknown> = {}) {
  return {
    metaIndexStats: vi.fn().mockResolvedValue({ total: 42, byMode: { PvE: 30, WvW: 12 }, bySource: { 'snowcrows.com': 42 }, lastIndexedAt: '2026-06-14T00:00:00.000Z' }),
    metaIndexSample: vi.fn().mockResolvedValue([{ id: 'a:0', mode: 'PvE', source: 'snowcrows.com', url: 'a', title: 'Power Tempest', snippet: 'runs Force', indexedAt: '' }]),
    metaIndexSearch: vi.fn().mockResolvedValue([{ source: 'snowcrows.com', url: 'a', title: 'Power Tempest', snippet: 'sigil of force', score: 0.91 }]),
    ...over
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('MetaIndexInspector', () => {
  it('renders index stats on mount', async () => {
    render(<MetaIndexInspector />)
    expect(await screen.findByText(/42/)).toBeTruthy()
    expect(screen.getByText(/PvE: 30/)).toBeTruthy()
  })

  it('runs a test search and renders ranked hits', async () => {
    const search = vi.fn().mockResolvedValue([{ source: 'metabattle.com', url: 'b', title: 'Scourge', snippet: 'curse', score: 0.8 }])
    ;(window as unknown as { officer: unknown }).officer = officer({ metaIndexSearch: search })
    render(<MetaIndexInspector />)
    fireEvent.change(screen.getByPlaceholderText(/test search/i), { target: { value: 'scourge' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(search).toHaveBeenCalledWith('scourge', undefined))
    expect(await screen.findByText('Scourge')).toBeTruthy()
  })

  it('loads a sample of chunks', async () => {
    render(<MetaIndexInspector />)
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }))
    expect(await screen.findByText('Power Tempest')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/renderer/src/components/MetaIndexInspector.test.tsx --maxWorkers=2`

- [ ] **Step 3: Implement** `src/renderer/src/components/MetaIndexInspector.tsx`:
```tsx
import { useEffect, useState, type ReactElement } from 'react'
import type {
  RendererMetaIndexStats,
  RendererMetaChunkRow,
  RendererMetaSearchHit
} from '../../../preload/index.d'

const MODES = ['', 'PvE', 'WvW', 'WvW Roaming']

export default function MetaIndexInspector(): ReactElement {
  const [stats, setStats] = useState<RendererMetaIndexStats | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('')
  const [hits, setHits] = useState<RendererMetaSearchHit[] | null>(null)
  const [rows, setRows] = useState<RendererMetaChunkRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.officer.metaIndexStats().then(setStats)
  }, [])

  async function runSearch(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setRows(null)
    setHits(await window.officer.metaIndexSearch(query, mode || undefined))
    setBusy(false)
  }
  async function loadSample(): Promise<void> {
    setHits(null)
    setRows(await window.officer.metaIndexSample({ mode: mode || undefined, limit: 25 }))
  }

  return (
    <div className="sgroup mi-inspector">
      <h2>
        Index inspector <span className="mi-dev">dev</span>
      </h2>
      {stats && (
        <div className="mi-stats">
          <span>
            <b>{stats.total}</b> chunks
          </span>
          {Object.entries(stats.byMode).map(([m, c]) => (
            <span key={m}>
              {m}: {c}
            </span>
          ))}
          <span className="mi-sub">
            {Object.entries(stats.bySource).map(([s, c]) => `${s} ${c}`).join(' · ') || 'no sources'}
          </span>
        </div>
      )}
      <div className="srow mi-row">
        <input
          className="sinput"
          placeholder="test search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
        />
        <select className="sinput mi-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m || 'All modes'}
            </option>
          ))}
        </select>
        <button className="sbtn" disabled={busy} onClick={() => void runSearch()}>
          Search
        </button>
        <button className="sbtn" onClick={() => void loadSample()}>
          Load sample
        </button>
      </div>
      {hits && (
        <div className="mi-results">
          {hits.length === 0 ? (
            <div className="mi-empty">no results</div>
          ) : (
            hits.map((h, i) => (
              <div className="mi-hit" key={i}>
                <div className="mi-hit-head">
                  <span className="mi-score">{h.score.toFixed(3)}</span> <b>{h.title}</b>{' '}
                  <span className="mi-src">{h.source}</span>
                </div>
                <div className="mi-snip">{h.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}
      {rows && (
        <div className="mi-results">
          {rows.length === 0 ? (
            <div className="mi-empty">index empty — run a crawl</div>
          ) : (
            rows.map((r) => (
              <div className="mi-hit" key={r.id}>
                <div className="mi-hit-head">
                  <b>{r.title}</b> <span className="mi-src">{r.source} · {r.mode}</span>
                </div>
                <div className="mi-snip">{r.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: mount in the Meta panel (dev-gated).** In `src/renderer/src/components/panels/Meta.tsx`, import it and render at the bottom of the panel (after the modes `.map(...)`, before the closing `</div>` of `.meta-panel`):
```tsx
import MetaIndexInspector from '../MetaIndexInspector'
```
```tsx
      {import.meta.env.DEV && <MetaIndexInspector />}
```

- [ ] **Step 5: styles.** Append to `src/renderer/src/theme.css`:
```css
.mi-inspector { margin-top: 14px; border-top: 1px dashed var(--rule2); padding-top: 10px; }
.mi-dev { font-size: 10px; text-transform: uppercase; color: var(--accent-b); border: 1px solid var(--accent-b); border-radius: 2px; padding: 0 4px; }
.mi-stats { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; margin: 6px 0; color: var(--ink); }
.mi-stats .mi-sub { opacity: 0.6; flex-basis: 100%; }
.mi-row { display: flex; gap: 6px; align-items: center; }
.mi-row .sinput { flex: 1; }
.mi-row .mi-mode { flex: 0 0 auto; }
.mi-results { margin-top: 8px; max-height: 320px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.mi-hit { border: 1px solid var(--rule2); border-radius: 3px; padding: 6px 8px; }
.mi-hit-head { font-size: 12px; display: flex; gap: 6px; align-items: baseline; }
.mi-score { color: var(--accent-b); font-variant-numeric: tabular-nums; }
.mi-src { opacity: 0.6; font-size: 11px; }
.mi-snip { font-size: 11px; opacity: 0.8; margin-top: 3px; white-space: pre-wrap; }
.mi-empty { font-size: 12px; opacity: 0.6; }
```
(If any token like `--rule2`/`--accent-b`/`--ink` is named differently, use the actual tokens used by sibling `.meta-*` rules.)

- [ ] **Step 6: Run, expect PASS:** `npx vitest run src/renderer/src/components/MetaIndexInspector.test.tsx --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 7: Commit**
```bash
git add src/renderer/src/components/MetaIndexInspector.tsx src/renderer/src/components/MetaIndexInspector.test.tsx src/renderer/src/components/panels/Meta.tsx src/renderer/src/theme.css
git commit -m "feat(meta): dev-gated LanceDB index inspector (stats + test-search + browse)"
```

---

### Task 4: Full verification

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS.
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke (controller).** Dev run with a populated index: open Meta (nav 07), scroll to "Index inspector". Confirm real stats (total / per-mode / per-source / last indexed), run a query → ranked results with scores, "Load sample" → chunk list. Confirm the section is ABSENT in a production build (`import.meta.env.DEV` false).

---

## Self-Review

**Spec coverage:**
- `MetaIndex.stats`/`sample` + `MetaChunkRow`/`MetaIndexStats` (LanceDB countRows + select scan + where/limit; empty on missing table) → Task 1. ✔
- `FakeMetaIndex` updated → Task 1. ✔
- IPC `meta:index-stats|sample|search` (try/catch → empty), preload methods + renderer types → Task 2. ✔
- `MetaIndexInspector` (stats + test-search via real `search()` + browse) dev-gated in Meta panel + styles → Task 3. ✔
- Empty/error handling (empty shapes, clean panel) → Tasks 1/2/3. ✔
- Tests: FakeMetaIndex stats/sample unit-tested; component tested with mocked officer; real LanceMetaIndex smoke-tested → Tasks 1/3/4. ✔

**Placeholder scan:** none — full code in every step. The LanceDB `select`/`countRows` note is a build-time confirm with the API verified present + shapes fixed.

**Type consistency:** `MetaChunkRow`/`MetaIndexStats`/`MetaSearchHit` defined in Task 1 are mirrored as `Renderer*` in Task 2 and consumed by `MetaIndexInspector` in Task 3. `metaIndexSearch(query, mode?)` signature matches across preload, IPC handler (`meta:index-search` → `search(query,{mode,k:8})`), and the component call (`metaIndexSearch(query, mode || undefined)`). `sample({mode?, limit})` matches across all layers.
