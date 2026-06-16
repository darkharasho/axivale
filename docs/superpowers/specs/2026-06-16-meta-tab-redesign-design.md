# Meta Tab Redesign

**Date:** 2026-06-16
**Status:** Approved (design), pending implementation plan
**Follows:** `2026-06-16-settings-redesign-and-italics-design.md` — applies the same rail-nav + card control language to the Meta tab.

## Goal

Give the Meta tab the same structure as the redesigned Settings tab: a left-rail
section nav (one game mode at a time), a card-based content pane, and a restyled
playbook modal — reusing the shared `Pane`/`Card`/`Field` primitives and the
`.spane`/`.spcard` control CSS.

Behavior is preserved: the same meta data, the same background-refresh progress,
the same playbook editing/derive flow. This is presentational + a state-ownership
move, not a logic change.

## Current state

`src/renderer/src/components/panels/Meta.tsx` (243 lines) is the data owner: it
fetches `metaList()`, subscribes to `onMetaProgress`, and tracks `busy`/`fetching`
per mode. It renders `.settings`/`.sgroup` with an intro blurb, then one `.sgroup`
per mode (heading + status, collapsible `ModeSummary`, source links with status
chips, and a WvW-only `PlaybookLauncher` → `PlaybookModal`). `MetaIndexInspector`
renders dev-only at the bottom.

`App.tsx` renders `{section === 'meta' && <Meta />}` inside `.chatcol`, with the
left rail (`Editions`) and right rail (`RightRail`) both shown.

## Architecture

Mirror the Settings approach, but because the rail nav needs the list of modes,
**lift the meta data into `App.tsx`** as the single source of truth:

- **`App.tsx` becomes the meta data owner.** Move out of `Meta.tsx`:
  - `metaModes: RendererMetaMode[]` state + the `metaList()` fetch + a `refreshMeta()`.
  - `metaBusy: Record<string, boolean>` and `metaFetching: Record<string, string | null>` state.
  - the `onMetaProgress` subscription `useEffect` (updates busy/fetching, calls `refreshMeta` on `mode-done`).
  - Add `activeMetaMode: string` state (a mode id; defaults to the first mode's id
    once `metaModes` loads — an effect sets it if empty). Not persisted across restarts.
- **Rail swap (extend the existing ternary):**
  ```tsx
  {section === 'settings' ? (
    <SettingsNav ... />
  ) : section === 'meta' ? (
    <MetaNav modes={metaModes} busy={metaBusy} active={activeMetaMode} onSelect={setActiveMetaMode} />
  ) : (
    <Editions ... />
  )}
  ```
- **Right rail hidden on Meta too:** `{section !== 'settings' && section !== 'meta' && <RightRail ... />}`.
- **`Meta` render becomes:**
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

### Components (new `components/meta/` dir)

- **`components/meta/MetaNav.tsx`** — left-rail nav (`.snav` classes, reused). Items:
  - `Overview` (no mode; section `00`) — selecting it shows the panel intro + dev tools.
  - one item per mode (`m.mode`, e.g. WvW / Roaming / PvE), numbered `01`, `02`, …
  - status indicator per mode item: a refreshing spinner when `busy[m.id]`, else a
    dot lit (`--green`) when `m.refreshedAt` is set, dim otherwise.
  - `active`/`onSelect` like `SettingsNav`. Active mode id `''` (or sentinel `'overview'`) = Overview.
- **`components/meta/Meta.tsx`** — presentational pane (moved from `panels/Meta.tsx`).
  Receives `modes`, `active`, `busy`, `fetching`, `onRefresh`. Renders:
  - If Overview selected: a `Pane` ("Meta" / background-knowledge sub) containing an
    intro `Card` (the existing explanatory text) and, in DEV, the force-refresh button
    and `<MetaIndexInspector />`.
  - If a mode selected: a `Pane` (mode name kicker/title + status sub) with:
    - a **Summary** `Card` containing `ModeSummary` (collapsible markdown).
    - a **Sources** `Card` (or card footer) listing each source as an LED chip
      (green dot = ok, accent dot = error, dim = never; spinner/accent when fetching).
    - WvW only: a **Playbook** `Card` with the launcher button + blessed/derived hint.
- **`components/meta/ModeSummary.tsx`** — the existing collapsible summary, extracted unchanged.
- **`components/meta/PlaybookModal.tsx`** + **`PlaybookLauncher`** — extracted; modal
  innards restyled into the card/field language (see below). Behavior unchanged
  (`metaUpdatePlaybook`, `metaDeriveComp`, save-on-blur, Escape-to-close).

### Shared primitives move

`Pane`, `Card`, `Field`, `Segmented`, `Keyring` (currently
`components/settings/ui.tsx`) are not settings-specific. **Move them to
`src/renderer/src/components/panelui.tsx`** and update the settings section imports
(`./ui` → `../panelui`). Meta imports from `../panelui`. `KeyLabel` moves with them.
(`settings/ui.tsx` is deleted.)

### Playbook modal restyle

In `PlaybookModal`, keep the `action-overlay`/`action-modal` shell and all handlers.
Restyle the body:
- The `blessed` checkbox + "Refresh from AxiBridge" derive button → a small control
  row inside a `Card` titled "Baseline".
- The derived-baseline block (`meta-derived*`) → presented inside the same Card as a
  clean key/meta line; keep the profession list.
- Principles / Guild overrides textareas → `Field`-wrapped with `.slabel` labels; the
  textareas use a bordered style consistent with `.sfield-input` (multi-line variant
  `.sfield-area`).

### CSS (`theme.css`)

- Reuse `.spane*`, `.spcard*`, `.sfield*` from the Settings redesign.
- **Fix off-palette chip colors:** `.meta-chip.ok` uses `var(--green)`; `.meta-chip.error`
  uses `var(--accent-b)` (currently `#2c7a3f` / `#a33`).
- Add `.meta-led` source-chip styles (LED dot + label, ok/err/never/fetching states)
  if the existing `.meta-src`/`.meta-chip` don't map cleanly onto the card footer.
- Add `.sfield-area` (multi-line input: same border/background as `.sfield-input`,
  `min-height`, `resize:vertical`, `line-height:1.5`, serif or mono per the textareas).
- Remove `.meta-mode h2` if unused after the move; keep `.meta-summary*`, `.meta-spin`,
  `.meta-derived*`, `.meta-prof`, `.meta-pb-*` (restyle as needed). Remove any meta
  class with zero references after the rewrite.

## Behavior preserved

- Background auto-refresh + per-source progress (busy/fetching) and the "refreshing…"
  indicator (now in the nav + pane header).
- `ModeSummary` collapse/expand + overflow detection.
- Source links open externally; status reflects `s.status` / fetching.
- WvW playbook: open/close, blessed toggle, derive-from-AxiBridge, principles/overrides
  save-on-blur, derived-baseline display.
- Dev-only: force re-crawl button + `MetaIndexInspector`.

## Out of scope

- Persisting the active meta mode across restarts.
- Changing what data the meta crawler collects or how it's stored.
- Touching other tabs.

## Files touched

- `src/renderer/src/App.tsx` — lift meta data ownership; `activeMetaMode` state; rail
  swap for meta; hide right rail on meta; pass props to `Meta`/`MetaNav`.
- `src/renderer/src/components/panelui.tsx` — new (moved from `settings/ui.tsx`).
- `src/renderer/src/components/settings/*.tsx` — update imports (`./ui` → `../panelui`).
- `src/renderer/src/components/settings/ui.tsx` — deleted.
- `src/renderer/src/components/meta/MetaNav.tsx` — new.
- `src/renderer/src/components/meta/Meta.tsx` — new (presentational; replaces `panels/Meta.tsx`).
- `src/renderer/src/components/meta/ModeSummary.tsx` — new (extracted).
- `src/renderer/src/components/meta/PlaybookModal.tsx` — new (extracted + restyled).
- `src/renderer/src/components/panels/Meta.tsx` — deleted (logic split to App + meta/).
- `src/renderer/src/components/MetaIndexInspector.tsx` — unchanged (imported by meta/Meta).
- `src/renderer/src/theme.css` — chip color fix, `.sfield-area`, meta cleanups.

## Verification

- `npm run typecheck` renderer gate clean (filter pre-existing `App.test.tsx`).
- `npm run dev`, Meta tab: left rail shows Overview + one item per mode with correct
  status dots; right rail hidden; selecting a mode shows its cards; Overview shows the
  intro + (DEV) force-refresh + index inspector.
- Trigger/observe a background refresh: the nav + header show "refreshing…", sources
  show fetching, and content updates on completion.
- WvW: open the playbook modal, toggle blessed, derive, edit principles/overrides
  (save on blur), reopen to confirm persistence; Escape closes.
- Switch Meta ↔ other tabs: rail returns to editions, right rail returns.
