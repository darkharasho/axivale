# GW2 Meta Bias (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bias the AI toward current GW2 metas by injecting a maintained, per-game-mode source reference (+ notes) into the agent's system prompt, with a panel to edit it, seeded with the canonical sites.

**Architecture:** A `MetaStore` (`meta.json`, seeded defaults) holds per-mode sources + notes. A pure `buildMetaReference(modes)` builds a compact block appended to the per-turn system prompt (after the skills block). A "Meta" panel edits it. Mirrors the Skills feature throughout.

**Tech Stack:** TypeScript, Electron IPC, React 18, vitest (+ @testing-library/react). Stores follow `skillStore.ts` (atomic, debounced, corrupt-safe). Run tests `npx vitest run <file> --maxWorkers=2`. Commit per task.

---

## File Structure
- Create: `src/main/metaStore.ts` (+ test), `src/main/metaPrompt.ts` (+ test), `src/renderer/src/components/panels/Meta.tsx` (+ test).
- Modify: `src/main/agent.ts` (AgentDeps.meta + runTurn append), `src/main/index.ts` (construct + IPC), `src/preload/index.ts` + `index.d.ts`, `src/renderer/src/components/Masthead.tsx` (Section + nav), `src/renderer/src/App.tsx` (render), `src/renderer/src/theme.css` (styles).

---

## Task 1: MetaStore (seeded defaults)

**Files:**
- Create: `src/main/metaStore.ts`
- Test: `src/main/metaStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/metaStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from './metaStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metastore-'))
  path = join(dir, 'meta.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('MetaStore', () => {
  it('seeds default modes on first run (PvE, WvW, WvW Roaming) and persists them', () => {
    const s = new MetaStore(path)
    const modes = s.list().map((m) => m.mode)
    expect(modes).toContain('PvE')
    expect(modes).toContain('WvW')
    expect(modes).toContain('WvW Roaming')
    expect(existsSync(path)).toBe(true)
    // PvE points at Snowcrows
    const pve = s.list().find((m) => m.mode === 'PvE')!
    expect(pve.sources.some((src) => /snowcrows/i.test(src.url))).toBe(true)
    expect(pve.notes).toBe('')
  })

  it('adds, updates, and removes modes', () => {
    const s = new MetaStore(path)
    const m = s.addMode({ mode: 'PvP', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com' }], notes: '' })
    expect(m.id).toBeTruthy()
    const up = s.updateMode(m.id, { notes: 'condi everywhere' })
    expect(up?.notes).toBe('condi everywhere')
    s.removeMode(m.id)
    expect(s.get(m.id)).toBeNull()
  })

  it('survives a corrupt file by reseeding defaults', () => {
    writeFileSync(path, 'not json')
    expect(new MetaStore(path).list().length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './metaStore'`.

- [ ] **Step 3: Implement**

```ts
// src/main/metaStore.ts
//
// Owns userData/meta.json — per-game-mode meta source references + notes used to
// bias build/comp advice. Mirrors skillStore.ts (atomic tmp+rename, debounced,
// corrupt-safe). Seeds canonical sources on first run / corrupt file.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export interface MetaSource {
  label: string
  url: string
}
export interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string
  updatedAt: string
}

export type MetaModeSeed = Pick<MetaMode, 'mode' | 'sources'> & Partial<Pick<MetaMode, 'notes'>>

interface FileShape {
  modes: MetaMode[]
}

const DEBOUNCE_MS = 300

const DEFAULT_SEED: Array<Pick<MetaMode, 'mode' | 'sources'>> = [
  { mode: 'PvE', sources: [{ label: 'Snowcrows', url: 'https://snowcrows.com' }] },
  {
    mode: 'WvW',
    sources: [
      { label: 'MetaBattle (WvW)', url: 'https://metabattle.com/wiki/Category:WvW_Zerg_Builds' },
      { label: 'gw2mists', url: 'https://gw2mists.com' },
      { label: 'Hardstuck', url: 'https://hardstuck.gg' }
    ]
  },
  {
    mode: 'WvW Roaming',
    sources: [
      { label: 'MetaBattle (Roaming)', url: 'https://metabattle.com/wiki/Category:WvW_Roaming_Builds' },
      { label: 'GuildJen', url: 'https://guildjen.com' },
      { label: 'Hardstuck', url: 'https://hardstuck.gg' }
    ]
  }
]

export class MetaStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
    if (this.state.modes.length === 0) {
      this.state = { modes: DEFAULT_SEED.map((s) => this.makeMode(s)) }
      this.flush()
    }
  }

  private makeMode(seed: Pick<MetaMode, 'mode' | 'sources'> & { notes?: string }): MetaMode {
    return {
      id: randomUUID(),
      mode: seed.mode,
      sources: seed.sources,
      notes: seed.notes ?? '',
      updatedAt: new Date().toISOString()
    }
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { modes: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return { modes: Array.isArray(parsed.modes) ? parsed.modes : [] }
    } catch {
      return { modes: [] }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  list(): MetaMode[] {
    return [...this.state.modes]
  }

  get(id: string): MetaMode | null {
    return this.state.modes.find((m) => m.id === id) ?? null
  }

  addMode(seed: MetaModeSeed): MetaMode {
    const mode = this.makeMode(seed)
    this.state.modes.push(mode)
    this.scheduleWrite()
    return mode
  }

  updateMode(id: string, patch: Partial<MetaModeSeed>): MetaMode | null {
    const mode = this.get(id)
    if (!mode) return null
    if (patch.mode !== undefined) mode.mode = patch.mode
    if (patch.sources !== undefined) mode.sources = patch.sources
    if (patch.notes !== undefined) mode.notes = patch.notes
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return mode
  }

  removeMode(id: string): void {
    this.state.modes = this.state.modes.filter((m) => m.id !== id)
    this.scheduleWrite()
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/metaStore.ts src/main/metaStore.test.ts
git commit -m "feat(meta): MetaStore with seeded per-mode meta sources"
```

---

## Task 2: buildMetaReference

**Files:**
- Create: `src/main/metaPrompt.ts`
- Test: `src/main/metaPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/metaPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildMetaReference } from './metaPrompt'
import type { MetaMode } from './metaStore'

function mode(over: Partial<MetaMode> = {}): MetaMode {
  return {
    id: 'a', mode: 'WvW', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com' }],
    notes: '', updatedAt: 'x', ...over
  }
}

describe('buildMetaReference', () => {
  it('returns empty string when there are no modes', () => {
    expect(buildMetaReference([])).toBe('')
  })

  it('lists each mode + its source urls and the directive', () => {
    const out = buildMetaReference([mode()])
    expect(out).toContain('GW2 meta reference')
    expect(out).toContain('WvW')
    expect(out).toContain('https://metabattle.com')
    expect(out.toLowerCase()).toContain('cite')
  })

  it('includes notes when present, omits the notes line when empty', () => {
    expect(buildMetaReference([mode({ notes: 'scourge meta' })])).toContain('scourge meta')
    expect(buildMetaReference([mode({ notes: '' })])).not.toMatch(/notes:/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/metaPrompt.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './metaPrompt'`.

- [ ] **Step 3: Implement**

```ts
// src/main/metaPrompt.ts
//
// Builds the per-turn "GW2 meta reference" block appended to the system prompt:
// the current-meta ground-truth sources (+ notes) per game mode, so the model
// biases build/comp/squad advice toward meta and cites the right source. Returns
// '' (with no leading separator) when there are no modes — zero overhead.

import type { MetaMode } from './metaStore'

export function buildMetaReference(modes: MetaMode[]): string {
  if (modes.length === 0) return ''
  const lines = modes
    .map((m) => {
      const srcs = m.sources.map((s) => `${s.label} (${s.url})`).join(', ')
      const head = `- ${m.mode} — sources: ${srcs || 'none'}`
      return m.notes.trim() ? `${head}\n  notes: ${m.notes.trim()}` : head
    })
    .join('\n')
  return (
    `\n\n# GW2 meta reference\n` +
    `For build/comp/squad advice, treat these per-mode sources as the current-meta ` +
    `ground truth — prefer and cite them (e.g. "per Snowcrows…"), and flag when a ` +
    `build differs from meta. Still verify specifics via axiforge_catalog and ` +
    `gw2_api; never invent.\n` +
    lines
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/metaPrompt.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/metaPrompt.ts src/main/metaPrompt.test.ts
git commit -m "feat(meta): buildMetaReference prompt block"
```

---

## Task 3: Wire meta into the agent + IPC

**Files:**
- Modify: `src/main/agent.ts`, `src/main/index.ts`

- [ ] **Step 1: agent.ts — AgentDeps.meta + append the block**

Imports (near the `buildTurnSystemPrompt` import):

```ts
import { buildMetaReference } from './metaPrompt'
import type { MetaMode } from './metaStore'
```

Add to the `AgentDeps` interface (next to `skills`):

```ts
  /** Meta-reference modes, read fresh per turn (build/comp bias). */
  meta: () => MetaMode[]
```

In `runTurn`, change the `systemPrompt` line to append the meta block:

```ts
        systemPrompt:
          buildTurnSystemPrompt(AXIVALE_SYSTEM_PROMPT, skills, forced) +
          buildMetaReference(this.deps.meta()),
```

- [ ] **Step 2: index.ts — construct MetaStore, wire dep + IPC**

Import + construct (near the `SkillStore` construction):

```ts
import { MetaStore } from './metaStore'
```
```ts
  const meta = new MetaStore(join(app.getPath('userData'), 'meta.json'))
```

Add to the `new AgentService({ ... })` deps (next to `skills`):

```ts
    meta: () => meta.list(),
```

Add IPC handlers near the `skills:*` handlers:

```ts
  ipcMain.handle('meta:list', () => meta.list())
  ipcMain.handle('meta:add-mode', (_e, seed: { mode: string; sources: { label: string; url: string }[]; notes?: string }) =>
    meta.addMode(seed)
  )
  ipcMain.handle(
    'meta:update-mode',
    (_e, id: string, patch: Partial<{ mode: string; sources: { label: string; url: string }[]; notes: string }>) =>
      meta.updateMode(id, patch)
  )
  ipcMain.handle('meta:remove-mode', (_e, id: string) => meta.removeMode(id))
```

- [ ] **Step 3: Typecheck + main tests**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS.
Run: `npx vitest run src/main --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent.ts src/main/index.ts
git commit -m "feat(meta): inject meta reference into the turn + meta IPC"
```

---

## Task 4: Preload API

**Files:**
- Modify: `src/preload/index.ts`, `src/preload/index.d.ts`

- [ ] **Step 1: Bridge methods** (in `exposeInMainWorld('officer', { ... })`)

```ts
  metaList: () => ipcRenderer.invoke('meta:list'),
  metaAddMode: (seed: { mode: string; sources: { label: string; url: string }[]; notes?: string }) =>
    ipcRenderer.invoke('meta:add-mode', seed),
  metaUpdateMode: (
    id: string,
    patch: Partial<{ mode: string; sources: { label: string; url: string }[]; notes: string }>
  ) => ipcRenderer.invoke('meta:update-mode', id, patch),
  metaRemoveMode: (id: string) => ipcRenderer.invoke('meta:remove-mode', id),
```

- [ ] **Step 2: Types** (`src/preload/index.d.ts`)

```ts
export interface RendererMetaSource {
  label: string
  url: string
}
export interface RendererMetaMode {
  id: string
  mode: string
  sources: RendererMetaSource[]
  notes: string
  updatedAt: string
}
```
Add to `OfficerApi`:
```ts
  metaList(): Promise<RendererMetaMode[]>
  metaAddMode(seed: { mode: string; sources: RendererMetaSource[]; notes?: string }): Promise<RendererMetaMode>
  metaUpdateMode(
    id: string,
    patch: Partial<{ mode: string; sources: RendererMetaSource[]; notes: string }>
  ): Promise<RendererMetaMode | null>
  metaRemoveMode(id: string): Promise<void>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS. (If `App.test.tsx`'s `makeOfficer` mock must satisfy the full `OfficerApi`, add `metaList: vi.fn().mockResolvedValue([])`, `metaAddMode`/`metaUpdateMode`/`metaRemoveMode` resolved-default mocks.)

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts src/renderer/src/App.test.tsx
git commit -m "feat(meta): preload API for meta modes"
```

---

## Task 5: Meta panel

**Files:**
- Create: `src/renderer/src/components/panels/Meta.tsx`
- Test: `src/renderer/src/components/panels/Meta.test.tsx`

Read `src/renderer/src/components/panels/Skills.tsx` first and reuse its container/class conventions (`settings`, `sgroup`, `sinput`, `sbtn`, `srow`, `panel-empty`, `sk-*`/`shelp`).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/renderer/src/components/panels/Meta.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Meta from './Meta'

function officer(over: Record<string, unknown> = {}) {
  return {
    metaList: vi.fn().mockResolvedValue([
      { id: '1', mode: 'WvW', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com' }], notes: 'scourge', updatedAt: '' }
    ]),
    metaAddMode: vi.fn().mockResolvedValue({ id: '2', mode: 'PvE', sources: [], notes: '', updatedAt: '' }),
    metaUpdateMode: vi.fn().mockResolvedValue(null),
    metaRemoveMode: vi.fn().mockResolvedValue(undefined),
    ...over
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Meta panel', () => {
  it('lists modes with their notes', async () => {
    render(<Meta />)
    expect(await screen.findByText('WvW')).toBeTruthy()
    expect(screen.getByDisplayValue('scourge')).toBeTruthy()
  })

  it('saves edited notes', async () => {
    const update = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { officer: unknown }).officer = officer({ metaUpdateMode: update })
    render(<Meta />)
    const ta = (await screen.findByDisplayValue('scourge')) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'spellbreaker meta' } })
    fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0])
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('1', expect.objectContaining({ notes: 'spellbreaker meta' }))
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/components/panels/Meta.test.tsx --maxWorkers=2`
Expected: FAIL — `Cannot find module './Meta'`.

- [ ] **Step 3: Implement**

```tsx
// src/renderer/src/components/panels/Meta.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

export default function Meta(): ReactElement {
  const [modes, setModes] = useState<RendererMetaMode[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  async function refresh(): Promise<void> {
    const list = await window.officer.metaList()
    setModes(list)
    setDrafts(Object.fromEntries(list.map((m) => [m.id, m.notes])))
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function save(m: RendererMetaMode): Promise<void> {
    await window.officer.metaUpdateMode(m.id, { notes: drafts[m.id] ?? '' })
    await refresh()
  }

  return (
    <div className="settings meta-panel">
      <div className="sgroup">
        <p className="shelp">
          The AI treats these per-mode sources as current-meta ground truth for
          build/comp advice and cites them. Edit the notes as the meta shifts.
        </p>
      </div>
      {modes.length === 0 ? (
        <div className="panel-empty">No meta modes.</div>
      ) : (
        modes.map((m) => (
          <div className="sgroup meta-mode" key={m.id}>
            <h2>{m.mode}</h2>
            <div className="meta-sources">
              {m.sources.map((s) => (
                <a key={s.url} className="meta-src" href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ))}
            </div>
            <textarea
              className="sinput sk-area"
              placeholder="Current meta notes for this mode (e.g. comp staples, standout builds)"
              value={drafts[m.id] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
            />
            <div className="srow">
              <button className="sbtn" onClick={() => void save(m)}>
                Save notes
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/components/panels/Meta.test.tsx --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/panels/Meta.tsx src/renderer/src/components/panels/Meta.test.tsx
git commit -m "feat(meta): meta reference panel"
```

---

## Task 6: Nav entry + render + styles

**Files:**
- Modify: `src/renderer/src/components/Masthead.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/theme.css`

- [ ] **Step 1: Section + nav (Masthead.tsx)**

Extend the `Section` union to include `'meta'`:

```ts
export type Section = 'dispatches' | 'builds' | 'comps' | 'roster' | 'bureau' | 'skills' | 'meta' | 'settings'
```

Add a nav tuple to the data-driven nav array (after the `['06', 'skills', 'Skills']` entry), renumbering `settings` accordingly:

```ts
            ['07', 'meta', 'Meta'],
```

(If `settings` had `'07'`, bump it to `'08'`; match the array's existing numbering scheme.)

- [ ] **Step 2: Render the panel (App.tsx)**

Import near the other panels:

```ts
import Meta from './components/panels/Meta'
```
Render alongside the others:
```tsx
          {section === 'meta' && <Meta />}
```
If `SECTION_TITLES` exists, add `meta: 'Meta'`.

- [ ] **Step 3: Styles (theme.css)**

```css
/* ---- Meta panel ---- */
.meta-mode h2{margin-bottom:6px}
.meta-sources{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
.meta-src{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-b);text-decoration:none;border:1px solid var(--rule);padding:3px 8px}
.meta-src:hover{color:var(--ink);border-color:var(--rule2)}
```

- [ ] **Step 4: Typecheck + renderer tests + build**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer --maxWorkers=2`
Expected: PASS. (If a Masthead test enumerates sections, add `'meta'`.)
Run: `npm run build`
Expected: completes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Masthead.tsx src/renderer/src/App.tsx src/renderer/src/theme.css
git commit -m "feat(meta): Meta nav section, panel render, styles"
```

---

## Task 7: Full verification

**Files:** none.

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS.
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke test:** `npm run dev` → open **Meta** (nav 07): the seeded PvE / WvW / WvW Roaming modes show with source links; edit a mode's notes and Save. Then ask the agent "what's the current WvW zerg meta?" — it should defer to and cite the configured sources (MetaBattle/gw2mists/Hardstuck) rather than guessing, and reflect any notes you set.

---

## Self-Review Notes

- **Spec coverage:** MetaStore + seeded defaults (T1); buildMetaReference (T2); AgentDeps.meta + runTurn append + IPC (T3); preload (T4); panel (T5); nav/render/styles (T6); verify (T7). All mapped.
- **Type consistency:** `MetaMode`/`MetaSource` (T1) ↔ `RendererMetaMode`/`RendererMetaSource` (T4); `buildMetaReference(modes: MetaMode[])` (T2) matches the `runTurn` call (T3); `AgentDeps.meta: () => MetaMode[]` (T3) matches `meta: () => meta.list()` construction (T3). IPC channel names match preload methods.
- **Cross-task typecheck dip:** after T3 adds `AgentDeps.meta`, `index.ts` must supply it — both are in T3, so node typecheck is clean at T3's end.
