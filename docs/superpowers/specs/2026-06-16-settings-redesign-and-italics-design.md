# UI Refinement: De-bold Italics + Settings Redesign

**Date:** 2026-06-16
**Status:** Approved (design), pending implementation plan

## Goal

Two UI refinements to the AxiVale renderer:

1. **Italics legibility** — italic text reads too heavy and hurts readability. Remove
   italic where it is used as a *default* style; keep italic only for genuine markdown
   emphasis.
2. **Settings redesign** — the Settings view is a single 1,096-line flat scroll of seven
   sections with awkward, weirdly-spaced controls. Restructure it into a section-navigated
   layout with a redesigned, consistent control language.

Both are presentational changes. No `window.officer.*` IPC contracts, provider logic, or
data flows change.

---

## Part 1 — Italics

### Current problem

`theme.css` applies `font-style:italic` in two ways:

- **Bold + italic** Playfair Display headings (`font-weight:700` *and* `font-style:italic`)
  — read heavy at small sizes.
- **Italic body defaults** — chat messages, help text, blockquotes, the input field, and
  several labels default to italic, which is tiring over running text.

### Change

In `theme.css`, remove `font-style:italic` from every selector where italic is a *default*
style. Bold headings keep `font-weight:700`; they just lose the slant. Markdown `<em>`
(`.prose em`, default browser rendering) stays italic — that is real emphasis and is out of
scope.

Selectors to set upright (remove `font-style:italic`, leave all other properties):

| Selector | Line (approx) | Notes |
|---|---|---|
| `.folio h1` | 77 | keep weight 700 |
| `.msg.user .body` | 88 | user chat messages — main running text |
| `.prose blockquote` | 112 | |
| `.edition .ed-headline` | 237 | |
| `.edition .ed-rename` | 241 | |
| `.field` | 255 | input field |
| `.field::placeholder` | 256 | |
| `.notice .nask` | 272 | |
| `.sgroup h2` | 280 | keep weight 700 (see Part 2 — class may move) |
| `.ssub` | 281 | keep weight 700 |
| `.shelp` | 327 | help text |
| `.clspick-btn .ph` | 313 | placeholder |
| `.cname` | 403 | keep weight 700 |
| `.bnone` | 384 | |
| `.sname` | 433 | keep weight 700 |
| `.sd-sub` | 474 | |
| `.cs-title` | 561–565 | |
| `.cs-build-note` | 671–677 | |

> Implementation note: confirm exact line numbers at edit time — Part 2 edits `theme.css`
> in the same pass and may shift them. Grep for `font-style:italic` and review each hit
> against this table; any hit not listed here (i.e. genuine `<em>` emphasis) is left alone.

No JSX changes for Part 1.

---

## Part 2 — Settings redesign

### Architecture

The app shell (`App.tsx`) renders a three-column `.sheet`: left rail (`<Editions>`), center
`.chatcol`, right rail (`<RightRail>`). All three render in every view, including Settings.
The redesign makes the shell *view-aware* for Settings:

- **Left rail:** when `section === 'settings'`, render a new `<SettingsNav>` instead of
  `<Editions>`. Same `.rail.left` slot and width (188px).
- **Right rail:** when `section === 'settings'`, do **not** render `<RightRail>` — the
  Settings pane goes full width (minus the left nav) so it breathes.
- **Center pane:** `<Settings>` renders only the *active* section, full width within
  `.chatcol`. The existing `.folio` header ("Settings" + dateline) is retained.

The `section` state already exists in `App.tsx` (`type Section = ... | 'settings'`). The
*active settings sub-section* is new state, owned by `App.tsx` so the left-rail
`<SettingsNav>` and the `<Settings>` pane share it.

```
App.tsx
  state: section            (existing)  — which top-level view
  state: settingsSection    (new)       — which settings sub-section is active
                                          default: 'intelligence'

  .sheet
    section === 'settings'
      ? <SettingsNav active={settingsSection} onSelect={setSettingsSection} status={...} />
      : <Editions ... />
    .chatcol
      <div class="folio"> Settings / dateline </div>
      section === 'settings' && <Settings section={settingsSection} ... />
    section !== 'settings' && <RightRail ... />
```

`settingsSection` is a union type:
`'intelligence' | 'gw2' | 'axitools' | 'axiforge' | 'repos' | 'dispatches' | 'about'`.
Default on open is `'intelligence'` (most-touched). Not persisted across app restarts in
this pass — it resets to `'intelligence'` each time Settings is opened.

### Component decomposition

`Settings.tsx` is 1,096 lines: one component owning ~50 `useState` hooks plus all IPC
handlers, rendering seven `.sgroup` blocks inline. Split it:

- **`Settings.tsx`** stays the **data owner** — all existing state, `useEffect`s, and
  handler functions remain here unchanged. It becomes a thin dispatcher: given the active
  `section` prop, render the matching section component, passing that section's slice of
  state + handlers as a typed props bag.
- **`components/settings/` — seven presentational components**, each receiving a typed
  props interface (no IPC calls of their own; they call handlers passed down):
  - `Intelligence.tsx` — provider toggle, Claude/Gemini/OpenAI/Local panels, Ollama wizard
  - `Gw2Keys.tsx`
  - `AxiTools.tsx`
  - `AxiForge.tsx`
  - `ReportRepos.tsx` (incl. the GitHub-account subsection)
  - `Dispatches.tsx` (shared dispatches list)
  - `About.tsx`
- **`components/settings/SettingsNav.tsx`** — the left-rail section list (numbered items,
  status dots). Takes `active`, `onSelect`, and a small `status` object (which sections are
  configured, to light the dots).
- **Shared presentational primitives** in `components/settings/ui.tsx` (or inline) used by
  all sections: `Section` (kicker + Playfair title + description wrapper), `Card`
  (header bar with title + optional status LED, padded body), `Field` (label + input +
  help), `Segmented`, `Chips`, `Keyring` (redesigned — see below). The existing `Keyring`
  in `Settings.tsx` moves here and is restyled.

This keeps the data layer in one place (no prop-drilling of raw `set*` setters beyond the
handlers each section needs) while no single file stays anywhere near 1,096 lines.

### Control language (CSS — `theme.css`)

New / revised classes. The redesign replaces floating dashed-underline inputs and ad-hoc
spacing with bordered controls on a consistent vertical rhythm. Approved via in-app mock.

- **`.settings`** — becomes the pane container; `.sheet` flex already provides the column.
  Pane content max-width ~620px, padding `22px 0`.
- **`.snav`, `.snav-h`, `.snav-item`, `.snav-item.on`, `.snav-item .no`, `.snav-item .dot`**
  — left-rail settings nav. Active item: accent left-border + faint accent tint. Status
  dot: `--green` when configured, `--faint` when not.
- **`.spane-kick`** — mono uppercase accent kicker ("Section 01").
- **`.spane-h`** — Playfair, weight 700, upright (Part 1), ~24px.
- **`.spane-sub`** — one-line description, `--ink-dim`.
- **`.scard`, `.scard-h`, `.scard-t`, `.scard-s` (+ `.led`), `.scard-b`** — grouping card:
  header bar (title + optional status LED/text), padded body.
- **`.sfield`, `.slabel` (revised), `.sinput` (revised)** — `.sinput` becomes
  `border:1px solid var(--rule); background:rgba(0,0,0,.25); padding:9px 12px;` with
  `:focus{border-color:var(--accent-b)}`. Drops the dashed underline + bottom margin;
  spacing comes from `.sfield` rhythm.
- **`.shelp` (revised)** — upright (Part 1), sits directly under its field.
- **`.sseg`, `.sseg button`, `.sseg button.on`** — segmented toggle (connected bordered
  segments; active = accent fill).
- **`.schips`, `.schip`, `.schip.on`** — chip group for model selection.
- **`.skeys`, `.skey`, `.skey.on` (+ `.rad`, `.badge`, `.x`)** — keyring as bordered rows:
  radio dot, label, "active" badge, remove ✕. Replaces the current `.picker`/`.pi` styling
  for keyrings.
- **`.sactions`, `.sbtn` (kept), `.sbtn.ghost`** — button row. `.sbtn` primary (accent
  fill); ghost = outline secondary. Reuses existing `.sbtn`; `.sbtn.out` may be aliased to
  `.sbtn.ghost` or kept.

Old Settings-only classes that become unused after the rewrite (e.g. the inline-styled
`subsection`, ad-hoc `marginTop`) are removed. Classes still used by *non-Settings* views
(`.picker`/`.pi` are used by Builds/Comps/etc.) are **left intact** — only Settings stops
using them.

### Behavior preserved

Every interaction works exactly as today; only markup/CSS and file layout change:

- Provider switch + per-provider model selection
- Claude OAuth token save; system-login fallback
- Gemini/OpenAI keyrings (add/activate/remove) + curated + custom model entry
- Local/Ollama: endpoint probe, one-click setup wizard, hardware detection, per-model
  pull-from-picker with progress
- GW2 keyring + validation + guild selection
- AxiTools keyring + connect
- AxiForge status/launch/recheck
- AxiBridge repo link/unlink, auto-discover, health check, GitHub device-flow sign-in
- Shared dispatches list (open/delete)
- About: version + check-for-updates
- `onChanged` / `onProviderChanged` callbacks fire as before

### Out of scope

- Persisting the active settings sub-section across restarts
- Redesigning non-Settings views (Builds, Comps, Roster, etc.)
- Changing markdown `<em>` emphasis rendering
- Any IPC / main-process changes

---

## Files touched

- `src/renderer/src/theme.css` — Part 1 italics; Part 2 new/revised classes
- `src/renderer/src/App.tsx` — view-aware rail swap, `settingsSection` state, hide right
  rail on Settings
- `src/renderer/src/components/Settings.tsx` — becomes thin data-owner/dispatcher
- `src/renderer/src/components/settings/SettingsNav.tsx` — new
- `src/renderer/src/components/settings/Intelligence.tsx` — new
- `src/renderer/src/components/settings/Gw2Keys.tsx` — new
- `src/renderer/src/components/settings/AxiTools.tsx` — new
- `src/renderer/src/components/settings/AxiForge.tsx` — new
- `src/renderer/src/components/settings/ReportRepos.tsx` — new
- `src/renderer/src/components/settings/Dispatches.tsx` — new
- `src/renderer/src/components/settings/About.tsx` — new
- `src/renderer/src/components/settings/ui.tsx` — new shared primitives (Section/Card/Field/
  Segmented/Chips/Keyring)

## Verification

- `npm run dev`, open Settings: left rail shows the 7-section nav with correct status dots;
  right rail is hidden; each section renders only when selected; default is Intelligence.
- Exercise each section's controls and confirm behavior is unchanged (save token, switch
  provider/model, add/activate/remove keys, probe local, launch forge, link repo, GitHub
  sign-in, delete share, check updates).
- Confirm italics are upright across chat messages, help text, blockquotes, input field,
  edition headlines, and section/card headings — and that markdown `*emphasis*` is still
  italic.
- Switch between Settings and other views and back; confirm the rail swaps cleanly and
  chat history returns.
