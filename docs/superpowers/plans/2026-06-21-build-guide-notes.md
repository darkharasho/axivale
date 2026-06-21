# Build-guide notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent save a finalized build guide onto a build's AxiForge `notes` field — written in the readable `[[skill:Name]]` syntax it already knows, auto-transpiled to AxiForge's `@[category:id:Name]` link tokens — and read it back to edit instead of regenerating.

**Architecture:** A pure resolver (`buildNoteLinks.ts`) transpiles `[[skill|trait|item:Name]]` markers into AxiForge `@[category:id:Name]` tokens by resolving names → numeric GW2 ids from a generic walk of the build object (skills/traits carry ids) and the AxiForge catalog (gear ids). Two thin tools (`axiforge_build_notes_get`/`_set`) read and write `build.notes`, preserving all other fields/images. A `build-guide` default skill drives read→edit→save.

**Tech Stack:** TypeScript (Node ESM), `@anthropic-ai/claude-agent-sdk` `tool()`, `zod`, vitest. Existing modules: `src/main/tools/axiforge.ts` (`safe`/`safeRich`/`write`, `deps.axiforge` = `AxiforgeClient`), `src/main/skillStore.ts`, `src/main/agent.ts`.

## Global Constraints

- Run vitest with `--maxWorkers=2`. Single file: `npx vitest run <file> --maxWorkers=2`.
- Do NOT run `npm install` (dev-linked `@axiapps/bridge-metrics`); no deps are added.
- Verification must include `npm run typecheck` (vitest/esbuild does not type-check).
- AxiForge skill-link token syntax (verified at `axiforge/src/site/render-notes.js:55`): `@[category:id:name]`, regex `/@\[(\w+):([\w]+):([^\]]+)\]/`. Categories used here: `skill`, `trait`, `item` (`item` auto-resolves in AxiForge). The **id must be the real numeric GW2 id**; name is display-only.
- AxiVale marker syntax (input the agent writes): `[[skill:Name]]`, `[[trait:Name]]`, `[[item:Name]]`.
- AxiForge build `notes` cap is **100000 chars** (`axiforge/src/main/buildStore.js:215`) — `notes_set` rejects longer input rather than letting AxiForge silently truncate.
- Existing `@[...]` tokens already in the notes must pass through `notes_set` unchanged.
- Unresolved markers degrade to plain text (brackets stripped) — never leak raw `[[...]]` into AxiForge.
- Images and all other build fields are preserved on save (the tool fetches the full build via `getBuild`, which includes images, and saves `{...build, notes}`).

---

## File Structure

- `src/main/buildNoteLinks.ts` — **new.** Pure transpiler/resolver. One responsibility: `(notes, build, catalog) → transpiled notes + resolution report`. No I/O.
- `src/main/buildNoteLinks.test.ts` — **new.** Resolver unit tests (run in normal CI).
- `src/main/tools/axiforge.ts` — **modify.** Add `axiforge_build_notes_get` + `axiforge_build_notes_set` (+ a private `loadCatalogSafe` helper).
- `src/main/tools/axiforge.test.ts` — **new or modify.** Tool tests with a fake `deps.axiforge`.
- `src/main/tools/inventory.test.ts` — **modify.** Add the two new tool names to the sorted snapshot.
- `src/main/skillStore.ts` — **modify.** Register the `build-guide` default skill in `DEFAULT_SEED`.
- `src/main/skillStore.test.ts` — **modify (if present) or assert via existing test.** Verify the seed is present.
- `src/main/agent.ts` — **modify.** One system-prompt bullet + add the two tools to `LOCAL_TOOL_ALLOWLIST`.

---

## Task 1: `buildNoteLinks.ts` — pure transpiler/resolver

**Files:**
- Create: `src/main/buildNoteLinks.ts`
- Test: `src/main/buildNoteLinks.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface NoteLinkResolution { notes: string; resolved: number; unresolved: Array<{ name: string; type: 'skill' | 'trait' | 'item'; reason: 'not-found' | 'catalog-unavailable' }> }`
  - `interface NoteCatalog { profession?: unknown; upgrades?: unknown }`
  - `function transpileNotes(notes: string, build: unknown, catalog: NoteCatalog | null): NoteLinkResolution`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/buildNoteLinks.test.ts
import { describe, it, expect } from 'vitest'
import { transpileNotes } from './buildNoteLinks'

// Build with its own skills (heal/utility/elite) and spec traits — all id+name pairs.
const build = {
  profession: 'Guardian',
  gameMode: 'wvw',
  skills: {
    heal: { id: 9102, name: 'Shelter' },
    utility: [{ id: 9168, name: 'Stand Your Ground' }, null, null],
    elite: { id: 30273, name: 'Renewed Focus' }
  },
  specs: [
    { id: 62, name: 'Firebrand', minorTraits: [{ id: 2063, name: 'Stoic Demeanor' }], majorTraitsByTier: { 1: [{ id: 1909, name: 'Unscathed Contender' }] } }
  ],
  equipment: { runes: { helm: 'Rune of the Scholar' } } // gear is name-only, resolved via catalog
}
const catalog = {
  profession: null,
  upgrades: [{ id: 24836, name: 'Rune of the Scholar' }]
}

describe('transpileNotes', () => {
  it('resolves a build skill marker to an @[skill:id:name] token', () => {
    const r = transpileNotes('Open with [[skill:Shelter]].', build, catalog)
    expect(r.notes).toBe('Open with @[skill:9102:Shelter].')
    expect(r.resolved).toBe(1)
    expect(r.unresolved).toEqual([])
  })

  it('resolves trait and item markers (item from catalog)', () => {
    const r = transpileNotes('[[trait:Unscathed Contender]] + [[item:Rune of the Scholar]]', build, catalog)
    expect(r.notes).toBe('@[trait:1909:Unscathed Contender] + @[item:24836:Rune of the Scholar]')
    expect(r.resolved).toBe(2)
  })

  it('matches names case-insensitively and trims whitespace', () => {
    const r = transpileNotes('[[skill:  shelter  ]]', build, catalog)
    expect(r.notes).toBe('@[skill:9102:shelter]')
    expect(r.resolved).toBe(1)
  })

  it('leaves an unknown name as plain text and reports it', () => {
    const r = transpileNotes('Use [[skill:Made Up Skill]] now.', build, catalog)
    expect(r.notes).toBe('Use Made Up Skill now.')
    expect(r.unresolved).toEqual([{ name: 'Made Up Skill', type: 'skill', reason: 'not-found' }])
  })

  it('reports catalog-unavailable when catalog is null and the name is not in the build', () => {
    const r = transpileNotes('[[item:Rune of the Scholar]]', build, null)
    expect(r.notes).toBe('Rune of the Scholar')
    expect(r.unresolved[0].reason).toBe('catalog-unavailable')
  })

  it('passes existing @[...] tokens through untouched', () => {
    const r = transpileNotes('Keep @[skill:1234:Old Token] and add [[skill:Shelter]]', build, catalog)
    expect(r.notes).toBe('Keep @[skill:1234:Old Token] and add @[skill:9102:Shelter]')
  })

  it('prefers the build id over a catalog id for the same name', () => {
    const r = transpileNotes('[[skill:Shelter]]', build, { upgrades: [{ id: 999, name: 'Shelter' }] })
    expect(r.notes).toBe('@[skill:9102:Shelter]') // build (9102) wins
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/buildNoteLinks.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./buildNoteLinks`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/buildNoteLinks.ts

export interface NoteLinkResolution {
  notes: string
  resolved: number
  unresolved: Array<{ name: string; type: 'skill' | 'trait' | 'item'; reason: 'not-found' | 'catalog-unavailable' }>
}

export interface NoteCatalog {
  profession?: unknown
  upgrades?: unknown
}

// AxiVale marker the agent writes: [[skill|trait|item:Name]]
const MARKER = /\[\[(skill|trait|item):([^\]]+)\]\]/g

/**
 * Walk any value, collecting every { id: number>0, name: non-empty string } node
 * into a case-insensitive name -> id map. First-seen wins, so callers walk the
 * highest-priority source (the build) before lower-priority ones (the catalog).
 * This is shape-agnostic: it does not depend on the exact build/catalog layout,
 * only on the universal { id, name } pairing GW2 entities use.
 */
function collectIdNames(node: unknown, out: Map<string, number>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) collectIdNames(child, out)
    return
  }
  const obj = node as Record<string, unknown>
  const id = obj.id
  const name = obj.name
  if (typeof id === 'number' && id > 0 && typeof name === 'string' && name.trim()) {
    const key = name.trim().toLowerCase()
    if (!out.has(key)) out.set(key, id)
  }
  for (const value of Object.values(obj)) collectIdNames(value, out)
}

export function transpileNotes(notes: string, build: unknown, catalog: NoteCatalog | null): NoteLinkResolution {
  const index = new Map<string, number>()
  collectIdNames(build, index) // build first → its ids take precedence
  if (catalog) {
    collectIdNames(catalog.profession, index)
    collectIdNames(catalog.upgrades, index)
  }

  let resolved = 0
  const unresolved: NoteLinkResolution['unresolved'] = []

  const out = notes.replace(MARKER, (_full, type: string, rawName: string) => {
    const name = rawName.trim()
    const id = index.get(name.toLowerCase())
    if (id) {
      resolved += 1
      return `@[${type}:${id}:${name}]`
    }
    unresolved.push({
      name,
      type: type as 'skill' | 'trait' | 'item',
      reason: catalog ? 'not-found' : 'catalog-unavailable'
    })
    return name // strip brackets → plain text; never leak [[...]] into AxiForge
  })

  return { notes: out, resolved, unresolved }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/buildNoteLinks.test.ts --maxWorkers=2`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/buildNoteLinks.ts src/main/buildNoteLinks.test.ts
git commit -m "feat(builds): pure [[..]]->@[..] note-link transpiler/resolver"
```

---

## Task 2: `axiforge_build_notes_get` + `axiforge_build_notes_set` tools

**Files:**
- Modify: `src/main/tools/axiforge.ts`
- Test: `src/main/tools/axiforge.test.ts` (create if absent)
- Modify: `src/main/tools/inventory.test.ts`

**Interfaces:**
- Consumes: `transpileNotes`, `NoteCatalog` from `../buildNoteLinks`; existing `deps.axiforge.getBuild(id)`, `deps.axiforge.saveBuild(build)`, `deps.axiforge.catalogProfession(prof, mode?)`, `deps.axiforge.catalogUpgrades()`, the module's `write(...)` helper, `safe`/`safeRich`.
- Produces: two tools appended to the array returned by `buildAxiforgeTools`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/tools/axiforge.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildAxiforgeTools } from './axiforge'

function fakeDeps(buildOverride: Record<string, unknown> = {}) {
  const saveBuild = vi.fn(async (b: Record<string, unknown>) => ({ ...b, updatedAt: '2026-06-21' }))
  const build = {
    id: 'b1',
    title: 'FB WvW',
    profession: 'Guardian',
    gameMode: 'wvw',
    images: { icon: 'BIGBASE64' },
    skills: { heal: { id: 9102, name: 'Shelter' }, utility: [], elite: null },
    notes: 'old @[skill:1:Old]',
    ...buildOverride
  }
  const deps = {
    axiforge: {
      getBuild: vi.fn(async () => build),
      saveBuild,
      catalogProfession: vi.fn(async () => null),
      catalogUpgrades: vi.fn(async () => [{ id: 24836, name: 'Rune of the Scholar' }])
    },
    axiforgeLauncher: { ensureRunning: vi.fn(async () => {}) }
  }
  return { deps, saveBuild, build }
}

const tools = (deps: unknown) => buildAxiforgeTools(deps as never)
const byName = (deps: unknown, name: string) => tools(deps).find((t) => t.name === name)!
const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text)

describe('axiforge_build_notes_get', () => {
  it('returns the raw notes and a char count', async () => {
    const { deps } = fakeDeps()
    const res = await byName(deps, 'axiforge_build_notes_get').handler({ build_id: 'b1' }, {})
    const out = parse(res)
    expect(out.notes).toBe('old @[skill:1:Old]')
    expect(out.notesChars).toBe('old @[skill:1:Old]'.length)
  })
})

describe('axiforge_build_notes_set', () => {
  it('transpiles [[..]] markers, preserves images + other fields, and reports resolution', async () => {
    const { deps, saveBuild } = fakeDeps()
    const res = await byName(deps, 'axiforge_build_notes_set').handler(
      { build_id: 'b1', notes: 'Open [[skill:Shelter]] · [[item:Rune of the Scholar]] · [[skill:Nope]]' },
      {}
    )
    const saved = saveBuild.mock.calls[0][0] as Record<string, unknown>
    expect(saved.notes).toBe('Open @[skill:9102:Shelter] · @[item:24836:Rune of the Scholar] · Nope')
    expect(saved.images).toEqual({ icon: 'BIGBASE64' }) // preserved
    expect(saved.title).toBe('FB WvW')                  // other fields preserved
    const out = parse(res)
    expect(out.resolved).toBe(2)
    expect(out.unresolved).toEqual([{ name: 'Nope', type: 'skill', reason: 'not-found' }])
  })

  it('rejects notes over the 100000-char cap before saving', async () => {
    const { deps, saveBuild } = fakeDeps()
    const res = await byName(deps, 'axiforge_build_notes_set').handler(
      { build_id: 'b1', notes: 'x'.repeat(100001) },
      {}
    )
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/100000/)
    expect(saveBuild).not.toHaveBeenCalled()
  })

  it('degrades gracefully when the catalog calls fail (still resolves build skills)', async () => {
    const { deps, saveBuild } = fakeDeps()
    deps.axiforge.catalogProfession = vi.fn(async () => { throw new Error('closed') })
    deps.axiforge.catalogUpgrades = vi.fn(async () => { throw new Error('closed') })
    await byName(deps, 'axiforge_build_notes_set').handler(
      { build_id: 'b1', notes: '[[skill:Shelter]] [[item:Rune of the Scholar]]' },
      {}
    )
    const saved = saveBuild.mock.calls[0][0] as Record<string, unknown>
    // build skill resolves; the catalog-only item degrades to plain text
    expect(saved.notes).toBe('@[skill:9102:Shelter] Rune of the Scholar')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/tools/axiforge.test.ts --maxWorkers=2`
Expected: FAIL — `byName(...,'axiforge_build_notes_get')` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Add the import near the top of `src/main/tools/axiforge.ts`:

```ts
import { transpileNotes, type NoteCatalog } from '../buildNoteLinks'
```

Add this helper inside `buildAxiforgeTools` (alongside `write`/`folderNames`), so it can call `deps.axiforge`:

```ts
  // Load the build's profession catalog + upgrades for name->id resolution.
  // Offline-tolerant: any failure degrades to null, so build-component
  // resolution still works and catalog-only names are reported, not fatal.
  const loadCatalog = async (profession: string, gameMode: string): Promise<NoteCatalog | null> => {
    const mode = gameMode === 'pve' || gameMode === 'wvw' || gameMode === 'pvp' ? gameMode : undefined
    const [profCat, upgrades] = await Promise.all([
      profession ? deps.axiforge.catalogProfession(profession, mode).catch(() => null) : Promise.resolve(null),
      deps.axiforge.catalogUpgrades().catch(() => null)
    ])
    if (!profCat && !upgrades) return null
    return { profession: profCat, upgrades }
  }
```

Append the two tools to the array returned by `buildAxiforgeTools` (before the closing `]`):

```ts
    tool(
      'axiforge_build_notes_get',
      'Read the markdown notes/guide saved on an AxiForge build (returns the raw text and its length). Call this BEFORE writing a guide so you edit the existing one instead of regenerating from scratch. Works while AxiForge is closed.',
      { build_id: z.string().describe('Id of the build (from axiforge_builds_list)') },
      safe(async ({ build_id }) => {
        const build = await deps.axiforge.getBuild(build_id)
        const notes = typeof (build as Record<string, unknown>).notes === 'string'
          ? ((build as Record<string, unknown>).notes as string)
          : ''
        return { build_id, title: (build as Record<string, unknown>).title ?? null, notes, notesChars: notes.length }
      })
    ),
    tool(
      'axiforge_build_notes_set',
      [
        'Save a markdown build guide onto a build\'s notes field. Write links to skills/traits/gear by NAME as [[skill:Name]], [[trait:Name]], or [[item:Name]] (runes/sigils/relics use [[item:...]]); this tool resolves each name to the real GW2 id and converts it to the AxiForge @[...] token that renders as a skill chip. Existing @[...] tokens are kept as-is.',
        'It returns resolved (count) and unresolved (names it could not link — fix their spelling, or they may be off this build/off-meta). Overwrites the notes field, so read the current notes first with axiforge_build_notes_get and edit them. Images and all other build fields are preserved.'
      ].join(' '),
      {
        build_id: z.string().describe('Id of the build to write notes onto'),
        notes: z.string().describe('Full markdown guide; link entities as [[skill:Name]] / [[trait:Name]] / [[item:Name]]')
      },
      safeRich(async ({ build_id, notes }) => {
        if (notes.length > 100000) {
          throw new Error(`Notes are ${notes.length} chars; AxiForge caps build notes at 100000. Trim the guide.`)
        }
        const build = (await deps.axiforge.getBuild(build_id)) as Record<string, unknown>
        const profession = typeof build.profession === 'string' ? build.profession : ''
        const gameMode = typeof build.gameMode === 'string' ? build.gameMode : ''
        const catalog = await loadCatalog(profession, gameMode)
        const { notes: transpiled, resolved, unresolved } = transpileNotes(notes, build, catalog)
        // build came from getBuild (full object incl. images), so spreading it preserves everything.
        const saved = (await write(() => deps.axiforge.saveBuild({ ...build, notes: transpiled }))) as Record<string, unknown>
        return {
          value: {
            build_id: saved.id ?? build_id,
            title: saved.title ?? build.title ?? null,
            resolved,
            unresolved,
            notesChars: transpiled.length
          },
          display: { kind: 'build-card', data: { build: saved } }
        }
      })
    ),
```

Then update `src/main/tools/inventory.test.ts`: add `'axiforge_build_notes_get'` and `'axiforge_build_notes_set'` to the sorted `expect(names).toEqual([...])` array. They sort BEFORE `'axiforge_builds_get'` (the `_` in `build_notes` sorts before the `s` in `builds`), so place both immediately above the existing `'axiforge_builds_...'` entries.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/tools/axiforge.test.ts src/main/tools/inventory.test.ts --maxWorkers=2`
Expected: PASS (4 axiforge tool tests + inventory snapshot green).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/main/tools/axiforge.ts src/main/tools/axiforge.test.ts src/main/tools/inventory.test.ts
git commit -m "feat(axiforge): build_notes_get/set tools with skill-link transpile"
```

---

## Task 3: `build-guide` default skill

**Files:**
- Modify: `src/main/skillStore.ts`
- Test: `src/main/skillStore.test.ts` (modify if present; otherwise add a focused test)

**Interfaces:**
- Consumes: `DEFAULT_SEED: DefaultSkill[]` (`{ key, name, whenToUse, instructions }`), exported `SKILLS`.
- Produces: a new `DEFAULT_SEED` entry with `key: 'build-guide'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/skillStore.test.ts  (add this block; create the file with this if absent)
import { describe, it, expect } from 'vitest'
import { SKILLS } from './skillStore'

describe('build-guide default skill', () => {
  it('is seeded and steers the read->edit->save notes flow', () => {
    const s = SKILLS.find((x) => x.key === 'build-guide')
    expect(s, 'build-guide seed present').toBeTruthy()
    expect(s!.instructions).toMatch(/axiforge_build_notes_get/)
    expect(s!.instructions).toMatch(/axiforge_build_notes_set/)
    expect(s!.instructions).toMatch(/\[\[skill:/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/skillStore.test.ts --maxWorkers=2`
Expected: FAIL — `build-guide` seed not found.

- [ ] **Step 3: Write minimal implementation**

Add this entry to the `DEFAULT_SEED` array in `src/main/skillStore.ts` (after the `commander-review` entry):

```ts
  ,{
    key: 'build-guide',
    name: 'Build Guide',
    whenToUse:
      'writing or updating the notes/guide for a GW2 build — "write a guide for this build", "save these notes", "document the rotation", build how-to/playbook',
    instructions:
      'Write or refine a build guide and SAVE it onto the build, so it persists and a fresh chat can reuse it instead of starting over.\n\n1. ALWAYS read first: call axiforge_build_notes_get for the build (id from axiforge_builds_list). If notes already exist, EDIT them — keep the good parts, change what the user asked. Do NOT regenerate the whole guide from scratch.\n\n2. Ground every skill/trait/gear choice in axiforge_catalog (and gw2_api) — balance patches invalidate memory. Reference entities by NAME in the markdown as [[skill:Exact Name]], [[trait:Exact Name]], or [[item:Exact Name]] (runes/sigils/relics use [[item:...]]). Do NOT write numeric ids or chat codes — axiforge_build_notes_set resolves names to the real ids and renders them as skill chips in AxiForge.\n\n3. Keep it a GUIDE, not a transcript: tight, skimmable markdown. A good shape (adapt to the build): a one-line role/summary, key skills & traits, rotation/combo priority, gear/stat notes, and matchup or WvW/PvE tips. Short sections and lists beat walls of text. You may drop a YouTube/Twitch URL on its own line to embed a clip.\n\n4. Save with axiforge_build_notes_set(build_id, notes). Then check the returned unresolved list — those names did not link (wrong spelling, not in this build, or off-meta). Fix the names and save again, or tell the user which ones could not be linked.\n\n5. Confirm what you saved in one line; do not paste the whole guide back into chat unless asked — it now lives on the build.'
  }
```

> Note: `DEFAULT_SEED` entries are comma-separated array elements. Match the file's
> existing formatting (the leading `,` above assumes you append after the last
> element's `}`; if the array uses trailing commas, drop the leading `,` and add a
> normal element). Make the array valid — run the test to confirm.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/skillStore.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/skillStore.ts src/main/skillStore.test.ts
git commit -m "feat(skills): build-guide default skill (read->edit->save notes)"
```

---

## Task 4: System-prompt guidance + local allowlist + full verification

**Files:**
- Modify: `src/main/agent.ts`

**Interfaces:**
- Consumes: tool names `axiforge_build_notes_get` / `axiforge_build_notes_set` (Task 2).
- Produces: prompt + allowlist edits (no new exports).

- [ ] **Step 1: Add the two tools to the local allowlist**

In `src/main/agent.ts`, in the `LOCAL_TOOL_ALLOWLIST` array, add (near the other axiforge/axibridge entries):

```ts
  'axiforge_build_notes_get',
  'axiforge_build_notes_set',
```

- [ ] **Step 2: Add a system-prompt bullet on build-notes linking**

In `src/main/agent.ts`, just after the existing entity-linking guidance (the `[[skill:Name]]` paragraph around lines 217–228), add:

```ts
  '- Saving a build guide: write it onto the build with axiforge_build_notes_set (read the current notes first with axiforge_build_notes_get and edit them — do not regenerate). In build NOTES, link entities by name as [[skill:Name]] / [[trait:Name]] / [[item:Name]] and the tool converts them to AxiForge\'s @[...] tokens; check the unresolved list it returns and fix those names. (This is distinct from chat prose, where [[skill:Name]] already renders directly in AxiVale.)',
```

(Match the surrounding array/string-join style — if that section is one template string, append the line; if it is an array of bullet strings, add this element.)

- [ ] **Step 3: Full verification**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: all tests PASS (incl. the new resolver/tool/skill tests and the updated inventory snapshot); typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent.ts
git commit -m "feat(agent): guide agent to save build guides via notes tools; allowlist them"
```

---

## Task 5: In-app smoke verification

**Files:** none (manual).

- [ ] **Step 1: Launch**

Run the app (`npm run dev`) with AxiForge installed and at least one saved build.

- [ ] **Step 2: Exercise save**

Ask: "Write a short guide for my <build name> build and save it." Expect the agent to call `axiforge_build_notes_get` then `axiforge_build_notes_set`, report a `resolved` count, and the build card to update. Open the build in AxiForge → the notes render with skill chips (the `@[...]` tokens resolved).

- [ ] **Step 3: Exercise iterate-don't-restart**

In a NEW conversation: "Tweak the rotation section of my <build name> guide." Expect it to `axiforge_build_notes_get` first and edit, not regenerate.

- [ ] **Step 4: Record outcome**

Note pass/fail. If a skill name didn't link, confirm it appeared in `unresolved` (the agent should have surfaced it).

---

## Self-Review

**Spec coverage:**
- Pure transpiler/resolver (`buildNoteLinks.ts`), build-first then catalog, unresolved→plain+report, `@[...]` passthrough → Task 1. ✓
- `axiforge_build_notes_get` (raw notes + char count) → Task 2. ✓
- `axiforge_build_notes_set` (transpile, preserve images/fields, 100k reject, offline-tolerant catalog, build-card display, resolved/unresolved report) → Task 2. ✓
- `build-guide` skill (read→edit→save, `[[..]]` linking, concise) → Task 3. ✓
- System-prompt bullet + local allowlist → Task 4. ✓
- Inventory snapshot updated for the two tools → Task 2. ✓
- Error handling (offline catalog, build-not-found via getBuild throw, over-cap, image preservation) → Task 2 tests. ✓
- Testing incl. typecheck → Tasks 1–4. ✓
- Out of scope (AxiVale-side rendering, comp notes, auto-writing, image creation, reverse transform) → respected. ✓
- The spec's planning Risks (exact build slot paths / catalog name fields) are **dissolved** by the generic `{id,name}` collector in Task 1 — it depends only on the universal id+name pairing, not on layout. Noted so the omission is explicit.

**Placeholder scan:** No TBD/TODO. Every code step is complete. Task 3's array-insertion note gives the implementer the exact formatting caveat. Task 5 is genuine manual verification.

**Type consistency:** `transpileNotes(notes, build, catalog) → NoteLinkResolution` and `NoteCatalog` defined in Task 1 and consumed identically in Task 2. `unresolved` item shape `{ name, type, reason }` matches across the resolver, its tests, and the tool test. Tool names `axiforge_build_notes_get`/`axiforge_build_notes_set` are identical in Tasks 2, 3 (skill text), and 4 (prompt + allowlist) and the inventory snapshot.
