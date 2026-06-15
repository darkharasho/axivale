# WvW Comp Expertise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AxiVale an expert at WvW squad compositions by ingesting sourced comp-rule knowledge and adding a deterministic `comp_check` validator, instead of improvising squads from a generic skeleton.

**Architecture:** Phase 1 adds new WvW comp-rule + mechanics sources to the existing meta-fetch pipeline, distills the rule pages with a new comp-focused prompt into each mode's `notes`, and rewrites the system-prompt comp framing. Phase 2 adds a sourced role→boon mapping and a pure `comp_check` tool (with a WvW comp eval set) that does coverage arithmetic over a proposed roster. All in the Electron main process, layered onto `src/main/meta/*` and `src/main/tools/*`.

**Tech Stack:** TypeScript, Electron main process, Vitest (`--maxWorkers=2`), `@anthropic-ai/claude-agent-sdk` `tool()` + `zod` for tools, existing LanceDB RAG (untouched here).

---

## Background the implementer must know

- **Meta pipeline shape.** `src/main/meta/refresh.ts` (`MetaRefresher.refreshStale`) loops over stale modes; for each mode it fetches every configured source, caches the raw text, ingests pages into the RAG index, then calls `distill(mode.mode, raws, model, specMap)` once and stores the result via `store.recordDistill(mode.id, notes)`. There is exactly **one `notes` string per mode** (`src/main/metaStore.ts`).
- **Source configs** live ONLY in `src/main/meta/sources.ts` (`SOURCE_CONFIGS`). A URL with no matching config is silently skipped. `kind` is `'browser' | 'wiki' | 'static'`. Browser sources use `selector` (content node) and optional `linkSelector` + `crawlDepth` to crawl into linked pages.
- **Mode seeds** live in `src/main/metaStore.ts` `DEFAULT_SEED`. This is **authoritative** — on startup `reconcile()` syncs each mode's sources to the seed (adds new, drops removed). The WvW mode's `mode` string is exactly `'WvW'` (note the casing — `meta_search`'s zod enum is `'PvE' | 'WvW' | 'WvW Roaming'`).
- **distill is pure + model-injected.** `distill(modeName, rawTexts, model, specMap)` returns `string | null`; a falsy model output or empty input yields `null`, and the caller leaves prior notes intact (knowledge never regresses). The new comp distill MUST follow the same contract.
- **Tools** are built in `src/main/tools/index.ts` `buildOfficerTools(deps)`, each module exporting a `buildXxxTools(...)` that returns `Array<SdkMcpToolDefinition<any>>` via the SDK `tool(name, description, zodShape, safe(handler))` pattern. See `src/main/tools/metaSearch.ts` for the minimal example. `safe` is from `src/main/tools/shared.ts`. Tools are unit-tested by calling `t.handler(args, extra)` directly.
- **Test runner:** `npx vitest run <path> --maxWorkers=2` (global CLAUDE.md cap).
- **Commits:** repo convention is to branch off `main` first; commit messages end with the Co-Authored-By trailer. Create branch `wvw-comp-expertise` before Task 1 if not already on it.

---

# PHASE 1 — Knowledge

## Task 1: Add a `content` discriminator to SourceConfig

**Files:**
- Modify: `src/main/meta/sources.ts`
- Test: `src/main/meta/sources.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/meta/sources.test.ts`:

```ts
import { configForUrl } from './sources'

it('tags WvW guide/wiki pages as rules and build pages as builds', () => {
  expect(configForUrl('https://wiki.guildwars2.com/wiki/Boon')?.content).toBe('rules')
  expect(configForUrl('https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles')?.content).toBe('rules')
  expect(configForUrl('https://guildorder.com/games/gw2/guides/wvw-squad-leadership')?.content).toBe('rules')
  // existing build sources default to 'builds'
  expect(configForUrl('https://metabattle.com/wiki/WvW')?.content ?? 'builds').toBe('builds')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
Expected: FAIL — `content` is undefined / `guildorder.com` returns null.

- [ ] **Step 3: Implement**

In `src/main/meta/sources.ts`, extend the interface and add configs:

```ts
export interface SourceConfig {
  host: string
  kind: 'browser' | 'wiki' | 'static'
  selector?: string
  wikiApi?: string
  linkSelector?: string
  crawlDepth?: number
  /** What this source contributes to distillation. Default 'builds'. */
  content?: 'builds' | 'rules'
}
```

Add to `SOURCE_CONFIGS` (append; do not remove existing entries):

```ts
  // --- WvW comp knowledge (Layer 3 mechanics + Layer 1 rules) ---
  { host: 'wiki.guildwars2.com', kind: 'wiki', wikiApi: 'https://wiki.guildwars2.com/api.php', content: 'rules' },
  { host: 'guildorder.com', kind: 'browser', selector: 'article, main', content: 'rules' },
  // Snowcrows guide pages are rules; the existing snowcrows.com static config below
  // handles build pages. configForUrl matches host only, so split by a guides check
  // is done in resolveContent (Step 4 below), not here.
```

Because `configForUrl` matches by host and `snowcrows.com` already has a `static` build config, add a helper that overrides `content` to `'rules'` for snowcrows **guide** URLs:

```ts
export function resolveContent(url: string): 'builds' | 'rules' {
  const cfg = configForUrl(url)
  if (!cfg) return 'builds'
  if (cfg.content) return cfg.content
  // snowcrows.com has one host config (builds) but its /guides/ pages are rules
  if (/snowcrows\.com\/guides\//.test(url)) return 'rules'
  return 'builds'
}
```

Update the test's snowcrows assertions to use `resolveContent`:

```ts
import { configForUrl, resolveContent } from './sources'
// ...
expect(resolveContent('https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles')).toBe('rules')
expect(resolveContent('https://snowcrows.com/builds/wvw')).toBe('builds')
expect(resolveContent('https://wiki.guildwars2.com/wiki/Boon')).toBe('rules')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "feat(meta): tag WvW comp sources as rules vs builds"
```

---

## Task 2: Seed the new WvW comp sources

**Files:**
- Modify: `src/main/metaStore.ts:48-55` (the WvW seed entry)
- Test: `src/main/metaStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/metaStore.test.ts` (uses a temp file like the existing tests — copy the temp-path setup already in that file):

```ts
it('seeds WvW with comp-rule + mechanics sources', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  const urls = wvw.sources.map((s) => s.url)
  expect(urls).toContain('https://wiki.guildwars2.com/wiki/Squad')
  expect(urls).toContain('https://wiki.guildwars2.com/wiki/Boon')
  expect(urls).toContain('https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles')
  expect(urls).toContain('https://guildorder.com/games/gw2/guides/wvw-squad-leadership')
  expect(urls).toContain('https://snowcrows.com/news/wvw')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: FAIL — new URLs absent.

- [ ] **Step 3: Implement**

Replace the WvW entry in `DEFAULT_SEED` (`src/main/metaStore.ts`) with:

```ts
  {
    mode: 'WvW',
    sources: [
      // Layer 3 — mechanics truth (wiki)
      { label: 'GW2 Wiki (Squad)', url: 'https://wiki.guildwars2.com/wiki/Squad' },
      { label: 'GW2 Wiki (Boon)', url: 'https://wiki.guildwars2.com/wiki/Boon' },
      // Layer 1 — composition rules (WvW guides)
      { label: 'Snowcrows (WvW Roles)', url: 'https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles' },
      { label: 'Guild Order (WvW Squad Leadership)', url: 'https://guildorder.com/games/gw2/guides/wvw-squad-leadership' },
      // Layer 2 — role-tagged builds
      { label: 'MetaBattle (WvW)', url: 'https://metabattle.com/wiki/WvW' },
      { label: 'Snowcrows (WvW)', url: 'https://snowcrows.com/builds/wvw' },
      { label: 'Snowcrows (WvW DPS tier list)', url: 'https://snowcrows.com/news/wvw' },
      { label: 'gw2mists (Zerg)', url: 'https://gw2mists.com/en/builds?mode=zerg' }
    ]
  },
```

Note: `reconcile()` will add these to any existing on-disk meta.json on next launch, preserving provenance for survivors.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/metaStore.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/metaStore.ts src/main/metaStore.test.ts
git commit -m "feat(meta): seed WvW comp-rule and mechanics sources"
```

---

## Task 3: Add the snowcrows news-landing crawl config

**Files:**
- Modify: `src/main/meta/sources.ts`
- Test: `src/main/meta/sources.test.ts`

The snowcrows host currently has a single `static` config. The news landing
(`/news/wvw`) needs to crawl into the latest tier-list article. Add a URL-specific
branch so `/news/` snowcrows pages use a `browser` crawl while `/builds/` stays
static.

- [ ] **Step 1: Write the failing test**

```ts
import { configForUrl } from './sources'

it('crawls the snowcrows WvW news landing into the latest tier list', () => {
  const cfg = configForUrl('https://snowcrows.com/news/wvw')
  expect(cfg?.kind).toBe('browser')
  expect(cfg?.linkSelector).toBeTruthy()
  expect((cfg?.crawlDepth ?? 0)).toBeGreaterThanOrEqual(1)
})

it('keeps snowcrows build pages static', () => {
  expect(configForUrl('https://snowcrows.com/builds/wvw')?.kind).toBe('static')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
Expected: FAIL — both snowcrows URLs currently resolve to the single `static` config.

- [ ] **Step 3: Implement**

Change `configForUrl` in `src/main/meta/sources.ts` to special-case snowcrows news. Keep the existing host lookup, but branch before returning:

```ts
export function configForUrl(url: string): SourceConfig | null {
  let host: string
  let path: string
  try {
    const u = new URL(url)
    host = u.host.replace(/^www\./, '')
    path = u.pathname
  } catch {
    return null
  }
  // snowcrows news landings crawl into the newest article (tier lists rotate dates)
  if (host === 'snowcrows.com' && path.startsWith('/news/')) {
    return {
      host: 'snowcrows.com',
      kind: 'browser',
      selector: 'main',
      linkSelector: 'a[href*="/news/wvw/"]',
      crawlDepth: 1,
      content: 'builds'
    }
  }
  return SOURCE_CONFIGS.find((c) => host === c.host || host.endsWith(`.${c.host}`)) ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/sources.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "feat(meta): crawl snowcrows WvW news for the latest tier list"
```

---

## Task 4: Add `distillComp` — the comp-rule distiller

**Files:**
- Create: `src/main/meta/distillComp.ts`
- Test: `src/main/meta/distillComp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/distillComp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { distillComp } from './distillComp'

describe('distillComp', () => {
  it('returns null for empty input without calling the model', async () => {
    let called = false
    const model = async (): Promise<string> => {
      called = true
      return 'x'
    }
    expect(await distillComp('WvW', [], model)).toBeNull()
    expect(called).toBe(false)
  })

  it('returns null when the model yields empty', async () => {
    const out = await distillComp('WvW', ['some rule text'], async () => '   ')
    expect(out).toBeNull()
  })

  it('sends a comp-rules prompt and returns the model output trimmed', async () => {
    let seen = ''
    const model = async (p: string): Promise<string> => {
      seen = p
      return '## Squad Composition\n- one Primary Support per subgroup\n'
    }
    const out = await distillComp('WvW', ['Primary Support provides Stability...'], model)
    expect(out).toContain('Squad Composition')
    // prompt is rules-focused, not a build table
    expect(seen.toLowerCase()).toContain('subgroup')
    expect(seen.toLowerCase()).toContain('boon')
    expect(seen).toContain('Primary Support provides Stability')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/distillComp.test.ts --maxWorkers=2`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/main/meta/distillComp.ts`:

```ts
// src/main/meta/distillComp.ts
//
// Compresses WvW comp-RULE pages (guides + wiki mechanics) into a tight
// "Squad Composition" section appended to a mode's meta notes. Sibling of
// distill.ts (which handles build tables); same pure, model-injected contract:
// empty input or empty model output → null, so the caller keeps prior notes.

import type { MetaModel } from './distill'

export async function distillComp(
  modeName: string,
  ruleTexts: string[],
  model: MetaModel
): Promise<string | null> {
  const joined = ruleTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
  if (!joined) return null

  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} squad-composition RULES ` +
    `from community guides and the official wiki. The excerpts are raw page text with ` +
    `navigation, ads, and headings — IGNORE that boilerplate. Extract COMPOSITION rules, ` +
    `not a list of individual builds.\n\n` +
    `FORMAT your answer as a section that begins with the exact heading ` +
    `"## Squad Composition" followed by:\n` +
    `1. The ROLE TAXONOMY — each squad role and the boons/duties it covers (e.g. ` +
    `Primary Support → Stability, Resistance, Protection; Boon Strip DPS → enemy boon ` +
    `removal + CC).\n` +
    `2. PER-SUBGROUP requirements — what every 5-player subgroup must cover, and which ` +
    `roles pair together.\n` +
    `3. SQUAD-WIDE notes — scale (havoc vs zerg), boon-target caps, and any ratios the ` +
    `sources state. If a source gives a hard number (e.g. boons affect 5 targets, max 15 ` +
    `subgroups), include it and attribute it to the wiki.\n\n` +
    `Be concise; state only what the excerpts support. Do NOT invent ratios the sources ` +
    `do not give — say "sources give no fixed ratio" instead.\n\n` +
    `CRITICAL — faithfulness over prior knowledge: GW2 has expansions and elite specs ` +
    `released after your training. Copy every profession, elite-spec, and role name ` +
    `VERBATIM from the excerpts (e.g. Evoker, Untamed, Amalgam, Luminary, Spectre, ` +
    `Paragon, Troubadour); never rename, "correct", or reassign one from your own ` +
    `knowledge.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/distillComp.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/distillComp.ts src/main/meta/distillComp.test.ts
git commit -m "feat(meta): add distillComp for WvW squad-composition rules"
```

---

## Task 5: Wire refresh to partition sources and run both distills

**Files:**
- Modify: `src/main/meta/refresh.ts:61-85`
- Test: `src/main/meta/refresh.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/meta/refresh.test.ts` (reuse the existing fakes/builders in that file — fake fetcher, in-memory store, and a model spy). The new test asserts that when a mode has both build and rule sources, the stored notes contain both the build table and the `## Squad Composition` section:

```ts
it('combines build distill and comp-rule distill into one notes blob', async () => {
  // Arrange: a WvW mode whose sources include a rule URL and a build URL.
  // Fake fetcher returns distinct text per URL; fake model echoes a marker so we
  // can tell which prompt produced which output.
  const model = async (prompt: string): Promise<string> => {
    if (prompt.includes('Squad Composition')) return '## Squad Composition\n- rule line'
    return '| Build | Role |\n|---|---|\n| Firebrand | Primary Support |'
  }
  // ...build refresher with store containing a WvW mode that has one rules source
  //    (e.g. wiki Boon) and one build source (e.g. metabattle WvW), fetcher ok for both...
  await refresher.refreshStale()
  const notes = store.get(wvwId)!.notes
  expect(notes).toContain('Squad Composition')
  expect(notes).toContain('| Build | Role |')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`
Expected: FAIL — notes contain only the build table; no comp section.

- [ ] **Step 3: Implement**

In `src/main/meta/refresh.ts`:

Add import at top:

```ts
import { distillComp } from './distillComp'
import { configForUrl, resolveContent } from './sources'
```

(`configForUrl` is already imported — extend the import to include `resolveContent`.)

Replace the per-mode loop body (the `for (const src of mode.sources)` block and the
distill call after it) so it partitions raws by content kind:

```ts
      for (const mode of stale) {
        emit({ type: 'mode-start', modeId: mode.id })
        const buildRaws: string[] = []
        const ruleRaws: string[] = []
        for (const src of mode.sources) {
          if (!configForUrl(src.url)) continue
          emit({ type: 'source-start', modeId: mode.id, url: src.url })
          console.log(`[meta] fetch start (${mode.id}):`, src.url)
          const r = await fetcher.fetch(src.url)
          store.recordFetch(mode.id, src.url, r.ok ? { ok: true } : { ok: false, error: r.error })
          if (r.ok) {
            cache.put(src.url, r.text)
            if (resolveContent(src.url) === 'rules') ruleRaws.push(r.text)
            else buildRaws.push(r.text)
            console.log(`[meta] fetch ok (${mode.id}): ${src.url} — ${r.pages.length} page(s)`)
            await this.ingest(mode.mode, src.url, r.pages)
          } else {
            console.warn(`[meta] fetch FAILED (${mode.id}): ${src.url} — ${r.error}`)
          }
          emit({ type: 'source-done', modeId: mode.id, url: src.url })
        }
        const buildNotes = buildRaws.length ? await distill(mode.mode, buildRaws, model, specMap) : null
        const compNotes = ruleRaws.length ? await distillComp(mode.mode, ruleRaws, model) : null
        const combined = [buildNotes, compNotes].filter(Boolean).join('\n\n')
        if (combined) store.recordDistill(mode.id, combined)
        emit({ type: 'mode-done', modeId: mode.id })
      }
```

Note the behavior preserved: if neither distill produces output, `recordDistill` is
not called and prior notes survive (knowledge never regresses).

- [ ] **Step 4: Run the full meta test suite**

Run: `npx vitest run src/main/meta/refresh.test.ts --maxWorkers=2`
Expected: PASS (new test + all existing refresh tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/refresh.ts src/main/meta/refresh.test.ts
git commit -m "feat(meta): distill comp rules and builds into combined notes"
```

---

## Task 6: Rewrite the WvW comp framing in the system prompt

**Files:**
- Modify: `src/main/agent.ts:28-32` (the 5-role skeleton bullet)
- Test: `src/main/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/systemPrompt.test.ts` (it imports `AXIVALE_SYSTEM_PROMPT` from `./agent`):

```ts
import { AXIVALE_SYSTEM_PROMPT } from './agent'

it('frames WvW comps around subgroup boon coverage, not a fixed 5-slot list', () => {
  const p = AXIVALE_SYSTEM_PROMPT
  expect(p).toMatch(/subgroup/i)
  expect(p).toMatch(/boon strip|boon corrupt/i)
  expect(p).toMatch(/meta_search/) // points at retrieved comp rules
  // no longer claims the generic five-role party skeleton as the WvW frame
  expect(p).not.toContain('a standard party covers five roles')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2`
Expected: FAIL — current prompt still contains "a standard party covers five roles".

- [ ] **Step 3: Implement**

In `src/main/agent.ts`, replace the bullet currently at lines 28-32 (the
"Squad comps are built in subgroups of 5..." paragraph) with:

```ts
- Squad comps are built in subgroups of up to 5, because most boons only reach 5
  targets (cite the GW2 Wiki for that cap). Do NOT use a fixed five-role party
  template — comp shape depends on mode and squad size (roaming 1-5, havoc 5-10,
  zerg 15-50). For WvW specifically, think in squad roles, not a fixed slot list:
  per-subgroup boon support (stability + the subgroup's core boons), squad-wide
  boon strip/corrupt and hard CC to break enemy stability, and condition cleanse
  and barrier/heal sustain — then enough pure DPS to convert that into downs.
  Before proposing or critiquing a WvW comp, call meta_search(mode='WvW') for the
  current role taxonomy and per-subgroup rules and cite them; name which role each
  build fills and call out any missing or doubled-up role rather than silently
  listing builds. WvW does NOT run quickness/alacrity-per-subgroup like PvE — never
  import the PvE 10-man frame into a WvW comp.
```

(Phase 2 adds a sentence here pointing at `comp_check`; see Task 9.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent.ts src/main/systemPrompt.test.ts
git commit -m "feat(agent): WvW-accurate comp framing in the system prompt"
```

---

# PHASE 2 — Validator

## Task 7: Sourced role→boon mapping

**Files:**
- Create: `src/main/meta/compRoles.ts`
- Test: `src/main/meta/compRoles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/compRoles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { WVW_ROLES, boonsForRole, type WvwRole } from './compRoles'

describe('WvW role→boon mapping', () => {
  it('lists the WvW role taxonomy from the Snowcrows roles guide', () => {
    const names = WVW_ROLES.map((r) => r.role)
    expect(names).toEqual(
      expect.arrayContaining([
        'Primary Support',
        'Secondary Support',
        'Tertiary Support',
        'Boon Strip DPS',
        'Pure DPS'
      ])
    )
  })

  it('maps Primary Support to stability', () => {
    expect(boonsForRole('Primary Support')).toContain('Stability')
  })

  it('marks Boon Strip DPS as a stripper, not a boon provider', () => {
    const r = WVW_ROLES.find((x) => x.role === 'Boon Strip DPS')!
    expect(r.strips).toBe(true)
    expect(boonsForRole('Boon Strip DPS')).not.toContain('Stability')
  })

  it('every role carries a source URL', () => {
    for (const r of WVW_ROLES) expect(r.source).toMatch(/^https?:\/\//)
  })

  it('boonsForRole returns [] for an unknown role', () => {
    expect(boonsForRole('Nonsense' as WvwRole)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/compRoles.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/main/meta/compRoles.ts`:

```ts
// src/main/meta/compRoles.ts
//
// Sourced WvW role → boon/duty mapping used by comp_check to translate a build's
// squad role into the coverage it provides. Derived from the Snowcrows "WvW
// Basics: Understanding Roles" guide; every entry traces to a source URL. This is
// a small curated lookup, NOT model output — update it when the guide changes.

const SC_ROLES = 'https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles'

export type WvwRole =
  | 'Primary Support'
  | 'Secondary Support'
  | 'Tertiary Support'
  | 'Boon Strip DPS'
  | 'Pure DPS'

export interface RoleDef {
  role: WvwRole
  /** Boons/effects this role provides to allies. */
  boons: string[]
  /** Non-boon duties (heal, cleanse, barrier, CC). */
  duties: string[]
  /** True if the role's job is removing ENEMY boons (provides little to allies). */
  strips: boolean
  source: string
}

export const WVW_ROLES: RoleDef[] = [
  {
    role: 'Primary Support',
    boons: ['Stability', 'Resistance', 'Protection', 'Might'],
    duties: ['Maintain subgroup stability', 'Monitor boon bar'],
    strips: false,
    source: SC_ROLES
  },
  {
    role: 'Secondary Support',
    boons: [],
    duties: ['Healing', 'Condition Removal', 'Barrier'],
    strips: false,
    source: SC_ROLES
  },
  {
    role: 'Tertiary Support',
    boons: ['Quickness', 'Might', 'Resistance'],
    duties: ['Flex utility', 'Down resurrection'],
    strips: false,
    source: SC_ROLES
  },
  {
    role: 'Boon Strip DPS',
    boons: [],
    duties: ['Enemy boon removal', 'Crowd control'],
    strips: true,
    source: SC_ROLES
  },
  {
    role: 'Pure DPS',
    boons: [],
    duties: ['Burst damage', 'Cleave downs'],
    strips: false,
    source: SC_ROLES
  }
]

export function boonsForRole(role: WvwRole): string[] {
  return WVW_ROLES.find((r) => r.role === role)?.boons ?? []
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/compRoles.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/compRoles.ts src/main/meta/compRoles.test.ts
git commit -m "feat(meta): sourced WvW role-to-boon mapping"
```

---

## Task 8: `checkComp` — the pure coverage validator

**Files:**
- Create: `src/main/meta/compCheck.ts`
- Test: `src/main/meta/compCheck.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/compCheck.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkComp, type Roster } from './compCheck'

const subgroup = (roles: string[]) => roles.map((role, i) => ({ build: `${role} ${i}`, role }))

describe('checkComp', () => {
  it('passes a covered subgroup', () => {
    const roster: Roster = {
      subgroups: [
        subgroup(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Boon Strip DPS'])
      ]
    }
    const r = checkComp(roster)
    expect(r.findings.filter((f) => f.severity === 'error')).toHaveLength(0)
  })

  it('flags a subgroup with pure DPS but no stability source', () => {
    const roster: Roster = { subgroups: [subgroup(['Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])] }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /stability/i.test(f.message) && f.severity === 'error')).toBe(true)
  })

  it('warns when the squad has no boon strip at all', () => {
    const roster: Roster = {
      subgroups: [subgroup(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /boon strip/i.test(f.message))).toBe(true)
  })

  it('flags doubled Primary Support in one subgroup as a warning', () => {
    const roster: Roster = {
      subgroups: [subgroup(['Primary Support', 'Primary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /doubl/i.test(f.message) && f.severity === 'warning')).toBe(true)
  })

  it('reports an unknown role instead of silently passing', () => {
    const roster: Roster = { subgroups: [subgroup(['Healer', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])] }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /unknown role/i.test(f.message))).toBe(true)
  })

  it('flags an oversized subgroup (>5)', () => {
    const roster: Roster = {
      subgroups: [subgroup(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /5 players/i.test(f.message) && f.severity === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/compCheck.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/main/meta/compCheck.ts`:

```ts
// src/main/meta/compCheck.ts
//
// Deterministic WvW comp coverage validator. Given a roster (builds grouped into
// subgroups, each build tagged with a WvW role), it checks per-subgroup boon
// coverage and squad-wide role presence against the sourced role mapping, and
// returns structured findings. Pure — no I/O. The model proposes a roster, calls
// this, and fixes the findings.

import { WVW_ROLES, type WvwRole } from './compRoles'

export interface RosterEntry {
  build: string
  role: string
}
export interface Roster {
  subgroups: RosterEntry[][]
}

export type Severity = 'error' | 'warning'
export interface Finding {
  severity: Severity
  message: string
  /** 0-based subgroup index, or null for squad-wide findings. */
  subgroup: number | null
}
export interface CompReport {
  findings: Finding[]
  /** GW2 Wiki: boons affect at most 5 targets — the reason subgroups cap at 5. */
  boonCap: number
}

const KNOWN_ROLES = new Set<string>(WVW_ROLES.map((r) => r.role))
const isRole = (s: string): s is WvwRole => KNOWN_ROLES.has(s)

export function checkComp(roster: Roster): CompReport {
  const findings: Finding[] = []
  const squadRoleCounts: Record<string, number> = {}

  roster.subgroups.forEach((sg, i) => {
    if (sg.length > 5) {
      findings.push({
        severity: 'error',
        subgroup: i,
        message: `Subgroup ${i + 1} has ${sg.length} players — subgroups hold at most 5 players (GW2 Wiki).`
      })
    }
    const counts: Record<string, number> = {}
    for (const e of sg) {
      if (!isRole(e.role)) {
        findings.push({
          severity: 'warning',
          subgroup: i,
          message: `Unknown role "${e.role}" for ${e.build} — cannot verify its coverage.`
        })
        continue
      }
      counts[e.role] = (counts[e.role] ?? 0) + 1
      squadRoleCounts[e.role] = (squadRoleCounts[e.role] ?? 0) + 1
    }

    const hasPureDps = (counts['Pure DPS'] ?? 0) > 0
    const hasStability = (counts['Primary Support'] ?? 0) > 0
    if (hasPureDps && !hasStability) {
      findings.push({
        severity: 'error',
        subgroup: i,
        message: `Subgroup ${i + 1} has Pure DPS but no Primary Support — no stability source for the subgroup.`
      })
    }
    if ((counts['Primary Support'] ?? 0) >= 2) {
      findings.push({
        severity: 'warning',
        subgroup: i,
        message: `Subgroup ${i + 1} doubles Primary Support — stability/boons cap at 5 targets, so the second is largely wasted here.`
      })
    }
  })

  // Squad-wide: strip and cleanse must exist somewhere. Sources give no fixed
  // ratio, so these are warnings (presence checks), not hard counts.
  if ((squadRoleCounts['Boon Strip DPS'] ?? 0) === 0) {
    findings.push({
      severity: 'warning',
      subgroup: null,
      message: 'No Boon Strip DPS anywhere — the squad cannot clear enemy stability to land CC and spikes.'
    })
  }
  if ((squadRoleCounts['Secondary Support'] ?? 0) === 0) {
    findings.push({
      severity: 'warning',
      subgroup: null,
      message: 'No Secondary Support anywhere — no dedicated healing/condition cleanse/barrier sustain.'
    })
  }

  return { findings, boonCap: 5 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/compCheck.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/compCheck.ts src/main/meta/compCheck.test.ts
git commit -m "feat(meta): deterministic WvW comp coverage validator"
```

---

## Task 9: Expose `comp_check` as an officer tool

**Files:**
- Create: `src/main/tools/compCheck.ts`
- Modify: `src/main/tools/index.ts`
- Modify: `src/main/agent.ts` (add the comp_check pointer sentence from Task 6)
- Test: `src/main/tools/compCheck.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/tools/compCheck.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCompCheckTools } from './compCheck'

const tool = buildCompCheckTools()[0]

describe('comp_check tool', () => {
  it('is named comp_check', () => {
    expect(tool.name).toBe('comp_check')
  })

  it('returns findings for a roster with a coverage gap', async () => {
    const res = await tool.handler(
      { subgroups: [[{ build: 'Zerk', role: 'Pure DPS' }, { build: 'Zerk2', role: 'Pure DPS' }]] },
      {} as never
    )
    const text = JSON.stringify(res)
    expect(text).toMatch(/stability|Primary Support/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/tools/compCheck.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the tool**

Create `src/main/tools/compCheck.ts` (mirrors `metaSearch.ts`):

```ts
// src/main/tools/compCheck.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import { checkComp, type Roster } from '../meta/compCheck'

const entry = z.object({
  build: z.string().describe('Build name, e.g. "Support Firebrand"'),
  role: z
    .string()
    .describe('WvW squad role: Primary Support | Secondary Support | Tertiary Support | Boon Strip DPS | Pure DPS')
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCompCheckTools(): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'comp_check',
      'Validate a proposed WvW squad composition for boon coverage and role gaps. ' +
        'Pass the roster as subgroups (each up to 5 builds, each tagged with its WvW role from meta_search). ' +
        'Returns structured findings: per-subgroup coverage errors (e.g. Pure DPS with no stability source), ' +
        'doubled roles, oversized subgroups, and squad-wide gaps (no boon strip, no cleanse). ' +
        'Errors are hard problems; warnings are advisories. Sources give no fixed squad-wide ratios, so ' +
        'squad-wide checks are presence-based. Fix the errors, then re-check.',
      {
        subgroups: z
          .array(z.array(entry))
          .describe('Subgroups of up to 5 builds each; the order is the subgroup number')
      },
      safe(async ({ subgroups }: { subgroups: Array<Array<{ build: string; role: string }>> }) => {
        const report = checkComp({ subgroups } as Roster)
        return {
          boonCap: report.boonCap,
          errors: report.findings.filter((f) => f.severity === 'error'),
          warnings: report.findings.filter((f) => f.severity === 'warning'),
          ok: report.findings.every((f) => f.severity !== 'error')
        }
      })
    )
  ]
}
```

- [ ] **Step 4: Register the tool**

In `src/main/tools/index.ts`, add the import and include it in `buildOfficerTools`:

```ts
import { buildCompCheckTools } from './compCheck'
```

```ts
    ...buildMetaSearchTools(deps.metaIndex),
    ...buildCompCheckTools(),
    ...buildGw2WikiTools(deps.wikiFacts),
```

- [ ] **Step 5: Point the system prompt at comp_check**

In `src/main/agent.ts`, append to the WvW comp bullet edited in Task 6:

```ts
  After drafting a WvW roster, call comp_check with the builds grouped into
  subgroups (each tagged with its role) and fix any errors it reports before
  presenting the comp.
```

Add to `src/main/systemPrompt.test.ts`:

```ts
it('tells the model to validate WvW rosters with comp_check', () => {
  expect(AXIVALE_SYSTEM_PROMPT).toMatch(/comp_check/)
})
```

- [ ] **Step 6: Run tool + prompt tests**

Run: `npx vitest run src/main/tools/compCheck.test.ts src/main/systemPrompt.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/tools/compCheck.ts src/main/tools/index.ts src/main/agent.ts src/main/systemPrompt.test.ts
git commit -m "feat(tools): expose comp_check WvW composition validator"
```

---

## Task 10: WvW comp eval set

**Files:**
- Create: `src/main/meta/compCheck.eval.test.ts`

This is the "is it expert?" measurement: known-good and known-bad WvW rosters with
expected verdicts. Extend it as new failure modes surface in real use.

- [ ] **Step 1: Write the eval test**

Create `src/main/meta/compCheck.eval.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkComp, type Roster } from './compCheck'

const sg = (roles: string[]): Roster['subgroups'][number] =>
  roles.map((role, i) => ({ build: `${role}-${i}`, role }))

const hasError = (r: Roster): boolean =>
  checkComp(r).findings.some((f) => f.severity === 'error')

describe('WvW comp eval set', () => {
  // GOOD: two well-covered subgroups, strip + cleanse present squad-wide.
  it('accepts a clean two-subgroup zerg core', () => {
    const good: Roster = {
      subgroups: [
        sg(['Primary Support', 'Secondary Support', 'Boon Strip DPS', 'Pure DPS', 'Pure DPS']),
        sg(['Primary Support', 'Secondary Support', 'Tertiary Support', 'Pure DPS', 'Pure DPS'])
      ]
    }
    expect(hasError(good)).toBe(false)
  })

  // BAD: all-DPS subgroup, no support, no strip, no cleanse.
  it('rejects an all-DPS subgroup', () => {
    const bad: Roster = { subgroups: [sg(['Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])] }
    expect(hasError(bad)).toBe(true)
  })

  // BAD: stacked supports, no damage path still flags wasted doubling (warning) but
  // the oversized/structure errors must surface for a 6-stack.
  it('rejects an oversized subgroup', () => {
    const bad: Roster = {
      subgroups: [sg(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    expect(hasError(bad)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the eval**

Run: `npx vitest run src/main/meta/compCheck.eval.test.ts --maxWorkers=2`
Expected: PASS

- [ ] **Step 3: Full suite + typecheck**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/meta/compCheck.eval.test.ts
git commit -m "test(meta): WvW comp eval set for comp_check"
```

---

## Final verification

- [ ] Run the whole suite: `npx vitest run --maxWorkers=2`
- [ ] Typecheck: `npm run typecheck`
- [ ] Manual smoke (optional, needs `npm run dev`): ask AxiVale for a WvW zerg comp; confirm it calls `meta_search(mode='WvW')`, cites the WvW roles guide + wiki, drafts subgroups, calls `comp_check`, and fixes any reported gaps before presenting.

---

## Self-review notes (author)

- **Spec coverage:** Layer 1/2/3 sources → Tasks 1-3; comp-rule distill → Tasks 4-5; system-prompt rewrite → Task 6; role→boon mapping → Task 7; `comp_check` validator → Tasks 8-9; eval set → Task 10. All spec sections mapped.
- **Naming consistency:** pure validator is `checkComp` (`compCheck.ts`); the tool is `comp_check` exposed via `buildCompCheckTools` (`tools/compCheck.ts`); distiller is `distillComp` (`distillComp.ts`); source helper is `resolveContent`. Used consistently across tasks.
- **Mode string** is `'WvW'` everywhere (matches the `meta_search` enum and seed).
- **No new LanceDB schema** — comp rule pages index as ordinary WvW-mode chunks; no `comp` tag (deferred, not needed for Phase 1 retrieval).
