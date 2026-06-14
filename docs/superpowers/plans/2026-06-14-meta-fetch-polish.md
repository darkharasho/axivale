# Meta Fetch Polish: PvE sources + scrape-noise suppression + live progress

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Round out the just-merged GW2 Meta Fetch: add MetaBattle/Hardstuck PvE sources (and propagate to existing installs), silence benign third-party ad/tracker noise during scraping, and show live per-mode refresh progress in the Meta panel.

**Architecture:** Three independent slices. (1) MetaStore gains an additive `reconcile()` against the canonical seed so new sources reach existing `meta.json`. (2) `BrowserWindowFetcher` runs in an isolated session partition with a resource-type block list. (3) The orchestrator emits typed progress events → IPC → preload → the panel reflects them live.

**Tech Stack:** Electron main, TS, vitest, React.

---

### Task 1: PvE sources + additive reconcile

**Files:** Modify `src/main/metaStore.ts`; Test `src/main/metaStore.test.ts`

- [ ] **Step 1: failing tests** — append to `src/main/metaStore.test.ts` (reuse existing `tmpPath`/imports):

```ts
describe('MetaStore reconcile', () => {
  it('seeds PvE with snowcrows + metabattle + hardstuck', () => {
    const s = new MetaStore(tmpPath())
    const pve = s.list().find((m) => m.mode === 'PvE')!
    const urls = pve.sources.map((x) => x.url)
    expect(urls).toContain('https://snowcrows.com')
    expect(urls).toContain('https://metabattle.com/wiki/Category:PvE_builds')
    expect(urls).toContain('https://hardstuck.gg/gw2/builds/')
  })

  it('adds missing canonical sources to an existing mode without touching notes/provenance', () => {
    const p = tmpPath()
    writeFileSync(
      p,
      JSON.stringify({
        modes: [
          {
            id: 'a',
            mode: 'PvE',
            sources: [
              { label: 'Snowcrows', url: 'https://snowcrows.com', status: 'ok', fetchedAt: '2026-01-01T00:00:00.000Z', error: null }
            ],
            notes: 'kept',
            refreshedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: ''
          }
        ]
      })
    )
    const s = new MetaStore(p)
    const pve = s.list().find((m) => m.mode === 'PvE')!
    expect(pve.notes).toBe('kept')
    expect(pve.sources.find((x) => x.url === 'https://snowcrows.com')!.status).toBe('ok')
    expect(pve.sources.map((x) => x.url)).toContain('https://metabattle.com/wiki/Category:PvE_builds')
    expect(pve.sources.map((x) => x.url)).toContain('https://hardstuck.gg/gw2/builds/')
  })

  it('is idempotent — a second construct adds nothing', () => {
    const p = tmpPath()
    const a = new MetaStore(p)
    const before = a.list().find((m) => m.mode === 'PvE')!.sources.length
    const b = new MetaStore(p)
    expect(b.list().find((m) => m.mode === 'PvE')!.sources.length).toBe(before)
  })

  it('adds a wholly missing canonical mode', () => {
    const p = tmpPath()
    writeFileSync(p, JSON.stringify({ modes: [{ id: 'a', mode: 'PvE', sources: [], notes: '', refreshedAt: null, updatedAt: '' }] }))
    const s = new MetaStore(p)
    expect(s.list().map((m) => m.mode)).toContain('WvW')
  })
})
```

- [ ] **Step 2: run, expect FAIL:** `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`

- [ ] **Step 3: implement.** In `src/main/metaStore.ts`:

Replace the PvE entry in `DEFAULT_SEED` with:
```ts
  {
    mode: 'PvE',
    sources: [
      { label: 'Snowcrows', url: 'https://snowcrows.com' },
      { label: 'MetaBattle (PvE)', url: 'https://metabattle.com/wiki/Category:PvE_builds' },
      { label: 'Hardstuck (PvE)', url: 'https://hardstuck.gg/gw2/builds/' }
    ]
  },
```

In the constructor, replace the seed-only branch with seed-or-reconcile:
```ts
constructor(private readonly path: string) {
  this.state = this.read()
  if (this.state.modes.length === 0) {
    this.state = { modes: DEFAULT_SEED.map((s) => this.makeMode(s)) }
    this.flush()
  } else if (this.reconcile()) {
    this.flush()
  }
}
```

Add the method (additive only — never removes; preserves notes + provenance):
```ts
/** Merge any canonical seed modes/sources missing from the stored file. */
private reconcile(): boolean {
  let changed = false
  for (const seed of DEFAULT_SEED) {
    const existing = this.state.modes.find((m) => m.mode === seed.mode)
    if (!existing) {
      this.state.modes.push(this.makeMode(seed))
      changed = true
      continue
    }
    for (const src of seed.sources) {
      if (!existing.sources.some((s) => s.url === src.url)) {
        existing.sources.push({ label: src.label, url: src.url, status: 'never', fetchedAt: null, error: null })
        changed = true
      }
    }
  }
  return changed
}
```

- [ ] **Step 4: run, expect PASS (incl. pre-existing):** `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
- [ ] **Step 5: typecheck** `npm run typecheck` PASS.
- [ ] **Step 6: commit**
```bash
git add src/main/metaStore.ts src/main/metaStore.test.ts
git commit -m "feat(meta): add MetaBattle/Hardstuck PvE sources + additive reconcile"
```

---

### Task 2: Scrape-noise suppression (isolated session + block list)

**Files:** Modify `src/main/meta/fetcher.ts` (no unit test — Electron-only; manual smoke).

- [ ] **Step 1: implement.** In `src/main/meta/fetcher.ts`:

Change the electron import:
```ts
import { BrowserWindow, session } from 'electron'
```

Add near the top (after `FETCH_TIMEOUT_MS`):
```ts
// Meta sites embed ad/tracker/image subresources that don't affect innerText
// and spam the console (ERR_CONNECTION_REFUSED behind ad-blockers). Run the
// scrape window in an isolated in-memory session and drop those resource types.
const SCRAPE_PARTITION = 'meta-scrape'
const BLOCKED_TYPES = new Set(['image', 'media', 'font', 'object', 'ping', 'cspReport', 'subFrame'])
```

In `BrowserWindowFetcher`, add a guard field and set up the filter in `window()`:
```ts
  private win: BrowserWindow | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private filtered = false

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const ses = session.fromPartition(SCRAPE_PARTITION)
    if (!this.filtered) {
      ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) =>
        cb({ cancel: BLOCKED_TYPES.has(details.resourceType) })
      )
      this.filtered = true
    }
    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        partition: SCRAPE_PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    return this.win
  }
```
(Leave `fetch`, `fetchOne`, `destroy` unchanged. The isolated partition guarantees the filter never touches the app's own renderer requests.)

- [ ] **Step 2: typecheck** `npm run typecheck` PASS; quick sanity `npx vitest run src/main/meta/fetcher.test.ts --maxWorkers=2` (still 3 PASS — wiki path unaffected).
- [ ] **Step 3: commit**
```bash
git add src/main/meta/fetcher.ts
git commit -m "fix(meta): isolate scrape window + drop ad/image subresources"
```

---

### Task 3: Orchestrator progress events

**Files:** Modify `src/main/meta/refresh.ts`; Test `src/main/meta/refresh.test.ts`

- [ ] **Step 1: failing test** — append to `src/main/meta/refresh.test.ts`:

```ts
describe('MetaRefresher progress', () => {
  it('emits mode-start, source-start(s), mode-done, then idle for a stale mode', async () => {
    const s = store()
    // make only PvE stale: mark the others fresh
    s.list().forEach((x) => {
      if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh')
    })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const events: string[] = []
    await new MetaRefresher({
      store: s,
      fetcher: fetcher(Object.fromEntries(pve.sources.map((x) => [x.url, { ok: true, text: 'r' }]))),
      cache: fakeCache(),
      model: vi.fn().mockResolvedValue('notes'),
      now: () => Date.now(),
      emit: (e) => events.push(e.type)
    }).refreshStale()
    expect(events[0]).toBe('mode-start')
    expect(events).toContain('source-start')
    expect(events).toContain('mode-done')
    expect(events[events.length - 1]).toBe('idle')
  })
})
```

- [ ] **Step 2: run, expect FAIL:** `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`

- [ ] **Step 3: implement.** In `src/main/meta/refresh.ts`:

Add the event type + optional emitter to deps:
```ts
export type MetaProgress =
  | { type: 'mode-start'; modeId: string }
  | { type: 'source-start'; modeId: string; url: string }
  | { type: 'mode-done'; modeId: string }
  | { type: 'idle' }

export interface RefresherDeps {
  store: MetaStore
  fetcher: MetaFetcher
  cache: RawCache
  model: MetaModel
  now: () => number
  staleMs?: number
  emit?: (e: MetaProgress) => void
}
```

In `refreshStale`, wire the emits (default to a no-op):
```ts
async refreshStale(): Promise<void> {
  const { store, fetcher, cache, model, now } = this.deps
  const emit = this.deps.emit ?? ((): void => {})
  const staleMs = this.deps.staleMs ?? SEVEN_DAYS_MS
  try {
    for (const mode of store.list()) {
      if (!isStale(mode, now(), staleMs)) continue
      emit({ type: 'mode-start', modeId: mode.id })
      const raws: string[] = []
      for (const src of mode.sources) {
        if (!configForUrl(src.url)) continue
        emit({ type: 'source-start', modeId: mode.id, url: src.url })
        const r = await fetcher.fetch(src.url)
        store.recordFetch(mode.id, src.url, r.ok ? { ok: true } : { ok: false, error: r.error })
        if (r.ok) {
          cache.put(src.url, r.text)
          raws.push(r.text)
        }
      }
      if (raws.length > 0) {
        const notes = await distill(mode.mode, raws, model)
        if (notes) store.recordDistill(mode.id, notes)
      }
      emit({ type: 'mode-done', modeId: mode.id })
    }
  } finally {
    emit({ type: 'idle' })
  }
}
```

- [ ] **Step 4: run, expect PASS (all refresh tests):** `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`
- [ ] **Step 5: typecheck** PASS.
- [ ] **Step 6: commit**
```bash
git add src/main/meta/refresh.ts src/main/meta/refresh.test.ts
git commit -m "feat(meta): orchestrator emits live refresh progress events"
```

---

### Task 4: IPC + preload + live panel UI

**Files:** Modify `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/components/panels/Meta.tsx`(+test), `src/renderer/src/theme.css`

- [ ] **Step 1: main process — forward events.** In `src/main/index.ts`, where `metaRefresher` is constructed, add an `emit` that pushes to the renderer:
```ts
  emit: (e) => {
    const win = mainWindow
    if (win && !win.isDestroyed()) win.webContents.send('meta:progress', e)
  },
```
(Add it inside the `new MetaRefresher({ ... })` options object alongside `store`/`fetcher`/`cache`/`model`/`now`. Import `MetaProgress` type is not required in index.ts since the object is structurally typed, but add `import type { MetaProgress } from './meta/refresh'` only if the typechecker requires it.)

- [ ] **Step 2: preload.** In `src/preload/index.ts`, add to the exposed `officer` object (near other `on*` subscriptions):
```ts
  onMetaProgress: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on('meta:progress', handler)
    return () => ipcRenderer.removeListener('meta:progress', handler)
  },
```

- [ ] **Step 3: preload types.** In `src/preload/index.d.ts` add the event type + method:
```ts
export type RendererMetaProgress =
  | { type: 'mode-start'; modeId: string }
  | { type: 'source-start'; modeId: string; url: string }
  | { type: 'mode-done'; modeId: string }
  | { type: 'idle' }
```
and in `OfficerApi` (near `onAgentEvent`):
```ts
  onMetaProgress(cb: (e: RendererMetaProgress) => void): () => void
```

- [ ] **Step 4: panel test** — add to `src/renderer/src/components/panels/Meta.test.tsx`. First extend the mock `officer()` to capture the progress callback:
```ts
function officer() {
  let progressCb: ((e: unknown) => void) | null = null
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
            { label: 'MetaBattle', url: 'https://metabattle.com', status: 'ok', fetchedAt: '2026-06-10T00:00:00.000Z', error: null }
          ]
        }
      ]),
    onMetaProgress: (cb: (e: unknown) => void) => {
      progressCb = cb
      return () => {}
    },
    __fire: (e: unknown) => progressCb?.(e)
  }
}
```
Keep the two existing tests (they ignore `onMetaProgress`/`__fire`). Add:
```ts
import { act } from '@testing-library/react'

it('shows a refreshing indicator while a mode is in progress', async () => {
  const o = officer()
  ;(window as unknown as { officer: unknown }).officer = o
  render(<Meta />)
  await screen.findByText('WvW')
  act(() => {
    ;(o as unknown as { __fire: (e: unknown) => void }).__fire({ type: 'mode-start', modeId: '1' })
  })
  expect(screen.getByText(/refreshing/i)).toBeTruthy()
})
```

- [ ] **Step 5: run, expect FAIL:** `npx vitest run src/renderer/src/components/panels/Meta.test.tsx --maxWorkers=2`

- [ ] **Step 6: panel implementation** — update `src/renderer/src/components/panels/Meta.tsx`:

```tsx
// src/renderer/src/components/panels/Meta.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMetaMode, RendererMetaProgress } from '../../../../preload/index.d'

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
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [fetching, setFetching] = useState<Record<string, string | null>>({})

  function refresh(): void {
    void window.officer.metaList().then(setModes)
  }
  useEffect(() => {
    refresh()
    return window.officer.onMetaProgress((e: RendererMetaProgress) => {
      if (e.type === 'mode-start') setBusy((b) => ({ ...b, [e.modeId]: true }))
      else if (e.type === 'source-start') setFetching((f) => ({ ...f, [e.modeId]: e.url }))
      else if (e.type === 'mode-done') {
        setBusy((b) => ({ ...b, [e.modeId]: false }))
        setFetching((f) => ({ ...f, [e.modeId]: null }))
        refresh()
      }
    })
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
              {m.mode}{' '}
              {busy[m.id] ? (
                <span className="meta-refreshing">
                  <span className="meta-spin" /> refreshing…
                </span>
              ) : (
                <span className="meta-fresh">{ago(m.refreshedAt)}</span>
              )}
            </h2>
            <p className="meta-summary">{m.notes || 'No summary yet — awaiting first refresh.'}</p>
            <div className="meta-sources">
              {m.sources.map((s) => {
                const isFetching = fetching[m.id] === s.url
                return (
                  <span className="meta-srcrow" key={s.url}>
                    <a className="meta-src" href={s.url} target="_blank" rel="noreferrer">
                      {s.label}
                    </a>
                    <span
                      className={`meta-chip ${isFetching ? 'fetching' : s.status}`}
                      title={s.error ?? undefined}
                    >
                      {isFetching ? 'fetching…' : s.status}
                    </span>
                  </span>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 7: styles** — append to `src/renderer/src/theme.css`:
```css
.meta-refreshing {
  font-size: 11px;
  font-weight: 400;
  color: var(--accent-b);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.meta-spin {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--rule2);
  border-top-color: var(--accent-b);
  border-radius: 50%;
  display: inline-block;
  animation: meta-spin 0.7s linear infinite;
}
@keyframes meta-spin {
  to {
    transform: rotate(360deg);
  }
}
.meta-chip.fetching {
  color: var(--accent-b);
  border-color: var(--accent-b);
  opacity: 1;
}
```

- [ ] **Step 8: run, expect PASS:** `npx vitest run src/renderer/src/components/panels/Meta.test.tsx --maxWorkers=2`
- [ ] **Step 9: typecheck** `npm run typecheck` PASS.
- [ ] **Step 10: commit**
```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/panels/Meta.tsx src/renderer/src/components/panels/Meta.test.tsx src/renderer/src/theme.css
git commit -m "feat(meta): live per-mode refresh progress in the panel"
```

---

### Task 5: Full verification

- [ ] `npx vitest run --maxWorkers=2` → PASS (all files).
- [ ] `npm run typecheck` → PASS.
- [ ] `npm run build` → PASS.
- [ ] Manual smoke: launch `npm run dev`; open Meta (nav 07). Confirm: the console no longer spams ad-domain ERR_CONNECTION_REFUSED; PvE now lists Snowcrows + MetaBattle (PvE) + Hardstuck (PvE); on launch each stale mode shows a spinning "refreshing…" with its source chips flipping to "fetching…", then settles to a summary + ok/error chips + timestamp without reopening the panel.

---

## Self-Review

**Coverage:** PvE sources + propagation → Task 1 (seed + reconcile, tested incl. existing-install + idempotent + missing-mode). Noise → Task 2 (isolated partition + block list). Live progress → Tasks 3 (emit, tested) + 4 (IPC/preload/panel, tested).
**Placeholders:** none — full code in every step.
**Type consistency:** `MetaProgress` (refresh.ts) mirrored as `RendererMetaProgress` (preload). `emit?` optional so existing refresh.test calls (no emit) still compile. `onMetaProgress` returns an unsubscribe fn used as the useEffect cleanup. Reconcile uses the same `MetaSource` provenance shape as `makeMode`/`normalize`.
