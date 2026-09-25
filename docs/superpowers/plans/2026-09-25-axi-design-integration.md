# AxiVale × axi-design Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `@axiapps/axi-design` v1.10.0 as AxiVale's UI foundation — shared accent system, token parity, component reuse, family resemblance — while preserving the newspaper identity as editorial typography plus two named departures.

**Architecture:** Fork B. `axi.css` and `accents.css` import as shipped; AxiVale does not re-dress axi components in newsprint. A token bridge re-points AxiVale's 14 private custom properties at axi tokens, re-skinning all 821 existing `var()` references with no markup churn. Six component families then migrate one shippable phase at a time, each composing axi classes *alongside* the existing semantic class rather than replacing it, so no test file is edited.

**Tech Stack:** Electron ^33 (Chromium 130), electron-vite, React 18, TypeScript, Vitest + @testing-library/react + jsdom, plain CSS (no preprocessor, no CSS-in-JS).

**Spec:** `docs/superpowers/specs/2026-09-25-axivale-axi-design-integration-design.md`

---

## Spec corrections carried into this plan

The spec's §12 said the axi class names in §8 were from the documented vocabulary and should be read out of `axi.css` before use. That was done while writing this plan. Five things changed, and **the plan is authoritative over the spec where they differ**:

1. **`.axi-seg` does not exist.** The segmented toggle (`.sseg`) becomes a group of `.axi-pill` with `aria-pressed`. `.axi-tabs` is a nav element (anchors with `aria-current="page"`) and is the right target for `.mnav`, not for `.sseg`.
2. **`.axi-field` does not exist.** The field family is `.axi-input`, `.axi-select`, `.axi-search` (+ `.axi-search__icon`), and `textarea.axi-input`.
3. **`.axi-bar` does not exist.** A single quantity is `.axi-meter` + `.axi-meter__fill`; a labelled run is `.axi-meter-list`.
4. **`.axi-modal` is a `<dialog>`.** It styles `::backdrop` and expects `showModal()`. AxiVale's `.action-overlay` is a real element that `ActionModal.test.tsx:50` clicks to dismiss. Converting to `<dialog>` would delete that element and break the zero-churn target, so **AxiVale keeps its overlay-div structure** and borrows `.axi-modal__head` / `__body` / `__foot` plus panel weight by hand. This is a deliberate deviation, recorded in Task 8.
5. **`.axi-window` and `.axi-titlebar` exist and supersede the spec's frameless approach.** The spec proposed axiroster's inward inset-shadow trick. axi-design instead ships a real Electron titlebar: `-webkit-app-region: drag` on the strip, `.axi-titlebar__btns` opting back out with `no-drag`, and `button:last-child:hover { background: var(--axi-danger) }` — which *is* the close-button correction §6 asked for, already in the package. `.axi-window` deliberately carries **no** block ("there is nothing behind a window that this language is entitled to draw on"), so the inset trick is not needed and must not be added.

A sixth correction is a genuine defect in the spec, not a naming slip:

6. **§10's "the share viewer carries it for free" is false.** `src/share-viewer/main.tsx` imports `../renderer/src/theme.css` and never imports `axi.css`. The moment `theme.css`'s `:root` stops declaring values and starts aliasing `var(--axi-*)`, the viewer renders with every token undefined. The viewer must import `axi.css` and `accents.css` itself and set a default accent. This is Task 2 and is a **build-breaking prerequisite**, not a cleanup.

## Global Constraints

- **Package version:** `"@axiapps/axi-design": "^1.10.0"` in `dependencies` (not devDependencies — it ships in the renderer bundle).
- **No `asarUnpack` entry.** The package is CSS-only, no JS, no transitive deps, `sideEffects: ["*.css"]`. `electron-builder` config is untouched.
- **Import order is load-bearing:** `axi.css` → `accents.css` → `theme.css`. `theme.css` is imported from `App.tsx`, so the two axi imports must appear in `main.tsx` **above** `import App from './App'`; ES module evaluation order is what orders the bundled CSS, and theme.css must win over axi.css at `:root`.
- **Vitest parallelism is capped.** Always run `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`. Never a bare `npm test` (this machine runs heavy apps alongside dev work and an unbounded vitest exhausts memory).
- **`npm run typecheck` is part of every verification.** Vitest runs through esbuild and silently passes TypeScript type errors; CI runs both tsc projects and so must you.
- **Two build targets.** `npm run build` runs `electron-vite build && vite build --config vite.viewer.config.ts`. Any change to `theme.css` must be checked against `npm run build:viewer`.
- **Zero test-selector churn.** No file under `src/**/*.test.tsx` may be edited by Tasks 1–13 except to *add* new tests. A task that requires editing an existing assertion has broken the composition rule and must be reworked.
- **Exactly two sanctioned departures** from axi-design's eleven rules: the torn clip-path edge, and the scanline scoped to the editorial column. Any other gradient, dashed rule, `double` rule, or partial-opacity colour wash introduced after Task 4 is a bug.
- **No font changes.** Playfair Display, Source Serif 4 and IBM Plex Mono all stay loaded from `src/renderer/index.html`; the CSP is untouched.
- **`color-mix` requires Chromium 111+.** Electron ^33 is Chromium 130. Safe, no fallback needed.

## Review Focus

Five things the spec implies but no task's own deliverable naturally exercises. Each has a test assigned to the task that owns the code.

1. **An unknown or legacy accent id in the settings store** — a value written by a future build, or a hand-edited `settings.json` — must resolve to `crimson-red`, not render an unstyled app. *(Task 5)*
2. **`localStorage` throwing or holding garbage** — Electron's renderer can have storage disabled or partitioned, and the accent mirror is read synchronously at boot before anything else. A throw here is a white window, not a degraded accent. *(Task 5)*
3. **`--accent-b` against a light accent.** The 82% mix toward white is tuned against `crimson-red`. `slate-silver` (`#94a3b8`) is already light; mixing it toward white may yield a "bright" variant indistinguishable from the base across 125 references. *(Task 6)*
4. **`settings:set` rejecting.** The picker writes to an encrypted store over IPC. If that write fails, the UI must not be left showing an accent the store does not hold. *(Task 6)*
5. **The share viewer has no Electron IPC and no accent picker.** `applyTheme` must never be called there, and the viewer must still render with a definite accent rather than inheriting `:root`'s bare `--axi-accent`. *(Task 2)*

---

## File Structure

**Created:**
- `src/renderer/src/themes/accents.ts` — the accent catalogue, default, and `resolveAccentId`. No DOM, no IPC; pure data + one function, so it is trivially testable.
- `src/renderer/src/themes/applyTheme.ts` — the only module that touches `document.documentElement` and `localStorage` for theming.
- `src/renderer/src/themes/accents.test.ts` — unit tests for resolution.
- `src/renderer/src/themes/applyTheme.test.ts` — unit tests for the DOM attribute and the storage mirror.
- `src/renderer/src/components/settings/Appearance.tsx` — the 11-swatch picker.
- `src/renderer/src/components/settings/Appearance.test.tsx`
- `src/renderer/src/theme.guard.test.ts` — a text-level guard over `theme.css`. jsdom does not apply imported stylesheets, so visual CSS cannot be asserted through the DOM; reading the file as text and asserting on its content is the one form of regression test this migration can actually carry, and it is what keeps the "exactly two departures" constraint enforceable after the humans stop looking.

**Modified:**
- `src/renderer/src/theme.css` — the bulk of the work. Tasks 1, 3, 4, 8–13.
- `src/renderer/src/main.tsx` — two CSS imports + `applyTheme` bootstrap.
- `src/share-viewer/main.tsx` — two CSS imports + a static accent attribute.
- `src/share-viewer/viewer.css` — gradient removal.
- `src/main/secrets.ts` — one member added to the `SettingKey` union.
- `src/renderer/src/components/Settings.tsx` — register the Appearance section.
- `src/renderer/src/components/settings/SettingsNav.tsx` — add `'appearance'` to `SettingsSection`.
- `package.json` — one dependency.
- Component `.tsx` files in Tasks 8–13 — class-name composition only.

---

### Task 1: Install the package and bridge the tokens

This is the whole of the spec's §3. It re-skins the entire app in one commit without touching a single line of markup.

**Files:**
- Modify: `package.json` (dependencies block, line 26–42)
- Modify: `src/renderer/src/main.tsx` (whole file, 9 lines)
- Modify: `src/renderer/src/theme.css:2-9` (the `:root` block)
- Create: `src/renderer/src/theme.guard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the aliased `:root` in `theme.css`. Every later task assumes `var(--axi-*)` tokens resolve inside `theme.css`, and that `--accent-b` is derived rather than literal.

- [ ] **Step 1: Install the dependency**

```bash
npm install --save @axiapps/axi-design@^1.10.0
```

Confirm it landed and is CSS-only:

```bash
ls node_modules/@axiapps/axi-design/dist/
node -e "console.log(Object.keys(require('./node_modules/@axiapps/axi-design/package.json').exports))"
```

Expected: `axi.css`, `accents.css` present in `dist/`; exports list `./axi.css ./tokens.css ./accents.css ./accents.json ./package.json`.

- [ ] **Step 2: Write the failing guard test**

Create `src/renderer/src/theme.guard.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// import.meta.url, not __dirname: package.json sets "type": "module", so this
// file is ESM and __dirname does not exist in it.
const themeCss = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

/** The :root block only — where tokens are declared. */
const rootBlock = themeCss.slice(themeCss.indexOf(':root{'), themeCss.indexOf('}', themeCss.indexOf(':root{')) + 1)

describe('token bridge', () => {
  it('declares no raw hex colours in :root', () => {
    expect(rootBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('aliases every legacy token onto an axi token', () => {
    for (const name of ['bg', 'bg2', 'paper', 'line', 'rule', 'rule2', 'ink', 'ink-dim', 'faint', 'accent', 'green', 'amber']) {
      expect(rootBlock).toMatch(new RegExp(`--${name}\\s*:\\s*var\\(--axi-`))
    }
  })

  it('derives --accent-b from the live accent rather than pinning it', () => {
    expect(rootBlock).toMatch(/--accent-b\s*:\s*color-mix\(in srgb,\s*var\(--axi-accent\)\s*82%,\s*white\)/)
  })

  it('derives --focus from the live accent rather than pinning it', () => {
    expect(rootBlock).toMatch(/--focus\s*:\s*color-mix\(in srgb,\s*var\(--axi-accent\)/)
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — all four assertions fail, because `:root` still declares literal hex values.

- [ ] **Step 4: Replace the `:root` block in `theme.css`**

Replace `src/renderer/src/theme.css` lines 2–9 (the `:root{...}` block, including the `--focus` comment) with:

```css
/* Token bridge to @axiapps/axi-design. These names are AxiVale's own history:
   821 references across this file still use them, so they are kept as aliases
   rather than renamed. Change a value in axi-design and it lands here.
   --rule, --rule2 and --line all collapse onto --axi-rule: AxiVale drew three
   rule colours, axi draws one colour at two weights (--axi-border-control 3px
   structural, --axi-border-hairline 2px subordinate). Weight carries the
   hierarchy now, not hue. */
:root{
  --bg: var(--axi-ground);
  --bg2: var(--axi-ground);
  --paper: var(--axi-surface);
  --line: var(--axi-rule);
  --rule: var(--axi-rule);
  --rule2: var(--axi-rule);
  --ink: var(--axi-text);
  --ink-dim: var(--axi-text-dim);
  --faint: var(--axi-text-faint);
  --accent: var(--axi-accent);
  /* LOCAL EXTENSION: axi-design defines no accent-bright token. AxiVale's
     two-tone red is load-bearing across 125 references, so it survives here,
     derived by color-mix so it tracks whichever of the 11 accents is live.
     The 82% is tuned by eye. Delete this in favour of the real token if
     axi-design ever formalises an accent-bright. */
  --accent-b: color-mix(in srgb, var(--axi-accent) 82%, white);
  --green: var(--axi-ok);
  --amber: var(--axi-warn);
  /* The accent held back, so an active field reads as "ready," not alarmed. */
  --focus: color-mix(in srgb, var(--axi-accent) 55%, transparent);
}
```

- [ ] **Step 5: Run the guard test to confirm it passes**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Add the axi imports to `main.tsx`**

Replace `src/renderer/src/main.tsx` entirely. The two axi imports must sit **above** `import App from './App'` — `App.tsx` imports `theme.css`, and module evaluation order is what orders the bundled CSS. theme.css must come last so its `:root` and `body` rules win.

```ts
import React from 'react'
import ReactDOM from 'react-dom/client'
// Order matters: axi.css declares the tokens, accents.css overrides --axi-accent
// per [data-axi-accent], and theme.css (imported by App) aliases onto both and
// must come last to win at :root.
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 7: Verify the whole suite and the types**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
```

Expected: all tests PASS with **no existing test file edited**; typecheck clean. If any existing test now fails, stop — the bridge has changed behaviour, not just appearance, and that needs understanding before proceeding.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/renderer/src/main.tsx src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "feat(theme): bridge AxiVale tokens onto axi-design

Aliases the 14 private custom properties onto --axi-* tokens, re-skinning
all 821 existing references with no markup churn. --accent-b survives as a
documented local extension derived by color-mix so it tracks the live accent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix the share viewer's token resolution

**This is a build-breaking prerequisite created by Task 1, not a cleanup.** The viewer imports `theme.css` directly and never imported `axi.css`; after Task 1 every one of its tokens resolves to nothing. It also has no Electron IPC and no picker, so it needs a statically chosen accent. *(Review Focus item 5.)*

**Files:**
- Modify: `src/share-viewer/main.tsx`
- Modify: `src/share-viewer/viewer.css:16-19` (the `body` background)

**Interfaces:**
- Consumes: Task 1's aliased `theme.css`.
- Produces: nothing other tasks depend on. The viewer is terminal — no later task touches it.

- [ ] **Step 1: Reproduce the breakage**

```bash
npm run build:viewer
```

The build itself succeeds (CSS custom properties fail at paint, not at build). Confirm the defect by inspecting the emitted CSS for the dangling reference:

```bash
grep -o -- '--paper: *var(--axi-surface)' dist-viewer/assets/*.css || grep -ro -- '--paper[^;]*' dist/ | head
```

Expected: `--paper: var(--axi-surface)` is present and **no** `--axi-surface` is ever declared in the viewer bundle. That is the bug.

- [ ] **Step 2: Add the axi imports and a static accent**

Replace `src/share-viewer/main.tsx`:

```tsx
// src/share-viewer/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The viewer is a standalone web page with no Electron IPC and no accent
// picker, so it imports the design language directly and pins the default
// accent on <html> rather than calling applyTheme(). theme.css aliases onto
// these tokens and must be imported after them.
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import '../renderer/src/theme.css'
import '@axiapps/forge-render/forge-render.css'
import './viewer.css'
import ShareApp from './ShareApp'

document.documentElement.setAttribute('data-axi-accent', 'crimson-red')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShareApp />
  </StrictMode>
)
```

- [ ] **Step 3: Remove the viewer's gradient**

In `src/share-viewer/viewer.css`, replace the `body` rule's background (currently `var(--bg, #16171a) radial-gradient(1100px 500px at 50% -15%, rgba(255,255,255,.03), transparent)`) with a flat ground. The hardcoded fallbacks go too — the token is now guaranteed to resolve:

```css
body {
  margin: 0;
  min-height: 100vh;
  /* Flat. The radial glow was generic dark-app sheen — rule 1. */
  background: var(--axi-ground);
  color: var(--axi-text);
}
```

- [ ] **Step 4: Verify both builds and the viewer's tests**

```bash
npm run build:viewer
npx vitest run src/share-viewer --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
```

Expected: build succeeds; `ShareApp.test.tsx` passes unedited; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/share-viewer/main.tsx src/share-viewer/viewer.css
git commit -m "fix(viewer): import axi-design so bridged tokens resolve

The share viewer imports theme.css directly and never imported axi.css,
so every token bridged in the previous commit resolved to nothing there.
Pins crimson-red statically since the viewer has no IPC and no picker.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Flatten the ground and scope the two departures

The spec's §6. The app stops being serif-bodied and gradient-grounded.

**Files:**
- Modify: `src/renderer/src/theme.css:10-15` (the `body` rule), `:17-22` (scrollbars)
- Modify: `src/renderer/src/theme.css` — `.msg.user .body::after`, `.inputzone::before`
- Modify: `src/renderer/src/theme.guard.test.ts`

**Interfaces:**
- Consumes: Task 1's aliases.
- Produces: a `body` that is flat `--axi-ground` and `--axi-sans`. Task 4 scopes serif back onto the five editorial selectors and depends on `body` no longer being serif.

- [ ] **Step 1: Add the failing departure-count assertions**

Append to `src/renderer/src/theme.guard.test.ts`:

```ts
describe('sanctioned departures', () => {
  it('has exactly one gradient, and it is the editorial scanline', () => {
    const gradients = themeCss.match(/(radial|linear|repeating-linear)-gradient/g) ?? []
    expect(gradients).toEqual(['repeating-linear-gradient'])
  })

  it('keeps exactly two clip-path torn edges', () => {
    expect(themeCss.match(/clip-path/g)).toHaveLength(2)
  })

  it('draws the body on the flat ground', () => {
    expect(themeCss).toMatch(/body\{[^}]*background:\s*var\(--axi-ground\)/)
  })

  it('does not set a serif body font', () => {
    expect(themeCss).not.toMatch(/body\{[^}]*font-family:\s*'Source Serif 4'/)
  })
})
```

Note the first assertion also pins the *absence* of the `.wskel .wbar` sheen gradient, which Task 13 removes. Until then it will fail on that too — which is correct: the guard states the destination.

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — four gradients found (`radial`, `repeating-linear`, `linear` on body; `linear` on `.wskel .wbar`), body is serif.

- [ ] **Step 3: Flatten `body`**

Replace the `body` rule at `theme.css:11-15`:

```css
body{color:var(--ink);overflow:hidden;background:var(--axi-ground)}
```

The radial glow and the vertical linear gradient are deleted. `font-family:'Source Serif 4',serif` is deleted — the body inherits `--axi-sans` from axi.css. The scanline is **not** deleted; it moves in Step 4.

- [ ] **Step 4: Re-scope the scanline onto the editorial column**

Add, immediately after the `body` rule:

```css
/* SANCTIONED DEPARTURE 2 of 2 — breaks rule 1 (no gradients on surfaces).
   Scoped to the reading column rather than painted across the app. In form
   this is a gradient; in intent it is halftone paper texture, not a depth
   cue. Rule 1 exists to stop surfaces pretending to be lit. This does not
   pretend to be lit. */
.chatcol{background-image:repeating-linear-gradient(0deg,transparent 0 1px,rgba(0,0,0,.05) 1px 2px)}
```

- [ ] **Step 5: Re-token the torn edges**

`.msg.user .body::after` — change `background:var(--paper)` to `background:var(--axi-surface)` and prepend the comment:

```css
/* SANCTIONED DEPARTURE 1 of 2 — breaks no rule literally; it is simply not a
   shape axi-design would draw. The most characteristic thing in the app. */
```

`.inputzone::before` — same substitution, `var(--paper)` → `var(--axi-surface)`. (`.inputzone` itself keeps its `box-shadow:0 -14px 24px rgba(0,0,0,.45)`; that is a shadow, not a surface gradient, and is out of this task's scope.)

- [ ] **Step 6: Fix the scrollbar's dashed track and hardcoded hex**

At `theme.css:19-21`, `::-webkit-scrollbar-track` uses `1px dashed var(--line)` and `::-webkit-scrollbar-thumb` hardcodes `#16171a`:

```css
::-webkit-scrollbar-track{background:transparent;border-left:var(--axi-border-hairline) solid var(--axi-rule)}
::-webkit-scrollbar-thumb{background:var(--axi-rule);border-radius:0;border:2px solid var(--axi-ground)}
::-webkit-scrollbar-thumb:hover{background:var(--axi-accent)}
*{scrollbar-width:thin;scrollbar-color:var(--axi-rule) transparent}
```

- [ ] **Step 7: Run the guard**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: the `clip-path`, `body` background and serif assertions PASS. The gradient-count assertion still FAILS, reporting `['repeating-linear-gradient', 'linear-gradient']` — the remaining one is `.wskel .wbar`'s skeleton sheen, which Task 13 removes. **This is the one expected-failing assertion in the plan.** Leave it failing and mark it:

```ts
  // Fails until Task 13 removes the .wskel .wbar sheen gradient.
  it.fails('has exactly one gradient, and it is the editorial scanline', () => {
```

Change `it` to `it.fails` for that one assertion only, with that comment. Task 13 changes it back.

- [ ] **Step 8: Verify and commit**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual check: flat ground, sans chrome, scanline only in the reading column
```

```bash
git add src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "feat(theme): flatten the ground, scope the scanline

Removes the radial glow and vertical gradient from body (rule 1) and
re-scopes the halftone scanline to the editorial column as departure 2 of 2.
Torn edges re-tokened onto --axi-surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Scope the editorial typography

The spec's §4. Serif stops being global and becomes five selectors.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.lede`, `.folio h1`, `.action-modal__title`, the drop cap, `.prose`
- Modify: `src/renderer/src/theme.guard.test.ts`

**Interfaces:**
- Consumes: Task 3's sans-bodied `body`.
- Produces: the editorial zone. Task 5's line conversion styles the same selectors.

**Why this is three declarations and not a guard-clause exercise:** 41 rules in `axi.css` set `font: var(--axi-t-*)` — the `font` shorthand includes family — and only 2 set a bare `font-family`. An axi component nested inside a serif-scoped ancestor therefore re-asserts its own sans automatically. No `:not()` guards are needed anywhere in this task.

- [ ] **Step 1: Add the failing scoping assertions**

Append to `theme.guard.test.ts`:

```ts
describe('editorial typography', () => {
  it('scopes Playfair to display selectors only', () => {
    const playfair = themeCss.match(/[^{}]+\{[^}]*'Playfair Display'[^}]*\}/g) ?? []
    const selectors = playfair.map((r) => r.slice(0, r.indexOf('{')).trim())
    expect(selectors.sort()).toEqual([
      '.action-modal__title',
      '.folio h1',
      '.lede',
      '.prose > p:first-child::first-letter',
      '.prose h1,.prose h2,.prose h3'
    ])
  })

  it('keeps Source Serif on prose body copy', () => {
    expect(themeCss).toMatch(/\.prose\{[^}]*font-family:\s*'Source Serif 4'/)
  })

  it('never overrides the --axi-mono token', () => {
    expect(themeCss).not.toMatch(/--axi-mono\s*:/)
  })
})
```

That last assertion pins a real trap: `--axi-t-*` shorthands resolve `var(--axi-mono)` at `:root` and inherit already-substituted, so overriding `--axi-mono` in `theme.css` would re-font nothing while looking like it should. IBM Plex Mono is applied **by name** in the editorial zone instead, which the existing rules already do.

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'editorial typography' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL on the first two — `.prose` does not yet declare Source Serif (it inherited it from `body`), and the Playfair selector list does not yet include the heading rule.

- [ ] **Step 3: Declare serif on `.prose`**

`.prose` previously inherited Source Serif from `body`. Add the family explicitly to the `.prose` rule:

```css
.prose{font-family:'Source Serif 4',serif}
```

Merge this into the existing `.prose` declaration block rather than adding a second rule.

- [ ] **Step 4: Add the prose heading rule**

Article headings inside `.prose` keep Playfair. Add:

```css
.prose h1,.prose h2,.prose h3{font-family:'Playfair Display',serif;font-weight:700}
```

- [ ] **Step 5: Confirm the other three Playfair selectors are already correct**

`.lede` (line 106), `.folio h1` (line 80), `.action-modal__title` (line 931) and the drop cap already declare `font-family:'Playfair Display',serif`. Verify no *other* rule does:

```bash
grep -n "Playfair Display" src/renderer/src/theme.css
```

Expected: exactly five rules. If a sixth appears, either fold it into the list in the test or remove the family from it — do not silently widen the test.

- [ ] **Step 6: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
```

Expected: the three new assertions PASS; everything else unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "feat(theme): scope newsprint typography to the editorial zone

Playfair narrows to five display selectors and Source Serif is declared on
.prose rather than inherited from body. The chrome is sans like every other
axi app. --axi-mono is deliberately never overridden.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The accent module

The spec's §7, data layer only. No UI — Task 6 builds the picker on top.

**Files:**
- Create: `src/renderer/src/themes/accents.ts`
- Create: `src/renderer/src/themes/accents.test.ts`
- Create: `src/renderer/src/themes/applyTheme.ts`
- Create: `src/renderer/src/themes/applyTheme.test.ts`
- Modify: `src/main/secrets.ts` (the `SettingKey` union)
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: Task 1's `main.tsx` import block.
- Produces, and Task 6 depends on all of these exactly:
  - `type AccentDefinition = { id: string; label: string; hex: string }`
  - `const ACCENTS: AccentDefinition[]`
  - `const DEFAULT_ACCENT_ID = 'crimson-red'`
  - `function resolveAccentId(id?: string | null): string`
  - `const ACCENT_STORAGE_KEY = 'axivale.accent'`
  - `function applyTheme(id: string): void`
  - `function readAccent(): string`
  - `SettingKey` gains the member `'accent'`

- [ ] **Step 1: Write the failing resolution tests**

Create `src/renderer/src/themes/accents.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT_ID, resolveAccentId } from './accents'

describe('ACCENTS', () => {
  it('ships all 11 official accents with id, label and hex', () => {
    expect(ACCENTS).toHaveLength(11)
    for (const a of ACCENTS) {
      expect(a.id).toMatch(/^[a-z-]+$/)
      expect(a.label.length).toBeGreaterThan(0)
      expect(a.hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('contains the AxiVale default', () => {
    expect(ACCENTS.map((a) => a.id)).toContain(DEFAULT_ACCENT_ID)
    expect(DEFAULT_ACCENT_ID).toBe('crimson-red')
  })
})

describe('resolveAccentId', () => {
  it('passes through a known id', () => {
    expect(resolveAccentId('emerald-mint')).toBe('emerald-mint')
  })

  // Review Focus 1: a value written by a future build or hand-edited into
  // settings.json must not leave the app unstyled.
  it('falls back to the default for an unknown id', () => {
    expect(resolveAccentId('chartreuse-surprise')).toBe(DEFAULT_ACCENT_ID)
  })

  it('falls back to the default for null, undefined and empty string', () => {
    expect(resolveAccentId(null)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId(undefined)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId('')).toBe(DEFAULT_ACCENT_ID)
  })

  it('maps AxiVale legacy theme names onto official accents', () => {
    expect(resolveAccentId('red')).toBe('crimson-red')
    expect(resolveAccentId('accent')).toBe('crimson-red')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/renderer/src/themes/accents.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `Cannot find module './accents'`.

- [ ] **Step 3: Write `accents.ts`**

```ts
// src/renderer/src/themes/accents.ts
// The accent catalogue comes from the design package rather than being copied
// here: accents.json lives at the package root (not dist/) and is the same
// file the other axi apps read, so a new accent shipped upstream appears here
// with no AxiVale edit.
import accentsJson from '@axiapps/axi-design/accents.json'

export type AccentDefinition = { id: string; label: string; hex: string }

export const ACCENTS: AccentDefinition[] = accentsJson as AccentDefinition[]

/** crimson-red (#ef4444) is the nearest official accent to AxiVale's historic
 *  #c8423a — brighter and less brown, recognisably the same ink. */
export const DEFAULT_ACCENT_ID = 'crimson-red'

/** Names AxiVale may have stored before the accent system existed. */
const LEGACY_THEME_TO_ACCENT: Record<string, string> = {
  red: 'crimson-red',
  accent: 'crimson-red'
}

export function resolveAccentId(id?: string | null): string {
  if (id && ACCENTS.some((a) => a.id === id)) return id
  if (id && LEGACY_THEME_TO_ACCENT[id]) return LEGACY_THEME_TO_ACCENT[id]
  return DEFAULT_ACCENT_ID
}
```

- [ ] **Step 4: Run to confirm it passes**

```bash
npx vitest run src/renderer/src/themes/accents.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: PASS, 6 tests. If the JSON import fails to typecheck, add `"resolveJsonModule": true` to `tsconfig.web.json`'s `compilerOptions` — check first, do not add it blindly.

- [ ] **Step 5: Write the failing `applyTheme` tests**

Create `src/renderer/src/themes/applyTheme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, readAccent, ACCENT_STORAGE_KEY } from './applyTheme'
import { DEFAULT_ACCENT_ID } from './accents'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-axi-accent')
  vi.restoreAllMocks()
})

describe('applyTheme', () => {
  it('sets data-axi-accent on the document root', () => {
    applyTheme('teal-ocean')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('teal-ocean')
  })

  it('resolves an unknown id before applying it', () => {
    applyTheme('nonsense')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe(DEFAULT_ACCENT_ID)
  })

  it('mirrors the applied accent into localStorage for the next boot', () => {
    applyTheme('violet-purple')
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('violet-purple')
  })

  // Review Focus 2: the mirror is read before anything else renders. A throw
  // here is a white window, not a degraded accent.
  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => applyTheme('rose-pink')).not.toThrow()
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('rose-pink')
  })
})

describe('readAccent', () => {
  it('returns the default when nothing is stored', () => {
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
  })

  it('returns the mirrored accent', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'amber-warm')
    expect(readAccent()).toBe('amber-warm')
  })

  it('returns the default when the mirror holds garbage', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, '{"not":"an id"}')
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
  })

  it('does not throw when localStorage getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
  })
})
```

- [ ] **Step 6: Run to confirm it fails**

```bash
npx vitest run src/renderer/src/themes/applyTheme.test.ts --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `Cannot find module './applyTheme'`.

- [ ] **Step 7: Write `applyTheme.ts`**

```ts
// src/renderer/src/themes/applyTheme.ts
import { DEFAULT_ACCENT_ID, resolveAccentId } from './accents'

/** The synchronous boot mirror. The settings store is the source of truth,
 *  but it answers over async IPC — long after first paint. Reading a mirrored
 *  copy here is what stops the window painting the default accent and then
 *  visibly flipping to the chosen one. */
export const ACCENT_STORAGE_KEY = 'axivale.accent'

/** Sets the accent on <html>, where accents.css's [data-axi-accent] rules
 *  hang, and mirrors it for the next boot. Storage failures are swallowed:
 *  a renderer with storage disabled should lose the mirror, not the window. */
export function applyTheme(id: string): void {
  const resolved = resolveAccentId(id)
  document.documentElement.setAttribute('data-axi-accent', resolved)
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, resolved)
  } catch {
    /* no mirror this run; the store still holds the truth */
  }
}

export function readAccent(): string {
  try {
    return resolveAccentId(localStorage.getItem(ACCENT_STORAGE_KEY))
  } catch {
    return DEFAULT_ACCENT_ID
  }
}
```

- [ ] **Step 8: Run to confirm it passes**

```bash
npx vitest run src/renderer/src/themes/ --pool=forks --poolOptions.forks.maxForks=2
```

Expected: PASS, 14 tests across both files.

- [ ] **Step 9: Add the `SettingKey` member**

In `src/main/secrets.ts`, add to the `SettingKey` union (it begins at line 14). Place it with the other presentation keys, near `'windowBounds'`:

```ts
  /** One of @axiapps/axi-design's 11 accent ids; unknown values resolve to
   *  crimson-red in the renderer. Mirrored to localStorage for first paint. */
  | 'accent'
```

No IPC change is needed: `settings:get` and `settings:set` (`src/main/index.ts:726-727`) are generic over `SettingKey` and have no per-key allowlist.

- [ ] **Step 10: Bootstrap the accent in `main.tsx`**

Add to `src/renderer/src/main.tsx`, after the two CSS imports and before `createRoot`. It must run before render so the first paint is already correct:

```ts
import { applyTheme, readAccent } from './themes/applyTheme'
```

and immediately before `ReactDOM.createRoot(...)`:

```ts
// Synchronous, from the mirror — the store reconciles in Settings once IPC answers.
applyTheme(readAccent())
```

- [ ] **Step 11: Verify everything**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
```

Expected: all PASS, no existing test edited, both tsc projects clean (`secrets.ts` is in the node project, `themes/` in the web project).

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/themes src/renderer/src/main.tsx src/main/secrets.ts
git commit -m "feat(theme): add the shared accent module

Reads the 11-accent catalogue from axi-design's accents.json, resolves
unknown and legacy ids to crimson-red, and applies the accent to <html>
before first paint from a localStorage mirror. The encrypted settings store
remains the source of truth; a new 'accent' SettingKey carries it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The accent picker

**Files:**
- Create: `src/renderer/src/components/settings/Appearance.tsx`
- Create: `src/renderer/src/components/settings/Appearance.test.tsx`
- Modify: `src/renderer/src/components/settings/SettingsNav.tsx` (the `SettingsSection` union and the nav list)
- Modify: `src/renderer/src/components/Settings.tsx` (import + the section router)

**Interfaces:**
- Consumes: `ACCENTS`, `DEFAULT_ACCENT_ID`, `resolveAccentId` from `../../themes/accents`; `applyTheme` from `../../themes/applyTheme`; `SettingsSection` from `./SettingsNav`.
- Produces: `export default function Appearance(): ReactElement`; `SettingsSection` gains `'appearance'`.

- [ ] **Step 1: Read the sibling sections before writing anything**

```bash
sed -n '1,60p' src/renderer/src/components/settings/Notifications.tsx
sed -n '1,50p' src/renderer/src/components/settings/SettingsNav.tsx
grep -n "settings:get\|settings:set" src/renderer/src/components/settings/*.tsx | head
```

Follow whatever IPC-access pattern those files already use (`window.api.*` or similar) — **do not invent a new one**. The code in Step 3 below uses `window.api.getSetting` / `window.api.setSetting` as placeholders for the real names; substitute the actual ones you find. This is the one place in the plan where you must read before writing, because the preload surface is not reproduced here.

- [ ] **Step 2: Write the failing picker test**

Create `src/renderer/src/components/settings/Appearance.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Appearance from './Appearance'
import { ACCENTS, DEFAULT_ACCENT_ID } from '../../themes/accents'

afterEach(() => {
  document.documentElement.removeAttribute('data-axi-accent')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Appearance', () => {
  it('renders one swatch per official accent', async () => {
    const { container } = render(<Appearance />)
    await waitFor(() => expect(container.querySelectorAll('.accent-swatch')).toHaveLength(ACCENTS.length))
  })

  it('marks the stored accent as pressed', async () => {
    const { container } = render(<Appearance />)
    await waitFor(() => {
      const pressed = container.querySelector('.accent-swatch[aria-pressed="true"]')
      expect(pressed?.getAttribute('data-accent-id')).toBe(DEFAULT_ACCENT_ID)
    })
  })

  it('applies the accent to <html> on click', async () => {
    const { container } = render(<Appearance />)
    await waitFor(() => expect(container.querySelector('.accent-swatch')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-accent-id="teal-ocean"]')!)
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-axi-accent')).toBe('teal-ocean')
    )
  })

  // Review Focus 4: the store is encrypted and answers over IPC. If the write
  // fails, the UI must not keep showing an accent the store does not hold.
  it('reverts the selection when the settings write rejects', async () => {
    const { container } = render(<Appearance />)
    await waitFor(() => expect(container.querySelector('.accent-swatch')).toBeTruthy())
    vi.spyOn(window.api, 'setSetting').mockRejectedValue(new Error('store locked'))
    fireEvent.click(container.querySelector('[data-accent-id="violet-purple"]')!)
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-axi-accent')).toBe(DEFAULT_ACCENT_ID)
    )
  })
})
```

Whatever mock shape the sibling settings tests use for `window.api`, reuse it here — check `Notifications.test.tsx` if one exists, or `App.test.tsx`'s setup.

- [ ] **Step 3: Run to confirm it fails**

```bash
npx vitest run src/renderer/src/components/settings/Appearance.test.tsx --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `Cannot find module './Appearance'`.

- [ ] **Step 4: Write `Appearance.tsx`**

Substitute the real IPC names found in Step 1 for `window.api.getSetting` / `setSetting`.

```tsx
import { useEffect, useState, type ReactElement } from 'react'
import { ACCENTS, DEFAULT_ACCENT_ID, resolveAccentId } from '../../themes/accents'
import { applyTheme } from '../../themes/applyTheme'

export default function Appearance(): ReactElement {
  const [accent, setAccent] = useState(DEFAULT_ACCENT_ID)

  // The mirror already painted the right accent at boot; this reconciles the
  // mirror against the store, which is the source of truth.
  useEffect(() => {
    let live = true
    void window.api
      .getSetting('accent')
      .then((stored: string | null) => {
        if (!live) return
        const resolved = resolveAccentId(stored)
        setAccent(resolved)
        applyTheme(resolved)
      })
      .catch(() => {
        /* store unreadable; the mirror's accent stands */
      })
    return () => {
      live = false
    }
  }, [])

  async function choose(id: string): Promise<void> {
    const previous = accent
    setAccent(id)
    applyTheme(id)
    try {
      await window.api.setSetting('accent', id)
    } catch {
      // The store did not take it. Showing an accent the store does not hold
      // would survive until the next boot and then silently revert.
      setAccent(previous)
      applyTheme(previous)
    }
  }

  return (
    <div className="sgroup">
      <div className="slabel">Accent</div>
      <p className="shint">
        The ink this edition is printed in. Shared with every other axi application.
      </p>
      <div className="accent-grid">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="accent-swatch"
            data-accent-id={a.id}
            aria-pressed={a.id === accent}
            aria-label={a.label}
            title={a.label}
            style={{ '--swatch': a.hex } as React.CSSProperties}
            onClick={() => void choose(a.id)}
          >
            <span className="accent-swatch__chip" />
            <span className="accent-swatch__name">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the swatch styles to `theme.css`**

```css
/* Accent picker. Rule 5: the filled swatch IS the status, so the chosen one
   needs no tick — it is the one wearing its colour and its block. */
.accent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}
.accent-swatch{display:flex;align-items:center;gap:9px;padding:9px 11px;background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);color:var(--axi-text-dim);font:var(--axi-t-label);letter-spacing:var(--axi-ls-label);text-transform:uppercase;cursor:pointer;transition:transform .1s,box-shadow .1s}
.accent-swatch:hover{color:var(--axi-text);box-shadow:var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);transform:translate(-2px,-2px)}
.accent-swatch__chip{flex:none;width:16px;height:16px;background:var(--swatch);border:var(--axi-border-hairline) solid var(--axi-ink-line);transform:rotate(45deg)}
.accent-swatch[aria-pressed="true"]{color:var(--axi-text);box-shadow:var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line)}
```

- [ ] **Step 6: Register the section**

In `src/renderer/src/components/settings/SettingsNav.tsx`, add `'appearance'` to the `SettingsSection` union and add its entry to the nav list, placed just before `'about'`.

In `src/renderer/src/components/Settings.tsx`, add `import Appearance from './settings/Appearance'` alongside the other section imports, and add the `appearance` branch to the router following the exact shape the existing branches use.

- [ ] **Step 7: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
```

Expected: the four new tests PASS; every pre-existing test passes unedited.

- [ ] **Step 8: Check `--accent-b` against a light accent — Review Focus 3**

This is a judgment call that needs eyes, not an assertion.

```bash
npm run dev
```

Open Settings → Appearance, select **Slate Silver** (`#94a3b8`). Look at anything drawn in `--accent-b`: `.kick`, `.typebar`, `.action-modal__kick`, the drop cap, `.edition .ed-acts button.share:hover`.

`color-mix(in srgb, #94a3b8 82%, white)` is `#a9b5c2` — a 6% lightness step. Against `crimson-red` the same formula gives a clearly distinct tint; against an already-light accent it may not read as a second tone at all.

Record the finding. If the separation is inadequate, **do not silently retune the percentage** — report it and stop for a decision. The spec flagged this as an open item precisely because the fix (making the mix direction-aware, mixing toward `--axi-ink-line` for light accents) is a design change, not an implementation detail.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/settings/Appearance.tsx src/renderer/src/components/settings/Appearance.test.tsx src/renderer/src/components/settings/SettingsNav.tsx src/renderer/src/components/Settings.tsx src/renderer/src/theme.css
git commit -m "feat(settings): add the 11-accent picker

A new Appearance section. The filled swatch is the selection (rule 5), so
no tick is drawn. A rejected settings write reverts the applied accent
rather than leaving the UI ahead of the store.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The line conversion

The spec's §5. Dashed and double leave the codebase.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.folio`, `.mnav`, `.prose hr`, `.byline`, `.rip .t`, `.mtop`, `.chatcol`, `.prose a`, `.folio-act`, `.prose blockquote`, `.prose table`, `.prose ul`
- Modify: `src/renderer/src/theme.guard.test.ts`

**Interfaces:**
- Consumes: Task 4's editorial zone.
- Produces: no dashed or double rule anywhere in `theme.css`. Tasks 8–13 must not reintroduce one.

- [ ] **Step 1: Add the failing line-vocabulary assertions**

Append to `theme.guard.test.ts`:

```ts
describe('line vocabulary', () => {
  it('has no dashed borders outside the axi dashed-button variant', () => {
    expect(themeCss).not.toMatch(/border[^:;{}]*:\s*[^;{}]*\bdashed\b/)
  })

  it('has no double borders', () => {
    expect(themeCss).not.toMatch(/\bdouble\b/)
  })

  it('has no dotted borders or underlines', () => {
    expect(themeCss).not.toMatch(/\bdotted\b/)
  })

  it('draws every rule at one of axi\'s two weights', () => {
    const widths = themeCss.match(/border(?:-top|-bottom|-left|-right)?:\s*([\d.]+)px/g) ?? []
    expect(widths).toEqual([])
  })
})
```

That last one is strict on purpose: after this task every border in `theme.css` is expressed as `var(--axi-border-control)` or `var(--axi-border-hairline)`, never a literal pixel count. Tasks 8–13 keep it that way.

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'line vocabulary' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL on all four.

- [ ] **Step 3: Convert the seven structural rules**

Apply exactly this mapping:

```css
/* .folio — was 3px double var(--rule) */
.folio{display:flex;align-items:baseline;padding:12px 0 10px;border-bottom:var(--axi-border-control) solid var(--axi-rule)}

/* .mnav — was 3px double var(--rule2) */
.mnav{display:flex;border-top:var(--axi-border-control) solid var(--axi-rule);padding:0 30px}

/* .prose hr — was 1px dashed var(--rule). Matches .axi-prose hr exactly. */
.prose hr{border:none;border-top:var(--axi-border-control) solid var(--axi-rule);margin:30px 0}

/* .byline — was 1px solid var(--line). Subordinate, so the hairline. */
.byline{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.18em;color:var(--faint);text-transform:uppercase;margin-bottom:12px;padding-bottom:10px;border-bottom:var(--axi-border-hairline) solid var(--axi-rule)}

/* .rip .t — was 1.5px dashed var(--rule2) */
.rip .t{flex:1;border-bottom:var(--axi-border-hairline) solid var(--axi-rule)}

/* .mtop — was 1px dashed var(--rule). Structural: it divides the chrome. */
.mtop{border-bottom:var(--axi-border-control) solid var(--axi-rule);-webkit-app-region:drag}
```

Preserve every other declaration in each of these rules — the snippets above show the full replacement for the line-bearing ones only; `.mtop` in particular has more declarations than shown, so edit its border in place rather than overwriting the rule.

- [ ] **Step 4: Delete `.chatcol`'s side rules**

Remove `border-left:1px dashed var(--rule);border-right:1px dashed var(--rule)` from `.chatcol`, leaving its flex and padding declarations (and the scanline added in Task 3). Converting them to 3px solid would put two heavy vertical bars around the reading column — worse than their absence. The column is legible from its padding.

- [ ] **Step 5: Convert `.prose a` to the axi prose link**

```css
.prose a{color:var(--axi-accent);font-weight:600;text-underline-offset:2px}
.prose a:hover{color:var(--axi-text)}
```

`text-decoration:underline dotted` is deleted. Also convert the other dotted-underline links found at `theme.css:177` — `.dtable td a`, `.manifest .v a`, `.copy a` — to the same treatment.

- [ ] **Step 6: Turn `.folio-act` into a real control**

```css
.folio-act{align-self:center;margin-left:16px;font:var(--axi-t-label);letter-spacing:var(--axi-ls-label);text-transform:uppercase;color:var(--axi-text-dim);background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);padding:4px 10px;cursor:pointer;transition:transform .1s,box-shadow .1s}
.folio-act:hover{color:var(--axi-text);box-shadow:var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);transform:translate(-2px,-2px)}
```

- [ ] **Step 7: Take axi's blockquote**

Not a conversion of the existing one — axi's version verbatim, because it is the house style and it is more distinctive:

```css
.prose blockquote{margin:0 0 18px;padding:11px 13px;border-left:var(--axi-border-panel) solid var(--axi-accent);background:var(--axi-ground);border-radius:0}
.prose blockquote p{margin:0;font-style:italic}
```

- [ ] **Step 8: Take axi's prose table**

`.prose table` is editorial, so it takes `.axi-prose`'s treatment — **not** `.axi-table`'s panel treatment, which Task 12 applies elsewhere. The `1px dotted` cell borders and the `rgba(0,0,0,.12)` wash both go (the wash is a rule-2 violation):

```css
.prose table{width:100%;margin:0 0 18px;border-collapse:collapse;border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);overflow:hidden;font-size:13.5px;text-align:left}
.prose th{text-align:left;padding:10px 12px;background:var(--axi-surface-raised);color:var(--axi-text);font:var(--axi-t-micro);letter-spacing:var(--axi-ls-micro);text-transform:uppercase}
.prose td{padding:10px 12px;border-top:var(--axi-border-hairline) solid var(--axi-rule)}
```

Delete the superseded `.prose thead th`, `.prose th,.prose td` and `.prose tr:last-child td` rules.

- [ ] **Step 9: Adopt the diamond bullet**

The family motif (rule 7), and the cheapest family-resemblance win available:

```css
.prose ul{list-style:none;padding-left:20px}
.prose ul > li{position:relative}
.prose ul > li::before{content:"";position:absolute;left:-20px;top:.55em;width:7px;height:7px;transform:rotate(45deg);background:var(--axi-accent);border:var(--axi-border-hairline) solid var(--axi-ink-line)}
```

- [ ] **Step 10: Sweep for stragglers**

```bash
grep -n "dashed\|double\|dotted" src/renderer/src/theme.css
```

Expected: no output. If any remain (`.stepper button`, `.sinput`, `.sselect`, `.wt-opt input`, `.action-modal__foot` are likely), convert them the same way — hairline for subordinate, control for structural — rather than leaving them for a later task. This task owns the line vocabulary.

- [ ] **Step 11: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual: the article, the folio, the masthead nav
```

Expected: the four new assertions PASS; `Article.test.tsx` and every other pre-existing test passes unedited.

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "feat(theme): convert newsprint rules to axi's line vocabulary

Dashed, double and dotted leave the codebase; every rule is now drawn in
--axi-rule at one of two weights. Takes axi's blockquote, prose table and
diamond bullet verbatim. .chatcol's side rules are deleted rather than
converted — 3px solid gutters read worse than none.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Raised surfaces

Phase 1, and the largest single win: nine hand-copied implementations of one idea.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.earsw-menu`, `.ctx-menu`, `.ssel-menu`, `.clspick-menu`, `.skill-typeahead`, `.overlay`, `.share-overlay`, `.action-overlay`, `.action-modal`, `.wnm`, `.wnm-scrim`

**Interfaces:**
- Consumes: Tasks 1 and 7.
- Produces: a single raised-surface treatment. Tasks 9–13 raise nothing themselves.

**Deviation recorded:** `.axi-modal` is a `<dialog>` that styles `::backdrop` and expects `showModal()`. `ActionModal.test.tsx:50` clicks `.action-overlay` to dismiss, and `Rails.test.tsx` queries `.action-modal` in four places. Converting to `<dialog>` deletes the overlay element and breaks the zero-churn constraint. **AxiVale keeps its overlay-div structure** and takes axi's *weights* by hand. This is a considered trade, not an oversight: the alternative is editing six assertions across two test files to buy a native focus trap AxiVale does not currently have and has not asked for.

- [ ] **Step 1: Write the failing surface-consistency test**

Append to `theme.guard.test.ts`:

```ts
describe('raised surfaces', () => {
  const RAISED = ['.earsw-menu', '.ctx-menu', '.ssel-menu', '.clspick-menu', '.skill-typeahead', '.wnm']

  it('draws every popover at panel weight on the ink line', () => {
    for (const sel of RAISED) {
      const rule = themeCss.match(new RegExp(`\\${sel}\\{[^}]*\\}`))?.[0]
      expect(rule, `${sel} not found`).toBeTruthy()
      expect(rule, `${sel} border`).toMatch(/border:\s*var\(--axi-border-panel\) solid var\(--axi-ink-line\)/)
      expect(rule, `${sel} block`).toMatch(/box-shadow:\s*var\(--axi-offset-panel\) var\(--axi-offset-panel\) 0 var\(--axi-ink-line\)/)
    }
  })

  it('draws every scrim in the shared scrim token', () => {
    for (const sel of ['.overlay', '.share-overlay', '.action-overlay', '.wnm-scrim']) {
      const rule = themeCss.match(new RegExp(`\\${sel}\\{[^}]*\\}`))?.[0]
      expect(rule, `${sel} not found`).toBeTruthy()
      expect(rule, `${sel} background`).toMatch(/background:\s*var\(--axi-scrim\)/)
    }
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'raised surfaces' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — all six popovers are `1px solid var(--rule2)` with `4px 4px 0 rgba(0,0,0,.4)`, and all four scrims are literal `rgba(0,0,0,.5–.62)`.

- [ ] **Step 3: Convert the six popovers**

Each keeps its own positioning, sizing and z-index. Only these three declarations change, in each of `.earsw-menu`, `.ctx-menu`, `.ssel-menu`, `.clspick-menu`, `.skill-typeahead`, `.wnm`:

```css
  background: var(--axi-surface-raised);
  border: var(--axi-border-panel) solid var(--axi-ink-line);
  box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line);
```

`--axi-surface-raised` rather than `--axi-surface`: these are chips and popovers raised off a panel, which is exactly what that token is for.

- [ ] **Step 4: Convert the four scrims**

In `.overlay`, `.share-overlay`, `.action-overlay` and `.wnm-scrim`, replace the literal `rgba(0,0,0,.5)` / `.6` / `.62` with `var(--axi-scrim)`. Remove `.wnm-scrim`'s `backdrop-filter:blur(1.5px)` — a blur is the depth cue rule 3 replaces with a block, and it is the only blur in the file.

- [ ] **Step 5: Convert `.action-modal` to panel weight**

```css
.action-modal{position:relative;display:flex;flex-direction:column;width:min(1080px,94vw);min-height:360px;max-height:90vh;background:var(--axi-surface);border:var(--axi-border-panel) solid var(--axi-ink-line);box-shadow:var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line)}
```

Delete `.action-modal::before` entirely — the inset 1px double-frame was a newsprint device standing in for the outline axi now draws properly.

Its head/foot rules take axi's modal treatment (structural rules inside one raised thing, per rule 8):

```css
.action-modal__rule{border:none;border-top:var(--axi-border-control) solid var(--axi-rule);margin:16px 24px 0}
.action-modal__foot{display:flex;align-items:center;gap:12px;padding:13px 24px;border-top:var(--axi-border-control) solid var(--axi-rule);margin-top:auto}
```

- [ ] **Step 6: Fix `.action-modal__stamp`'s borderless border**

It declares `border:1.5px solid` with no colour, relying on `currentColor`, and its `.ok` variant uses `rgba(111,174,111,.6)` — a rule-2 violation:

```css
.action-modal__stamp{flex:none;font:var(--axi-t-micro);letter-spacing:var(--axi-ls-micro);text-transform:uppercase;border:var(--axi-border-hairline) solid currentColor;padding:5px 12px;transform:rotate(-3deg);margin-top:3px;white-space:nowrap}
.action-modal__stamp.ok{color:var(--axi-ok)}
.action-modal__stamp.fail{color:var(--axi-danger)}
.action-modal__stamp.work{color:var(--axi-text-faint)}
```

The rotation stays — a rubber stamp is an editorial device and it costs nothing structurally.

- [ ] **Step 7: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual: right-click menu, the ear switcher, the action modal, the new-window modal
```

Expected: the two new assertions PASS; `ActionModal.test.tsx` and `Rails.test.tsx` pass **unedited** — that is the point of the deviation recorded above.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "refactor(theme): unify nine raised surfaces on axi panel weight

Six popovers, four scrims and the action modal were nine hand-copied
implementations of one idea at the wrong border weight. AxiVale keeps its
overlay-div structure rather than adopting axi's <dialog>, so no test
assertion changes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Controls

Phase 2. Establishes the 3px/3px control grammar everywhere a pointer lands.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.btn-stamp`, `.btn-out`, `.stepper button`, `.ed-acts button`, `.mnav a/button`
- Modify: `src/renderer/src/components/Editions.tsx` (class composition only)

**Interfaces:**
- Consumes: Task 7's line vocabulary.
- Produces: `.btn-stamp` and `.btn-out` styled as `.axi-btn--primary` and `.axi-btn`. Task 10 follows the same composition pattern.

- [ ] **Step 1: Write the failing control test**

Append to `theme.guard.test.ts`:

```ts
describe('controls', () => {
  it('draws buttons at control weight on the ink line', () => {
    for (const sel of ['.btn-stamp', '.btn-out']) {
      const rule = themeCss.match(new RegExp(`\\${sel}\\{[^}]*\\}`))?.[0]
      expect(rule, `${sel} not found`).toBeTruthy()
      expect(rule).toMatch(/border:\s*var\(--axi-border-control\) solid var\(--axi-ink-line\)/)
    }
  })

  it('gives the primary button the accent ink, not white', () => {
    const rule = themeCss.match(/\.btn-stamp\{[^}]*\}/)?.[0]
    expect(rule).toMatch(/color:\s*var\(--axi-accent-ink\)/)
    expect(rule).not.toMatch(/#fff/)
  })

  it('lifts on hover rather than fading', () => {
    expect(themeCss).toMatch(/\.btn-stamp:hover\{[^}]*transform:\s*translate\(-2px,\s*-2px\)/)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'controls' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `.btn-stamp` is `color:#fff` with `1px dashed rgba(255,255,255,.4)` and a 3px accent `outline`; `.btn-out` is `1px solid var(--rule2)`; neither has a hover lift.

- [ ] **Step 3: Convert the two buttons**

`.btn-stamp` is the primary action; `.btn-out` is the secondary. They become axi's two button weights:

```css
.btn-stamp{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;font:var(--axi-t-label);letter-spacing:var(--axi-ls-label);text-transform:uppercase;color:var(--axi-accent-ink);background:var(--axi-accent);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);box-shadow:var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);cursor:pointer;transition:transform .1s,box-shadow .1s}
.btn-stamp:hover{color:var(--axi-accent-ink);box-shadow:var(--axi-offset-control-hover) var(--axi-offset-control-hover) 0 var(--axi-ink-line);transform:translate(-2px,-2px)}
.btn-out{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;font:var(--axi-t-label);letter-spacing:var(--axi-ls-label);text-transform:uppercase;color:var(--axi-text-dim);background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);cursor:pointer;transition:transform .1s,box-shadow .1s}
.btn-out:hover{color:var(--axi-text);box-shadow:var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);transform:translate(-2px,-2px)}
```

Note `.btn-stamp` rests *with* a block and deepens it on hover, rather than gaining one. A resting block that only translates on hover moves element and block together and leaves the lower-right edge where it started — the "grows rather than lifts" failure. `.notice--safe .btn-stamp{background:var(--accent-b);outline-color:var(--accent-b)}` loses its now-meaningless `outline-color`; keep only the background override.

- [ ] **Step 4: Convert the stepper and the edition actions**

```css
.stepper button{font:var(--axi-t-label);line-height:1;background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);color:var(--axi-text-dim);width:24px;height:24px;cursor:pointer}
.stepper button:hover{color:var(--axi-text)}
```

`.ed-acts button` is an icon button inside a hovered row; it keeps its ghost treatment but loses the `rgba(255,255,255,.06)` wash (rule 2) and the stray `border-radius:3px` (radius is 0 in this language):

```css
.edition .ed-acts button{width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;background:none;border:none;color:var(--axi-text-faint);cursor:pointer;padding:0;border-radius:var(--axi-radius-sm)}
.edition .ed-acts button:hover{color:var(--axi-text);background:var(--axi-surface-raised)}
.edition .ed-acts button.share:hover{color:var(--accent-b)}
```

- [ ] **Step 5: Convert the masthead nav to `.axi-tabs` grammar**

`.mnav a.on` uses `border-bottom-color:var(--accent)` — keep that idea, it matches axi's `[aria-current="page"]`, but move the weight onto the token:

```css
.mnav a,.mnav button{font:var(--axi-t-label);letter-spacing:var(--axi-ls-label);text-transform:uppercase;color:var(--axi-text-dim);text-decoration:none;padding:9px 0;margin-right:34px;display:flex;gap:8px;border:none;border-bottom:var(--axi-border-hairline) solid transparent;cursor:pointer;background:none}
```

- [ ] **Step 6: Compose the axi class in `Editions.tsx`**

The composition rule in action. In `src/renderer/src/components/Editions.tsx:171`, the new-dispatch button gains the axi class alongside its semantic one:

```tsx
        <button className="ed-new axi-btn" onClick={onNew}>
          + New dispatch
        </button>
```

`.ed-new`'s own styling rules in `theme.css` that now duplicate `.axi-btn` are deleted; the class name stays as the hook.

- [ ] **Step 7: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual: the notice card's two buttons, the editions rail, the masthead nav
```

Expected: the three new assertions PASS; `Editions.test.tsx` passes unedited (it queries `.edition` and button titles, neither of which moved).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/components/Editions.tsx src/renderer/src/theme.guard.test.ts
git commit -m "refactor(theme): migrate buttons to axi control grammar

.btn-stamp and .btn-out become axi's primary and secondary weights, with
the block-deepening hover rather than the outline-and-fade they had.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Fields

Phase 3. Retires the last newsprint device in the chrome: the dashed underline input.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.sinput`, `.sselect`, `.ed-search`, `.wt-opt input`
- Modify: `src/renderer/src/components/Editions.tsx:176` (class composition)

**Interfaces:**
- Consumes: Task 9's control grammar.
- Produces: boxed fields. Task 11's switch sits alongside them in the same forms.

- [ ] **Step 1: Write the failing field test**

Append to `theme.guard.test.ts`:

```ts
describe('fields', () => {
  it('boxes every field instead of underlining it', () => {
    for (const sel of ['.sinput', '.sselect', '.ed-search']) {
      const rule = themeCss.match(new RegExp(`\\${sel}\\{[^}]*\\}`))?.[0]
      expect(rule, `${sel} not found`).toBeTruthy()
      expect(rule).toMatch(/border:\s*var\(--axi-border-control\) solid var\(--axi-ink-line\)/)
      expect(rule, `${sel} still underlined`).not.toMatch(/border-bottom:/)
    }
  })

  it('draws the checkbox mark in the accent ink', () => {
    const rule = themeCss.match(/\.wt-opt input:checked::after\{[^}]*\}/)?.[0]
    expect(rule).toMatch(/var\(--axi-accent-ink\)/)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'fields' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `.sinput` and `.sselect` are `border:none` plus a `1.5px dashed` bottom, and the checkbox tick is `#f4f1ea`.

- [ ] **Step 3: Box the text input**

```css
.sinput{width:100%;padding:11px 12px;background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);color:var(--axi-text);font:var(--axi-t-label);font-size:14px;outline:none;margin-bottom:12px}
.sinput::placeholder{color:var(--axi-text-faint);font-weight:500}
```

- [ ] **Step 4: Box the select and draw axi's caret**

The caret is two gradients meeting — a background-image, not a surface gradient, so rule 1 is untouched. **The Task 3 guard counts gradients in `theme.css`, so this would trip it.** Avoid that by not reimplementing the caret: give the select `.axi-select`'s job by composing the class in the markup instead, and keep only AxiVale's layout here:

```css
.sselect{width:100%;margin-bottom:12px}
```

Then in each component rendering a `.sselect`, compose: `className="sselect axi-select"`. Find them with:

```bash
grep -rn "sselect" src/renderer/src --include=*.tsx
```

- [ ] **Step 5: Box the editions search**

```css
.ed-search{width:100%;padding:11px 12px;background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);color:var(--axi-text);font:var(--axi-t-label);font-size:13px;outline:none}
```

- [ ] **Step 6: Convert the hand-rolled checkbox**

`.wt-opt input` reimplements what `.axi-check` does. Keep the element (it is a real `<input type=checkbox>`) and restate it in axi's terms:

```css
.wt-opt input{appearance:none;-webkit-appearance:none;margin:0;flex:none;width:var(--axi-check-size,22px);height:var(--axi-check-size,22px);display:inline-grid;place-items:center;background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);cursor:pointer}
.wt-opt input::after{content:"";width:55%;height:30%;opacity:0;border-left:var(--axi-border-control) solid var(--axi-accent-ink);border-bottom:var(--axi-border-control) solid var(--axi-accent-ink);transform:translateY(-12%) rotate(-45deg)}
.wt-opt input:checked{background:var(--axi-check-fill,var(--axi-accent))}
.wt-opt input:checked::after{opacity:1}
.wt-opt input:focus-visible{outline:var(--axi-border-hairline) solid var(--axi-accent);outline-offset:2px}
```

The mark is always in the DOM and revealed with opacity rather than created on `:checked`, so the box never changes size as it toggles.

- [ ] **Step 7: Compose the search class**

`src/renderer/src/components/Editions.tsx:176`:

```tsx
        className="ed-search axi-input"
```

- [ ] **Step 8: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual: Settings fields, the editions search, the tool-picker checkboxes
```

Expected: both new assertions PASS; the Task 3 gradient count is unchanged (still the scanline plus the Task 13 straggler).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/components src/renderer/src/theme.guard.test.ts
git commit -m "refactor(theme): box the fields

Retires the dashed-underline input, the last newsprint device in the
chrome, and restates the hand-rolled checkbox in axi's terms.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The segmented toggle and the switch

Phase 4, and the one genuine redesign in the migration.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.sseg`, `.sseg button`, `.sk2-toggle`
- Modify: whichever component renders `.sk2-toggle` (find it in Step 1)

**Interfaces:**
- Consumes: Task 9's control grammar.
- Produces: `.sk2-toggle` rendered as a real switch with `role="switch"` and `aria-checked`.

- [ ] **Step 1: Find the markup**

```bash
grep -rn "sk2-toggle\|sseg" src/renderer/src --include=*.tsx
```

Read the component that renders `.sk2-toggle` before changing it. It is currently a `<button>` with an `.led` span and an `.off` class — not a switch in any accessible sense.

- [ ] **Step 2: Write the failing switch test**

Add to the test file of whichever component renders the toggle (found in Step 1). Adapt the render call to that component's real props:

```tsx
it('exposes the toggle as a switch with its state', () => {
  const { container } = render(/* the component, toggled off */)
  const sw = container.querySelector('[role="switch"]')
  expect(sw).toBeTruthy()
  expect(sw!.getAttribute('aria-checked')).toBe('false')
})
```

This is a new test, not an edit to an existing assertion — permitted, and the only markup-level test in Tasks 8–13.

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run <that test file> --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — no element has `role="switch"`.

- [ ] **Step 4: Convert the markup to a switch**

Replace the `.sk2-toggle` button with axi's switch shape. The `.led` span becomes the knob; the `.off` class is replaced by `aria-checked`, because the state belongs in the accessibility tree, not in a class name:

```tsx
<button
  type="button"
  role="switch"
  aria-checked={enabled}
  className="sk2-toggle axi-switch"
  onClick={onToggle}
>
  <span className="axi-switch__knob" />
</button>
```

Any label text that was inside the button moves to a sibling `<span>` outside it — a switch's box is the track, and text inside it breaks the knob's `calc`-based travel.

- [ ] **Step 5: Reduce the CSS**

`.axi-switch` now does the work. `.sk2-toggle` keeps only what is AxiVale's:

```css
.sk2-toggle{flex:none}
```

Delete `.sk2-toggle.off`, `.sk2-toggle .led`, and the `rgba(0,0,0,.2)` background (rule 2).

- [ ] **Step 6: Convert the segmented toggle to pills**

`.sseg`'s buttons become `.axi-pill` with `aria-pressed`, which is axi's filter-toggle shape. In the markup, replace `className={on ? 'on' : ''}` with `aria-pressed={on}` and add `axi-pill`. In CSS:

```css
.sseg{display:inline-flex;gap:6px}
```

Delete `.sseg button`, `.sseg button:last-child` and `.sseg button.on` — `.axi-pill` supplies all three, including the pressed fill and the lift.

- [ ] **Step 7: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual: toggle it on and off, check the knob travels fully
```

Expected: the new switch test PASSES; everything pre-existing passes unedited. Watch specifically for the knob overshooting the track's right edge — if it does, the track's width has been overridden somewhere without `--axi-switch-w` being set to match, and the `calc` travel is measuring the wrong number.

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/src
git commit -m "refactor(theme): make the toggle a real switch

.sk2-toggle was an LED pill with its state in a class name. It becomes an
axi switch with role=switch and aria-checked, and .sseg becomes a pill
group with aria-pressed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Tables

Phase 5. `.prose table` was already done in Task 7 and is **not** touched here.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.dtable`, `.dtable th`, `.dtable td`, `.dtable tbody tr`, `.richtable th`

**Interfaces:**
- Consumes: Task 8's panel weight.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing table test**

Append to `theme.guard.test.ts`:

```ts
describe('tables', () => {
  it('gives the header the control weight and the rows the hairline', () => {
    expect(themeCss).toMatch(/\.dtable th\{[^}]*border-bottom:\s*var\(--axi-border-control\) solid var\(--axi-rule\)/)
    expect(themeCss).toMatch(/\.dtable td\{[^}]*border-bottom:\s*var\(--axi-border-hairline\) solid var\(--axi-rule\)/)
  })

  it('hovers a row on the neutral ramp, not an ink', () => {
    const rule = themeCss.match(/\.dtable tbody tr:hover[^{]*\{[^}]*\}/)?.[0]
    expect(rule).toMatch(/background:\s*var\(--axi-surface-raised\)/)
  })

  it('does not stripe rows with a translucent wash', () => {
    expect(themeCss).not.toMatch(/nth-child\(even\)\{[^}]*rgba/)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'tables' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — rows use `rgba(255,255,255,.018)` striping and `rgba(228,227,220,.05)` hover, both rule-2 violations.

- [ ] **Step 3: Convert `.dtable`**

The panel is the raised thing and the table is what is inside it, so the wrapper takes the outline and the table itself takes none:

```css
.dtable{margin-top:10px;background:var(--axi-surface);border:var(--axi-border-panel) solid var(--axi-ink-line);border-radius:var(--axi-radius);overflow-x:auto}
.dtable table{width:max-content;min-width:100%;margin:0;border-collapse:collapse;font-variant-numeric:tabular-nums}
.dtable th{background:none;font:var(--axi-t-micro);letter-spacing:var(--axi-ls-micro);text-transform:uppercase;color:var(--axi-text-faint);text-align:left;white-space:nowrap;padding:0 10px 10px;border-bottom:var(--axi-border-control) solid var(--axi-rule)}
.dtable td{font:var(--axi-t-small);font-weight:700;color:var(--axi-text-dim);white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis;padding:9px 10px;border-bottom:var(--axi-border-hairline) solid var(--axi-rule)}
.dtable tbody tr:hover td{background:var(--axi-surface-raised);color:var(--axi-text)}
.dtable tbody tr:last-child td{border-bottom:none}
.dtable td.nm2{color:var(--axi-text)}
```

Delete `.dtable tbody tr:nth-child(even)` entirely. Zebra striping and a hover highlight are two answers to the same question; axi answers it with the hover, and forty rows each carrying a translucent wash is the tinted-everything failure rule 2 exists for.

- [ ] **Step 4: Preserve `.richtable`'s sort affordance**

`.richtable th{cursor:pointer;user-select:none}` and `.richtable th:hover{color:var(--ink)}` carry real behaviour. Keep both, re-tokening the hover:

```css
.richtable th{cursor:pointer;user-select:none}
.richtable th:hover{color:var(--axi-text)}
```

- [ ] **Step 5: Run and verify**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
npm run dev   # visual: a tool result in the coupon, and the action modal's table; click a .richtable header to confirm sorting still works
```

Expected: the three new assertions PASS; `ToolCoupon.test.tsx` and `Rails.test.tsx` (both query `.richtable`) pass unedited.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "refactor(theme): migrate data tables to axi weights

The wrapper is the panel and the table is its interior (rule 8). Zebra
striping goes — the row hover already answers that question, and forty
translucent washes is what rule 2 exists to prevent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Quantities, and closing the gradient guard

Phase 6, and the task that makes Task 3's `it.fails` assertion pass.

**Files:**
- Modify: `src/renderer/src/theme.css` — `.learn-bar`, `.learn-fill`, `.csign`/`.cfillbar`, `.wskel .wbar`, `.typebar`
- Modify: `src/renderer/src/theme.guard.test.ts` (restore the gradient assertion)

**Interfaces:**
- Consumes: Task 1's aliases.
- Produces: the gradient count at exactly one. This task must be the last of the CSS phases.

- [ ] **Step 1: Restore the gradient assertion**

In `theme.guard.test.ts`, change the Task 3 `it.fails(...)` back to `it(...)` and delete the "Fails until Task 13" comment.

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/renderer/src/theme.guard.test.ts -t 'gradient' --pool=forks --poolOptions.forks.maxForks=2
```

Expected: FAIL — `['repeating-linear-gradient', 'linear-gradient']`, the second being `.wskel .wbar`'s sheen.

- [ ] **Step 3: Replace the skeleton sheen with a composited indicator**

`.wskel .wbar` animates `background-position` across a three-stop gradient. Rule 11 asks that an indicator of work animate a composited property; `background-position` is neither composited nor legal under rule 1. axi's answer is `.axi-meter--busy`, which animates a transform:

```css
.wskel .wbar{position:relative;height:11px;margin-bottom:9px;background:var(--axi-ground);border:var(--axi-border-hairline) solid var(--axi-ink-line);overflow:hidden}
.wskel .wbar::after{content:"";position:absolute;inset:0;width:35%;background:var(--axi-rule);animation:wbar-sweep 1.6s ease-in-out infinite}
@keyframes wbar-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}
```

Delete the `wire-sheen` keyframes if nothing else references them:

```bash
grep -n "wire-sheen" src/renderer/src/theme.css
```

- [ ] **Step 4: Convert the learning meter**

```css
.learn-bar{display:flex;height:var(--axi-meter-h,12px);background:var(--axi-ground);border:var(--axi-border-control) solid var(--axi-ink-line);border-radius:var(--axi-radius-sm);overflow:hidden}
.learn-fill{flex:none;height:100%;background:var(--axi-series,var(--axi-accent))}
```

**`.learn-fill`'s inline `style.width` must not be touched.** `MetaLearningBanner.test.tsx:22-25` reads `.learn-fill`'s `style.width` and asserts it is `'50%'`. The component sets that inline; this CSS must not introduce a competing `width` declaration.

- [ ] **Step 5: Convert the confidence bar**

```css
.cfillbar{display:block;height:100%;background:var(--axi-ok)}
.csign.partial .cfillbar{background:var(--axi-warn)}
```

- [ ] **Step 6: Re-token the type cursor**

```css
.typebar{display:inline-block;width:9px;height:15px;background:var(--accent-b);vertical-align:text-bottom;margin-left:3px;animation:typebar-blink 1s steps(1) infinite}
```

`steps(1)` on `opacity` is already composited and rule-11 clean — only the token changes, and `--accent-b` already resolves through the bridge. No edit needed if it already reads `var(--accent-b)`; verify and move on.

- [ ] **Step 7: Run the full guard and the full suite**

```bash
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
npm run typecheck
```

Expected: **every** guard assertion PASSES, including the gradient count now returning exactly `['repeating-linear-gradient']`. `MetaLearningBanner.test.tsx` passes unedited.

- [ ] **Step 8: Final visual pass**

```bash
npm run dev
```

Walk the app: masthead and nav, the editions rail, a dispatch article (drop cap, diamond bullets, blockquote, table, hr), the input bar's torn edge, a user clipping's torn edge, the action modal, the right-click menu, Settings including the new Appearance section, and the learning banner. Then switch the accent to `electric-blue` and confirm the whole app follows, including `--accent-b`.

- [ ] **Step 9: Verify the viewer one last time**

```bash
npm run build
```

Both targets must build. The viewer is the one surface no test covers visually — open `dist-viewer/index.html` (or whatever `vite.viewer.config.ts` emits) in a browser and confirm it is not a white page.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/theme.css src/renderer/src/theme.guard.test.ts
git commit -m "refactor(theme): draw quantities as length, close the gradient guard

The skeleton sheen animated background-position across a gradient; it
becomes a composited transform sweep (rule 11). theme.css now contains
exactly one gradient — the sanctioned editorial scanline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** §3 → Task 1. §4 → Task 4. §5 → Task 7. §6 → Task 3 (ground, departures) and the Spec Corrections block (frameless chrome, which `.axi-window` supersedes). §7 → Tasks 5 and 6. §8 → Tasks 8–13, phase for phase. §9 (test strategy) → the Global Constraint plus every task's verify step. §10 (share viewer) → Task 2, where it turned out to be a defect rather than a freebie. §11 (dependency) → Task 1 Step 1. §12 open item 1 → Task 6 Step 8; open item 2 → resolved before writing, in the Spec Corrections block.

**One deliberate omission.** The spec's §6 frameless-window treatment (axiroster's inset shadow) is **not** implemented, because `.axi-window`/`.axi-titlebar` exist and do it properly. Adopting them fully would restructure `.mtop`/`.mmain`/`.winctl` and the `-webkit-app-region` zones — a markup change across the masthead that risks the drag regions, which `Masthead.test.tsx` covers only partially. Tasks 3 and 7 re-token the existing chrome without restructuring it. **Adopting `.axi-window` properly should be its own follow-up task after this plan lands**, with the masthead's drag behaviour verified by hand on all three platforms. Flagging rather than silently dropping it.

**Known imprecision.** Task 6 Step 1 requires reading the preload surface before writing, because `window.api`'s real method names are not reproduced in this plan. Task 11 Steps 1–2 require reading the component that renders `.sk2-toggle` for the same reason. These are the only two places an implementer cannot work from the plan alone, and both say so explicitly.
