# Build-guide notes — design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)

## Problem

Users iterate on a build "guide" inside an AxiVale conversation; the agent keeps
regenerating the whole guide, and there is no way to save just the finished
product so a fresh conversation can reuse it without re-running the entire
process or pasting a mile-long prompt.

The capability technically exists (the agent can `axiforge_builds_get` → set
`build.notes` → `axiforge_builds_save`), but nothing makes the agent do it
reliably, read the existing guide before rewriting, or produce skill links that
render in AxiForge. AxiForge build notes render with a specific token syntax that
the agent cannot satisfy from names alone.

## Key facts (verified against the AxiForge source)

AxiForge is at `/var/home/mstephens/Documents/GitHub/axiforge`.

- **Build `notes` field:** `buildStore.js:215` — `notes: asString(input.notes, 100000)`.
  A plain markdown string, max **100,000 chars**, fully persisted and round-tripped.
- **Notes render with `marked`** plus a custom entity parser:
  `axiforge/src/site/render-notes.js`. Skill/entity links use the syntax
  **`@[category:id:name]`**, regex `/@\[(\w+):([\w]+):([^\]]+)\]/g` (line 55):
  - categories: `skill, trait, rune, sigil, food, utility, infusion, enrichment,
    relic, weapon, item` (`item` auto-resolves to the specific category).
  - **the id is the real numeric GW2 id** (weapons use string ids like `dagger`);
    the name is display-only, resolved by id.
  - example: `@[skill:5659:Whirlwind Attack]`.
  - Also supports `![desc](~img:key)` images and bare YouTube/Twitch URL embeds.
- **AxiVale's own link syntax is different:** `[[skill:Name]]` / `[[trait:Name]]` /
  `[[item:Name]]` (`rehypeEntityLinks.ts`, name-based, resolved by the app). The
  system prompt already mandates this for chat prose and forbids inventing ids.
- **AxiVale can already read/write notes:** `axiforgeClient.getBuild(id)` returns
  the full build incl. `notes`; `saveBuild(build)` accepts the full object
  (`Record<string, unknown>`). `axiforge_builds_save` already re-attaches stored
  images on update (`tools/axiforge.ts:179-189`) — reuse that logic.
- **Catalog resolves name→id:** `axiforge_catalog` →
  `catalogProfession(profession_id, game_mode)` (skills/traits) and
  `catalogUpgrades()` (runes/sigils/relics); both cached to disk so they work
  while AxiForge is closed. The build object itself also carries its own
  skills/traits/gear as id+name pairs — the cheapest, most accurate source.

## Design

The agent writes the guide in the readable `[[skill:Name]]` syntax it already
knows. A new notes tool **transpiles** those markers into AxiForge's
`@[category:id:Name]` tokens by resolving names → real GW2 ids, then saves onto
`build.notes` preserving everything else. A `build-guide` skill drives a
read→edit→save loop so iteration never restarts from zero.

### Component 1 — `buildNoteLinks.ts` (pure transpiler/resolver)

`src/main/buildNoteLinks.ts`. The unit-testable core.

```ts
export interface NoteLinkResolution {
  notes: string                              // transpiled markdown
  resolved: number                           // count of [[..]] markers turned into @[..]
  unresolved: Array<{ name: string; type: 'skill' | 'trait' | 'item'; reason: string }>
}
export function transpileNotes(
  notes: string,
  build: Record<string, unknown>,
  catalog: { profession?: unknown; upgrades?: unknown } | null
): NoteLinkResolution
```

Behavior:
- Build a case-insensitive `name → { category, id }` index, **build-first**:
  1. **Build's own components** — walk the build object's skill/trait/gear slots
     into the index (highest priority; exact; no catalog needed). The exact slot
     paths are an AxiForge build-shape detail confirmed in planning against a real
     build object (see Risks).
  2. **Catalog** — fold `catalog.profession` skills/traits and `catalog.upgrades`
     (runes/sigils/relics → category `item`) when present.
- Match `[[skill|trait|item:Name]]` markers (regex over AxiVale's marker syntax),
  case-insensitive on the trimmed name. Type → category: `skill→skill`,
  `trait→trait`, `item→item` (AxiForge's generic `item` auto-resolves).
- Replace a resolved marker with `@[category:id:Name]`.
- **Existing `@[cat:id:name]` tokens pass through untouched** (the marker regex
  only matches `[[...]]`).
- **Unresolved** marker → replace with plain `Name` (strip brackets so no raw
  `[[...]]` leaks into AxiForge, which would not render it) and record
  `{ name, type, reason }` (`reason`: `not-found` or `catalog-unavailable`).
- **Ambiguity:** build-source wins; within catalog the first match wins; still
  linked (no separate failure).

Pure: no I/O, no Electron — so it unit-tests with fixtures.

### Component 2 — `axiforge_build_notes_get` tool

`src/main/tools/axiforge.ts`. Read half.

- Input: `{ build_id: string }`.
- Behavior: `getBuild(build_id)`, return `{ build_id, title, notes, notesChars }`
  where `notes` is the raw stored markdown (existing `@[...]` tokens intact) and
  `notesChars` is its length. Empty/absent notes → `notes: ''`, `notesChars: 0`.
- `safe(...)` (no rich display needed; or a minimal display showing the build
  title). Read-only.

### Component 3 — `axiforge_build_notes_set` tool

`src/main/tools/axiforge.ts`. Save half.

- Input: `{ build_id: string; notes: string }`.
- Behavior:
  1. `getBuild(build_id)` — for the component index AND to preserve all other
     fields. Not found → clear error.
  2. Reject when `notes.length > 100000` with a clear message (AxiForge's cap;
     fail loud rather than let AxiForge silently truncate).
  3. Load catalog: `catalogProfession(build.profession, gameMode)` +
     `catalogUpgrades()`, each wrapped so a failure (AxiForge closed, no cache)
     degrades to `null` rather than throwing — build-component resolution still
     works; catalog-only names become `unresolved` with `reason:
     'catalog-unavailable'`.
  4. `transpileNotes(notes, build, catalog)`.
  5. Save via the existing image-preserving path: re-attach stored `images` from
     the freshly fetched build (mirror `axiforge_builds_save:179-189`), set
     `notes` to the transpiled string, `saveBuild({...build, notes, images})`.
  6. Return `{ value: { build_id, title, resolved, unresolved, notesChars },
     display: { kind: 'build-card', data: { build: saved } } }` so the user sees
     the updated build card and the agent sees what didn't link.
- Wrapped with the module's existing `write(...)` helper (starts AxiForge headless
  if needed), like the other write tools. Not on the destructive-confirm list:
  it edits the one field the user asked for, and the skill always `get`s first.

### Component 4 — `build-guide` skill + system-prompt note

- **Default skill** `build-guide` (`skillStore.ts`, alongside `wvw-report` etc.),
  loadable via `load_skill`. Recipe:
  - Trigger: user wants to write / update / save a build guide or "notes" for a build.
  - Step 1: `axiforge_build_notes_get` to read the current guide — **edit it, do
    not regenerate from scratch.**
  - Step 2: draft/refine **concise, structured** markdown (headings, short
    sections: role, rotation/combos, key skills, matchups). Reference skills/
    traits/gear by name as `[[skill:Name]]` / `[[trait:Name]]` / `[[item:Name]]`,
    grounded in `axiforge_catalog`. May use AxiForge features (bare YouTube/Twitch
    URLs embed; `![desc](~img:key)` for an existing build image).
  - Step 3: `axiforge_build_notes_set`; then inspect `unresolved` and fix names
    (wrong spelling / not in this build / off-meta) before finishing.
  - Keep it tight — a guide, not a transcript of the conversation.
- **System-prompt note** (`agent.ts`, near the existing entity-linking section):
  one bullet — to save a build guide, use `axiforge_build_notes_get/_set`; in
  build *notes* write links as `[[skill:Name]]` and `notes_set` converts them to
  AxiForge's `@[...]` tokens (distinct from chat prose, where `[[skill:Name]]`
  renders directly in AxiVale).

## Data flow

```
user: "write/update the guide for build X"
  skill → axiforge_build_notes_get(X)            // read existing; edit, don't restart
  agent drafts/edits markdown with [[skill:Name]] links, grounded via axiforge_catalog
  skill → axiforge_build_notes_set(X, notes)
        → getBuild(X)            (component index + preserve fields/images)
        → catalog                (profession + upgrades; offline-tolerant → null)
        → transpileNotes(...)    → @[category:id:Name] tokens
        → saveBuild({...build, notes, images})
        → { resolved, unresolved, notesChars }
  agent fixes any unresolved names, re-saves if needed
```

## Error handling

- **AxiForge offline / no cached catalog:** resolve from the build's own
  components only (its `getBuild` has a file fallback); catalog-only names →
  `unresolved` (`reason: 'catalog-unavailable'`); notes still save.
- **Build not found:** clear error from `notes_set`/`notes_get`.
- **Over 100k chars:** rejected before save with an explicit message.
- **Images / other build fields:** preserved via the existing re-attach logic; the
  agent never touches images.
- **Unresolved markers:** become plain text + reported; raw `[[...]]` never leaks
  into AxiForge.
- **Existing `@[...]` tokens:** preserved exactly (lossless round-trip).

## Testing

- **`buildNoteLinks` unit tests (pure, the bulk):** resolve from build
  components; resolve from catalog; case-insensitive name match; `[[item:…]]` →
  `item`; unresolved → plain text + reported with reason; existing `@[…]`
  passthrough; ambiguity (build wins); mixed document with several markers; empty
  notes.
- **`notes_set` tool test** (fake axiforge client: `getBuild` returns a build with
  components + images, `catalog*` stubbed, `saveBuild` captures its arg): asserts
  `[[…]]` transpiled to `@[…]`, `notes` set, **images + other fields preserved**,
  `unresolved` surfaced, over-cap rejected, catalog-failure degrades gracefully.
- **`notes_get` tool test:** returns raw notes + char count; empty-notes case.
- `npm run typecheck` passes (CI does not type-check via vitest).

## Risks / to confirm in planning

- **Build component shape:** the exact slot paths for skills/traits/gear in the
  AxiForge build object must be confirmed against a real build (inspect a cached
  build JSON or AxiForge `buildStore.js`) so the resolver walks the right fields.
  Until confirmed, the resolver still works via the catalog; build-component
  resolution is the optimization.
- **Catalog name fields:** confirm the property names that carry display name +
  id in `catalogProfession`/`catalogUpgrades` responses.

## Out of scope

- Rendering build notes inside AxiVale (they render in AxiForge).
- Comp notes (only build notes).
- Auto-writing a guide the user didn't ask for.
- Creating images (the agent may reference an existing `~img:key`, not add one).
- A reverse `@[…]` → `[[…]]` transform on read (the raw token is human-readable;
  set passes existing tokens through unchanged).

## Files

- `src/main/buildNoteLinks.ts` — new: pure transpiler/resolver.
- `src/main/buildNoteLinks.test.ts` — new: resolver unit tests.
- `src/main/tools/axiforge.ts` — add `axiforge_build_notes_get` + `axiforge_build_notes_set`.
- `src/main/tools/axiforge.test.ts` (or the existing axiforge tool test) — tool tests.
- `src/main/skillStore.ts` — register the `build-guide` default skill.
- `src/main/agent.ts` — one system-prompt bullet on build-notes linking.
- Local-model tool allowlist (`agent.ts`) — add the two tools if local models should reach them (likely yes; they're read/edit on the local AxiForge).
