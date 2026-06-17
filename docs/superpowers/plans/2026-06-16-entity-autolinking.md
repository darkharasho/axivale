# Entity Autolinking + Hover Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GW2 skills, traits, and items in rendered prose into color-coded inline links that show a lazy-resolved, cached hover card and open the GW2 Wiki on click.

**Architecture:** Main process resolves entities (items ← AxiForge catalog; skills/traits ← GW2 wiki facts) and builds a known-name dictionary (items ← catalog; skills/traits ← GW2 API `?ids=all`, cached to disk). The renderer gets the dictionary, a `rehypeEntityLinks` plugin wraps marker syntax (`[[type:Name]]`) and conservative exact-text matches into `.axi-entity` spans, and a delegated `createEntityHover` helper shows a hover card (resolved via IPC, cached) and opens the deterministic wiki URL on click.

**Tech Stack:** Electron + React 18 + TypeScript (ESM, extensionless imports), `react-markdown` + rehype (`unist-util-visit` over HAST), Vitest, `@axiapps/forge-render`, `@axiapps/gw2-data` (`WikiClient`).

## Global Constraints

- ESM throughout; **no file extensions** in imports; `"type": "module"`.
- Test files: `src/**/*.test.{ts,tsx}` (co-located next to source). Run with `npx vitest run --maxWorkers=2` (config already caps `maxForks: 2` — honor it).
- No path aliases; use relative imports.
- New IPC channels need three edits in lockstep: `ipcMain.handle` in `src/main/index.ts`, a wrapper in `src/preload/index.ts`, and a type in `src/preload/index.d.ts` (`OfficerApi`). Renderer calls via `window.officer.*`.
- Entity types are exactly `'skill' | 'trait' | 'item'`. Locations are out of scope.
- GW2 wiki URL is deterministic: `https://wiki.guildwars2.com/wiki/<encodeURIComponent(name with spaces → underscores)>`.

---

### Task 1: Entity card types + normalizers (main, pure)

**Files:**
- Create: `src/main/entities/types.ts`
- Create: `src/main/entities/normalize.ts`
- Test: `src/main/entities/normalize.test.ts`

**Interfaces:**
- Consumes: `WikiFactsResult` from `../meta/wikiFacts`; catalog entry shape `{ id?: number; name: string; icon?: string; bonuses?: string[] }` from `../forgeCatalog`.
- Produces:
  - `type EntityType = 'skill' | 'trait' | 'item'`
  - `interface EntityFact { label: string; value?: string }`
  - `interface EntityCard { type: EntityType; name: string; icon?: string; subtitle?: string; description?: string; facts: EntityFact[]; wikiUrl: string }`
  - `wikiUrlFor(name: string): string`
  - `wikiFactsToCard(type: 'skill' | 'trait', r: WikiFactsResult): EntityCard | null`
  - `catalogItemToCard(entry: { id?: number; name: string; icon?: string; bonuses?: string[] }): EntityCard`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/entities/normalize.test.ts
import { describe, it, expect } from 'vitest'
import { wikiUrlFor, wikiFactsToCard, catalogItemToCard } from './normalize'
import type { WikiFactsResult } from '../meta/wikiFacts'

describe('wikiUrlFor', () => {
  it('builds a wiki url with spaces as underscores', () => {
    expect(wikiUrlFor('Lily of the Elon')).toBe('https://wiki.guildwars2.com/wiki/Lily_of_the_Elon')
  })
  it('encodes special characters but keeps underscores', () => {
    expect(wikiUrlFor("Zealot's Speed")).toBe("https://wiki.guildwars2.com/wiki/Zealot's_Speed")
  })
})

describe('wikiFactsToCard', () => {
  const base: WikiFactsResult = {
    name: 'Shelter', found: true, hasSplit: false,
    pve: [], wvw: [], pvp: [],
    recharge: { pve: 30, wvw: 30, pvp: 30 }, activation: { pve: 0, wvw: 0, pvp: 0 }
  }
  it('returns null when the page was not found', () => {
    expect(wikiFactsToCard('skill', { ...base, found: false })).toBeNull()
  })
  it('maps a found skill to a card with recharge fact, subtitle, and wiki url', () => {
    const card = wikiFactsToCard('skill', base)
    expect(card).toMatchObject({
      type: 'skill', name: 'Shelter', subtitle: 'Skill',
      wikiUrl: 'https://wiki.guildwars2.com/wiki/Shelter'
    })
    expect(card?.facts).toContainEqual({ label: 'Recharge', value: '30s' })
  })
})

describe('catalogItemToCard', () => {
  it('maps a catalog rune to an item card with its bonuses as facts', () => {
    const card = catalogItemToCard({ id: 1, name: 'Superior Rune of the Monk', icon: 'x.png', bonuses: ['+25 Healing'] })
    expect(card).toEqual({
      type: 'item', name: 'Superior Rune of the Monk', icon: 'x.png',
      subtitle: 'Item', description: undefined,
      facts: [{ label: '', value: '+25 Healing' }],
      wikiUrl: 'https://wiki.guildwars2.com/wiki/Superior_Rune_of_the_Monk'
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/entities/normalize.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./normalize`.

- [ ] **Step 3: Write the types**

```ts
// src/main/entities/types.ts
export type EntityType = 'skill' | 'trait' | 'item'

export interface EntityFact {
  label: string
  value?: string
}

export interface EntityCard {
  type: EntityType
  name: string
  icon?: string
  subtitle?: string
  description?: string
  facts: EntityFact[]
  wikiUrl: string
}
```

- [ ] **Step 4: Write the normalizers**

```ts
// src/main/entities/normalize.ts
import type { WikiFactsResult } from '../meta/wikiFacts'
import type { EntityCard, EntityType } from './types'

export function wikiUrlFor(name: string): string {
  // Wiki titles use underscores for spaces; encode the rest but keep underscores readable.
  const title = name.trim().replace(/ /g, '_')
  return `https://wiki.guildwars2.com/wiki/${encodeURI(title)}`
}

const SUBTITLE: Record<EntityType, string> = { skill: 'Skill', trait: 'Trait', item: 'Item' }

export function wikiFactsToCard(type: 'skill' | 'trait', r: WikiFactsResult): EntityCard | null {
  if (!r.found) return null
  const facts: EntityCard['facts'] = []
  if (r.recharge?.pve != null) facts.push({ label: 'Recharge', value: `${r.recharge.pve}s` })
  if (r.activation?.pve) facts.push({ label: 'Activation', value: `${r.activation.pve}s` })
  return {
    type,
    name: r.name,
    subtitle: SUBTITLE[type],
    facts,
    wikiUrl: wikiUrlFor(r.name)
  }
}

export function catalogItemToCard(entry: {
  id?: number
  name: string
  icon?: string
  bonuses?: string[]
}): EntityCard {
  return {
    type: 'item',
    name: entry.name,
    icon: entry.icon,
    subtitle: SUBTITLE.item,
    description: undefined,
    facts: (entry.bonuses ?? []).map((value) => ({ label: '', value })),
    wikiUrl: wikiUrlFor(entry.name)
  }
}
```

Note: `WikiFactsResult.recharge`/`.activation` are typed `ModeNums` in `wikiFacts.ts`. If TypeScript complains that `pve` is not indexable, import and use the existing `ModeNums` type or access via `(r.recharge as Record<string, number | null>).pve`. Verify the exact `ModeNums` shape in `src/main/meta/wikiFacts.ts` before finalizing.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/entities/normalize.test.ts --maxWorkers=2`
Expected: PASS (3 suites).

- [ ] **Step 6: Commit**

```bash
git add src/main/entities/types.ts src/main/entities/normalize.ts src/main/entities/normalize.test.ts
git commit -m "feat(entities): EntityCard types + wiki/catalog normalizers"
```

---

### Task 2: Name dictionary builder + GW2 name fetcher (main, pure)

**Files:**
- Create: `src/main/entities/dictionary.ts`
- Test: `src/main/entities/dictionary.test.ts`

**Interfaces:**
- Consumes: `EntityType` from `./types`.
- Produces:
  - `interface EntityDictionaryEntry { name: string; type: EntityType }`
  - `interface EntityDictionary { entries: EntityDictionaryEntry[] }` — entries sorted by `name.length` descending (longest-first) so the matcher prefers the longest match.
  - `buildDictionary(input: { skills: string[]; traits: string[]; items: string[] }): EntityDictionary` — trims, drops empties, dedupes by name (first type wins in precedence order item > skill > trait), sorts longest-first.
  - `type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>`
  - `fetchGw2Names(endpoint: 'skills' | 'traits', fetchImpl: FetchLike): Promise<string[]>` — GETs `https://api.guildwars2.com/v2/${endpoint}?ids=all`, returns the `name` of each row (skipping rows without a string name).

- [ ] **Step 1: Write the failing test**

```ts
// src/main/entities/dictionary.test.ts
import { describe, it, expect } from 'vitest'
import { buildDictionary, fetchGw2Names } from './dictionary'

describe('buildDictionary', () => {
  it('trims, drops empties, and sorts entries longest-first', () => {
    const dict = buildDictionary({ skills: ['Shelter', '  ', ' Lily of the Elon '], traits: [], items: [] })
    expect(dict.entries.map((e) => e.name)).toEqual(['Lily of the Elon', 'Shelter'])
    expect(dict.entries[0]).toEqual({ name: 'Lily of the Elon', type: 'skill' })
  })
  it('dedupes a name across types with item > skill > trait precedence', () => {
    const dict = buildDictionary({ skills: ['Resolve'], traits: ['Resolve'], items: ['Resolve'] })
    expect(dict.entries).toEqual([{ name: 'Resolve', type: 'item' }])
  })
})

describe('fetchGw2Names', () => {
  it('requests ?ids=all and returns the names', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      return { ok: true, json: async () => [{ id: 1, name: 'Shelter' }, { id: 2 }, { id: 3, name: 'Bane Signet' }] }
    }
    const names = await fetchGw2Names('skills', fetchImpl)
    expect(calls).toEqual(['https://api.guildwars2.com/v2/skills?ids=all'])
    expect(names).toEqual(['Shelter', 'Bane Signet'])
  })
  it('returns [] when the response is not ok', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => [] })
    expect(await fetchGw2Names('traits', fetchImpl)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/entities/dictionary.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./dictionary`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/entities/dictionary.ts
import type { EntityType } from './types'

export interface EntityDictionaryEntry {
  name: string
  type: EntityType
}

export interface EntityDictionary {
  entries: EntityDictionaryEntry[]
}

export function buildDictionary(input: {
  skills: string[]
  traits: string[]
  items: string[]
}): EntityDictionary {
  const byName = new Map<string, EntityType>()
  // Precedence: item > skill > trait. Insert lowest precedence first so higher overwrites.
  const ordered: Array<[EntityType, string[]]> = [
    ['trait', input.traits],
    ['skill', input.skills],
    ['item', input.items]
  ]
  for (const [type, names] of ordered) {
    for (const raw of names) {
      const name = raw.trim()
      if (name) byName.set(name, type)
    }
  }
  const entries = [...byName.entries()].map(([name, type]) => ({ name, type }))
  entries.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name))
  return { entries }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export async function fetchGw2Names(
  endpoint: 'skills' | 'traits',
  fetchImpl: FetchLike
): Promise<string[]> {
  const res = await fetchImpl(`https://api.guildwars2.com/v2/${endpoint}?ids=all`)
  if (!res.ok) return []
  const rows = (await res.json()) as Array<{ name?: unknown }>
  return rows.map((r) => r.name).filter((n): n is string => typeof n === 'string' && n.length > 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/entities/dictionary.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/entities/dictionary.ts src/main/entities/dictionary.test.ts
git commit -m "feat(entities): name dictionary builder + GW2 names fetcher"
```

---

### Task 3: Entity service + IPC wiring (main, preload, d.ts)

**Files:**
- Create: `src/main/entities/service.ts`
- Test: `src/main/entities/service.test.ts`
- Modify: `src/main/index.ts` (register two `ipcMain.handle` channels)
- Modify: `src/preload/index.ts` (add two wrappers to the `officer` bridge)
- Modify: `src/preload/index.d.ts` (add two methods + export shared types to `OfficerApi`)

**Interfaces:**
- Consumes: `EntityCard`, `EntityType` from `./types`; `EntityDictionary`, `buildDictionary`, `fetchGw2Names` from `./dictionary`; `wikiFactsToCard`, `catalogItemToCard` from `./normalize`; `WikiFacts` from `../meta/wikiFacts`; `ForgeUpgradeCatalog` from `../forgeCatalog`.
- Produces:
  - `class EntityService` with:
    - `constructor(deps: { wikiFacts: WikiFacts; getCatalog: () => Promise<ForgeUpgradeCatalog | null>; fetchNames: (e: 'skills' | 'traits') => Promise<string[]> })`
    - `resolve(input: { type: EntityType; name: string }): Promise<EntityCard | null>` — dispatches by type, memoizes successes in an LRU keyed `type:name`; failures are not cached.
    - `dictionary(): Promise<EntityDictionary>` — builds once from catalog + fetched names, caches the result in memory.
  - IPC channels `entity:resolve` (`{ type, name }` → `EntityCard | null`) and `entity:dictionary` (`void` → `EntityDictionary`).
  - `window.officer.resolveEntity(input: { type: EntityType; name: string }): Promise<EntityCard | null>`
  - `window.officer.entityDictionary(): Promise<EntityDictionary>`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/entities/service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EntityService } from './service'

function makeService(over: Partial<ConstructorParameters<typeof EntityService>[0]> = {}) {
  return new EntityService({
    wikiFacts: { lookup: vi.fn(async (name: string) => ({
      name, found: true, hasSplit: false, pve: [], wvw: [], pvp: [],
      recharge: { pve: 30, wvw: 30, pvp: 30 }, activation: { pve: 0, wvw: 0, pvp: 0 }
    })) },
    getCatalog: async () => ({
      runes: [{ id: 1, name: 'Superior Rune of the Monk', bonuses: ['+25 Healing'] }],
      relics: [{ name: 'Relic of the Monk' }]
    }),
    fetchNames: async (e) => (e === 'skills' ? ['Shelter'] : ['Zeal']),
    ...over
  })
}

describe('EntityService.resolve', () => {
  it('resolves a skill via wiki facts and caches it (second call does not re-lookup)', async () => {
    const lookup = vi.fn(async (name: string) => ({
      name, found: true, hasSplit: false, pve: [], wvw: [], pvp: [],
      recharge: { pve: 30, wvw: 30, pvp: 30 }, activation: { pve: 0, wvw: 0, pvp: 0 }
    }))
    const svc = makeService({ wikiFacts: { lookup } })
    const a = await svc.resolve({ type: 'skill', name: 'Shelter' })
    const b = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(a?.name).toBe('Shelter')
    expect(b).toEqual(a)
    expect(lookup).toHaveBeenCalledTimes(1)
  })
  it('resolves an item from the catalog by name', async () => {
    const card = await makeService().resolve({ type: 'item', name: 'Superior Rune of the Monk' })
    expect(card).toMatchObject({ type: 'item', name: 'Superior Rune of the Monk' })
    expect(card?.facts).toContainEqual({ label: '', value: '+25 Healing' })
  })
  it('returns null for an unknown item and does not cache the miss', async () => {
    const getCatalog = vi.fn(async () => ({ runes: [], relics: [] }))
    const svc = makeService({ getCatalog })
    expect(await svc.resolve({ type: 'item', name: 'Nope' })).toBeNull()
    await svc.resolve({ type: 'item', name: 'Nope' })
    expect(getCatalog).toHaveBeenCalledTimes(2)
  })
})

describe('EntityService.dictionary', () => {
  it('merges catalog item names with fetched skill/trait names', async () => {
    const dict = await makeService().dictionary()
    const names = dict.entries.map((e) => e.name)
    expect(names).toContain('Shelter')
    expect(names).toContain('Zeal')
    expect(names).toContain('Superior Rune of the Monk')
    expect(names).toContain('Relic of the Monk')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/entities/service.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./service`.

- [ ] **Step 3: Write the service**

```ts
// src/main/entities/service.ts
import type { WikiFacts } from '../meta/wikiFacts'
import type { ForgeUpgradeCatalog } from '../forgeCatalog'
import type { EntityCard, EntityType } from './types'
import { wikiFactsToCard, catalogItemToCard } from './normalize'
import { buildDictionary, type EntityDictionary } from './dictionary'

interface Deps {
  wikiFacts: WikiFacts
  getCatalog: () => Promise<ForgeUpgradeCatalog | null>
  fetchNames: (e: 'skills' | 'traits') => Promise<string[]>
}

export class EntityService {
  private readonly cache = new Map<string, EntityCard>()
  private dict: EntityDictionary | null = null

  constructor(private readonly deps: Deps) {}

  async resolve(input: { type: EntityType; name: string }): Promise<EntityCard | null> {
    const key = `${input.type}:${input.name}`
    const hit = this.cache.get(key)
    if (hit) return hit
    let card: EntityCard | null = null
    if (input.type === 'item') {
      const catalog = await this.deps.getCatalog()
      const entry =
        catalog?.runes.find((r) => r.name === input.name) ??
        catalog?.relics.find((r) => r.name === input.name)
      card = entry ? catalogItemToCard(entry) : null
    } else {
      const facts = await this.deps.wikiFacts.lookup(input.name)
      card = wikiFactsToCard(input.type, facts)
    }
    if (card) this.cache.set(key, card) // never cache a miss
    return card
  }

  async dictionary(): Promise<EntityDictionary> {
    if (this.dict) return this.dict
    const [catalog, skills, traits] = await Promise.all([
      this.deps.getCatalog(),
      this.deps.fetchNames('skills'),
      this.deps.fetchNames('traits')
    ])
    const items = [
      ...(catalog?.runes ?? []).map((r) => r.name),
      ...(catalog?.relics ?? []).map((r) => r.name)
    ]
    this.dict = buildDictionary({ skills, traits, items })
    return this.dict
  }
}
```

Note: `relics` entries lack `bonuses`/`id`; `catalogItemToCard` already defaults `bonuses` to `[]`, so relic cards are valid (empty facts).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/entities/service.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Wire the IPC handlers in `src/main/index.ts`**

Near the other `ipcMain.handle('settings:get', ...)` registrations, after constructing the existing `WikiFactsClient`/`ForgeCatalogCache` (find the instances already built in this file — reuse them; do not construct new wiki/catalog clients), add:

```ts
import { EntityService } from './entities/service'
import { WikiFactsClient } from './meta/wikiFacts'
import { fetchGw2Names } from './entities/dictionary'

// ...inside the same setup scope where `forgeCatalog` (ForgeCatalogCache) already exists:
const entityService = new EntityService({
  wikiFacts: new WikiFactsClient(),
  getCatalog: () => forgeCatalog.getUpgrades(),
  fetchNames: (e) => fetchGw2Names(e, (url) => fetch(url))
})

ipcMain.handle('entity:resolve', (_event, input: { type: 'skill' | 'trait' | 'item'; name: string }) =>
  entityService.resolve(input)
)
ipcMain.handle('entity:dictionary', () => entityService.dictionary())
```

If the existing `ForgeCatalogCache` instance is named differently than `forgeCatalog`, use that name. `fetch` is available globally in the Electron main process (Node 18+). If TypeScript flags `fetch` as undefined, cast: `(url: string) => fetch(url) as unknown as Promise<{ ok: boolean; json(): Promise<unknown> }>`.

- [ ] **Step 6: Add the preload wrappers in `src/preload/index.ts`**

Inside the `contextBridge.exposeInMainWorld('officer', { ... })` object, add:

```ts
  resolveEntity: (input: { type: 'skill' | 'trait' | 'item'; name: string }) =>
    ipcRenderer.invoke('entity:resolve', input),
  entityDictionary: () => ipcRenderer.invoke('entity:dictionary'),
```

- [ ] **Step 7: Add the types in `src/preload/index.d.ts`**

Add shared types (top of file or near other exported types) and two methods inside `interface OfficerApi`:

```ts
export type EntityType = 'skill' | 'trait' | 'item'
export interface EntityFact { label: string; value?: string }
export interface EntityCard {
  type: EntityType
  name: string
  icon?: string
  subtitle?: string
  description?: string
  facts: EntityFact[]
  wikiUrl: string
}
export interface EntityDictionaryEntry { name: string; type: EntityType }
export interface EntityDictionary { entries: EntityDictionaryEntry[] }

// inside interface OfficerApi:
  resolveEntity(input: { type: EntityType; name: string }): Promise<EntityCard | null>
  entityDictionary(): Promise<EntityDictionary>
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: passes (no errors in main/preload). If `npm run typecheck` does not exist, run `npx tsc -p tsconfig.node.json --noEmit`.

- [ ] **Step 9: Commit**

```bash
git add src/main/entities/service.ts src/main/entities/service.test.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(entities): EntityService + entity:resolve/entity:dictionary IPC"
```

---

### Task 4: rehypeEntityLinks plugin (renderer, pure HAST)

**Files:**
- Create: `src/renderer/src/components/rehypeEntityLinks.ts`
- Test: `src/renderer/src/components/rehypeEntityLinks.test.ts`

**Interfaces:**
- Consumes: `EntityDictionary`, `EntityType` from `../../../preload/index.d` (import type only) — or redeclare a local minimal type to avoid cross-package import friction (see note). Uses `visit`, `SKIP` from `unist-util-visit`; `Root`, `Text`, `Element` from `hast`.
- Produces: `rehypeEntityLinks(opts: { dictionary: EntityDictionary }): (tree: Root) => void`. Wraps:
  - **Marker syntax** `[[type:Name]]` where `type ∈ {skill,trait,item}` → entity span (always).
  - **Bare text** exactly matching a dictionary name on whole-token boundaries, longest-first → entity span.
  - Output span: `{ className: ['axi-entity', 'axi-entity--<type>'], 'data-entity-type': type, 'data-entity-name': name }` with a single text child of the matched label.
  - Skips text inside `a`, `code`, `pre`, and heading (`h1`–`h6`) parents, and never re-processes generated spans.

Note on the dictionary type import: to avoid importing from the preload `.d.ts`, declare a local copy at the top of the plugin file:
```ts
type EntityType = 'skill' | 'trait' | 'item'
interface EntityDictionaryEntry { name: string; type: EntityType }
interface EntityDictionary { entries: EntityDictionaryEntry[] }
```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/components/rehypeEntityLinks.test.ts
import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { rehypeEntityLinks } from './rehypeEntityLinks'

const dict = {
  entries: [
    { name: 'Superior Rune of the Monk', type: 'item' as const },
    { name: 'Lily of the Elon', type: 'skill' as const },
    { name: 'Shelter', type: 'skill' as const },
    { name: 'Rune', type: 'item' as const }
  ]
}

function run(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeEntityLinks, { dictionary: dict })
      .use(rehypeStringify)
      .processSync(html)
  )
}

describe('rehypeEntityLinks — marker pass', () => {
  it('wraps [[skill:Shelter]] into an entity span', () => {
    expect(run('<p>Use [[skill:Shelter]] now</p>')).toContain(
      '<span class="axi-entity axi-entity--skill" data-entity-type="skill" data-entity-name="Shelter">Shelter</span>'
    )
  })
})

describe('rehypeEntityLinks — text pass', () => {
  it('wraps a bare exact name match', () => {
    expect(run('<p>Cast Shelter here</p>')).toContain('data-entity-name="Shelter"')
  })
  it('prefers the longest match', () => {
    const out = run('<p>Superior Rune of the Monk rocks</p>')
    expect(out).toContain('data-entity-name="Superior Rune of the Monk"')
    expect(out).not.toContain('>Rune</span>')
  })
  it('does not match inside a word (token boundary)', () => {
    expect(run('<p>Sheltered units</p>')).not.toContain('axi-entity')
  })
  it('is case-sensitive', () => {
    expect(run('<p>take shelter</p>')).not.toContain('axi-entity')
  })
  it('skips text inside code and anchors', () => {
    expect(run('<p><code>Shelter</code> and <a href="x">Shelter</a></p>')).not.toContain('axi-entity')
  })
  it('does not double-wrap an existing entity span', () => {
    const once = run('<p>Shelter</p>')
    expect(run(once)).toBe(once.replace(/<\/?html>|<\/?head>|<\/?body>/g, ''))
  })
})
```

If `rehype-parse`/`rehype-stringify`/`unified` are not already dev dependencies, install them: `npm i -D unified rehype-parse rehype-stringify`. (They are standard companions of the rehype plugins already in use.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/rehypeEntityLinks.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./rehypeEntityLinks`.

- [ ] **Step 3: Write the plugin**

```ts
// src/renderer/src/components/rehypeEntityLinks.ts
import { visit, SKIP } from 'unist-util-visit'
import type { Root, Text, Element, ElementContent } from 'hast'

type EntityType = 'skill' | 'trait' | 'item'
interface EntityDictionaryEntry { name: string; type: EntityType }
interface EntityDictionary { entries: EntityDictionaryEntry[] }

const SKIP_PARENTS = new Set(['a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const MARKER = /\[\[(skill|trait|item):([^\]]+)\]\]/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function entitySpan(type: EntityType, name: string, label: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['axi-entity', `axi-entity--${type}`],
      'data-entity-type': type,
      'data-entity-name': name
    },
    children: [{ type: 'text', value: label }]
  }
}

export function rehypeEntityLinks(opts: { dictionary: EntityDictionary }) {
  // Longest-first so the alternation prefers the longest name; entries are pre-sorted but re-sort defensively.
  const entries = [...opts.dictionary.entries].sort((a, b) => b.name.length - a.name.length)
  const byName = new Map(entries.map((e) => [e.name, e.type]))
  const textRe =
    entries.length > 0
      ? new RegExp(`(?<![\\w])(${entries.map((e) => escapeRe(e.name)).join('|')})(?![\\w])`, 'g')
      : null

  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return
      if (parent.type === 'element' && SKIP_PARENTS.has((parent as Element).tagName)) return

      const out: ElementContent[] = []
      let cursor = 0
      const value = node.value

      // Marker pass takes priority: split the text on [[type:Name]] first, then run the
      // text matcher only on the plain segments between markers.
      MARKER.lastIndex = 0
      let m: RegExpExecArray | null
      let lastMarkerEnd = 0
      const segments: Array<{ text: string } | { marker: [EntityType, string] }> = []
      while ((m = MARKER.exec(value))) {
        if (m.index > lastMarkerEnd) segments.push({ text: value.slice(lastMarkerEnd, m.index) })
        segments.push({ marker: [m[1] as EntityType, m[2].trim()] })
        lastMarkerEnd = m.index + m[0].length
      }
      if (lastMarkerEnd < value.length) segments.push({ text: value.slice(lastMarkerEnd) })

      let changed = false
      for (const seg of segments) {
        if ('marker' in seg) {
          out.push(entitySpan(seg.marker[0], seg.marker[1], seg.marker[1]))
          changed = true
          continue
        }
        if (!textRe) {
          out.push({ type: 'text', value: seg.text })
          continue
        }
        textRe.lastIndex = 0
        cursor = 0
        let tm: RegExpExecArray | null
        let segChanged = false
        while ((tm = textRe.exec(seg.text))) {
          const name = tm[1]
          const type = byName.get(name)
          if (!type) continue
          if (tm.index > cursor) out.push({ type: 'text', value: seg.text.slice(cursor, tm.index) })
          out.push(entitySpan(type, name, name))
          cursor = tm.index + name.length
          segChanged = true
        }
        if (segChanged) {
          if (cursor < seg.text.length) out.push({ type: 'text', value: seg.text.slice(cursor) })
          changed = true
        } else {
          out.push({ type: 'text', value: seg.text })
        }
      }

      if (!changed) return
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/rehypeEntityLinks.test.ts --maxWorkers=2`
Expected: PASS (all cases). If the "does not double-wrap" test is brittle on the html/body wrapper, assert instead that re-running the plugin on an entity span's parse yields no nested `axi-entity` inside `axi-entity` (count occurrences stays 1).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/rehypeEntityLinks.ts src/renderer/src/components/rehypeEntityLinks.test.ts
git commit -m "feat(entities): rehypeEntityLinks plugin (markers + conservative text match)"
```

---

### Task 5: Hover card renderer + renderRichSpan extension + CSS

**Files:**
- Create: `src/renderer/src/components/entityCard.ts` (pure HTML builder)
- Create: `src/renderer/src/components/entityHover.ts` (delegated hover/click controller)
- Test: `src/renderer/src/components/entityCard.test.ts`
- Modify: `src/renderer/src/components/richSpan.tsx` (handle `axi-entity`)
- Modify: `src/renderer/src/theme.css` (entity link + card styles)

**Interfaces:**
- Consumes: `EntityCard` type (local copy or `import type` from preload `.d.ts`); `window.officer.resolveEntity`.
- Produces:
  - `renderEntityCardHtml(card: EntityCard): string` — HTML string for the hover card (icon/name/subtitle/facts/footer link). `renderEntitySkeletonHtml(): string` — loading skeleton. `renderEntityEmptyHtml(name: string): string` — the "no data" state.
  - `createEntityHover(host: HTMLElement): { destroy(): void }` — delegates `mouseover`/`mouseout`/`click` on `.axi-entity` descendants; resolves via IPC with an in-memory `Map` cache; positions a floating card element; click opens `window.open(card?.wikiUrl ?? wikiSearchUrl(name), '_blank', 'noopener')`.
  - `ClassTag`-style rendering: `renderRichSpan` returns an inert `<span class="axi-entity ...">` element carrying the data attributes (hover is wired by `createEntityHover`, not React).

- [ ] **Step 1: Write the failing test for the pure card builders**

```ts
// src/renderer/src/components/entityCard.test.ts
import { describe, it, expect } from 'vitest'
import { renderEntityCardHtml, renderEntityEmptyHtml } from './entityCard'

describe('renderEntityCardHtml', () => {
  it('includes the name, subtitle, each fact, and the wiki link', () => {
    const html = renderEntityCardHtml({
      type: 'skill', name: 'Shelter', subtitle: 'Skill',
      facts: [{ label: 'Recharge', value: '30s' }], wikiUrl: 'https://wiki.guildwars2.com/wiki/Shelter'
    })
    expect(html).toContain('Shelter')
    expect(html).toContain('Skill')
    expect(html).toContain('Recharge')
    expect(html).toContain('30s')
    expect(html).toContain('https://wiki.guildwars2.com/wiki/Shelter')
  })
  it('escapes HTML in the name to prevent injection', () => {
    const html = renderEntityCardHtml({
      type: 'item', name: '<img src=x>', subtitle: 'Item', facts: [], wikiUrl: 'https://x'
    })
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;img')
  })
})

describe('renderEntityEmptyHtml', () => {
  it('shows a no-data message with the escaped name', () => {
    expect(renderEntityEmptyHtml('Shelter')).toContain('Shelter')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/entityCard.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./entityCard`.

- [ ] **Step 3: Write the card builders**

```ts
// src/renderer/src/components/entityCard.ts
export type EntityType = 'skill' | 'trait' | 'item'
export interface EntityFact { label: string; value?: string }
export interface EntityCard {
  type: EntityType
  name: string
  icon?: string
  subtitle?: string
  description?: string
  facts: EntityFact[]
  wikiUrl: string
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

export function renderEntitySkeletonHtml(): string {
  return `<div class="axi-ecard axi-ecard--loading">
    <div class="axi-ecard__row m"></div><div class="axi-ecard__row"></div><div class="axi-ecard__row s"></div>
  </div>`
}

export function renderEntityEmptyHtml(name: string): string {
  return `<div class="axi-ecard"><div class="axi-ecard__body">No data for ${esc(name)}.</div></div>`
}

export function renderEntityCardHtml(card: EntityCard): string {
  const icon = card.icon ? `<img class="axi-ecard__icon" src="${esc(card.icon)}" alt="" />` : `<span class="axi-ecard__icon axi-ecard__icon--${card.type}"></span>`
  const desc = card.description ? `<p class="axi-ecard__desc">${esc(card.description)}</p>` : ''
  const facts = card.facts.length
    ? `<ul class="axi-ecard__facts">${card.facts
        .map((f) => `<li><span class="axi-ecard__dot"></span><span>${f.label ? esc(f.label) + ': ' : ''}<b>${esc(f.value ?? '')}</b></span></li>`)
        .join('')}</ul>`
    : ''
  return `<div class="axi-ecard axi-ecard--${card.type}">
    <div class="axi-ecard__hd">${icon}<div><div class="axi-ecard__nm">${esc(card.name)}</div><div class="axi-ecard__ty">${esc(card.subtitle ?? '')}</div></div></div>
    <div class="axi-ecard__body">${desc}${facts}</div>
    <div class="axi-ecard__ft"><a href="${esc(card.wikiUrl)}" target="_blank" rel="noopener noreferrer">Open wiki ↗</a></div>
  </div>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/entityCard.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Write the hover controller (no unit test — DOM/IPC integration, verified in-app)**

```ts
// src/renderer/src/components/entityHover.ts
import type { EntityCard, EntityType } from './entityCard'
import { renderEntityCardHtml, renderEntitySkeletonHtml, renderEntityEmptyHtml } from './entityCard'

function wikiSearchUrl(name: string): string {
  return `https://wiki.guildwars2.com/index.php?search=${encodeURIComponent(name)}`
}

export function createEntityHover(host: HTMLElement): { destroy(): void } {
  const cache = new Map<string, EntityCard | null>()
  const pop = document.createElement('div')
  pop.className = 'axi-ecard-pop'
  pop.style.position = 'fixed'
  pop.style.zIndex = '9999'
  pop.style.display = 'none'
  document.body.appendChild(pop)

  function place(target: HTMLElement): void {
    const r = target.getBoundingClientRect()
    pop.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`
    pop.style.top = `${r.bottom + 6}px`
  }

  function find(e: Event): HTMLElement | null {
    const el = (e.target as HTMLElement)?.closest?.('.axi-entity')
    return el instanceof HTMLElement ? el : null
  }

  async function show(el: HTMLElement): Promise<void> {
    const type = el.dataset.entityType as EntityType | undefined
    const name = el.dataset.entityName
    if (!type || !name) return
    const key = `${type}:${name}`
    place(el)
    pop.style.display = 'block'
    if (cache.has(key)) {
      const card = cache.get(key) ?? null
      pop.innerHTML = card ? renderEntityCardHtml(card) : renderEntityEmptyHtml(name)
      return
    }
    pop.innerHTML = renderEntitySkeletonHtml()
    const card = await window.officer.resolveEntity({ type, name })
    if (card) cache.set(key, card) // do not cache misses
    if (pop.style.display === 'none') return // hidden while awaiting
    pop.innerHTML = card ? renderEntityCardHtml(card) : renderEntityEmptyHtml(name)
  }

  const onOver = (e: Event): void => { const el = find(e); if (el) void show(el) }
  const onOut = (e: Event): void => {
    const el = find(e)
    if (el && !pop.contains((e as MouseEvent).relatedTarget as Node)) pop.style.display = 'none'
  }
  const onClick = (e: Event): void => {
    const el = find(e)
    if (!el) return
    const name = el.dataset.entityName ?? ''
    const type = el.dataset.entityType as EntityType
    const key = `${type}:${name}`
    const url = cache.get(key)?.wikiUrl ?? wikiSearchUrl(name)
    window.open(url, '_blank', 'noopener')
  }

  host.addEventListener('mouseover', onOver)
  host.addEventListener('mouseout', onOut)
  host.addEventListener('click', onClick)

  return {
    destroy(): void {
      host.removeEventListener('mouseover', onOver)
      host.removeEventListener('mouseout', onOut)
      host.removeEventListener('click', onClick)
      pop.remove()
    }
  }
}
```

- [ ] **Step 6: Extend `renderRichSpan` in `src/renderer/src/components/richSpan.tsx`**

Add a branch before the fallback `return` (after the existing `axi-classicon` check):

```tsx
  if (classes.includes('axi-entity')) {
    const type = data['data-entity-type']
    const name = data['data-entity-name']
    if (typeof type === 'string' && typeof name === 'string') {
      return (
        <span className={className} data-entity-type={type} data-entity-name={name}>
          {children}
        </span>
      )
    }
  }
```

- [ ] **Step 7: Add CSS to `src/renderer/src/theme.css`**

```css
/* --- Entity autolinks --- */
.axi-entity {
  display: inline-flex; align-items: baseline; gap: 0.28em;
  border-bottom: 1px dotted currentColor; cursor: pointer;
  border-radius: 3px; padding-bottom: 1px; transition: background 0.12s;
}
.axi-entity::before {
  content: ''; width: 1em; height: 1em; border-radius: 3px; align-self: center; flex: 0 0 auto;
}
.axi-entity:hover { background: rgba(255, 255, 255, 0.05); }
.axi-entity--skill { color: #5aa7ff; }
.axi-entity--skill::before { background: linear-gradient(135deg, #5aa7ff, #2b6fd6); }
.axi-entity--trait { color: #b07cff; }
.axi-entity--trait::before { background: linear-gradient(135deg, #b07cff, #7d4ad6); border-radius: 50%; }
.axi-entity--item { color: #e0a44a; }
.axi-entity--item::before { background: linear-gradient(135deg, #e0a44a, #b5792a); }

/* --- Hover card --- */
.axi-ecard-pop { width: 300px; }
.axi-ecard {
  background: #171a21; border: 1px solid #262b36; border-radius: 10px;
  overflow: hidden; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); color: #cdd3df;
  font-size: 13.5px; line-height: 1.5;
}
.axi-ecard__hd { display: flex; gap: 11px; align-items: center; padding: 13px 14px; border-bottom: 1px solid #262b36; }
.axi-ecard__icon { width: 38px; height: 38px; border-radius: 7px; flex: 0 0 auto; }
.axi-ecard__icon--skill { background: linear-gradient(135deg, #5aa7ff, #2b6fd6); }
.axi-ecard__icon--trait { background: linear-gradient(135deg, #b07cff, #7d4ad6); }
.axi-ecard__icon--item { background: linear-gradient(135deg, #e0a44a, #b5792a); }
.axi-ecard__nm { font-weight: 600; color: #eef1f6; font-size: 15px; }
.axi-ecard__ty { font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: #7e8696; margin-top: 2px; }
.axi-ecard__body { padding: 12px 14px; color: #7e8696; }
.axi-ecard__desc { margin: 0 0 8px; }
.axi-ecard__facts { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
.axi-ecard__facts li { display: flex; gap: 8px; align-items: baseline; }
.axi-ecard__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; transform: translateY(-2px); }
.axi-ecard__facts b { color: #cdd3df; font-weight: 600; }
.axi-ecard__ft { padding: 10px 14px; border-top: 1px solid #262b36; }
.axi-ecard__ft a { color: #e0a44a; text-decoration: none; }
.axi-ecard--loading { padding: 14px; }
.axi-ecard__row { height: 11px; border-radius: 5px; margin-bottom: 9px; background: linear-gradient(90deg, #20242e, #2b313d, #20242e); background-size: 200% 100%; animation: axi-ecard-sh 1.1s infinite; }
.axi-ecard__row.s { width: 55%; } .axi-ecard__row.m { width: 80%; }
@keyframes axi-ecard-sh { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

- [ ] **Step 8: Typecheck + tests**

Run: `npm run typecheck && npx vitest run src/renderer/src/components/entityCard.test.ts --maxWorkers=2`
Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/entityCard.ts src/renderer/src/components/entityCard.test.ts src/renderer/src/components/entityHover.ts src/renderer/src/components/richSpan.tsx src/renderer/src/theme.css
git commit -m "feat(entities): hover card builders, delegated hover controller, span + CSS"
```

---

### Task 6: Wire into Article rendering + in-app verification

**Files:**
- Create: `src/renderer/src/components/useEntityDictionary.ts` (hook)
- Modify: `src/renderer/src/components/Article.tsx` (load dictionary, add plugin, bind hover)

**Interfaces:**
- Consumes: `window.officer.entityDictionary`; `rehypeEntityLinks` (Task 4); `createEntityHover` (Task 5); existing `ReactMarkdown` setup.
- Produces: a configured `rehypeEntityLinks` in the `rehypePlugins` arrays, and a `createEntityHover(container)` bound to the article's root element via a `ref` + `useEffect`.

- [ ] **Step 1: Write the dictionary hook**

```tsx
// src/renderer/src/components/useEntityDictionary.ts
import { useEffect, useState } from 'react'

type EntityType = 'skill' | 'trait' | 'item'
export interface EntityDictionary { entries: { name: string; type: EntityType }[] }

const EMPTY: EntityDictionary = { entries: [] }

export function useEntityDictionary(): EntityDictionary {
  const [dict, setDict] = useState<EntityDictionary>(EMPTY)
  useEffect(() => {
    let alive = true
    void window.officer.entityDictionary().then((d) => { if (alive) setDict(d ?? EMPTY) })
    return () => { alive = false }
  }, [])
  return dict
}
```

- [ ] **Step 2: Modify `Article.tsx` — imports**

Add near the other component imports:

```tsx
import { rehypeEntityLinks } from './rehypeEntityLinks'
import { createEntityHover } from './entityHover'
import { useEntityDictionary } from './useEntityDictionary'
import { useEffect, useRef } from 'react'
```

(Merge `useEffect`/`useRef` into the existing `react` import rather than duplicating it.)

- [ ] **Step 3: Modify `Article.tsx` — configure plugin + bind hover**

Inside the `Article` component body, before the return:

```tsx
  const dict = useEntityDictionary()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!rootRef.current) return
    const hover = createEntityHover(rootRef.current)
    return () => hover.destroy()
  }, [])
  const entityPlugin: [typeof rehypeEntityLinks, { dictionary: typeof dict }] = [
    rehypeEntityLinks,
    { dictionary: dict }
  ]
```

Attach `ref={rootRef}` to the outermost article container element returned by the component.

Then add `entityPlugin` to BOTH `rehypePlugins` arrays (lede ~line 168 and body ~line 202):

```tsx
  rehypePlugins={[rehypeEmojiIcons, rehypeClassIcons, entityPlugin]}
```

Note: the hover controller is bound once on mount; because it uses event delegation on the root, it automatically covers entity spans added on later re-renders. The plugin re-runs with the latest `dict` on each render, so links light up once the dictionary resolves.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Manual in-app verification**

Run: `npm run dev`

Verify in the running app:
1. Render an article/chat message containing a known skill (e.g. "Shelter"), a marker (`[[trait:Zeal]]`), and a catalog item name. Each shows a colored icon + dotted underline.
2. Hover a link → skeleton appears, then a card with name/subtitle/facts and "Open wiki ↗".
3. Re-hover the same link → card appears instantly (cached, no skeleton).
4. Click a link → GW2 Wiki opens in the system browser.
5. Confirm no false positives in ordinary prose (the conservative matcher should not light up common words).

If any check fails, debug with superpowers:systematic-debugging before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/useEntityDictionary.ts src/renderer/src/components/Article.tsx
git commit -m "feat(entities): wire entity autolinks + hover into Article rendering"
```

---

## Self-Review Notes

- **Spec coverage:** resolution IPC + LRU (Task 3), dictionary build from catalog + GW2 API (Tasks 2–3), hybrid marker+text detection (Task 4), lazy-resolve-on-hover + cache + skeleton (Task 5), icon+underline visual + click→external wiki (Tasks 5–6), item card reuse vs. skill/trait card (Task 5 uses one unified card builder fed by type-specific normalizers — acceptable simplification of the spec's "items reuse forge-render card"; revisit only if the visual diverges). Locations excluded per spec.
- **Not-found fallback:** inline link still renders (plugin is independent of resolve); click falls back to `wikiSearchUrl` (Task 5 `onClick`). Misses are not cached (Tasks 3 + 5).
- **Type consistency:** `EntityCard`/`EntityType`/`EntityDictionary` shapes are identical across main (`types.ts`), preload (`index.d.ts`), and the renderer local copies (`entityCard.ts`, plugin, hook). Keep them in sync if edited.
