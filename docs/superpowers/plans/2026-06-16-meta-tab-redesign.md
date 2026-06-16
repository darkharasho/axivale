# Meta Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Meta tab the same rail-nav + card layout as the redesigned Settings tab, restyle the playbook modal, and promote the shared UI primitives so both tabs share them.

**Architecture:** Lift the meta data (modes list, busy/fetching, progress subscription) into `App.tsx` as the single source of truth; add an `activeMetaMode` selector. The left rail swaps `Editions` → `MetaNav` on the Meta tab (and the right rail is hidden), mirroring Settings. `Meta` becomes a presentational pane rendering an Overview or one mode's cards. `Pane`/`Card`/`Field`/`Segmented`/`Keyring` move from `settings/ui.tsx` to a neutral `components/panelui.tsx`.

**Tech Stack:** Electron + React + TypeScript (renderer), plain CSS (`theme.css`), Vite. Meta types live in `src/preload/index.d.ts` (`RendererMetaMode`, `RendererMetaSource`, `RendererPlaybook`, `RendererDerivedComp`, `RendererMetaProgress`).

**Spec:** `docs/superpowers/specs/2026-06-16-meta-tab-redesign-design.md`

**Verification gate used throughout** (must print nothing — pre-existing test-file errors are out of scope):
```
npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep 'error TS' | grep -v 'App.test.tsx'
```
Tests: `npx vitest run --maxWorkers=2 src/renderer` (must stay green: 115 passing).

---

## Task 1: Promote shared primitives to `components/panelui.tsx`

**Files:**
- Create: `src/renderer/src/components/panelui.tsx`
- Modify: the 7 settings section files' import path
- Delete: `src/renderer/src/components/settings/ui.tsx`

- [ ] **Step 1: Create `panelui.tsx` with the current `settings/ui.tsx` contents**

```bash
git mv src/renderer/src/components/settings/ui.tsx src/renderer/src/components/panelui.tsx
```
(Using `git mv` preserves history and is exact — no transcription. Do NOT hand-copy.)

- [ ] **Step 2: Update the 7 settings imports**

In each of these files, change `from './ui'` to `from '../panelui'`:
`src/renderer/src/components/settings/About.tsx`, `AxiTools.tsx`, `AxiForge.tsx`, `Dispatches.tsx`, `Gw2Keys.tsx`, `Intelligence.tsx`, `ReportRepos.tsx`.

Run to confirm none remain:
```bash
grep -rln "from './ui'" src/renderer/src/components/settings/
```
Expected: no output.

- [ ] **Step 3: Verification gate**

Run the gate command. Expected: empty.

- [ ] **Step 4: Tests + commit**

```bash
npx vitest run --maxWorkers=2 src/renderer 2>&1 | tail -3
git add -A src/renderer/src/components
git commit -m "refactor: promote shared panel primitives to components/panelui

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: CSS — `.sfield-area`, meta chip palette fix

**Files:**
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: Add a multi-line field input next to `.sfield-input`**

Find `.sfield-input::placeholder{color:var(--faint)}` and add immediately after it:
```css
.sfield-area{width:100%;border:1px solid var(--rule);background:rgba(0,0,0,.25);padding:9px 12px;font-size:13px;color:var(--ink);font-family:'IBM Plex Mono',monospace;outline:none;line-height:1.5;min-height:84px;resize:vertical}
.sfield-area:focus{border-color:var(--accent-b)}
```

- [ ] **Step 2: Fix the off-palette meta chip colors**

Replace these two rules in the `/* ---- Meta panel ---- */` section:
```css
.meta-chip.ok {
  color: #2c7a3f;
  border-color: #2c7a3f;
}
.meta-chip.error {
  color: #a33;
  border-color: #a33;
}
```
with:
```css
.meta-chip.ok {
  color: var(--green);
  border-color: var(--green);
}
.meta-chip.error {
  color: var(--accent-b);
  border-color: var(--accent-b);
}
```

- [ ] **Step 3: Add Meta source-chip (LED) + nav-spinner classes**

Append to the `/* ---- Meta panel ---- */` section:
```css
/* meta source chip with status LED (used in the redesigned Sources card) */
.meta-srcs{display:flex;flex-wrap:wrap;gap:8px}
.meta-srcchip{display:inline-flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-dim);border:1px solid var(--rule);padding:3px 9px;text-decoration:none}
.meta-srcchip:hover{border-color:var(--rule2);color:var(--ink)}
.meta-srcchip .led{width:5px;height:5px;border-radius:50%;background:var(--green);flex:none}
.meta-srcchip.error{color:var(--accent-b);border-color:var(--accent-b)}
.meta-srcchip.error .led{background:var(--accent-b)}
.meta-srcchip.never{opacity:.5}
.meta-srcchip.never .led{background:var(--faint)}
.meta-srcchip.fetching{color:var(--accent-b);border-color:var(--accent-b)}
.meta-srcchip.fetching .led{background:var(--accent-b)}
/* nav refreshing spinner (reuses meta-spin keyframes) */
.snav-item .meta-spin{margin-left:auto}
```

- [ ] **Step 4: Verification gate + commit**

Run the gate (empty). Then:
```bash
git add src/renderer/src/theme.css
git commit -m "style(meta): theme-palette status chips, .sfield-area, meta source-chip classes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Extract `ModeSummary` to `components/meta/ModeSummary.tsx`

**Files:**
- Create: `src/renderer/src/components/meta/ModeSummary.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Distilled summary rendered as markdown, capped behind a "see more" toggle so a
 *  long write-up doesn't dominate the panel until the reader asks for it. */
export default function ModeSummary({ notes }: { notes: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 4)
  }, [notes])

  if (!notes) {
    return <p className="meta-summary meta-summary-empty">No summary yet — awaiting first refresh.</p>
  }
  return (
    <div className="meta-summary-wrap">
      <div ref={ref} className={`meta-summary prose ${expanded ? 'expanded' : 'collapsed'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
      </div>
      {(overflows || expanded) && (
        <button className="meta-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Gate + commit**

Gate empty. Then:
```bash
git add src/renderer/src/components/meta/ModeSummary.tsx
git commit -m "feat(meta): extract ModeSummary component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Extract + restyle the playbook into `components/meta/PlaybookModal.tsx`

**Files:**
- Create: `src/renderer/src/components/meta/PlaybookModal.tsx`

This file exports both `PlaybookLauncher` (default) and the modal. Behavior is identical to the original `panels/Meta.tsx` (`metaUpdatePlaybook`, `metaDeriveComp`, save-on-blur, Escape-to-close); only the body markup is restyled into Card/Field language.

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import { Card, Field } from '../panelui'

/** The comp playbook itself, rendered inside a popup. Squad-comp concept, so it is
 *  only ever launched for the squad WvW mode (see PlaybookLauncher). */
function PlaybookModal({
  mode,
  onChange,
  onClose
}: {
  mode: RendererMetaMode
  onChange: () => void
  onClose: () => void
}): ReactElement {
  const pb = mode.playbook
  const [principles, setPrinciples] = useState(pb.principles)
  const [overrides, setOverrides] = useState(pb.overrides)
  const [deriving, setDeriving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const synced = useRef({ principles: pb.principles, overrides: pb.overrides })
  useEffect(() => {
    // Adopt only genuine external changes (e.g. a derive/refresh) — don't re-echo our
    // own saves over in-progress edits in the other field.
    if (pb.principles !== synced.current.principles) {
      setPrinciples(pb.principles)
      synced.current.principles = pb.principles
    }
    if (pb.overrides !== synced.current.overrides) {
      setOverrides(pb.overrides)
      synced.current.overrides = pb.overrides
    }
  }, [pb.principles, pb.overrides])

  // Close on Escape, like the app's other modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = (patch: { principles?: string; overrides?: string; blessed?: boolean }): void => {
    void window.officer.metaUpdatePlaybook(mode.id, patch).then(onChange)
  }
  const derive = (): void => {
    setDeriving(true)
    setMsg(null)
    void window.officer.metaDeriveComp(mode.id).then((r) => {
      setDeriving(false)
      setMsg(r.ok ? 'Derived from AxiBridge reports.' : r.error ?? 'Failed.')
      onChange()
    })
  }

  const d = pb.derived
  return (
    <div className="action-overlay meta-pb-overlay" onClick={onClose}>
      <div className="action-modal meta-pb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="action-modal__head">
          <span className="nm">Comp Playbook — {mode.mode}</span>
          <button className="action-modal__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="action-modal__body meta-playbook">
          <Card title="Baseline">
            <div className="sactions" style={{ marginTop: 0 }}>
              <label className="meta-bless">
                <input
                  type="checkbox"
                  checked={pb.blessed}
                  onChange={(e) => save({ blessed: e.target.checked })}
                />
                blessed (used by AI)
              </label>
              <button className="sbtn ghost meta-pb-derive" disabled={deriving} onClick={derive}>
                {deriving ? 'Deriving…' : 'Refresh from AxiBridge'}
              </button>
            </div>
            {msg && <p className="shelp meta-pb-msg">{msg}</p>}
            {d ? (
              <div className="meta-derived">
                <p className="meta-derived-meta">
                  <strong>{d.sampleSize} reports</strong> · {d.window.fromISO}–{d.window.toISO} ·{' '}
                  {d.sourceRepos.join(', ')}
                  {d.lowConfidence ? ' · low confidence' : ''} · squad ~{d.avgSquadSize},{' '}
                  {d.supportPct}% support
                </p>
                <p className="meta-derived-sub">
                  Subgroup: <strong>{d.subgroup.core.join(' + ')}</strong>
                  {d.subgroup.flex.length ? ` + flex (${d.subgroup.flex.join(' / ')})` : ''}
                </p>
                <div className="meta-derived-profs">
                  {d.professions.slice(0, 12).map((p, i) => (
                    <span className="meta-prof" key={`${p.name}-${i}`}>
                      {p.name}: {p.avgPerSquad}/squad ({p.presencePct}%, {p.runAs})
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="shelp meta-derived-empty">
                No derived baseline yet — click &quot;Refresh from AxiBridge&quot;.
              </p>
            )}
          </Card>

          {/* saves on blur; an unmount before blur drops the in-flight edit — acceptable for notes fields */}
          <Field label="Principles">
            <textarea
              id={`pb-principles-${mode.id}`}
              className="sfield-area"
              rows={6}
              value={principles}
              onChange={(e) => setPrinciples(e.target.value)}
              onBlur={() => save({ principles })}
            />
          </Field>
          <Field label="Guild overrides">
            <textarea
              id={`pb-overrides-${mode.id}`}
              className="sfield-area"
              rows={3}
              value={overrides}
              onChange={(e) => setOverrides(e.target.value)}
              onBlur={() => save({ overrides })}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

/** WvW-only launcher: a button (with a derived-state hint) that opens the comp
 *  playbook in a popup. */
export default function PlaybookLauncher({
  mode,
  onChange
}: {
  mode: RendererMetaMode
  onChange: () => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const d = mode.playbook.derived
  const hint = d ? `${d.sampleSize} reports · ${d.sourceRepos.join(', ')}` : 'not yet derived'
  return (
    <div className="meta-pb-launch">
      <button className="sbtn ghost meta-pb-btn" onClick={() => setOpen(true)}>
        Comp playbook
      </button>
      <span className={`meta-pb-hint${mode.playbook.blessed ? ' blessed' : ''}`}>
        {mode.playbook.blessed ? 'blessed · ' : ''}
        {hint}
      </span>
      {open && <PlaybookModal mode={mode} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Gate + commit**

Gate empty. Then:
```bash
git add src/renderer/src/components/meta/PlaybookModal.tsx
git commit -m "feat(meta): extract + restyle playbook modal into card/field language

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `components/meta/MetaNav.tsx`

**Files:**
- Create: `src/renderer/src/components/meta/MetaNav.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'

/** The Overview item uses this sentinel as its id. */
export const META_OVERVIEW = 'overview'

export default function MetaNav({
  modes,
  busy,
  active,
  onSelect
}: {
  modes: RendererMetaMode[]
  busy: Record<string, boolean>
  active: string
  onSelect: (id: string) => void
}): ReactElement {
  return (
    <nav className="rail left snav">
      <div className="snav-h">Meta</div>
      <button
        className={`snav-item${active === META_OVERVIEW ? ' on' : ''}`}
        onClick={() => onSelect(META_OVERVIEW)}
      >
        <span className="no">00</span>
        Overview
      </button>
      {modes.map((m, i) => (
        <button
          key={m.id}
          className={`snav-item${active === m.id ? ' on' : ''}`}
          onClick={() => onSelect(m.id)}
        >
          <span className="no">{String(i + 1).padStart(2, '0')}</span>
          {m.mode}
          {busy[m.id] ? (
            <span className="meta-spin" />
          ) : (
            <span className={`dot${m.refreshedAt ? '' : ' off'}`}>●</span>
          )}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Gate + commit**

Gate empty. Then:
```bash
git add src/renderer/src/components/meta/MetaNav.tsx
git commit -m "feat(meta): left-rail mode nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Presentational `components/meta/Meta.tsx`

**Files:**
- Create: `src/renderer/src/components/meta/Meta.tsx`

Receives all data as props (App owns it). Renders the Overview or one mode's cards.

- [ ] **Step 1: Create the file**

```tsx
import type { ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import { Pane, Card } from '../panelui'
import ModeSummary from './ModeSummary'
import PlaybookLauncher from './PlaybookModal'
import MetaIndexInspector from '../MetaIndexInspector'
import { META_OVERVIEW } from './MetaNav'

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

export interface MetaProps {
  modes: RendererMetaMode[]
  active: string
  busy: Record<string, boolean>
  fetching: Record<string, string | null>
  onRefresh: () => void
}

export default function Meta({ modes, active, busy, fetching, onRefresh }: MetaProps): ReactElement {
  if (active === META_OVERVIEW) {
    return (
      <div className="settings meta-panel">
        <Pane
          no="00"
          title="Meta"
          sub="What AxiVale currently knows about the live meta per game mode. It refreshes automatically from the listed sources in the background and uses this to bias build and comp advice — nothing to edit."
        >
          {import.meta.env.DEV && (
            <Card title="Developer">
              <div className="sactions" style={{ marginTop: 0 }}>
                <button className="sbtn" onClick={() => void window.officer.metaForceRefresh()}>
                  Force re-crawl
                </button>
              </div>
            </Card>
          )}
          {modes.length === 0 && <div className="panel-empty">No meta modes.</div>}
        </Pane>
        {import.meta.env.DEV && <MetaIndexInspector />}
      </div>
    )
  }

  const m = modes.find((x) => x.id === active)
  if (!m) {
    return (
      <div className="settings meta-panel">
        <div className="panel-empty">Select a mode.</div>
      </div>
    )
  }

  const status = busy[m.id] ? (
    <span className="meta-refreshing">
      <span className="meta-spin" /> refreshing…
    </span>
  ) : (
    <span className="meta-fresh">{ago(m.refreshedAt)}</span>
  )

  return (
    <div className="settings meta-panel">
      <Pane no={String(modes.indexOf(m) + 1).padStart(2, '0')} title={m.mode} sub="">
        <div className="meta-pane-status">{status}</div>
        <Card title="Summary">
          <ModeSummary notes={m.notes} />
        </Card>
        <Card title="Sources">
          <div className="meta-srcs">
            {m.sources.map((s) => {
              const isFetching = fetching[m.id] === s.url
              const cls = isFetching ? 'fetching' : s.status
              return (
                <a
                  key={s.url}
                  className={`meta-srcchip ${cls}`}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.error ?? undefined}
                >
                  <span className="led" />
                  {s.label}
                  {isFetching ? ' · fetching…' : ''}
                </a>
              )
            })}
          </div>
        </Card>
        {/* Squad-comp playbook is WvW-only; Roaming/PvE never show it. */}
        {m.mode === 'WvW' && (
          <Card title="Comp playbook">
            <PlaybookLauncher mode={m} onChange={onRefresh} />
          </Card>
        )}
      </Pane>
    </div>
  )
}
```

- [ ] **Step 2: Add the one new class used above (`.meta-pane-status`)**

In `theme.css`, in the Meta section, append:
```css
.meta-pane-status{margin:-14px 0 16px}
```
(The Pane title has no `sub`, so this lifts the status line up under the title.)

- [ ] **Step 3: Gate + commit**

Gate empty. Then:
```bash
git add src/renderer/src/components/meta/Meta.tsx src/renderer/src/theme.css
git commit -m "feat(meta): presentational card-based Meta pane

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Lift meta data into `App.tsx`, wire the rail swap, delete old panel

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Delete: `src/renderer/src/components/panels/Meta.tsx`

- [ ] **Step 1: Imports**

In `src/renderer/src/App.tsx`, line 11 currently reads `import Meta from './components/panels/Meta'`. Replace it with:
```tsx
import Meta from './components/meta/Meta'
import MetaNav, { META_OVERVIEW } from './components/meta/MetaNav'
```
App.tsx already imports renderer types at line 21: `import type { RendererConversation, RendererSkill } from '../../preload/index.d'`. Extend that line to add the meta types (same module path `'../../preload/index.d'`):
```tsx
import type { RendererConversation, RendererSkill, RendererMetaMode, RendererMetaProgress } from '../../preload/index.d'
```

- [ ] **Step 2: Add meta state + data ownership (near `settingsSection`)**

```tsx
const [metaModes, setMetaModes] = useState<RendererMetaMode[]>([])
const [metaBusy, setMetaBusy] = useState<Record<string, boolean>>({})
const [metaFetching, setMetaFetching] = useState<Record<string, string | null>>({})
const [activeMetaMode, setActiveMetaMode] = useState<string>(META_OVERVIEW)

function refreshMeta(): void {
  void window.officer.metaList().then(setMetaModes)
}
useEffect(() => {
  refreshMeta()
  return window.officer.onMetaProgress((e: RendererMetaProgress) => {
    if (e.type === 'mode-start') setMetaBusy((b) => ({ ...b, [e.modeId]: true }))
    else if (e.type === 'source-start') setMetaFetching((f) => ({ ...f, [e.modeId]: e.url }))
    else if (e.type === 'mode-done') {
      setMetaBusy((b) => ({ ...b, [e.modeId]: false }))
      setMetaFetching((f) => ({ ...f, [e.modeId]: null }))
      refreshMeta()
    }
  })
}, [])
```

- [ ] **Step 3: Rail swap — extend the ternary**

Change:
```tsx
{section === 'settings' ? (
  <SettingsNav active={settingsSection} onSelect={setSettingsSection} status={settingsNavStatus} />
) : (
  <Editions ... />
)}
```
to:
```tsx
{section === 'settings' ? (
  <SettingsNav active={settingsSection} onSelect={setSettingsSection} status={settingsNavStatus} />
) : section === 'meta' ? (
  <MetaNav modes={metaModes} busy={metaBusy} active={activeMetaMode} onSelect={setActiveMetaMode} />
) : (
  <Editions ... />
)}
```
(Keep the full existing `<Editions ... />` element unchanged in the final branch.)

- [ ] **Step 4: Render the new Meta with props**

Replace `{section === 'meta' && <Meta />}` with:
```tsx
{section === 'meta' && (
  <Meta
    modes={metaModes}
    active={activeMetaMode}
    busy={metaBusy}
    fetching={metaFetching}
    onRefresh={refreshMeta}
  />
)}
```

- [ ] **Step 5: Hide the right rail on Meta too**

Change `{section !== 'settings' && (<RightRail ... />)}` to:
```tsx
{section !== 'settings' && section !== 'meta' && (
  <RightRail memberCount={memberCount} buildsCount={buildsCount} turns={turns} />
)}
```

- [ ] **Step 6: Delete the old panel**

```bash
git rm src/renderer/src/components/panels/Meta.tsx
```

- [ ] **Step 7: Verification gate**

Run the gate. Expected: empty. (If `App.test.tsx` gains a new error because it referenced the old Meta, that is a real test that must keep compiling — but `App.test.tsx`'s pre-existing error is filtered. If a NEW error appears in `App.test.tsx` specifically about Meta, fix the test mock minimally; otherwise leave test files alone.)

- [ ] **Step 8: Tests + commit**

```bash
npx vitest run --maxWorkers=2 src/renderer 2>&1 | tail -3
git add -A src/renderer/src
git commit -m "feat(meta): App owns meta data, rail-swap nav + hide right rail on meta

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Cleanup dead meta CSS

**Files:**
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: Find now-unused meta classes**

```bash
for c in meta-mode meta-sources meta-src meta-srcrow meta-chip; do
  echo "=== .$c ==="; grep -rln "\b$c\b" src/renderer/src --include=*.tsx
done
```
The redesigned Meta uses `.meta-srcchip` (new), `.meta-summary*`, `.meta-more`, `.meta-fresh`, `.meta-refreshing`, `.meta-spin`, `.meta-derived*`, `.meta-prof`, `.meta-pb-*`, `.meta-bless`, `.meta-panel`, `.meta-pane-status`. The OLD `.meta-mode`, `.meta-sources`, `.meta-src`, `.meta-srcrow`, `.meta-chip*` are no longer referenced by any `.tsx`.

- [ ] **Step 2: Remove only the confirmed-unreferenced rules**

Delete from `theme.css` the rules that Step 1 shows have ZERO `.tsx` references (expected: `.meta-mode h2`, `.meta-sources`, `.meta-src`, `.meta-src:hover`, `.meta-srcrow`, `.meta-chip`, `.meta-chip.ok`, `.meta-chip.error`, `.meta-chip.never`, `.meta-chip.fetching`). Keep everything still referenced. If any of the above unexpectedly still has a reference, keep it.

- [ ] **Step 3: Gate + tests + commit**

Gate empty; tests green. Then:
```bash
git add src/renderer/src/theme.css
git commit -m "chore(meta): remove dead pre-redesign meta css

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Shared primitives → `panelui.tsx` + settings imports updated → Task 1. ✓
- `.sfield-area`, chip palette fix, source-chip classes → Task 2. ✓
- `ModeSummary` extracted → Task 3. ✓
- Playbook modal extracted + restyled (Baseline card, Field textareas) → Task 4. ✓
- `MetaNav` (Overview + per-mode, status dots/spinner) → Task 5. ✓
- Presentational `Meta` (Overview + mode cards, LED source chips) → Task 6. ✓
- App owns meta data (modes/busy/fetching/progress), `activeMetaMode`, rail swap, right-rail hidden, old panel deleted → Task 7. ✓
- Dead-CSS cleanup → Task 8. ✓
- Behavior preserved (handlers/IPC unchanged; only ownership moved) → Tasks 4, 6, 7. ✓

**Deviation from spec (intentional):** default `activeMetaMode` is `META_OVERVIEW` (show the intro first), not the first mode. Cleaner landing; noted here.

**Placeholder scan:** No TBD/TODO. The only decision-rule steps are Task 7 Step 1 (preload type import path — instructed to mirror an existing import) and Task 8 (delete-if-unreferenced, with the expected list). Both give exact rules.

**Type consistency:** `META_OVERVIEW` exported from `MetaNav.tsx`, imported by `Meta.tsx` and `App.tsx`. `RendererMetaMode`/`RendererMetaProgress` from `preload/index.d`. `Meta` props (`modes/active/busy/fetching/onRefresh`) match App's state + `refreshMeta`. `MetaNav` props (`modes/busy/active/onSelect`) match App. `PlaybookLauncher` default export imported by `Meta.tsx`; `Card`/`Field`/`Pane` imported from `../panelui` (post-Task-1 location).
```
