# Entity Autolinking — Iteration 2 (markers-primary, real icons, theme)

> Follow-up on branch feat/entity-autolinking after live feedback. Subagent-driven, review per task.

**Feedback driving this:**
1. Hover card + inline chips must show the **real GW2 API icon**, not a gradient placeholder.
2. Card must use the **axivale theme** tokens, not a bespoke palette.
3. The bare-text matcher mislabeled the common word "Leap" → switch to **markers-primary**: the model emits `[[type:Name]]`, we resolve to the canonical entity, and **auto-text-matching is OFF by default**.

**Design (approved):** AI marks intent with `[[skill|trait|item:Name]]` (it knows names, not IDs) → we resolve name→canonical {id, icon, facts, wikiUrl} via the dictionary/API → themed card with real art. No bare-text auto-link = no "Leap" false positives. Icons + theme come along because resolution now returns the API icon and the dictionary carries icons for inline rendering.

## Global Constraints
- ESM, no file extensions in imports. Tests co-located `src/**/*.test.ts`, run `npx vitest run <file> --maxWorkers=2`.
- Entity types exactly `'skill' | 'trait' | 'item'`.
- Type shapes must stay in lockstep across: `src/main/entities/{types,dictionary,normalize,service}.ts`, `src/preload/index.d.ts`, `src/renderer/src/components/{rehypeEntityLinks,entityCard,useEntityDictionary}.ts(x)`.
- The full suite (`npx vitest run --maxWorkers=2`) must stay green; renderer typecheck stays at the 1 known pre-existing `App.test.tsx` error.
- GW2 API: `https://api.guildwars2.com/v2/{skills,traits}?ids=all` rows have `{ id, name, icon }` (icon = full render URL). Reuse the SAME request that builds the dictionary — no extra calls.

---

### Task A: Main — carry icons through dictionary + resolve

**Files:** `src/main/entities/dictionary.ts`, `normalize.ts`(maybe), `service.ts`, `types.ts`, `src/preload/index.d.ts`; tests alongside.

- Add `icon?: string` to `EntityDictionaryEntry` (and the preload `.d.ts` copy).
- Replace/augment `fetchGw2Names` with `fetchGw2Entities(endpoint: 'skills'|'traits', fetch): Promise<{ name: string; icon?: string }[]>` — same URL, returns name+icon (skip rows without a string name). Keep it a pure, injected-fetch function with a test (names + icons extracted; non-ok → []).
- `buildDictionary` input becomes `{ skills: {name,icon?}[]; traits: {name,icon?}[]; items: {name,icon?}[] }`; same trim/dedupe (item>skill>trait)/longest-first, now carrying `icon`. Update its test.
- `EntityService`:
  - deps: `fetchEntities: (e:'skills'|'traits') => Promise<{name,icon?}[]>` (was `fetchNames`).
  - `dictionary()` builds from fetched skill/trait entities + catalog runes/relics (`{name, icon}`).
  - Build an icon index `Map<string,string>` keyed `type:name` from the same data.
  - `resolve` for skill/trait: set `card.icon ??= iconIndex.get(\`${type}:${name}\`)` so cards get real art (items already carry catalog icon). Successes-only cache unchanged.
  - Update `service.test.ts`: fixtures return `{name,icon}`; assert a resolved skill card has the icon; dictionary entries carry icons.
- Wire the renamed dep in `src/main/index.ts`: `fetchEntities: (e) => fetchGw2Entities(e, (url)=>fetch(url))`.

Reviewer focus: lockstep types, icon index keying matches resolve lookup, no extra API calls, successes-only cache intact.

---

### Task B: Matcher — markers-primary + inline icon data attribute

**Files:** `src/renderer/src/components/rehypeEntityLinks.ts`, `richSpan.tsx`; tests.

- `rehypeEntityLinks(opts: { dictionary; autoTextMatch?: boolean })`. Default `autoTextMatch` = **false**. When false, the **text pass is skipped entirely** (marker pass still runs). The `byName` map now stores `{ type, icon? }`.
- When emitting a span (marker OR text), if the dictionary has an icon for that exact name, add `'data-entity-icon': icon`. (Marker names are looked up in `byName`; absent → no icon attr, no inline image.)
- Keep the memoized compile cache; it must key on `(dictionary, autoTextMatch)` so toggling the flag doesn't reuse a stale compiled matcher.
- Tests: with `autoTextMatch` omitted/false, `[[skill:Shelter]]` still wraps but bare "Shelter" does NOT; with `autoTextMatch:true`, legacy behavior holds (keep existing text-pass tests under that flag); `data-entity-icon` emitted when the dictionary entry has an icon.
- `renderRichSpan` `axi-entity` branch: when `data-entity-icon` is a string, render a leading `<img class="axi-entity__ico" src={icon} alt="" loading="lazy" />` before the name; else no inline graphic (themed text only). Preserve `data-entity-type`/`data-entity-name` passthrough.

Reviewer focus: text pass truly gated off by default; markers unaffected; compile-cache key includes the flag; img only when icon present; data attrs preserved.

---

### Task C: System prompt — instruct the model to emit markers

**Files:** `src/main/agent.ts` (the `AXIVALE_SYSTEM_PROMPT` string), `src/main/systemPrompt.test.ts`.

- Add a short section instructing: when referencing a specific GW2 **skill, trait, or item** in prose, wrap it as `[[skill:Exact Name]]` / `[[trait:Exact Name]]` / `[[item:Exact Name]]` using the canonical in-game name; do not wrap generic words, and do not invent IDs/codes — names only. Keep it concise and consistent with the existing prompt's voice.
- Add a `systemPrompt.test.ts` case asserting the marker syntax + the three types appear (e.g. `toContain('[[skill:')`, `/\[\[trait:/`, `/\[\[item:/`) and a line about using exact canonical names.

Reviewer focus: instruction is unambiguous, doesn't contradict existing `{{figure}}`/formatting rules, test asserts the real text.

---

### Task D: Theme the card + inline CSS (axivale tokens)

**Files:** `src/renderer/src/components/entityCard.ts` (markup tweaks only if needed), `src/renderer/src/theme.css`.

- Rewrite `.axi-entity*` and `.axi-ecard*` rules to use theme tokens: `--paper` (card bg), `--line`/`--rule` (borders), `--ink`/`--ink-dim`/`--faint` (text), `--accent` (fact dots), `--accent-b` (links/inline). Use `IBM Plex Mono` for the uppercase type label and the "Open wiki" footer (match existing mono labels). Drop the blue/purple/gold per-type colors.
- Inline `.axi-entity`: `color: var(--accent-b); text-decoration: underline dotted; text-underline-offset: 2px;` (echoing `.prose a`), `display: inline-flex; align-items: baseline; gap: .3em`. `.axi-entity__ico { width: 1.05em; height: 1.05em; align-self: center; border-radius: 3px; border: 1px solid var(--rule); }`. Remove the `::before` gradient chips.
- Card icon `.axi-ecard__icon` 40px, `border:1px solid var(--rule)`; ensure `entityCard.ts` already renders `<img>` when `card.icon` is present (it does) — verify the empty/skeleton states still read on the themed bg. Update the loading skeleton row colors to theme tokens.
- Verify `entityCard.test.ts` still passes (it asserts escaping + content, not colors).

Reviewer focus: only CSS/markup; no logic; tokens used (no stray hex that duplicates a token); inline img sizing sane.

---

## Verification (controller)
After all tasks: full suite green, renderer typecheck = 1 pre-existing error, then live in-app check (model emits a marker, card shows real icon, themed, and a bare common word like "Leap" is NOT linked).
