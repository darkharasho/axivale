# AxiVale × axi-design — integration design

**Date:** 2026-09-25
**Status:** design approved in chat; awaiting spec review
**Scope:** adopt `@axiapps/axi-design` as AxiVale's UI foundation while preserving the newspaper identity

---

## 1. Intent

Every app in the axi suite is moving onto the shared `@axiapps/axi-design`
package. AxiVale is the outlier: it has a bespoke "newspapery" theme — serif
display type, dashed and double rules, a drop cap, a torn paper edge — built
from 1562 lines of hand-written CSS with its own private token set.

The goal is to join the family without losing the paper. Four outcomes are
wanted, all of them:

1. **A shared accent system.** AxiVale gains the 11-accent picker every other
   axi app has.
2. **Token parity.** A palette change in axi-design lands in AxiVale without
   an AxiVale edit.
3. **Component reuse.** Stop hand-writing switches, modals, meters and tables.
4. **Family resemblance.** A stranger who uses another axi app should
   recognise this one as a sibling.

Success looks like: AxiVale's chrome is indistinguishable in *form* from
axiroster's, while its editorial surface — the article a dispatch renders into
— still reads as a newspaper.

### The tension, stated plainly

axi-design ships eleven rules. AxiVale's newsprint currently breaks three of
them:

| rule | AxiVale today |
|---|---|
| 1. No gradients on surfaces | `body` is a radial glow + scanline + vertical linear gradient |
| 2. No colour at partial opacity over the ground | washes like `rgba(200,66,58,.12)` throughout |
| 3. Every raised element is outlined and blocked | 1px dashed hairlines and 3px double rules |

These are not reconcilable by compromise. The design resolves them by
**surrendering the chrome entirely to axi** and keeping newsprint as
*typography* plus two named, documented departures.

---

## 2. Approach

**Fork B, chosen over Fork A.** Import `axi.css` and `accents.css` **as
shipped** — full axi form: 4px panel border with 6px offset, 3px control
border, sans type, radius 0, filled-means-status. AxiVale does **not** re-dress
axi components in newsprint clothing. Newsprint is confined to the editorial
surfaces.

**Sequencing: token bridge first, then component families.** §3 aliases
AxiVale's 14 private tokens onto axi tokens, which re-skins all 821 existing
references in one commit with no markup churn. Component migration then
proceeds family by family, each phase independently shippable.

### Two facts that make this cheap

Both were established by measurement, not assumption, and the design depends
on them:

**Font scoping is free.** 41 rules in `axi.css` set `font: var(--axi-t-*)` —
the `font` shorthand includes family — and only 2 set a bare `font-family`
(line 692 `--axi-sans`, line 1660 `--axi-mono` for prose code). An axi
component nested inside a serif-scoped ancestor therefore re-asserts its own
sans and is immune. The editorial zone costs three plain declarations and needs
no `:not()` guards.

**There are no class-name collisions.** AxiVale's own `axi-`-prefixed classes
(`.axi-ecard`, `.axi-ecard--loading`, `.axi-ecard-pop`, `.axi-emoji-icon`,
`.axi-emoji-mask`, `.axi-entity`, `.axi-class`) appear zero times in
`axi.css`. The prefix is a readability coincidence, not a conflict. No renames
are forced.

---

## 3. The token bridge

`theme.css`'s `:root` stops declaring values and starts aliasing. Every
existing `var(--rule2)` in the file keeps working; it now resolves through to
an axi token.

| AxiVale token | refs | becomes |
|---|---|---|
| `--bg` | 3 | `var(--axi-ground)` |
| `--bg2` | 9 | `var(--axi-ground)` |
| `--paper` | 25 | `var(--axi-surface)` |
| `--line` | 53 | `var(--axi-rule)` |
| `--rule` | 73 | `var(--axi-rule)` |
| `--rule2` | 78 | `var(--axi-rule)` |
| `--ink` | 98 | `var(--axi-text)` |
| `--ink-dim` | 97 | `var(--axi-text-dim)` |
| `--faint` | 128 | `var(--axi-text-faint)` |
| `--accent` | 42 | `var(--axi-accent)` |
| `--accent-b` | 125 | `color-mix(in srgb, var(--axi-accent) 82%, white)` |
| `--green` | 29 | `var(--axi-ok)` |
| `--amber` | 9 | `var(--axi-warn)` |
| `--focus` | 12 | `color-mix(in srgb, var(--axi-accent) 55%, transparent)` |

`--rule`, `--rule2` and `--line` all collapse onto `--axi-rule`. AxiVale drew
three rule colours; axi draws one rule colour at two *weights*
(`--axi-border-control` 3px structural, `--axi-border-hairline` 2px
subordinate). Weight, not hue, carries the hierarchy.

### `--accent-b` is a documented local extension

axi-design defines no accent-bright token. AxiVale's two-tone red is
load-bearing across 125 references, so it survives as a token axi-design does
not define, derived by `color-mix` so it tracks whichever accent is selected.

- The 82% figure is tuned by eye against `crimson-red`. It **must** be
  sanity-checked against a dark accent (`slate-silver` `#94a3b8`) before the
  accent picker ships, since mixing toward white from an already-light accent
  may produce too little separation.
- If axi-design ever formalises an accent-bright token, this extension is
  deleted in favour of it.
- `color-mix` requires Chromium 111+. AxiVale is on Electron ^33 (Chromium
  130). Safe.

---

## 4. The editorial zone

Newsprint typography survives, scoped rather than global.

- `body` stops being serif. It becomes `--axi-sans` like every other axi app.
- Five selectors keep Playfair Display: `.lede`, `.folio h1`,
  `.action-modal__title`, the drop cap, and article headings inside `.prose`.
- `.prose` body copy keeps Source Serif 4.
- `--axi-mono` stays axi's mono **globally**. IBM Plex Mono is applied **by
  name** in the editorial zone only (bylines, kickers, folio dates) rather
  than by overriding `--axi-mono`, because `--axi-t-*` shorthands resolve
  `var(--axi-mono)` at `:root` and inherit already-substituted — overriding the
  family token alone re-fonts nothing.

Three plain `font-family` declarations, no guards, per the font-scoping fact
above.

**No font changes.** All three faces (Playfair Display, Source Serif 4, IBM
Plex Mono) stay loaded from `src/renderer/index.html`, and the CSP
(`style-src` allowing `fonts.googleapis.com`, `font-src`
`fonts.gstatic.com`) is unchanged.

---

## 5. The line conversion

axi's line vocabulary bleeds *into* the editorial zone. The article keeps its
serif type and drop cap, but its dividers stop being newsprint and become axi
rules drawn in `--axi-rule`. **Dashed and double disappear from the codebase
entirely.**

| element | now | becomes | precedent |
|---|---|---|---|
| `.folio` | `3px double var(--rule)` | `3px solid var(--axi-rule)` | `.axi-prose h2` |
| `.mnav` | `3px double var(--rule2)` | `3px solid var(--axi-rule)` | `.axi-prose h2` |
| `.prose hr` | `1px dashed var(--rule)` | `3px solid var(--axi-rule)` | `.axi-prose hr` — exact |
| `.byline` | `1px solid var(--line)` | `2px solid var(--axi-rule)` | `.axi-prose td` |
| `.rip .t` | `1.5px dashed var(--rule2)` | `2px solid var(--axi-rule)` | `.axi-prose td` |
| `.mtop` | `1px dashed var(--rule)` | `3px solid var(--axi-rule)` | structural |
| `.chatcol` sides | `1px dashed var(--rule)` | **deleted** | — |

Also in this section:

- **`.prose a`** loses `text-decoration: underline dotted` and takes axi's
  prose link: `color: var(--axi-accent); font-weight: 600;
  text-underline-offset: 2px`, with `:hover { color: var(--axi-text) }`.
- **`.folio-act`** stops being a dashed line and becomes a real axi control —
  3px `--axi-ink-line` border with a 3px offset block.
- **`.prose blockquote`** takes **axi's** version, not a converted one: a 4px
  `--axi-border-panel` left rule in `--axi-accent` over an `--axi-ground`
  background, italic. This is a deliberate departure from the initial
  expectation of a 3px `--axi-rule` bar; axi's own `.axi-prose blockquote`
  is more distinctive and is the house style.
- **`.chatcol`'s side rules are deleted rather than converted.** Converting
  1px dashed column gutters to 3px solid produces two heavy vertical bars
  framing the reading column — worse than the absence. The column is already
  legible from its padding.
- **`.prose table`** takes `.axi-prose`'s table treatment, not `axi-table`'s:
  a 3px `--axi-ink-line` frame, `--axi-surface-raised` uppercase micro-type
  headers, and 2px `--axi-rule` row separators. Its current `1px dotted`
  cell borders and `rgba(0,0,0,.12)` wash both go. It is a table *in prose*,
  so it belongs to the editorial grammar, not to §8's component families.
- **The diamond bullet is adopted** in `.prose`, copying
  `.axi-prose ul > li::before` (7px square rotated 45°, `--axi-accent` fill,
  2px `--axi-ink-line` border). The diamond is axi's family motif (rule 7)
  and this is the cheapest family-resemblance win available.

---

## 6. The ground, and two sanctioned departures

### The ground goes flat

`body`'s radial glow and vertical linear gradient are **removed**, replaced by
flat `var(--axi-ground)` (`#15181d`). They are generic dark-app sheen — exactly
what rule 1 exists to kill — and they contribute nothing to the newspaper
identity.

### Departure 1 — the torn edge (survives)

`.msg.user .body::after`'s `clip-path` torn-paper edge on user clippings stays
unchanged, except that its `background: var(--paper)` becomes
`var(--axi-surface)`. It breaks no rule literally; it is simply not a shape
axi-design would draw. It is the single most characteristic thing in the app.

`.inputzone::before`'s torn top edge is the same device and survives on the
same terms.

### Departure 2 — the scanline (survives, scoped)

The `repeating-linear-gradient` halftone scanline stays, but **scoped to the
editorial column** rather than painted across the whole app.

- **Rule broken:** rule 1, no gradients on surfaces.
- **Why it is sanctioned:** technically a gradient; in intent, paper texture
  rather than a depth cue. Rule 1 exists to stop surfaces pretending to be
  lit. This does not pretend to be lit.

Both departures live on the editorial surface. There are **exactly two**. Any
future gradient, dashed rule or partial-opacity wash is a bug, not a third
departure.

### Frameless window chrome

`--axi-radius` is 0, so a frameless window has nothing for an offset block to
fall onto. AxiVale adopts axiroster's solution — draw the block **inward**:

```css
box-shadow: inset calc(-1 * var(--axi-offset-panel))
            calc(-1 * var(--axi-offset-panel)) 0 0 var(--axi-ink-line);
```

### Correction: the close button

`.winctl button.close:hover` currently fills with `var(--accent)`. Under rules
5 and 6 the accent is not a status. Close-is-destructive becomes
`var(--axi-danger)`.

---

## 7. The accent system

### Source of truth

`@axiapps/axi-design/accents.json` lives at the **package root** (not `dist/`)
and has the shape `[{ id, label, hex }]` — exactly axiroster's
`AccentDefinition`. The axiroster module pattern transplants directly.

New `src/renderer/src/themes/`:

- **`accents.ts`** — re-exports `accents.json` as `ACCENTS`, defines
  `DEFAULT_ACCENT_ID = 'crimson-red'`, and exports
  `resolveAccentId(id?: string | null): string` falling back to the default on
  any unknown value.
- **`applyTheme.ts`** — `applyTheme(id)` sets `data-axi-accent` on the
  document root; `readAccent()` returns the cached id.

**Default accent: `crimson-red` (`#ef4444`).** The nearest official accent to
AxiVale's `#c8423a` — brighter and less brown, recognisably the same ink.
AxiVale opens looking like AxiVale.

### Import order

`src/renderer/src/main.tsx` currently imports no CSS at all (`theme.css` is
pulled in from `App.tsx`). It gains, in this order:

```ts
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
```

ahead of the existing app import, with `applyTheme(readAccent())` called before
`createRoot(...).render(...)`.

### Persistence

The accent persists through AxiVale's existing encrypted settings store —
**not** localStorage as the source of truth.

- `SettingsStore` is at `src/main/secrets.ts:102`, instantiated at
  `src/main/index.ts:215`.
- IPC handlers `settings:get` / `settings:set` at
  `src/main/index.ts:726-727`.
- One new member in the `SettingKey` union in `src/main/secrets.ts`:
  `'accent'`.

**The first-paint problem, and its fix.** That store is async over IPC, so a
naive read would paint the default accent and then visibly flip. The accent is
therefore **mirrored into `localStorage` on every change** and read from there
synchronously at boot; the settings store remains the source of truth and
reconciles a tick later. `readAccent()` reads the mirror; a mismatch from the
IPC result re-applies.

### The picker

A new `src/renderer/src/components/settings/Appearance.tsx`, registered in
`Settings.tsx`'s section router alongside Intelligence, Gw2Keys, AxiTools,
AxiForge, ReportRepos, Dispatches, Notifications and About.

Eleven swatches, each a filled block with axi's outline-and-offset treatment,
the active one marked with the diamond motif. Under rule 5 the filled swatch
**is** the status, so no separate checkmark is drawn.

`--accent-b` needs no wiring — it is derived by `color-mix` from
`--axi-accent` and tracks the selection automatically.

---

## 8. The component families

AxiVale currently has **nine separate implementations of "a raised surface"**
— `.earsw-menu`, `.ctx-menu`, `.ssel-menu`, `.clspick-menu`,
`.skill-typeahead`, `.overlay`, `.share-overlay`, `.action-modal`, `.wnm` —
and eight are the same three declarations (`background: var(--paper)`,
`border: 1px solid var(--rule2)`, `box-shadow: 4px 4px 0 rgba(0,0,0,.4)`).
That is an axi panel, hand-copied eight times at the wrong border weight.

Each phase is independently shippable and independently verifiable.

| phase | AxiVale now | becomes |
|---|---|---|
| **0. Token bridge** | `:root` in `theme.css` + `viewer.css` | §3's alias table |
| **1. Raised surfaces** | the nine above | `axi-panel` / `axi-menu` / `axi-modal` / `axi-drawer` |
| **2. Controls** | `.btn-stamp`, `.btn-out`, `.stepper button`, `.mnav button`, `.ed-acts button`, `.winctl button` | `axi-btn` + variants, icon-button |
| **3. Fields** | `.sinput`, `.sselect`, `.ed-search`, `.wt-opt input` | `axi-field`, `axi-select`, `axi-check` |
| **4. Segmented + switch** | `.sseg`, `.sk2-toggle` | `axi-seg`, `axi-switch` |
| **5. Tables** | `.dtable`, `.richtable`, bare `table` | `axi-table` |
| **6. Quantities** | `.learn-bar`/`.learn-fill`, `.cfillbar`, `.wskel .wbar` | `axi-meter` / `axi-bar` |

Notes on specific phases:

- **Phase 3** retires the last newsprint holdout in the chrome: `.sinput` and
  `.sselect`'s `1.5px dashed` bottom borders. `.wt-opt input` is a hand-rolled
  checkbox (appearance:none plus a rotated `::after` tick) that `axi-check`
  replaces wholesale.
- **Phase 4** is a genuine redesign, not a re-skin: `.sk2-toggle` is an LED
  pill, not a switch, and becomes one.
- **Phase 5** must preserve `.richtable`'s click-to-sort behaviour
  (`.richtable th { cursor: pointer }`).
- **`.prose table` is not in phase 5.** It is editorial, so it takes
  `.axi-prose`'s table treatment from §5 — not `axi-table`'s panel
  treatment.
- **Phase 6** is mostly a token swap: these are already drawn as length
  rather than intensity, which is what rule 9 asks for.

### Per-instance knobs

axi-design components are tuned through per-instance custom properties read
with a fallback and never declared, so they cascade from any ancestor:
`--axi-modal-width`, `--axi-menu-width`, `--axi-drawer-width`,
`--axi-switch-fill/-w/-h/-knob`, `--axi-check-size/-fill`, `--axi-pill-fill`,
`--axi-textarea-h`, `--axi-panel-pad`, `--axi-meter-v/-h/-label/-value`,
`--axi-bar-v/-part`, and others. Sizing overrides use these; they do not fork
axi's rules.

---

## 9. Test strategy

**Target: zero test-selector churn.**

18 test files assert on class names across 28 selectors: `.action-modal`,
`.action-modal__x`, `.action-overlay`, `.axi-class`, `.axi-ecard-pop`,
`.comp-card`, `.comp-slot--empty`, `.comp-slot--filled`, `.cs-build`,
`.cs-grid`, `.cs-tile`, `.ctx-item`, `.edition`, `.forge-render`,
`.learn-banner`, `.learn-fill`, `.lede`, `.manifest`, `.mem-rollup`,
`.mini-card`, `.msg`, `.ncard`, `.post-figure`, `.recharts-line`, `.rich`,
`.richchart`, `.rich-stale-badge`, `.richtable`.

All 28 are **semantic**, not presentational. The rule is therefore:

> The AxiVale class stays as the behavioural hook; the axi class composes
> alongside it — `className="action-modal axi-modal"` — and the bespoke
> class's *styling rules* are deleted while the name survives.

Tests keep passing untouched, and the semantic name stays the thing a reader
greps for. A bespoke class that is purely presentational and not pinned is
simply deleted.

Each phase is verified by:

1. `npm test` — must pass with **no test file edited**. A phase that requires
   a test edit has broken the composition rule and should be reworked.
   Run with limited parallelism: `vitest run --pool=forks
   --poolOptions.forks.maxForks=2`.
2. `npm run typecheck` — both tsc projects. vitest runs through esbuild and
   silently passes type errors, so typecheck is not optional.
3. Visual check in `npm run dev`.

---

## 10. Scope boundaries

### The share viewer: tokens in, components out

`src/share-viewer/viewer.css` (400 lines) already imports `theme.css`, so the
phase-0 alias table carries it for free — it inherits the new ground and accent
with no further work. Its one real edit is
`background: var(--bg, #16171a) radial-gradient(...)`, which loses its gradient
under §6.

It has no switches, modals, meters or tables of its own, so phases 1–6 do not
touch it. It ships in phase 0 and is otherwise out of scope.

`vite.viewer.config.ts` is a second build target; `npm run build` runs both.
Any phase-0 change must be checked against `npm run build:viewer`.

### The `axi-` namespace: no renames

`.axi-ecard`, `.axi-ecard--loading`, `.axi-ecard-pop`, `.axi-emoji-icon`,
`.axi-emoji-mask`, `.axi-entity` and `.axi-class` collide with nothing in
`axi.css`. Renaming would churn a test-pinned selector (`.axi-ecard-pop`) to
solve a readability problem that a comment in `theme.css` solves. **They stay,
with a comment noting the coincidence.**

### Explicitly out of scope

- Any change to the three loaded font faces or to the CSP.
- Any React component restructuring beyond swapping class names and deleting
  dead CSS.
- Any change to `src/main/` beyond adding `'accent'` to `SettingKey`.
- Any new axi-design feature request. AxiVale consumes v1.10.0 as shipped.

---

## 11. Dependency

`package.json` gains `"@axiapps/axi-design": "^1.10.0"` to `dependencies`,
alongside the existing `@axiapps/*` packages (axilog, bridge-metrics,
forge-render, gw2-data). The package is CSS-only — no JS, no transitive
dependencies, `sideEffects: ["*.css"]` — so it needs no `asarUnpack` entry and
no electron-builder change.

---

## 12. Open items carried into planning

1. **Verify the `--accent-b` 82% mix against `slate-silver`** before the accent
   picker ships. If separation is inadequate at the light end, the mix needs to
   be direction-aware (toward white for dark accents, toward the ink line for
   light ones) or the extension needs to be reconsidered.
2. **Confirm the axi class names** for each family in §8 against `axi.css` at
   implementation time. The families are certain; the exact class names in the
   right-hand column are from the package's documented vocabulary and should be
   read out of `axi.css` before use.
