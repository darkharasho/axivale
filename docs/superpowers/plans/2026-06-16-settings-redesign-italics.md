# Settings Redesign + Italics De-bold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make italic text upright wherever it's a default style, and rebuild the Settings view into a rail-navigated, card-based layout with a consistent control language.

**Architecture:** `theme.css` gets the italic removals plus a new Settings control-class set. `App.tsx` becomes view-aware: on the Settings tab the left rail renders a new `SettingsNav` instead of `Editions`, the right rail is hidden, and the pane shows one section at a time driven by new `settingsSection` state. `Settings.tsx` keeps all ~50 state hooks + IPC handlers (the data owner) and becomes a thin dispatcher that renders one of seven new presentational section components, which use shared primitives.

**Tech Stack:** Electron + React + TypeScript (renderer in `src/renderer/src`), plain CSS (`theme.css`), Vite (`npm run dev`), `tsc`/`vue-tsc`-style typecheck via the project's build.

**Spec:** `docs/superpowers/specs/2026-06-16-settings-redesign-and-italics-design.md`

**Verification convention used throughout:**
- Typecheck: `npm run typecheck` if it exists, else `npx tsc --noEmit -p src/renderer` (confirm the renderer tsconfig path in Task 0).
- Visual/behavior: `npm run dev`, open the app, click the **Settings** tab (nav item 08).
- Per global instructions, if any vitest is run use `--maxWorkers=2`.

---

## Task 0: Confirm tooling commands

**Files:** none (read-only)

- [ ] **Step 1: Find the typecheck + dev commands**

Run:
```bash
cat package.json | sed -n '/"scripts"/,/}/p'
```
Expected: note the exact `dev` and typecheck/lint script names. If a `typecheck` script exists, use it everywhere below; otherwise use `npx tsc --noEmit` against the renderer tsconfig (find it: `ls src/renderer/tsconfig*.json` or root `tsconfig*.json`).

- [ ] **Step 2: Baseline build is green**

Run the typecheck command.
Expected: PASS (no errors) on the current `main`/branch state, so later failures are attributable to our changes.

No commit (read-only task).

---

## Task 1: De-bold the italics (`theme.css`)

**Files:**
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: List every italic default**

Run:
```bash
grep -n "font-style:italic\|font-style: italic" src/renderer/src/theme.css
```
Expected: a list of hits. Compare against the spec's table. Every hit EXCEPT genuine markdown emphasis is a target. (`.prose em` / default `<em>` is NOT in `theme.css` as `font-style:italic` — if a hit corresponds to real emphasis, leave it.)

- [ ] **Step 2: Remove `font-style:italic` from each default-style selector**

For each selector below, delete only the `font-style:italic` declaration (and its trailing/leading `;`), leaving every other property intact. These are the spec targets:

`.folio h1`, `.msg.user .body`, `.prose blockquote`, `.edition .ed-headline`, `.edition .ed-rename`, `.field`, `.field::placeholder`, `.notice .nask`, `.sgroup h2`, `.ssub`, `.shelp`, `.clspick-btn .ph`, `.cname`, `.bnone`, `.sname`, `.sd-sub`, `.cs-title`, `.cs-build-note`.

Example edits:
```css
/* before */ .folio h1{font-family:'Playfair Display',serif;font-size:16px;font-weight:700;font-style:italic}
/* after  */ .folio h1{font-family:'Playfair Display',serif;font-size:16px;font-weight:700}
```
```css
/* before */ .field{flex:1;border:none;border-bottom:1.5px dashed var(--rule2);padding:7px 2px;font-size:15px;font-style:italic;color:var(--ink);background:transparent;font-family:'Source Serif 4',serif;outline:none;caret-color:var(--accent-b)}
/* after  */ .field{flex:1;border:none;border-bottom:1.5px dashed var(--rule2);padding:7px 2px;font-size:15px;color:var(--ink);background:transparent;font-family:'Source Serif 4',serif;outline:none;caret-color:var(--accent-b)}
```
```css
/* before */ .field::placeholder{color:var(--faint);font-style:italic}
/* after  */ .field::placeholder{color:var(--faint)}
```
Apply the same single-declaration removal to the remaining selectors in the list. For multi-line rules (`.cs-title`, `.cs-build-note`) delete the `font-style: italic;` line.

- [ ] **Step 3: Verify no default italics remain**

Run:
```bash
grep -n "font-style:italic\|font-style: italic" src/renderer/src/theme.css
```
Expected: only hits that are genuine emphasis, if any (per Step 1 there should be none left in the target list).

- [ ] **Step 4: Typecheck**

Run the typecheck command.
Expected: PASS (CSS-only change; build unaffected).

- [ ] **Step 5: Visual check**

`npm run dev`. Confirm: chat message bodies, help text, blockquotes, the input field placeholder, edition headlines in the left rail, and section headings are all upright; a chat reply containing `*emphasis*` still renders italic.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "style: make default italics upright for legibility

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add the Settings control-class CSS (`theme.css`)

**Files:**
- Modify: `src/renderer/src/theme.css`

These classes back the new components in later tasks. Add them in the `/* settings */` region (after line ~277). Do NOT remove existing `.picker`/`.pi`/`.sinput` etc. yet — non-Settings views still use them, and Settings is rewritten incrementally.

- [ ] **Step 1: Append the new classes**

Add to `theme.css`:
```css
/* ---- Settings redesign ---- */
/* left-rail section nav (replaces editions on the Settings tab) */
.snav{padding:18px 12px 18px 0;font-family:'IBM Plex Mono',monospace}
.snav-h{font-size:8.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-dim);border-bottom:1px dashed var(--rule2);padding-bottom:6px;margin-bottom:10px}
.snav-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:none;border:none;padding:8px 10px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-dim);cursor:pointer;border-left:2px solid transparent}
.snav-item .no{color:var(--faint);font-size:9px}
.snav-item:hover{color:var(--ink);background:rgba(228,227,220,.04)}
.snav-item.on{color:var(--ink);border-left-color:var(--accent);background:rgba(200,66,58,.08)}
.snav-item.on .no{color:var(--accent-b)}
.snav-item .dot{margin-left:auto;font-size:7px;color:var(--green)}
.snav-item .dot.off{color:var(--faint)}

/* pane header */
.spane{padding:22px 0;max-width:620px}
.spane-kick{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.26em;text-transform:uppercase;color:var(--accent-b);margin-bottom:5px}
.spane-h{font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-bottom:4px}
.spane-sub{font-size:13.5px;color:var(--ink-dim);margin-bottom:22px;line-height:1.5}

/* grouping card */
.scard{border:1px solid var(--line);background:rgba(0,0,0,.14);margin-bottom:18px}
.scard-h{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);background:rgba(0,0,0,.18)}
.scard-t{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-dim)}
.scard-s{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.06em;color:var(--ink-dim);display:flex;align-items:center;gap:6px}
.scard-s.ok{color:var(--green)}
.scard-s.err{color:var(--accent-b)}
.scard-s .led{width:6px;height:6px;border-radius:50%;background:currentColor}
.scard-b{padding:16px}

/* field */
.sfield{margin-bottom:14px}
.sfield:last-child{margin-bottom:0}
.sfield .slabel{margin-bottom:6px}
.sfield-input{width:100%;border:1px solid var(--rule);background:rgba(0,0,0,.25);padding:9px 12px;font-size:13px;color:var(--ink);font-family:'IBM Plex Mono',monospace;outline:none}
.sfield-input:focus{border-color:var(--accent-b)}
.sfield-input::placeholder{color:var(--faint)}

/* segmented toggle */
.sseg{display:inline-flex;border:1px solid var(--rule2);margin-bottom:22px}
.sseg button{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-dim);background:transparent;border:none;border-right:1px solid var(--rule2);padding:8px 16px;cursor:pointer}
.sseg button:last-child{border-right:none}
.sseg button.on{color:#fff;background:var(--accent)}

/* chip group */
.schips{display:flex;flex-wrap:wrap;gap:7px}
.schip{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-dim);border:1px solid var(--rule2);background:rgba(0,0,0,.22);padding:6px 12px;cursor:pointer}
.schip.on{color:#fff;background:var(--accent);border-color:var(--accent)}
.schip:disabled{opacity:.5;cursor:default}

/* keyring rows */
.skeys{display:flex;flex-direction:column;border:1px solid var(--line);margin-bottom:14px}
.skey{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-dim);border:none;border-bottom:1px solid var(--line);background:none;cursor:pointer}
.skey:last-child{border-bottom:none}
.skey.on{color:var(--ink);background:rgba(200,66,58,.06)}
.skey .rad{width:7px;height:7px;border-radius:50%;border:1px solid var(--rule2);flex:none}
.skey.on .rad{background:var(--accent);border-color:var(--accent)}
.skey .badge{margin-left:auto;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-b)}
.skey .kx{color:var(--faint);cursor:pointer;padding-left:6px}
.skey .kx:hover{color:var(--accent-b)}

/* action row + ghost button */
.sactions{display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap}
.sbtn.ghost{color:var(--ink-dim);background:transparent;border:1px solid var(--rule2);outline:none}
.sbtn.ghost:hover{color:var(--ink);border-color:var(--ink-dim)}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command.
Expected: PASS (CSS-only).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "style: add settings redesign control classes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Shared Settings primitives (`settings/ui.tsx`)

**Files:**
- Create: `src/renderer/src/components/settings/ui.tsx`

These are presentational helpers used by every section. `Keyring` here replaces the one currently inside `Settings.tsx`.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/components/settings/ui.tsx`:
```tsx
import type { ReactElement, ReactNode } from 'react'

export interface KeyLabel {
  label: string
  active: boolean
}

/** Section pane wrapper: kicker + title + one-line description, then children. */
export function Pane({
  no,
  title,
  sub,
  children
}: {
  no: string
  title: string
  sub: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="spane">
      <div className="spane-kick">Section {no}</div>
      <h2 className="spane-h">{title}</h2>
      <p className="spane-sub">{sub}</p>
      {children}
    </div>
  )
}

/** Grouping card with a header bar (title + optional status) and a padded body. */
export function Card({
  title,
  status,
  children
}: {
  title: string
  status?: { msg: string; tone?: 'ok' | 'err' | 'dim' }
  children: ReactNode
}): ReactElement {
  return (
    <div className="scard">
      <div className="scard-h">
        <span className="scard-t">{title}</span>
        {status && (
          <span className={`scard-s ${status.tone ?? 'dim'}`}>
            <span className="led" />
            {status.msg}
          </span>
        )}
      </div>
      <div className="scard-b">{children}</div>
    </div>
  )
}

/** Labelled input field with optional help text below. */
export function Field({
  label,
  help,
  children
}: {
  label?: string
  help?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <div className="sfield">
      {label && <label className="slabel">{label}</label>}
      {children}
      {help && <p className="shelp">{help}</p>}
    </div>
  )
}

/** Connected segmented toggle. */
export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}): ReactElement {
  return (
    <div className="sseg">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Keyring: bordered rows, click to activate, ✕ to remove. */
export function Keyring({
  keys,
  onActivate,
  onRemove
}: {
  keys: KeyLabel[]
  onActivate: (label: string) => void
  onRemove: (label: string) => void
}): ReactElement | null {
  if (keys.length === 0) return null
  return (
    <div className="skeys">
      {keys.map((k) => (
        <button
          key={k.label}
          className={`skey${k.active ? ' on' : ''}`}
          onClick={() => onActivate(k.label)}
        >
          <span className="rad" />
          {k.label}
          {k.active && <span className="badge">active</span>}
          <span
            className="kx"
            title={`Remove "${k.label}"`}
            onClick={(e) => {
              e.stopPropagation()
              onRemove(k.label)
            }}
          >
            ✕
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command.
Expected: PASS. (Unused-export warnings are fine; consumers come in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/settings/ui.tsx
git commit -m "feat(settings): shared presentational primitives

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: SettingsNav component (`settings/SettingsNav.tsx`)

**Files:**
- Create: `src/renderer/src/components/settings/SettingsNav.tsx`

- [ ] **Step 1: Create the file**

Create `src/renderer/src/components/settings/SettingsNav.tsx`:
```tsx
import type { ReactElement } from 'react'

export type SettingsSection =
  | 'intelligence'
  | 'gw2'
  | 'axitools'
  | 'axiforge'
  | 'repos'
  | 'dispatches'
  | 'about'

/** Which sections show a "configured" status dot. Sections not listed show no dot. */
export interface SettingsNavStatus {
  intelligence?: boolean
  gw2?: boolean
  axitools?: boolean
  axiforge?: boolean
  repos?: boolean
}

const ITEMS: Array<{ key: SettingsSection; no: string; label: string; hasDot: boolean }> = [
  { key: 'intelligence', no: '01', label: 'Intelligence', hasDot: true },
  { key: 'gw2', no: '02', label: 'GW2 Keys', hasDot: true },
  { key: 'axitools', no: '03', label: 'AxiTools', hasDot: true },
  { key: 'axiforge', no: '04', label: 'AxiForge', hasDot: true },
  { key: 'repos', no: '05', label: 'Report Repos', hasDot: true },
  { key: 'dispatches', no: '06', label: 'Dispatches', hasDot: false },
  { key: 'about', no: '07', label: 'About', hasDot: false }
]

export default function SettingsNav({
  active,
  onSelect,
  status
}: {
  active: SettingsSection
  onSelect: (s: SettingsSection) => void
  status: SettingsNavStatus
}): ReactElement {
  return (
    <nav className="rail left snav">
      <div className="snav-h">Settings</div>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`snav-item${active === it.key ? ' on' : ''}`}
          onClick={() => onSelect(it.key)}
        >
          <span className="no">{it.no}</span>
          {it.label}
          {it.hasDot && (
            <span className={`dot${status[it.key as keyof SettingsNavStatus] ? '' : ' off'}`}>
              ●
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/settings/SettingsNav.tsx
git commit -m "feat(settings): left-rail section nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Section components — About + Dispatches (simplest two)

Start with the two stateless-ish sections to validate the prop-bag pattern before the big ones.

**Files:**
- Create: `src/renderer/src/components/settings/About.tsx`
- Create: `src/renderer/src/components/settings/Dispatches.tsx`

- [ ] **Step 1: Create `About.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card } from './ui'

export interface AboutProps {
  version: string
  updateMsg: string
  onCheckUpdates: () => void
}

export default function About({ version, updateMsg, onCheckUpdates }: AboutProps): ReactElement {
  return (
    <Pane no="07" title="About" sub="Version and updates.">
      <Card title="AxiVale">
        <div className="sactions">
          <div className="countline">
            AxiVale <b>v{version || '—'}</b>
          </div>
          <button className="sbtn ghost" onClick={onCheckUpdates}>
            Check for updates
          </button>
        </div>
        {updateMsg && <div className="sstatus ok">{updateMsg}</div>}
        <p className="shelp">
          Updates install automatically from GitHub releases; a banner appears when a new
          edition is ready.
        </p>
      </Card>
    </Pane>
  )
}
```

- [ ] **Step 2: Create `Dispatches.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card } from './ui'

export interface ShareEntry {
  id: string
  kind: string
  title: string
  url: string
  createdAt: string
}

export interface DispatchesProps {
  shareEntries: ShareEntry[]
  onDelete: (id: string) => void
}

export default function Dispatches({ shareEntries, onDelete }: DispatchesProps): ReactElement {
  return (
    <Pane
      no="06"
      title="Shared Dispatches"
      sub="Public links you have published to your GitHub Pages share site. Deleting one removes it from the web."
    >
      <Card title="Published">
        {shareEntries.length === 0 ? (
          <div className="sstatus">You haven&apos;t shared anything yet.</div>
        ) : (
          <ul className="share-list">
            {shareEntries.map((s) => (
              <li key={s.id} className="share-list-row">
                <div className="share-list-meta">
                  <span className="share-list-title">{s.title || 'Untitled'}</span>
                  <span className="share-list-kind">{s.kind}</span>
                </div>
                <div className="share-list-acts">
                  <a className="sbtn ghost" href={s.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="sbtn ghost" onClick={() => onDelete(s.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Pane>
  )
}
```

- [ ] **Step 3: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/About.tsx src/renderer/src/components/settings/Dispatches.tsx
git commit -m "feat(settings): About and Dispatches sections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Section components — AxiForge + AxiTools

**Files:**
- Create: `src/renderer/src/components/settings/AxiForge.tsx`
- Create: `src/renderer/src/components/settings/AxiTools.tsx`

- [ ] **Step 1: Create `AxiForge.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card } from './ui'

export type ForgeStatus =
  | { state: 'connected'; version: string }
  | { state: 'file-only' }
  | { state: 'offline' }
  | null

export interface AxiForgeProps {
  forgeStatus: ForgeStatus
  forgeLaunching: boolean
  onLaunch: () => void
  onRecheck: () => void
}

export default function AxiForge({
  forgeStatus,
  forgeLaunching,
  onLaunch,
  onRecheck
}: AxiForgeProps): ReactElement {
  const status =
    forgeStatus === null
      ? { msg: 'checking…', tone: 'dim' as const }
      : forgeStatus.state === 'connected'
        ? { msg: `connected · v${forgeStatus.version}`, tone: 'ok' as const }
        : forgeStatus.state === 'file-only'
          ? { msg: 'file-only · builds read from disk', tone: 'ok' as const }
          : { msg: 'not found', tone: 'err' as const }
  return (
    <Pane no="04" title="AxiForge" sub="Local build & comp editor connection.">
      <Card title="Connection" status={status}>
        {forgeStatus?.state === 'offline' && (
          <p className="shelp">Not found — install AxiForge via AxiOM.</p>
        )}
        <div className="sactions">
          {forgeStatus &&
            forgeStatus.state !== 'connected' &&
            forgeStatus.state !== 'offline' && (
              <button className="sbtn" disabled={forgeLaunching} onClick={onLaunch}>
                {forgeLaunching ? 'Starting…' : 'Launch AxiForge'}
              </button>
            )}
          <button className="sbtn ghost" onClick={onRecheck}>
            Recheck
          </button>
        </div>
        <p className="shelp">
          AxiVale edits AxiForge builds and comps through its local API. No setup needed — the
          connection is discovered automatically when AxiForge runs on this machine.
        </p>
      </Card>
    </Pane>
  )
}
```

- [ ] **Step 2: Create `AxiTools.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card, Field, Keyring, type KeyLabel } from './ui'

export interface AxiGuild {
  id: string
  name: string
}

export interface AxiToolsProps {
  axiKeys: KeyLabel[]
  axiLabel: string
  axiKey: string
  axiStatus: { msg: string; ok: boolean } | null
  axiGuild: AxiGuild | null
  setAxiLabel: (v: string) => void
  setAxiKey: (v: string) => void
  onActivate: (label: string) => void
  onRemove: (label: string) => void
  onAdd: () => void
}

export default function AxiTools(p: AxiToolsProps): ReactElement {
  return (
    <Pane
      no="03"
      title="AxiTools"
      sub="Discord server keys. The active key decides which server AxiVale acts on."
    >
      <Card title="Server keys">
        <Keyring keys={p.axiKeys} onActivate={p.onActivate} onRemove={p.onRemove} />
        <Field label="Label">
          <input
            className="sfield-input"
            type="text"
            value={p.axiLabel}
            placeholder="e.g. EWW server"
            onChange={(e) => p.setAxiLabel(e.target.value)}
          />
        </Field>
        <Field
          label="Key"
          help={
            <>
              In each Discord server, run <code>/config apikey generate</code> (requires Manage
              Server) and add the key here.
            </>
          }
        >
          <input
            className="sfield-input"
            type="password"
            value={p.axiKey}
            placeholder="paste key from Discord"
            onChange={(e) => p.setAxiKey(e.target.value)}
          />
        </Field>
        <div className="sactions">
          <button className="sbtn" disabled={!p.axiKey} onClick={p.onAdd}>
            Add &amp; connect
          </button>
        </div>
        {p.axiStatus && (
          <div className={`sstatus ${p.axiStatus.ok ? 'ok' : 'err'}`}>{p.axiStatus.msg}</div>
        )}
        {p.axiGuild && (
          <div className="perm">
            Bound to <b>{p.axiGuild.name}</b> · {p.axiGuild.id}
          </div>
        )}
      </Card>
    </Pane>
  )
}
```

- [ ] **Step 3: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/AxiForge.tsx src/renderer/src/components/settings/AxiTools.tsx
git commit -m "feat(settings): AxiForge and AxiTools sections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Section component — GW2 Keys

**Files:**
- Create: `src/renderer/src/components/settings/Gw2Keys.tsx`

- [ ] **Step 1: Create `Gw2Keys.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card, Field, Keyring, type KeyLabel } from './ui'

export interface Gw2Info {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: Array<{ id: string; name: string; tag: string; leader: boolean }>
}

export interface Gw2KeysProps {
  gw2Keys: KeyLabel[]
  gw2Label: string
  gw2Key: string
  gw2Status: { msg: string; ok: boolean } | null
  gw2Info: Gw2Info | null
  gw2GuildId: string | null
  setGw2Label: (v: string) => void
  setGw2Key: (v: string) => void
  onActivate: (label: string) => void
  onRemove: (label: string) => void
  onAdd: () => void
  onPickGuild: (id: string) => void
}

export default function Gw2Keys(p: Gw2KeysProps): ReactElement {
  return (
    <Pane no="02" title="GW2 API Keys" sub="Guild Wars 2 account keys and the active guild.">
      <Card title="Keys">
        <Keyring keys={p.gw2Keys} onActivate={p.onActivate} onRemove={p.onRemove} />
        <Field label="Label">
          <input
            className="sfield-input"
            type="text"
            value={p.gw2Label}
            placeholder="e.g. main account"
            onChange={(e) => p.setGw2Label(e.target.value)}
          />
        </Field>
        <Field label="API key">
          <input
            className="sfield-input"
            type="password"
            value={p.gw2Key}
            placeholder="paste API key"
            onChange={(e) => p.setGw2Key(e.target.value)}
          />
        </Field>
        <div className="sactions">
          <button className="sbtn" disabled={!p.gw2Key} onClick={p.onAdd}>
            Add &amp; verify
          </button>
        </div>
        {p.gw2Status && (
          <div className={`sstatus ${p.gw2Status.ok ? 'ok' : 'err'}`}>{p.gw2Status.msg}</div>
        )}
      </Card>
      {p.gw2Info && (
        <Card title="Account">
          <div className="perm">
            Permissions: {p.gw2Info.permissions.join(', ') || '—'}
            {p.gw2Info.missingPermissions.length > 0 && (
              <div className="miss">Missing: {p.gw2Info.missingPermissions.join(', ')}</div>
            )}
          </div>
          {p.gw2Info.guilds.length > 0 && (
            <div className="schips" style={{ marginTop: '10px' }}>
              {p.gw2Info.guilds.map((g) => (
                <button
                  key={g.id}
                  className={`schip${p.gw2GuildId === g.id ? ' on' : ''}`}
                  onClick={() => p.onPickGuild(g.id)}
                >
                  {g.name}
                  {g.tag ? ` [${g.tag}]` : ''}
                  {g.leader ? ' (leader)' : ''}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </Pane>
  )
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/settings/Gw2Keys.tsx
git commit -m "feat(settings): GW2 keys section

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Section component — Report Repos (incl. GitHub account)

**Files:**
- Create: `src/renderer/src/components/settings/ReportRepos.tsx`

- [ ] **Step 1: Create `ReportRepos.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card, Field, Keyring, type KeyLabel } from './ui'

export interface BridgeRepo {
  owner: string
  repo: string
}
export interface BridgeHealth {
  repo: string
  runs: number
  lastRun: string | null
  cachedReports: number
  lastIndexFetch: number | null
  error: string | null
}

export interface ReportReposProps {
  bridgeRepos: BridgeRepo[]
  bridgeHealth: BridgeHealth[]
  bridgeInput: string
  bridgeStatus: { msg: string; ok: boolean } | null
  bridgeFinding: boolean
  githubKeys: KeyLabel[]
  ghSigningIn: boolean
  ghUserCode: string
  ghCodeCopied: boolean
  ghAuthStatus: { msg: string; ok: boolean } | null
  setBridgeInput: (v: string) => void
  onAddRepo: () => void
  onRemoveRepo: (owner: string, repo: string) => void
  onDiscover: () => void
  onCheckHealth: () => void
  onActivateKey: (label: string) => void
  onRemoveKey: (label: string) => void
  onSignIn: () => void
  onCopyCode: () => void
}

export default function ReportRepos(p: ReportReposProps): ReactElement {
  return (
    <Pane
      no="05"
      title="Report Repos"
      sub="AxiBridge report repositories that feed dispatch data."
    >
      <Card title="Linked repos">
        {p.bridgeRepos.length > 0 && (
          <div className="skeys">
            {p.bridgeRepos.map((r) => {
              const health = p.bridgeHealth.find((h) => h.repo === `${r.owner}/${r.repo}`)
              return (
                <div key={`${r.owner}/${r.repo}`} className="skey">
                  <span className="rad" />
                  {r.owner}/{r.repo}
                  {health && !health.error && (
                    <span className="badge">
                      {health.runs} runs · {health.cachedReports} cached
                    </span>
                  )}
                  {health?.error && <span className="badge">unreachable</span>}
                  <span
                    className="kx"
                    title={`Unlink ${r.owner}/${r.repo}`}
                    onClick={() => p.onRemoveRepo(r.owner, r.repo)}
                  >
                    ✕
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <Field label="Link a repo">
          <input
            className="sfield-input"
            type="text"
            value={p.bridgeInput}
            placeholder="owner/repo or https://owner.github.io/repo"
            onChange={(e) => p.setBridgeInput(e.target.value)}
          />
        </Field>
        <div className="sactions">
          <button className="sbtn" disabled={!p.bridgeInput.trim()} onClick={p.onAddRepo}>
            Link repo
          </button>
          <button
            className="sbtn ghost"
            disabled={p.bridgeFinding || p.githubKeys.length === 0}
            onClick={p.onDiscover}
            title={
              p.githubKeys.length === 0
                ? 'Sign in with GitHub below first'
                : 'Scan your GitHub account'
            }
          >
            {p.bridgeFinding ? 'Searching…' : 'Find my report repos'}
          </button>
          <button className="sbtn ghost" onClick={p.onCheckHealth}>
            Check health
          </button>
        </div>
        {p.bridgeStatus && (
          <div className={`sstatus ${p.bridgeStatus.ok ? 'ok' : 'err'}`}>
            {p.bridgeStatus.msg}
          </div>
        )}
      </Card>

      <Card title="GitHub account">
        <p className="shelp">
          Optional — for private repos / higher rate limits. Public report repos work without
          signing in.
        </p>
        <Keyring keys={p.githubKeys} onActivate={p.onActivateKey} onRemove={p.onRemoveKey} />
        {p.ghUserCode && (
          <div className="sstatus ok">
            Enter code <b>{p.ghUserCode}</b>{' '}
            <button className="sbtn ghost" type="button" onClick={p.onCopyCode}>
              {p.ghCodeCopied ? 'copied ✓' : 'copy'}
            </button>{' '}
            at github.com/login/device (opened in your browser).
          </div>
        )}
        <div className="sactions">
          <button className="sbtn" disabled={p.ghSigningIn} onClick={p.onSignIn}>
            {p.ghSigningIn ? 'Signing in…' : 'Sign in with GitHub'}
          </button>
        </div>
        {p.ghAuthStatus && (
          <div className={`sstatus ${p.ghAuthStatus.ok ? 'ok' : 'err'}`}>
            {p.ghAuthStatus.msg}
          </div>
        )}
      </Card>
    </Pane>
  )
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/settings/ReportRepos.tsx
git commit -m "feat(settings): report repos + github account section

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Section component — Intelligence (largest)

**Files:**
- Create: `src/renderer/src/components/settings/Intelligence.tsx`

This section has four provider panels (Claude / Gemini / OpenAI / Local) plus the Ollama wizard. All sub-logic stays in `Settings.tsx`; this component is pure presentation over the passed props.

- [ ] **Step 1: Create `Intelligence.tsx`**

```tsx
import type { ReactElement } from 'react'
import { Pane, Card, Field, Segmented, Keyring, type KeyLabel } from './ui'

export type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'

export interface IntelligenceProps {
  provider: ProviderName
  onPickProvider: (p: ProviderName) => void
  // claude
  claudeToken: string
  claudeSaved: boolean
  claudeStatus: string
  model: string
  setClaudeToken: (v: string) => void
  onSaveClaude: () => void
  onPickModel: (p: ProviderName, value: string) => void
  // gemini / openai
  geminiKeys: KeyLabel[]
  openaiKeys: KeyLabel[]
  geminiModel: string
  openaiModel: string
  llmLabel: string
  llmKey: string
  customModel: string
  setLlmLabel: (v: string) => void
  setLlmKey: (v: string) => void
  setCustomModel: (v: string) => void
  onAddLlmKey: (service: 'gemini' | 'openai') => void
  onActivateLlmKey: (service: ProviderName, label: string) => void
  onRemoveLlmKey: (service: ProviderName, label: string) => void
  geminiModels: Array<{ value: string; label: string }>
  openaiModels: Array<{ value: string; label: string }>
  // local
  localEndpoint: string
  localModel: string
  localModels: string[]
  localStatus: { msg: string; ok: boolean } | null
  hw: { totalRamGb: number; recommendedModel: string; modelOptions: string[] } | null
  chosenModel: string
  ollamaBusy: boolean
  ollamaErr: string | null
  ollamaStage: string
  ollamaPct: number | null
  pullingModel: string | null
  setLocalEndpoint: (v: string) => void
  setChosenModel: (v: string) => void
  onSaveLocalEndpoint: () => void
  onStartOllamaSetup: () => void
  onPullModel: (model: string) => void
}

const PROVIDERS: Array<{ value: ProviderName; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'local', label: 'Local' }
]

const CLAUDE_MODELS = [
  { value: '', label: 'Default' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' }
]

export default function Intelligence(p: IntelligenceProps): ReactElement {
  return (
    <Pane
      no="01"
      title="Intelligence"
      sub="The AI provider that writes your dispatches, and the model it uses."
    >
      <Segmented value={p.provider} options={PROVIDERS} onChange={p.onPickProvider} />

      {p.provider === 'claude' && (
        <>
          <Card
            title="Authentication"
            status={{
              msg: p.claudeStatus || (p.claudeSaved ? 'token saved' : 'system login'),
              tone: 'ok'
            }}
          >
            <Field
              label="OAuth token"
              help={
                <>
                  Run <code>claude setup-token</code> in a terminal and paste the result. Leave
                  empty to use this machine&apos;s existing Claude Code login.
                </>
              }
            >
              <input
                className="sfield-input"
                type="password"
                value={p.claudeToken}
                placeholder={p.claudeSaved ? '•••••••• (saved)' : 'paste setup token'}
                onChange={(e) => p.setClaudeToken(e.target.value)}
              />
            </Field>
            <div className="sactions">
              <button className="sbtn" disabled={!p.claudeToken} onClick={p.onSaveClaude}>
                File token
              </button>
            </div>
          </Card>
          <Card title="Model">
            <div className="schips">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.value}
                  className={`schip${p.model === m.value ? ' on' : ''}`}
                  onClick={() => p.onPickModel('claude', m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {(p.provider === 'gemini' || p.provider === 'openai') && (
        <>
          <Card title="API keys">
            <Keyring
              keys={p.provider === 'gemini' ? p.geminiKeys : p.openaiKeys}
              onActivate={(label) => p.onActivateLlmKey(p.provider, label)}
              onRemove={(label) => p.onRemoveLlmKey(p.provider, label)}
            />
            <Field label="Label">
              <input
                className="sfield-input"
                type="text"
                value={p.llmLabel}
                placeholder="e.g. personal"
                onChange={(e) => p.setLlmLabel(e.target.value)}
              />
            </Field>
            <Field
              label="API key"
              help={
                p.provider === 'gemini'
                  ? 'Create a free key at aistudio.google.com → Get API key.'
                  : 'Create a key at platform.openai.com → API keys.'
              }
            >
              <input
                className="sfield-input"
                type="password"
                value={p.llmKey}
                placeholder={
                  p.provider === 'gemini' ? 'paste Gemini API key' : 'paste OpenAI API key'
                }
                onChange={(e) => p.setLlmKey(e.target.value)}
              />
            </Field>
            <div className="sactions">
              <button
                className="sbtn"
                disabled={!p.llmKey}
                onClick={() => p.onAddLlmKey(p.provider as 'gemini' | 'openai')}
              >
                Add key
              </button>
            </div>
          </Card>
          <Card title="Model">
            <div className="schips">
              {(p.provider === 'gemini' ? p.geminiModels : p.openaiModels).map((m) => {
                const active = p.provider === 'gemini' ? p.geminiModel : p.openaiModel
                return (
                  <button
                    key={m.value}
                    className={`schip${active === m.value ? ' on' : ''}`}
                    onClick={() => p.onPickModel(p.provider, m.value)}
                  >
                    {m.label}
                  </button>
                )
              })}
              {(() => {
                const active = p.provider === 'gemini' ? p.geminiModel : p.openaiModel
                const curated = p.provider === 'gemini' ? p.geminiModels : p.openaiModels
                if (active && !curated.some((m) => m.value === active)) {
                  return <button className="schip on">{active}</button>
                }
                return null
              })()}
            </div>
            <Field label="">
              <input
                className="sfield-input"
                style={{ marginTop: '10px' }}
                type="text"
                value={p.customModel}
                placeholder="or type a custom model id and press Enter"
                onChange={(e) => p.setCustomModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && p.customModel.trim()) {
                    p.onPickModel(p.provider, p.customModel.trim())
                    p.setCustomModel('')
                  }
                }}
              />
            </Field>
          </Card>
        </>
      )}

      {p.provider === 'local' && (
        <>
          <Card
            title="Server"
            status={p.localStatus ? { msg: p.localStatus.msg, tone: p.localStatus.ok ? 'ok' : 'err' } : undefined}
          >
            <Field label="Endpoint">
              <input
                className="sfield-input"
                type="text"
                value={p.localEndpoint}
                placeholder="http://localhost:11434"
                onChange={(e) => p.setLocalEndpoint(e.target.value)}
              />
            </Field>
            <div className="sactions">
              <button className="sbtn" onClick={p.onSaveLocalEndpoint}>
                Save &amp; probe
              </button>
            </div>
          </Card>

          {p.localModels.length > 0 &&
            (() => {
              const recommended = p.hw?.modelOptions ?? []
              const rows = [
                ...recommended,
                ...p.localModels.filter((m) => !recommended.includes(m))
              ]
              return (
                <Card title="Model">
                  <div className="schips">
                    {rows.map((m) => {
                      const installed = p.localModels.includes(m)
                      const isPulling = p.pullingModel === m
                      return (
                        <button
                          key={m}
                          className={`schip${p.localModel === m ? ' on' : ''}`}
                          disabled={p.ollamaBusy}
                          title={installed ? 'Installed' : 'Not installed — click to download'}
                          onClick={() =>
                            installed ? p.onPickModel('local', m) : p.onPullModel(m)
                          }
                        >
                          {m}{' '}
                          {isPulling
                            ? `· ${p.ollamaPct ?? 0}%`
                            : installed
                              ? '· ✓'
                              : '· ↓'}
                        </button>
                      )
                    })}
                  </div>
                  {p.ollamaErr && <div className="sstatus err">{p.ollamaErr}</div>}
                  <p className="shelp">
                    ✓ installed models are ready. Click a ↓ model to download it. The accented
                    chip is active.
                  </p>
                </Card>
              )
            })()}

          {p.localModels.length === 0 && (
            <Card title="Set up local AI">
              {p.hw && (
                <p className="shelp">
                  Detected {p.hw.totalRamGb} GB RAM — recommended{' '}
                  <strong>{p.hw.recommendedModel}</strong>.
                </p>
              )}
              {p.hw && (
                <div className="schips">
                  {p.hw.modelOptions.map((m) => (
                    <button
                      key={m}
                      className={`schip${p.chosenModel === m ? ' on' : ''}`}
                      disabled={p.ollamaBusy}
                      onClick={() => p.setChosenModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <div className="sactions">
                <button className="sbtn" disabled={p.ollamaBusy} onClick={p.onStartOllamaSetup}>
                  {p.ollamaBusy ? 'Setting up…' : 'Set up local AI (one click)'}
                </button>
              </div>
              {p.ollamaBusy && (
                <div className="ollama-progress">
                  <div className="sstatus">{p.ollamaStage}</div>
                  {p.ollamaPct !== null && <progress max={100} value={p.ollamaPct} />}
                </div>
              )}
              {p.ollamaErr && (
                <div className="sstatus err">
                  {p.ollamaErr}{' '}
                  <button className="sbtn ghost" onClick={p.onStartOllamaSetup}>
                    Retry
                  </button>
                </div>
              )}
              <p className="shelp">
                Installs a private, self-contained Ollama just for AxiVale — no admin rights.
                Local models are slower and less reliable on multi-step tasks than the cloud
                providers.
              </p>
            </Card>
          )}
        </>
      )}
    </Pane>
  )
}
```

- [ ] **Step 2: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/settings/Intelligence.tsx
git commit -m "feat(settings): intelligence section

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Rewrite `Settings.tsx` as the data-owner/dispatcher

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`

Keep ALL existing state hooks, `useEffect`s, and handler functions (lines 90–575 of the current file) verbatim. Remove the inline `Keyring` (now imported from `./settings/ui`). Replace the giant `return (...)` JSX (lines 577–1094) with a dispatcher that renders one section based on a new `section` prop. Add curated model arrays as props passed to `Intelligence`.

- [ ] **Step 1: Update imports and the component signature**

At the top of `Settings.tsx`, replace the inline `Keyring` function (lines 53–88) with imports, and add the section imports:
```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { SettingsSection } from './settings/SettingsNav'
import Intelligence from './settings/Intelligence'
import Gw2Keys from './settings/Gw2Keys'
import AxiTools from './settings/AxiTools'
import AxiForge from './settings/AxiForge'
import ReportRepos from './settings/ReportRepos'
import Dispatches from './settings/Dispatches'
import About from './settings/About'
```
Delete the local `function Keyring(...)` block entirely (the `KeyLabel` interface can stay in `Settings.tsx`, or import it from `./settings/ui` — keep one definition; if kept local, ensure it is structurally identical to `ui.tsx`'s `KeyLabel`).

Change the props interface and signature:
```tsx
export interface SettingsProps {
  section: SettingsSection
  onChanged: () => void
  onProviderChanged?: () => void
}

export default function Settings({ section, onChanged, onProviderChanged }: SettingsProps): ReactElement {
```

- [ ] **Step 2: Keep all state + handlers unchanged**

Leave every `useState`, `useRef`, `useEffect`, and `async function` from the current lines 91–575 exactly as-is. They are the data layer. (The `GEMINI_MODELS`, `OPENAI_MODELS`, `PROVIDERS`, `MODEL_SETTING` consts at the top also stay.)

- [ ] **Step 3: Replace the return JSX with the dispatcher**

Replace the entire `return ( <div className="settings"> ... </div> )` (current lines 577–1094) with:
```tsx
  return (
    <div className="settings">
      {section === 'intelligence' && (
        <Intelligence
          provider={provider}
          onPickProvider={pickProvider}
          claudeToken={claudeToken}
          claudeSaved={claudeSaved}
          claudeStatus={claudeStatus}
          model={model}
          setClaudeToken={setClaudeToken}
          onSaveClaude={saveClaude}
          onPickModel={pickProviderModel}
          geminiKeys={geminiKeys}
          openaiKeys={openaiKeys}
          geminiModel={geminiModel}
          openaiModel={openaiModel}
          llmLabel={llmLabel}
          llmKey={llmKey}
          customModel={customModel}
          setLlmLabel={setLlmLabel}
          setLlmKey={setLlmKey}
          setCustomModel={setCustomModel}
          onAddLlmKey={addLlmKey}
          onActivateLlmKey={activateLlmKey}
          onRemoveLlmKey={removeLlmKey}
          geminiModels={GEMINI_MODELS}
          openaiModels={OPENAI_MODELS}
          localEndpoint={localEndpoint}
          localModel={localModel}
          localModels={localModels}
          localStatus={localStatus}
          hw={hw}
          chosenModel={chosenModel}
          ollamaBusy={ollamaBusy}
          ollamaErr={ollamaErr}
          ollamaStage={ollamaStage}
          ollamaPct={ollamaPct}
          pullingModel={pullingModel}
          setLocalEndpoint={setLocalEndpoint}
          setChosenModel={setChosenModel}
          onSaveLocalEndpoint={saveLocalEndpoint}
          onStartOllamaSetup={startOllamaSetup}
          onPullModel={pullModelIntoPicker}
        />
      )}
      {section === 'gw2' && (
        <Gw2Keys
          gw2Keys={gw2Keys}
          gw2Label={gw2Label}
          gw2Key={gw2Key}
          gw2Status={gw2Status}
          gw2Info={gw2Info}
          gw2GuildId={gw2GuildId}
          setGw2Label={setGw2Label}
          setGw2Key={setGw2Key}
          onActivate={activateGw2}
          onRemove={removeGw2}
          onAdd={addGw2Key}
          onPickGuild={pickGw2Guild}
        />
      )}
      {section === 'axitools' && (
        <AxiTools
          axiKeys={axiKeys}
          axiLabel={axiLabel}
          axiKey={axiKey}
          axiStatus={axiStatus}
          axiGuild={axiGuild}
          setAxiLabel={setAxiLabel}
          setAxiKey={setAxiKey}
          onActivate={activateAxi}
          onRemove={removeAxi}
          onAdd={addAxiKey}
        />
      )}
      {section === 'axiforge' && (
        <AxiForge
          forgeStatus={forgeStatus}
          forgeLaunching={forgeLaunching}
          onLaunch={launchForge}
          onRecheck={checkForge}
        />
      )}
      {section === 'repos' && (
        <ReportRepos
          bridgeRepos={bridgeRepos}
          bridgeHealth={bridgeHealth}
          bridgeInput={bridgeInput}
          bridgeStatus={bridgeStatus}
          bridgeFinding={bridgeFinding}
          githubKeys={githubKeys}
          ghSigningIn={ghSigningIn}
          ghUserCode={ghUserCode}
          ghCodeCopied={ghCodeCopied}
          ghAuthStatus={ghAuthStatus}
          setBridgeInput={setBridgeInput}
          onAddRepo={addBridgeRepo}
          onRemoveRepo={removeBridgeRepo}
          onDiscover={discoverAndLinkRepos}
          onCheckHealth={refreshBridgeHealth}
          onActivateKey={(label) => activateLlmKey('github', label)}
          onRemoveKey={(label) => removeLlmKey('github', label)}
          onSignIn={signInGithub}
          onCopyCode={copyGhCode}
        />
      )}
      {section === 'dispatches' && (
        <Dispatches shareEntries={shareEntries} onDelete={deleteShare} />
      )}
      {section === 'about' && (
        <About version={version} updateMsg={updateMsg} onCheckUpdates={checkUpdates} />
      )}
    </div>
  )
}
```

> Note: `removeBridgeRepo` currently has signature `(owner, repo)` — matches `ReportRepos.onRemoveRepo`. `deleteShare`, `checkUpdates`, `activateLlmKey`, `removeLlmKey` are existing handlers. The `Gw2Info`/`AxiGuild`/`ForgeStatus`/`ShareEntry`/`BridgeRepo`/`BridgeHealth` shapes in the section files match the state types in `Settings.tsx`; if the typecheck flags a structural mismatch, align the section interface to the existing state type (do not change the state type).

- [ ] **Step 4: Typecheck**

Run the typecheck command.
Expected: PASS. Resolve any prop-type mismatches by adjusting the section component interface to match `Settings.tsx`'s existing types (per the note above).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Settings.tsx
git commit -m "refactor(settings): Settings becomes data-owner/dispatcher

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Wire the shell — rail swap, section state, hide right rail (`App.tsx`)

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import SettingsNav + its types and add section state**

Add imports near the other component imports:
```tsx
import SettingsNav, { type SettingsSection, type SettingsNavStatus } from './components/settings/SettingsNav'
```
Add state alongside the existing `const [section, setSection] = useState<Section>('dispatches')`:
```tsx
const [settingsSection, setSettingsSection] = useState<SettingsSection>('intelligence')
```

- [ ] **Step 2: Build the nav status object**

Where the component has access to the relevant connection state (the same data feeding `refreshStatus`/status indicators), assemble — using whatever status values already exist in `App.tsx`; if a given flag isn't readily available in `App.tsx`, pass `undefined` (dot shows "off"):
```tsx
const settingsNavStatus: SettingsNavStatus = {
  intelligence: true, // a provider is always selected
  gw2: undefined,
  axitools: undefined,
  axiforge: undefined,
  repos: undefined
}
```
> The dots are cosmetic. Only set a flag `true` if `App.tsx` already holds a truthy "configured" signal for it (e.g. a known active key/connection). Leaving them `undefined` is acceptable for this pass; do not add new IPC calls to `App.tsx` just to light dots.

- [ ] **Step 3: Swap the left rail conditionally**

Replace the unconditional `<Editions ... />` in `.sheet` (around App.tsx line 372) with:
```tsx
{section === 'settings' ? (
  <SettingsNav
    active={settingsSection}
    onSelect={setSettingsSection}
    status={settingsNavStatus}
  />
) : (
  <Editions
    items={editionItems}
    activeId={activeId}
    /* ...keep all existing Editions props exactly as they were... */
  />
)}
```
(Preserve every existing prop currently passed to `<Editions>`.)

- [ ] **Step 4: Pass `section` to Settings and hide the right rail on Settings**

Update the Settings render (around line 409):
```tsx
{section === 'settings' && (
  <Settings
    section={settingsSection}
    onChanged={refreshStatus}
    onProviderChanged={() => void newConversation()}
  />
)}
```
Wrap the right rail so it does not render on Settings (around line where `<RightRail ... />` is):
```tsx
{section !== 'settings' && <RightRail memberCount={memberCount} /* ...existing props... */ />}
```

- [ ] **Step 5: Typecheck**

Run the typecheck command.
Expected: PASS.

- [ ] **Step 6: Full visual + behavior verification**

`npm run dev`. Then:
1. Click the **Settings** tab → left rail shows the 7-item section nav; right rail is gone; pane shows **Intelligence**; folio header still reads "Settings".
2. Click each nav item → only that section renders; active item gets the accent left-border.
3. **Intelligence:** switch providers (segmented toggle); for Claude pick a model chip; paste a dummy token and confirm "File token" enables; for Local, confirm the endpoint field + setup/probe controls render.
4. **GW2:** add a key (use a throwaway/invalid value to see the error path), confirm activate/remove rows work, confirm guild chips appear after a valid verify (if you have a real key).
5. **AxiTools / AxiForge / Report Repos / Dispatches / About:** confirm each renders, buttons fire (Recheck, Check health, Check for updates), and the GitHub sign-in button starts the device flow.
6. Switch to **Dispatches** tab and back → the left rail returns to the editions/chat history list with no glitches; right rail returns.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(settings): rail-swap nav, section routing, hide right rail on settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Cleanup pass

**Files:**
- Modify: `src/renderer/src/theme.css` (only if safe)

- [ ] **Step 1: Find Settings-only dead classes**

Run:
```bash
grep -rn "sgroup\|\.ssub\|\.srow\b" src/renderer/src --include=*.tsx
```
Expected: confirm whether `.sgroup`, `.ssub`, `.srow` are still referenced by any `.tsx` (Settings no longer uses them). If a class is referenced ONLY by non-Settings views, leave it. If a class has zero remaining references anywhere, it may be removed.

- [ ] **Step 2: Remove only the confirmed-dead Settings classes**

Delete from `theme.css` only those rules with zero references found in Step 1 (likely `.sgroup`, `.sgroup h2`, `.ssub` if nothing else uses them). Do NOT remove `.picker`/`.pi`/`.sinput`/`.slabel`/`.sstatus`/`.shelp`/`.perm`/`.countline`/`.share-list*` — these are still used by section components or other views.

- [ ] **Step 3: Typecheck + quick visual**

Run the typecheck command (PASS), then `npm run dev` and re-open Settings + Builds + Comps to confirm nothing lost styling.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "chore(settings): remove dead settings-only css

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Part 1 italics → Task 1 (all 18 selectors enumerated). ✓
- View-aware shell (rail swap, hide right rail, section state) → Task 11. ✓
- `Settings.tsx` → thin data-owner/dispatcher → Task 10. ✓
- 7 section components → Tasks 5–9. ✓
- `SettingsNav` → Task 4. ✓
- Shared primitives (Pane/Card/Field/Segmented/Chips/Keyring) → Task 3 (Chips realized as `.schip` classes used inline + `Segmented`/`Keyring` components). ✓
- New control CSS → Task 2. ✓
- Behavior preserved (handlers unchanged) → Task 10 Step 2. ✓
- Default section = intelligence; not persisted → Task 11 Step 1. ✓
- Dead-CSS cleanup, keep shared classes → Task 12. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The only deliberately-conditional content is Task 11 Step 2 (nav status dots) and Task 12 (delete-if-unreferenced) — both give exact decision rules, not vague instructions.

**Type consistency:** `SettingsSection` defined in Task 4, imported in Tasks 10–11. `KeyLabel` defined in Task 3 (`ui.tsx`), reused by section interfaces. `ProviderName` defined in Task 9 and `Settings.tsx` (existing) — identical union; handler `pickProviderModel(p, value)` matches `onPickModel(p, value)`. `removeBridgeRepo(owner, repo)` matches `onRemoveRepo`. Provider model arrays passed as `geminiModels`/`openaiModels` props from existing `GEMINI_MODELS`/`OPENAI_MODELS`.
