# Meta Phase 2b — `gw2_wiki_facts` Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An on-demand `gw2_wiki_facts` officer tool that returns a skill/trait's mechanical facts **with PvE/WvW/PvP balance splits** (which the GW2 API lacks), parsed from the GW2 wiki via `@axiapps/gw2-data`.

**Architecture:** A `WikiFacts` interface (injected, faked in tests) wraps `@axiapps/gw2-data`'s `WikiClient.getWikitext` + the now-exported `parseFactsByMode`. A pure mapper turns the parser output into a stable `WikiFactsResult`. The tool calls `wikiFacts.lookup(name)`; the real client (network) is smoke-tested, everything else unit-tested with fakes.

**Tech Stack:** Electron main, TypeScript, `@axiapps/gw2-data@0.1.3` (`WikiClient`, `parseFactsByMode`), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-meta-phase2b-wiki-facts-design.md`

**Prereq (DONE):** `@axiapps/gw2-data@0.1.3` published with `parseFactsByMode` exported (returns `{ pve: any[], wvw: any[], pvp: any[], hasSplit: boolean, recharge: {pve,wvw,pvp}, activation: {pve,wvw,pvp} }`) and bumped in axivale.

---

## File Structure
- Create `src/main/meta/wikiFacts.ts` — `WikiFacts` interface, `WikiFactsResult` type, pure `toWikiFactsResult`, real `WikiFactsClient`.
- Create `src/main/tools/gw2Wiki.ts` — `buildGw2WikiTools` / `gw2_wiki_facts` tool.
- Modify `src/main/tools/shared.ts` — `ToolDeps.wikiFacts`.
- Modify `src/main/tools/index.ts` — register the tool.
- Modify `src/main/index.ts` — construct `WikiFactsClient`, inject into toolDeps.
- Modify `src/main/agent.ts` — prompt bullet.
- Tests: `src/main/meta/wikiFacts.test.ts`, `src/main/tools/gw2Wiki.test.ts`; update `src/main/tools/inventory.test.ts` + full-`ToolDeps` mocks.

Run tests with `npx vitest run <path> --maxWorkers=2` (never exceed 2).

---

### Task 1: WikiFacts interface + pure mapper + real client

**Files:**
- Create: `src/main/meta/wikiFacts.ts`
- Test: `src/main/meta/wikiFacts.test.ts`

- [ ] **Step 1: Write the failing test** (the pure mapper — the real client is network, not unit-tested):
```ts
// src/main/meta/wikiFacts.test.ts
import { describe, it, expect } from 'vitest'
import { toWikiFactsResult } from './wikiFacts'

describe('toWikiFactsResult', () => {
  it('maps parsed mode-split facts, surfacing WvW values that differ from PvE', () => {
    const parsed = {
      pve: [{ type: 'Recharge', value: 20 }],
      wvw: [{ type: 'Recharge', value: 30 }],
      pvp: [{ type: 'Recharge', value: 25 }],
      hasSplit: true,
      recharge: { pve: 20, wvw: 30, pvp: 25 },
      activation: { pve: 0.5, wvw: 0.5, pvp: 0.5 }
    }
    const r = toWikiFactsResult('Winds of Disenchantment', parsed)
    expect(r.found).toBe(true)
    expect(r.hasSplit).toBe(true)
    expect(r.recharge).toEqual({ pve: 20, wvw: 30, pvp: 25 })
    expect(r.wvw).toEqual([{ type: 'Recharge', value: 30 }])
    expect(r.name).toBe('Winds of Disenchantment')
  })

  it('returns a clean not-found result for null parse', () => {
    const r = toWikiFactsResult('Nope', null)
    expect(r).toEqual({
      name: 'Nope',
      found: false,
      hasSplit: false,
      pve: [],
      wvw: [],
      pvp: [],
      recharge: { pve: null, wvw: null, pvp: null },
      activation: { pve: null, wvw: null, pvp: null }
    })
  })

  it('tolerates a parse object missing optional fields', () => {
    const r = toWikiFactsResult('X', { pve: [], wvw: [], pvp: [], hasSplit: false } as never)
    expect(r.found).toBe(true)
    expect(r.recharge).toEqual({ pve: null, wvw: null, pvp: null })
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/wikiFacts.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** `src/main/meta/wikiFacts.ts`:
```ts
// src/main/meta/wikiFacts.ts
//
// On-demand GW2 wiki mechanical facts for a skill/trait, WITH the PvE/WvW/PvP
// balance splits the official GW2 API does not expose. Wraps @axiapps/gw2-data's
// WikiClient + parseFactsByMode. Behind the WikiFacts interface so the tool is
// unit-tested with a fake; the real network client is smoke-tested.
import { WikiClient, parseFactsByMode } from '@axiapps/gw2-data'

type ModeNums = { pve: number | null; wvw: number | null; pvp: number | null }

/** Shape returned by @axiapps/gw2-data parseFactsByMode (facts are opaque to us). */
interface ParsedModeFacts {
  pve?: unknown[]
  wvw?: unknown[]
  pvp?: unknown[]
  hasSplit?: boolean
  recharge?: ModeNums
  activation?: ModeNums
}

export interface WikiFactsResult {
  name: string
  found: boolean
  hasSplit: boolean
  pve: unknown[]
  wvw: unknown[]
  pvp: unknown[]
  recharge: ModeNums
  activation: ModeNums
}

export interface WikiFacts {
  lookup(name: string): Promise<WikiFactsResult>
}

const NO_NUMS: ModeNums = { pve: null, wvw: null, pvp: null }

/** Pure: map parseFactsByMode output (or null when the page/facts are absent) to the stable result. */
export function toWikiFactsResult(name: string, parsed: ParsedModeFacts | null): WikiFactsResult {
  if (!parsed) {
    return { name, found: false, hasSplit: false, pve: [], wvw: [], pvp: [], recharge: { ...NO_NUMS }, activation: { ...NO_NUMS } }
  }
  return {
    name,
    found: true,
    hasSplit: Boolean(parsed.hasSplit),
    pve: parsed.pve ?? [],
    wvw: parsed.wvw ?? [],
    pvp: parsed.pvp ?? [],
    recharge: parsed.recharge ?? { ...NO_NUMS },
    activation: parsed.activation ?? { ...NO_NUMS }
  }
}

/** Real client: fetch the wiki page (with a prefix-search fallback) and parse mode-split facts. */
export class WikiFactsClient implements WikiFacts {
  private readonly wiki = new WikiClient()

  async lookup(name: string): Promise<WikiFactsResult> {
    let wikitext = await this.wiki.getWikitext(name)
    if (!wikitext) {
      const matches = await this.wiki.prefixSearch(name, 1)
      if (matches && matches[0]) wikitext = await this.wiki.getWikitext(matches[0])
    }
    if (!wikitext) return toWikiFactsResult(name, null)
    return toWikiFactsResult(name, parseFactsByMode(wikitext) as ParsedModeFacts)
  }
}
```
NOTE: `@axiapps/gw2-data` is CJS with no bundled types — if `import { WikiClient, parseFactsByMode } from '@axiapps/gw2-data'` trips the typechecker (no type declarations), add a minimal ambient module declaration in a new `src/main/meta/gw2-data.d.ts`:
```ts
declare module '@axiapps/gw2-data' {
  export class WikiClient {
    constructor(opts?: unknown)
    getWikitext(title: string): Promise<string | null>
    prefixSearch(prefix: string, limit?: number): Promise<string[]>
  }
  export function parseFactsByMode(wikitext: string): unknown
}
```
(If the project already resolves these types another way, skip the .d.ts. Verify with `npm run typecheck`.)

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/wikiFacts.test.ts --maxWorkers=2`; `npm run typecheck` PASS.
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/wikiFacts.ts src/main/meta/wikiFacts.test.ts src/main/meta/gw2-data.d.ts 2>/dev/null; git add -A
git commit -m "feat(meta): WikiFacts client + pure mode-split mapper"
```

---

### Task 2: `gw2_wiki_facts` tool

**Files:**
- Create: `src/main/tools/gw2Wiki.ts`
- Modify: `src/main/tools/shared.ts`, `src/main/tools/index.ts`
- Test: `src/main/tools/gw2Wiki.test.ts`

- [ ] **Step 1: add the dep field.** In `src/main/tools/shared.ts`, add `import type { WikiFacts } from '../meta/wikiFacts'` at the top, and to `ToolDeps` (after `loadSkill`):
```ts
  /** On-demand GW2 wiki skill/trait facts with PvE/WvW/PvP splits. */
  wikiFacts: WikiFacts
```

- [ ] **Step 2: Write the failing test**
```ts
// src/main/tools/gw2Wiki.test.ts
import { describe, it, expect } from 'vitest'
import { buildGw2WikiTools } from './gw2Wiki'
import type { WikiFacts, WikiFactsResult } from '../meta/wikiFacts'

function fakeWiki(over: Partial<WikiFactsResult> = {}, spy?: (n: string) => void): WikiFacts {
  return {
    lookup: async (name) => {
      spy?.(name)
      return {
        name, found: true, hasSplit: true,
        pve: [{ type: 'Recharge', value: 20 }],
        wvw: [{ type: 'Recharge', value: 30 }],
        pvp: [], recharge: { pve: 20, wvw: 30, pvp: 20 },
        activation: { pve: null, wvw: null, pvp: null }, ...over
      }
    }
  }
}

describe('gw2_wiki_facts tool', () => {
  it('returns the mode-split facts and forwards the name', async () => {
    let asked = ''
    const t = buildGw2WikiTools(fakeWiki({}, (n) => { asked = n }))[0]
    const res = await t.handler({ name: 'Winds of Disenchantment' }, {})
    expect(asked).toBe('Winds of Disenchantment')
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('"wvw"')
    expect(text).toContain('30') // WvW recharge differs from PvE
  })

  it('passes through a not-found result cleanly', async () => {
    const t = buildGw2WikiTools(fakeWiki({ found: false, hasSplit: false, pve: [], wvw: [], pvp: [] }))[0]
    const res = await t.handler({ name: 'Nope' }, {})
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('"found":false')
  })
})
```

- [ ] **Step 3: Run, expect FAIL:** `npx vitest run src/main/tools/gw2Wiki.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement** `src/main/tools/gw2Wiki.ts`:
```ts
// src/main/tools/gw2Wiki.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { WikiFacts } from '../meta/wikiFacts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2WikiTools(wikiFacts: WikiFacts): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_wiki_facts',
      'Look up official GW2 wiki mechanical facts for a SKILL or TRAIT by name — damage coefficients, recharge, boon/condition durations, combo fields — WITH the PvE/WvW/PvP balance splits the GW2 API does NOT provide. Use this to ground WvW/roaming or any mechanics/tradeoff reasoning in real numbers (e.g. WvW recharge/coefficients differ from PvE). Skill/trait names come from meta_search results or build pages.',
      { name: z.string().describe('Exact skill or trait name, e.g. "Winds of Disenchantment"') },
      safe(async ({ name }: { name: string }) => wikiFacts.lookup(name))
    )
  ]
}
```

- [ ] **Step 5: register the tool.** In `src/main/tools/index.ts`, add the import and append to `buildOfficerTools`'s return array:
```ts
import { buildGw2WikiTools } from './gw2Wiki'
```
```ts
    ...buildGw2WikiTools(deps.wikiFacts),
```

- [ ] **Step 6: keep typecheck/tests green.** The new required `ToolDeps.wikiFacts` breaks full-`ToolDeps` mocks. Add a stub to each (mirror how sibling deps like `metaIndex` are stubbed): search for `metaIndex:` across `src/main/**/*.test.ts` and add next to it
```ts
      wikiFacts: { lookup: async () => ({ name: '', found: false, hasSplit: false, pve: [], wvw: [], pvp: [], recharge: { pve: null, wvw: null, pvp: null }, activation: { pve: null, wvw: null, pvp: null } }) },
```
Also in `src/main/index.ts` the real `toolDeps` object will get `wikiFacts` in Task 3 — for now if `index.ts` is built/typechecked before Task 3 it may error; that's fine, Task 3 immediately follows. In `src/main/tools/inventory.test.ts`, add `'gw2_wiki_facts'` to the expected tool-name list/snapshot.

- [ ] **Step 7: Run, expect PASS:** `npx vitest run src/main/tools/gw2Wiki.test.ts src/main/tools/inventory.test.ts --maxWorkers=2`.
- [ ] **Step 8: Commit**
```bash
git add -A
git commit -m "feat(meta): gw2_wiki_facts tool (mode-split skill/trait facts)"
```

---

### Task 3: Wire into main + prompt

**Files:**
- Modify: `src/main/index.ts`, `src/main/agent.ts`

- [ ] **Step 1: construct + inject.** In `src/main/index.ts`, import and construct the client, then add it to the `toolDeps` object:
```ts
import { WikiFactsClient } from './meta/wikiFacts'
```
Near the other meta construction (e.g. after `const metaIndex = ...`):
```ts
const wikiFacts = new WikiFactsClient()
```
In the `AgentService` `toolDeps` object (where `metaIndex: () => metaIndex` is), add:
```ts
      wikiFacts,
```

- [ ] **Step 2: prompt bullet.** In `src/main/agent.ts` `AXIVALE_SYSTEM_PROMPT`, add near the meta_search bullet (each sentence on ONE line — prompt regex tests match exact phrases):
```
- The GW2 API returns only PvE values — it has NO WvW/PvP balance splits.
  For the real WvW/PvP mechanics of a skill or trait (damage, recharge, boon/condi duration), call gw2_wiki_facts with the name.
  Use it whenever reasoning about WvW/roaming builds or any mechanics tradeoff; skill/trait names come from meta_search results.
```

- [ ] **Step 3: typecheck + build** — `npm run typecheck` PASS; `npm run build` PASS.
- [ ] **Step 4: Commit**
```bash
git add src/main/index.ts src/main/agent.ts
git commit -m "feat(meta): wire WikiFactsClient + gw2_wiki_facts prompt guidance"
```

---

### Task 4: Full verification

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS (all files + the new wikiFacts/gw2Wiki tests).
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke test (controller; not automatable).** Launch the app; ask a WvW mechanics question (e.g. "what's the WvW recharge and coefficient on Winds of Disenchantment, and how does it differ from PvE?"). Confirm `gw2_wiki_facts` fires, returns `wvw` facts/recharge that differ from `pve`, and the reply uses the WvW numbers. Ask for a bogus name and confirm a clean `found:false`.

---

## Self-Review

**Spec coverage:**
- `gw2_wiki_facts({name})` tool, skills+traits, mode-split output → Tasks 1+2. ✔
- Injected `WikiFacts` interface + `WikiFactsResult` shape (mode-split headline) → Task 1. ✔
- Real `WikiFactsClient` over `WikiClient.getWikitext` + `prefixSearch` fallback + `parseFactsByMode`; smoke-tested only → Task 1 + Task 4. ✔
- `ToolDeps.wikiFacts` + registration + wiring + prompt bullet → Tasks 2+3. ✔
- Non-destructive/auto-allowed (not added to DESTRUCTIVE/ACTION_GATED) → inherent (Task 2 registers a plain tool). ✔
- `safe()` wrapper, clean `found:false`, graceful network failure → Tasks 1+2. ✔
- Tests: pure mapper unit-tested, tool tested with fake, real client smoke-tested, inventory snapshot + ToolDeps mocks updated → Tasks 1/2/4. ✔

**Placeholder scan:** none — full code in every step. The `.d.ts` ambient-module note is a conditional (only if types are missing), with the exact content given.

**Type consistency:** `WikiFacts`/`WikiFactsResult`/`toWikiFactsResult` (Task 1) consumed by the tool (Task 2), `ToolDeps.wikiFacts` (Task 2 shared.ts), and `index.ts` wiring (Task 3). `ParsedModeFacts` matches the verified `parseFactsByMode` shape (`pve/wvw/pvp/hasSplit/recharge/activation`). The fake in the tool test returns the same `WikiFactsResult` shape.
