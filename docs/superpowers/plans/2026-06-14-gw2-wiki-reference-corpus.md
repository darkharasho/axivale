# GW2 Wiki Reference Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest a curated set of official GW2-wiki pages — concept/reference pages plus the aggregate `List of <profession> skills/traits` pages — into a dedicated LanceDB corpus, searchable via a `gw2_wiki_search` tool, with the prompt routing specifics to `gw2_wiki_facts`.

**Architecture:** A page registry → a background ingester (`getWikitextBatch` → `stripWikiMarkup` → content-hash gate → reuse `chunkPage` → embed → `wiki_chunks` table) reusing the existing `LanceMetaIndex` (parameterized by table name) + embedder, exposed by a new `gw2_wiki_search` tool. Pure/injected units unit-tested; real wiki+LanceDB smoke-tested.

**Tech Stack:** Electron main, TS, `@axiapps/gw2-data` (`WikiClient.getWikitextBatch`, `stripWikiMarkup`), existing `chunkPage`/`Embedder`/`LanceMetaIndex`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-gw2-wiki-reference-corpus-design.md`

**Verified:** `stripWikiMarkup(wikitext): string` and `WikiClient.getWikitextBatch(titles): Promise<Map<string,string|null>>` exist; `List of <profession> skills` pages exist and are rich (~10–21k chars). `LanceMetaIndex` uses a module `TABLE` const (3 refs) — parameterize it.

---

## File Structure
- Create `src/main/meta/wiki/refPages.ts` — the page registry (+ test).
- Modify `src/main/meta/rag/index.ts` — `LanceMetaIndex` table-name constructor param.
- Create `src/main/meta/wiki/ingest.ts` — `WikiRefIngester` (+ test).
- Create `src/main/tools/gw2WikiSearch.ts` — the tool; modify `tools/shared.ts` + `tools/index.ts` (+ test, mocks).
- Modify `src/main/index.ts` (construct + schedule + inject) + `src/main/agent.ts` (prompt).

Run tests with `npx vitest run <path> --maxWorkers=2` (never exceed 2).

---

### Task 1: Page registry

**Files:** Create `src/main/meta/wiki/refPages.ts`; Test `src/main/meta/wiki/refPages.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/main/meta/wiki/refPages.test.ts
import { describe, it, expect } from 'vitest'
import { WIKI_REF_PAGES } from './refPages'

describe('WIKI_REF_PAGES', () => {
  it('is a non-empty registry with category + title on every entry', () => {
    expect(WIKI_REF_PAGES.length).toBeGreaterThan(40)
    for (const p of WIKI_REF_PAGES) {
      expect(typeof p.category).toBe('string')
      expect(p.category.length).toBeGreaterThan(0)
      expect(typeof p.title).toBe('string')
      expect(p.title.length).toBeGreaterThan(0)
    }
  })
  it('covers skills + traits for all 9 professions and the key categories', () => {
    const cats = new Set(WIKI_REF_PAGES.map((p) => p.category))
    for (const c of ['skills', 'traits', 'upgrades', 'classes', 'stats', 'armor', 'weapons', 'boons-conditions', 'mechanics']) {
      expect(cats.has(c)).toBe(true)
    }
    expect(WIKI_REF_PAGES.filter((p) => p.category === 'skills')).toHaveLength(9)
    expect(WIKI_REF_PAGES.filter((p) => p.category === 'traits')).toHaveLength(9)
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/wiki/refPages.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** `src/main/meta/wiki/refPages.ts`:
```ts
// src/main/meta/wiki/refPages.ts
//
// Curated GW2-wiki pages to ingest into the reference corpus. Skills/traits use the
// wiki's aggregate "List of <profession> ..." pages (every skill/trait grouped by
// profession in one rich doc) for far better recall than per-entity micro-chunks.
// A title that 404s on the wiki is skipped at ingest time (not fatal), so approximate
// titles are safe to keep — refine against the live wiki as needed.
export interface WikiRefPage {
  category: string
  title: string
}

const PROFESSIONS = [
  'elementalist', 'warrior', 'guardian', 'revenant', 'engineer',
  'ranger', 'thief', 'mesmer', 'necromancer'
]

export const WIKI_REF_PAGES: WikiRefPage[] = [
  ...PROFESSIONS.map((p) => ({ category: 'skills', title: `List of ${p} skills` })),
  ...PROFESSIONS.map((p) => ({ category: 'traits', title: `List of ${p} traits` })),

  { category: 'upgrades', title: 'Rune' },
  { category: 'upgrades', title: 'Sigil' },
  { category: 'upgrades', title: 'Relic' },
  { category: 'upgrades', title: 'Infusion' },
  { category: 'upgrades', title: 'Upgrade component' },

  { category: 'classes', title: 'Profession' },
  { category: 'classes', title: 'Elementalist' },
  { category: 'classes', title: 'Warrior' },
  { category: 'classes', title: 'Guardian' },
  { category: 'classes', title: 'Revenant' },
  { category: 'classes', title: 'Engineer' },
  { category: 'classes', title: 'Ranger' },
  { category: 'classes', title: 'Thief' },
  { category: 'classes', title: 'Mesmer' },
  { category: 'classes', title: 'Necromancer' },

  { category: 'specializations', title: 'Specialization' },
  { category: 'specializations', title: 'Elite specialization' },

  { category: 'stats', title: 'Attribute' },
  { category: 'stats', title: 'Power' },
  { category: 'stats', title: 'Precision' },
  { category: 'stats', title: 'Toughness' },
  { category: 'stats', title: 'Vitality' },
  { category: 'stats', title: 'Ferocity' },
  { category: 'stats', title: 'Condition Damage' },
  { category: 'stats', title: 'Expertise' },
  { category: 'stats', title: 'Concentration' },
  { category: 'stats', title: 'Healing Power' },
  { category: 'stats', title: 'Agony Resistance' },
  { category: 'stats', title: 'Attribute combinations' },

  { category: 'armor', title: 'Armor' },
  { category: 'armor', title: 'Armor class' },
  { category: 'armor', title: 'Insignia' },

  { category: 'weapons', title: 'Weapon' },
  { category: 'weapons', title: 'Weapon types' },

  { category: 'boons-conditions', title: 'Boon' },
  { category: 'boons-conditions', title: 'Condition' },
  { category: 'boons-conditions', title: 'Effect' },
  { category: 'boons-conditions', title: 'Might' },
  { category: 'boons-conditions', title: 'Fury' },
  { category: 'boons-conditions', title: 'Quickness' },
  { category: 'boons-conditions', title: 'Alacrity' },
  { category: 'boons-conditions', title: 'Stability' },
  { category: 'boons-conditions', title: 'Protection' },
  { category: 'boons-conditions', title: 'Resolution' },
  { category: 'boons-conditions', title: 'Vulnerability' },
  { category: 'boons-conditions', title: 'Bleeding' },
  { category: 'boons-conditions', title: 'Burning' },
  { category: 'boons-conditions', title: 'Poison' },
  { category: 'boons-conditions', title: 'Torment' },
  { category: 'boons-conditions', title: 'Confusion' },

  { category: 'mechanics', title: 'Combo' },
  { category: 'mechanics', title: 'Defiance bar' },
  { category: 'mechanics', title: 'Crowd control' },
  { category: 'mechanics', title: 'Downed state' },
  { category: 'mechanics', title: 'Game mechanics' }
]
```

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/wiki/refPages.test.ts --maxWorkers=2`
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/wiki/refPages.ts src/main/meta/wiki/refPages.test.ts
git commit -m "feat(wiki): curated GW2-wiki reference page registry (list pages + concepts)"
```

---

### Task 2: `LanceMetaIndex` table-name parameter

**Files:** Modify `src/main/meta/rag/index.ts` (Test: existing `index.test.ts` stays green)

- [ ] **Step 1: Implement.** In `src/main/meta/rag/index.ts`:
  - Keep `const TABLE = 'meta_chunks'` as the default. Add a `table` field to `LanceMetaIndex` set from a new constructor param defaulting to `TABLE`. The current constructor is:
```ts
  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder
  ) {}
```
  Change to:
```ts
  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder,
    private readonly table: string = TABLE
  ) {}
```
  - Replace the **three** `TABLE` references in the body (the `names.includes(TABLE)`, `openTable(TABLE)`, and `createTable(TABLE, [seed])` calls) with `this.table`.

- [ ] **Step 2: Run existing tests + typecheck:** `npx vitest run src/main/meta/rag/index.test.ts --maxWorkers=2` (PASS — `FakeMetaIndex` unaffected); `npm run typecheck` PASS.
- [ ] **Step 3: Commit**
```bash
git add src/main/meta/rag/index.ts
git commit -m "refactor(meta): parameterize LanceMetaIndex table name (default meta_chunks)"
```

---

### Task 3: `WikiRefIngester`

**Files:** Create `src/main/meta/wiki/ingest.ts`; Test `src/main/meta/wiki/ingest.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/main/meta/wiki/ingest.test.ts
import { describe, it, expect, vi } from 'vitest'
import { WikiRefIngester, type WikiClientLike } from './ingest'
import { FakeMetaIndex } from '../rag/testFake'

function wiki(map: Record<string, string | null>): WikiClientLike & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    getWikitextBatch: async (titles) => {
      calls.push(titles)
      return new Map(titles.map((t) => [t, map[t] ?? null]))
    }
  }
}

const PAGES = [
  { category: 'stats', title: 'Power' },
  { category: 'skills', title: 'List of elementalist skills' },
  { category: 'mechanics', title: 'Gone' } // missing
]

describe('WikiRefIngester', () => {
  it('cleans, chunks, and indexes each present page; skips missing', async () => {
    const idx = new FakeMetaIndex()
    const w = wiki({
      Power: "'''Power''' is an [[attribute]] that increases damage. ".repeat(20),
      'List of elementalist skills': 'Fireball deals damage. Lightning Flash teleports. '.repeat(20),
      Gone: null
    })
    await new WikiRefIngester({ wiki: w, index: idx, pages: PAGES }).ingest()
    const replaced = idx.replaced.join(' ')
    expect(replaced).toContain('Power')
    expect(replaced).toContain('List_of_elementalist_skills')
    expect(replaced).not.toContain('Gone')
  })

  it('skips a page whose content hash is unchanged (no re-index)', async () => {
    const idx = new FakeMetaIndex()
    const w = wiki({ Power: 'Power is an attribute that boosts damage. '.repeat(20) })
    const deps = { wiki: w, index: idx, pages: [{ category: 'stats', title: 'Power' }] }
    await new WikiRefIngester(deps).ingest()
    const first = idx.replaced.length
    await new WikiRefIngester(deps).ingest() // same content → skipped
    expect(idx.replaced.length).toBe(first)
  })

  it('isolates a page that throws (others still index)', async () => {
    const idx = new FakeMetaIndex()
    const throwing = {
      indexedHash: async () => null,
      replacePage: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined),
      search: async () => [],
      stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
      sample: async () => []
    }
    const w = wiki({ A: 'alpha alpha alpha '.repeat(40), B: 'beta beta beta '.repeat(40) })
    await new WikiRefIngester({ wiki: w, index: throwing, pages: [{ category: 'x', title: 'A' }, { category: 'x', title: 'B' }] }).ingest()
    expect(throwing.replacePage).toHaveBeenCalledTimes(2) // didn't abort after the throw
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/wiki/ingest.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** `src/main/meta/wiki/ingest.ts`:
```ts
// src/main/meta/wiki/ingest.ts
//
// Ingest the curated GW2-wiki reference pages into the wiki_chunks corpus: batch-fetch
// wikitext, strip markup, content-hash gate, chunk (reused), and upsert. Error-isolated
// per page; a missing page is skipped. Runs in the background.
import { stripWikiMarkup } from '@axiapps/gw2-data'
import { chunkPage, sha1 } from '../rag/chunk'
import type { MetaIndex } from '../rag/index'
import { WIKI_REF_PAGES, type WikiRefPage } from './refPages'

export interface WikiClientLike {
  getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
}
export interface WikiRefIngesterDeps {
  wiki: WikiClientLike
  index: MetaIndex
  pages?: WikiRefPage[]
}

export function wikiPageUrl(title: string): string {
  return 'https://wiki.guildwars2.com/wiki/' + title.replace(/ /g, '_')
}

export class WikiRefIngester {
  constructor(private readonly deps: WikiRefIngesterDeps) {}

  async ingest(): Promise<void> {
    const pages = this.deps.pages ?? WIKI_REF_PAGES
    const { wiki, index } = this.deps
    for (let i = 0; i < pages.length; i += 50) {
      const batch = pages.slice(i, i + 50)
      let texts: Map<string, string | null>
      try {
        texts = await wiki.getWikitextBatch(batch.map((p) => p.title))
      } catch {
        continue // whole batch failed — skip it, keep going
      }
      for (const p of batch) {
        try {
          const raw = texts.get(p.title)
          if (!raw) continue
          const text = stripWikiMarkup(raw)
          if (!text || text.trim().length < 50) continue
          const url = wikiPageUrl(p.title)
          if ((await index.indexedHash(url)) === sha1(text)) continue
          const chunks = chunkPage(text, {
            mode: p.category,
            source: 'wiki.guildwars2.com',
            url,
            title: p.title
          })
          if (chunks.length > 0) await index.replacePage(url, chunks)
        } catch {
          /* one page failed — isolate and continue */
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/wiki/ingest.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/wiki/ingest.ts src/main/meta/wiki/ingest.test.ts
git commit -m "feat(wiki): WikiRefIngester (batch fetch -> strip -> chunk -> index, hash-gated)"
```

---

### Task 4: `gw2_wiki_search` tool

**Files:** Create `src/main/tools/gw2WikiSearch.ts`; Modify `src/main/tools/shared.ts`, `src/main/tools/index.ts`; Test `src/main/tools/gw2WikiSearch.test.ts`

- [ ] **Step 1: add the dep field.** In `src/main/tools/shared.ts`, add `import type { MetaIndex } from '../meta/rag/index'` if not present, and add to `ToolDeps` (after `metaIndex`):
```ts
  /** GW2-wiki reference corpus search (lazy). */
  wikiIndex: () => MetaIndex
```

- [ ] **Step 2: Write the failing test**
```ts
// src/main/tools/gw2WikiSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildGw2WikiSearchTools } from './gw2WikiSearch'
import { FakeMetaIndex } from '../meta/rag/testFake'

describe('gw2_wiki_search tool', () => {
  it('returns mapped hits and forwards the category filter', async () => {
    const idx = new FakeMetaIndex([{ source: 'wiki.guildwars2.com', url: 'u', title: 'Concentration', snippet: 'boon duration', score: 1 }])
    const t = buildGw2WikiSearchTools(() => idx)[0]
    const res = await t.handler({ query: 'boon duration', category: 'stats' }, {})
    expect(idx.queries[0]).toMatchObject({ query: 'boon duration', mode: 'stats' })
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('Concentration')
  })
  it('returns a clean message when empty', async () => {
    const t = buildGw2WikiSearchTools(() => new FakeMetaIndex())[0]
    const res = await t.handler({ query: 'x' }, {})
    expect((res.content[0] as { text: string }).text.toLowerCase()).toContain('no wiki reference')
  })
})
```

- [ ] **Step 3: Run, expect FAIL:** `npx vitest run src/main/tools/gw2WikiSearch.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement** `src/main/tools/gw2WikiSearch.ts`:
```ts
// src/main/tools/gw2WikiSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2WikiSearchTools(wikiIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_wiki_search',
      'Search the indexed GW2 wiki reference corpus for game mechanics and concepts — how attributes/boons/conditions/combos/armor weights/upgrades work, and which skills/traits a profession has (skills and traits are grouped by profession). Use this for conceptual/"how does X work" questions; for a SPECIFIC skill or trait\'s exact numbers and WvW/PvP splits use gw2_wiki_facts instead. Optional category: classes, specializations, stats, armor, weapons, upgrades, boons-conditions, mechanics, skills, traits.',
      {
        query: z.string().describe('What to look up, e.g. "how does Concentration affect boon duration"'),
        category: z.string().optional().describe('Optional category filter')
      },
      safe(async ({ query, category }: { query: string; category?: string }) => {
        const hits = await wikiIndex().search(query, { mode: category, k: 6 })
        if (hits.length === 0) return { note: 'no wiki reference indexed yet — the background ingest may not have run' }
        return hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
      })
    )
  ]
}
```

- [ ] **Step 5: register the tool.** In `src/main/tools/index.ts`, import and append to the `buildOfficerTools` array:
```ts
import { buildGw2WikiSearchTools } from './gw2WikiSearch'
```
```ts
    ...buildGw2WikiSearchTools(deps.wikiIndex),
```

- [ ] **Step 6: keep typecheck/tests green.** The new required `ToolDeps.wikiIndex` breaks full-`ToolDeps` mocks. Search `src/main/**/*.test.ts` for `metaIndex:` and add beside each a stub:
```ts
      wikiIndex: () => ({}) as never,
```
(mirroring the existing `metaIndex: () => ({}) as never` stub style). Add `'gw2_wiki_search'` to the `src/main/tools/inventory.test.ts` sorted tool-name snapshot.

- [ ] **Step 7: Run, expect PASS:** `npx vitest run src/main/tools/gw2WikiSearch.test.ts src/main/tools/inventory.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 8: Commit**
```bash
git add src/main/tools/gw2WikiSearch.ts src/main/tools/gw2WikiSearch.test.ts src/main/tools/shared.ts src/main/tools/index.ts src/main/tools/inventory.test.ts
git add -A
git commit -m "feat(wiki): gw2_wiki_search tool over the wiki reference corpus"
```

---

### Task 5: Wire into main + prompt

**Files:** Modify `src/main/index.ts`, `src/main/agent.ts`

- [ ] **Step 1: construct + schedule + inject.** In `src/main/index.ts`:
  - Imports near the meta block:
```ts
import { WikiClient } from '@axiapps/gw2-data/wiki'
import { WikiRefIngester } from './meta/wiki/ingest'
```
  - After `const metaIndex = new LanceMetaIndex(...)` and `const metaEmbedder = ...`, add:
```ts
const wikiIndex = new LanceMetaIndex(join(app.getPath('userData'), 'wiki-lance'), metaEmbedder, 'wiki_chunks')
const wikiIngester = new WikiRefIngester({ wiki: new WikiClient(), index: wikiIndex })
let wikiTimer: ReturnType<typeof setInterval> | null = null
```
  - In the `app.whenReady().then(...)` block, after the meta refresh scheduling (the `metaRefresher` setTimeout/setInterval), add a background ingest (never blocks startup) + a weekly refresh:
```ts
  setTimeout(() => void wikiIngester.ingest(), 8_000)
  wikiTimer = setInterval(() => void wikiIngester.ingest(), 7 * 24 * 60 * 60 * 1000)
```
  - In the `before-quit` handler, alongside `clearInterval(metaTimer)`:
```ts
  if (wikiTimer) clearInterval(wikiTimer)
```
  - Add `wikiIndex: () => wikiIndex,` to the AgentService `toolDeps` object (beside `metaIndex`).

- [ ] **Step 2: prompt bullet.** In `src/main/agent.ts` `AXIVALE_SYSTEM_PROMPT`, add near the meta_search / gw2_wiki_facts bullets (each sentence on ONE line — prompt regex tests):
```
- For GW2 game mechanics and concepts — how attributes, boons, conditions, combos, armor weights, or upgrades work, and which skills/traits a profession has — call gw2_wiki_search.
- For a SPECIFIC skill or trait's exact numbers and WvW/PvP splits call gw2_wiki_facts; for builds call meta_search.
```
(If a combined gw2_wiki_facts/meta_search routing bullet already exists, fold the gw2_wiki_search line in beside it rather than duplicating.)

- [ ] **Step 3: typecheck + build:** `npm run typecheck` PASS; `npm run build` PASS.
- [ ] **Step 4: Commit**
```bash
git add src/main/index.ts src/main/agent.ts
git commit -m "feat(wiki): wire wiki corpus ingest + gw2_wiki_search; prompt routing"
```

---

### Task 6: Full verification

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS.
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke (controller).** Dev run; wait for the background wiki ingest (first run fetches ~80 pages + embeds → a few minutes; watch console). Then ask a concept question ("how does Concentration affect boon duration?", "which elementalist skills grant Fury?", "what's the difference between the armor weight classes?"). Confirm `gw2_wiki_search` fires and returns relevant wiki passages, and a specific-skill question still routes to `gw2_wiki_facts`.

---

## Self-Review

**Spec coverage:**
- Registry of concept + aggregate `List of <profession> skills/traits` + Rune/Sigil/Relic pages → Task 1. ✔
- `wiki_chunks` via reused `LanceMetaIndex` (table-name param) → Task 2 + Task 5. ✔
- Ingester: getWikitextBatch → stripWikiMarkup → content-hash gate → chunkPage → replacePage, error-isolated, missing-skipped → Task 3. ✔
- `gw2_wiki_search({query, category?})` (mode=category filter, empty message, non-destructive) + ToolDeps + registration → Task 4. ✔
- Wiring (own embedder reuse, own dir, background schedule + weekly + quit cleanup) + prompt routing to gw2_wiki_facts → Task 5. ✔
- Error handling (page/batch failure skipped; empty index clean; hash-gate) → Tasks 3/4. ✔
- Tests: registry (pure), ingester (fake wiki+index), tool (fake index); real wiki+LanceDB smoke → Tasks 1/3/4/6. ✔

**Placeholder scan:** none — full code in every step. Registry titles are concrete (approximate ones are skipped-not-fatal by design, noted in the file header).

**Type consistency:** `WikiRefPage` (Task 1) consumed by the ingester (Task 3). `MetaIndex` (existing) reused for `wikiIndex` (Tasks 4/5) and the ingester's `index` dep (Task 3). `chunkPage`/`sha1` (existing) used in Task 3 with `{mode:category, source, url, title}` matching the `ChunkMeta` shape. `LanceMetaIndex` table param (Task 2) used in Task 5. `ToolDeps.wikiIndex: () => MetaIndex` (Task 4) injected in Task 5. `FakeMetaIndex` (existing, has stats/sample from the inspector slice) satisfies the ingester/tool tests.
