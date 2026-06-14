# Meta Extraction Slice 2 — Snowcrows Static Extractor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Snowcrows builds via static HTML fetch — parse the GW2-Armory data attributes, resolve ids → names via the public GW2 API, and assemble a structured build doc — so Snowcrows enters the corpus without a browser.

**Architecture:** A new `kind: 'static'` source method dispatched from the fetcher to a self-contained `meta/snowcrows.ts`: pure parsers (`parseArmory`/`extractHrefs`/`pickBuildLinks`/`assembleBuildDoc`), a cached GW2-API resolver (`resolveArmoryNames`), and a fetch-based crawler (`fetchSnowcrowsStatic`) returning the existing `FetchResult`. Structured-only (prose is not in the static HTML).

**Tech Stack:** Electron main, TS, public GW2 API (`/v2/{items,itemstats,skills,specializations,traits}`), vitest. No new deps (regex parsing; `jsdom` is dev-only).

**Spec:** `docs/superpowers/specs/2026-06-14-meta-extract-slice2-snowcrows-design.md`

**Verified facts:** Snowcrows build HTML is server-fetchable (200) with `data-armory-embed="items|skills|specializations|traits"` + `data-armory-ids` + per-item `data-armory-<id>-stat`/`-upgrades` + per-spec `data-armory-<id>-traits`. GW2 API resolves ids→names server-side with no key.

---

## File Structure
- Create `src/main/meta/snowcrows.ts` — all Snowcrows static logic (pure parsers + resolver + crawler).
- Create `src/main/meta/snowcrows.test.ts`.
- Modify `src/main/meta/fetcher.ts` — dispatch `kind === 'static'`.
- Modify `src/main/meta/sources.ts` (+`sources.test.ts`) — `kind` union + Snowcrows config.

Run tests with `npx vitest run <path> --maxWorkers=2` (never exceed 2).

---

### Task 1: Pure parsers — `parseArmory` / `extractHrefs` / `pickBuildLinks`

**Files:**
- Create: `src/main/meta/snowcrows.ts`
- Test: `src/main/meta/snowcrows.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
// src/main/meta/snowcrows.test.ts
import { describe, it, expect } from 'vitest'
import { parseArmory, extractHrefs, pickBuildLinks } from './snowcrows'

const ITEM = '<div data-armory-embed="items" data-armory-ids="48081" data-armory-48081-stat="1077" data-armory-48081-upgrades="74978"></div>'
const SPEC = '<div data-armory-embed="specializations" data-armory-ids="31" data-armory-31-traits="296,334,1510"></div>'
const SKILLS = '<div data-armory-embed="skills" data-armory-ids="5503,40183,5503"></div>'

describe('parseArmory', () => {
  it('parses items (id+stat+upgrades), specs (id+traits), skills (deduped)', () => {
    const p = parseArmory(ITEM + SPEC + SKILLS)
    expect(p.items).toEqual([{ id: 48081, statId: 1077, upgradeIds: [74978] }])
    expect(p.specs).toEqual([{ id: 31, traitIds: [296, 334, 1510] }])
    expect(p.skills).toEqual([5503, 40183]) // deduped, order preserved
  })
  it('dedupes repeated item embeds by id', () => {
    const p = parseArmory(ITEM + ITEM)
    expect(p.items).toHaveLength(1)
  })
  it('handles missing stat/upgrades', () => {
    const p = parseArmory('<div data-armory-embed="items" data-armory-ids="999"></div>')
    expect(p.items).toEqual([{ id: 999, statId: null, upgradeIds: [] }])
  })
})

describe('extractHrefs', () => {
  it('resolves relative + absolute hrefs against the base', () => {
    const html = '<a href="/builds/raids/x">a</a><a href="https://snowcrows.com/builds/wvw/y">b</a>'
    expect(extractHrefs(html, 'https://snowcrows.com/builds/raids')).toEqual([
      'https://snowcrows.com/builds/raids/x',
      'https://snowcrows.com/builds/wvw/y'
    ])
  })
})

describe('pickBuildLinks', () => {
  it('keeps same-origin /builds/ pages, drops the landing + dupes + off-site + non-build', () => {
    const links = pickBuildLinks(
      [
        'https://snowcrows.com/builds/raids',            // landing — drop
        'https://snowcrows.com/builds/raids/ele/weaver', // keep
        'https://snowcrows.com/builds/raids/ele/weaver', // dup — drop
        'https://snowcrows.com/guides/intro',            // non-build — drop
        'https://discord.gg/x'                            // off-site — drop
      ],
      'https://snowcrows.com/builds/raids',
      10
    )
    expect(links).toEqual(['https://snowcrows.com/builds/raids/ele/weaver'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/snowcrows.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** (start `src/main/meta/snowcrows.ts`):
```ts
// src/main/meta/snowcrows.ts
//
// Snowcrows static extractor. Snowcrows' build data is client-API-rendered (fails
// headless) but the build is fully encoded in the server HTML as GW2-Armory data
// attributes. We fetch the HTML, parse the armory embeds, resolve ids -> names via
// the public GW2 API, and assemble a structured build doc (no prose — it isn't in
// the static HTML). Pure parsers are unit-tested; the network crawl is smoke-tested.
import type { FetchResult, FetchedPage } from './fetcher'

const SCRAPE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface ArmoryItem {
  id: number
  statId: number | null
  upgradeIds: number[]
}
export interface ParsedArmory {
  items: ArmoryItem[]
  skills: number[]
  specs: Array<{ id: number; traitIds: number[] }>
}

const intList = (s: string | undefined): number[] =>
  (s ?? '')
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n))

export function parseArmory(html: string): ParsedArmory {
  const items: ArmoryItem[] = []
  const skills: number[] = []
  const specs: Array<{ id: number; traitIds: number[] }> = []
  const tagRe = /<[^>]*\bdata-armory-embed="(items|skills|specializations|traits)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0]
    const type = m[1].toLowerCase()
    const ids = intList(/\bdata-armory-ids="([^"]*)"/i.exec(tag)?.[1])
    if (type === 'skills') {
      for (const id of ids) if (!skills.includes(id)) skills.push(id)
    } else if (type === 'specializations') {
      for (const id of ids) {
        if (specs.some((s) => s.id === id)) continue
        const traitIds = intList(new RegExp(`\\bdata-armory-${id}-traits="([^"]*)"`, 'i').exec(tag)?.[1])
        specs.push({ id, traitIds })
      }
    } else if (type === 'items') {
      for (const id of ids) {
        if (items.some((i) => i.id === id)) continue
        const statRaw = new RegExp(`\\bdata-armory-${id}-stat="([^"]*)"`, 'i').exec(tag)?.[1]
        const statId = statRaw && Number.isFinite(parseInt(statRaw, 10)) ? parseInt(statRaw, 10) : null
        const upgradeIds = intList(new RegExp(`\\bdata-armory-${id}-upgrades="([^"]*)"`, 'i').exec(tag)?.[1])
        items.push({ id, statId, upgradeIds })
      }
    }
    // standalone `traits` embeds are ignored — selected traits come from specs.
  }
  return { items, skills, specs }
}

function normKey(u: string): string | null {
  try {
    const x = new URL(u)
    return (x.origin + x.pathname).replace(/\/$/, '')
  } catch {
    return null
  }
}

export function extractHrefs(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const re = /href="([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(new URL(m[1], baseUrl).href)
    } catch {
      /* skip bad href */
    }
  }
  return out
}

export function pickBuildLinks(hrefs: string[], landingUrl: string, max: number): string[] {
  const landing = normKey(landingUrl)
  let origin = ''
  try {
    origin = new URL(landingUrl).origin
  } catch {
    /* leave empty */
  }
  const seen = new Set<string>(landing ? [landing] : [])
  const out: string[] = []
  for (const h of hrefs) {
    let u: URL
    try {
      u = new URL(h)
    } catch {
      continue
    }
    if (origin && u.origin !== origin) continue
    if (!u.pathname.includes('/builds/')) continue
    const key = (u.origin + u.pathname).replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= max) break
  }
  return out
}
```
(`SCRAPE_UA` and `FetchedPage`/`FetchResult` are used by later tasks in this file; the type-only import of fetcher avoids a runtime import cycle.)

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/snowcrows.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/snowcrows.ts src/main/meta/snowcrows.test.ts
git commit -m "feat(meta): snowcrows armory parsers (parseArmory/extractHrefs/pickBuildLinks)"
```

---

### Task 2: GW2-API name resolver — `resolveArmoryNames`

**Files:**
- Modify: `src/main/meta/snowcrows.ts`
- Test: `src/main/meta/snowcrows.test.ts`

- [ ] **Step 1: Write the failing test** (append):
```ts
import { resolveArmoryNames, __resetArmoryCache, type FetchLike } from './snowcrows'
import { beforeEach, vi } from 'vitest'

beforeEach(() => __resetArmoryCache())

function fakeFetch(map: Record<string, unknown[]>): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const fn = (async (url: string) => {
    calls.push(url)
    const endpoint = new URL(url).pathname.split('/').pop() as string
    return { ok: true, json: async () => map[endpoint] ?? [], text: async () => '' }
  }) as FetchLike & { calls: string[] }
  fn.calls = calls
  return fn
}

describe('resolveArmoryNames', () => {
  const parsed = { items: [{ id: 48081, statId: 1077, upgradeIds: [74978] }], skills: [5503], specs: [{ id: 31, traitIds: [296] }] }
  it('resolves ids to names per endpoint', async () => {
    const f = fakeFetch({
      items: [{ id: 48081, name: "Zojja's Masque" }, { id: 74978, name: 'Sigil of Force' }],
      itemstats: [{ id: 1077, name: "Berserker's" }],
      skills: [{ id: 5503, name: 'Fire Attunement' }],
      specializations: [{ id: 31, name: 'Fire' }],
      traits: [{ id: 296, name: 'Empowering Flame' }]
    })
    const n = await resolveArmoryNames(parsed, f)
    expect(n.items[48081]).toBe("Zojja's Masque")
    expect(n.items[74978]).toBe('Sigil of Force')
    expect(n.itemstats[1077]).toBe("Berserker's")
    expect(n.skills[5503]).toBe('Fire Attunement')
    expect(n.specs[31]).toBe('Fire')
    expect(n.traits[296]).toBe('Empowering Flame')
  })
  it('caches across calls (no refetch of known ids)', async () => {
    const f = fakeFetch({ items: [{ id: 48081, name: 'X' }, { id: 74978, name: 'Y' }], itemstats: [{ id: 1077, name: 'Z' }], skills: [{ id: 5503, name: 'S' }], specializations: [{ id: 31, name: 'F' }], traits: [{ id: 296, name: 'T' }] })
    await resolveArmoryNames(parsed, f)
    const before = f.calls.length
    await resolveArmoryNames(parsed, f)
    expect(f.calls.length).toBe(before) // fully cached
  })
  it('falls back to the id string when a batch fails', async () => {
    const f = (async () => ({ ok: false, json: async () => [], text: async () => '' })) as FetchLike
    const n = await resolveArmoryNames(parsed, f)
    expect(n.skills[5503]).toBe('5503')
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/snowcrows.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** (append to `snowcrows.ts`):
```ts
export type FetchLike = (
  url: string
) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>

export interface ArmoryNames {
  items: Record<number, string>
  itemstats: Record<number, string>
  skills: Record<number, string>
  specs: Record<number, string>
  traits: Record<number, string>
}

const defaultFetch: FetchLike = (url) => fetch(url, { headers: { 'User-Agent': 'AxiVale' } })

const ENDPOINTS = ['items', 'itemstats', 'skills', 'specializations', 'traits'] as const
const nameCaches: Record<string, Map<number, string>> = Object.fromEntries(
  ENDPOINTS.map((e) => [e, new Map<number, string>()])
)
export function __resetArmoryCache(): void {
  for (const e of ENDPOINTS) nameCaches[e].clear()
}

async function resolveType(endpoint: string, ids: number[], fetchImpl: FetchLike): Promise<Record<number, string>> {
  const cache = nameCaches[endpoint]
  const out: Record<number, string> = {}
  const need: number[] = []
  for (const id of ids) {
    if (cache.has(id)) out[id] = cache.get(id)!
    else if (!need.includes(id)) need.push(id)
  }
  for (let i = 0; i < need.length; i += 200) {
    const batch = need.slice(i, i + 200)
    try {
      const res = await fetchImpl(`https://api.guildwars2.com/v2/${endpoint}?ids=${batch.join(',')}&lang=en`)
      if (!res.ok) throw new Error(`gw2 ${endpoint}`)
      const arr = (await res.json()) as Array<{ id: number; name?: string }>
      for (const e of arr) {
        const name = e.name || String(e.id)
        cache.set(e.id, name)
        out[e.id] = name
      }
    } catch {
      /* batch failed — leave these ids to the id-string fallback below */
    }
  }
  for (const id of ids) if (out[id] === undefined) out[id] = String(id)
  return out
}

export async function resolveArmoryNames(
  parsed: ParsedArmory,
  fetchImpl: FetchLike = defaultFetch
): Promise<ArmoryNames> {
  const itemIds = [...new Set([...parsed.items.map((i) => i.id), ...parsed.items.flatMap((i) => i.upgradeIds)])]
  const statIds = [...new Set(parsed.items.map((i) => i.statId).filter((n): n is number => n != null))]
  const traitIds = [...new Set(parsed.specs.flatMap((s) => s.traitIds))]
  const [items, itemstats, skills, specs, traits] = await Promise.all([
    resolveType('items', itemIds, fetchImpl),
    resolveType('itemstats', statIds, fetchImpl),
    resolveType('skills', parsed.skills, fetchImpl),
    resolveType('specializations', parsed.specs.map((s) => s.id), fetchImpl),
    resolveType('traits', traitIds, fetchImpl)
  ])
  return { items, itemstats, skills, specs, traits }
}
```

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/snowcrows.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/snowcrows.ts src/main/meta/snowcrows.test.ts
git commit -m "feat(meta): snowcrows GW2-API name resolver (cached, batched, fallback)"
```

---

### Task 3: `assembleBuildDoc`

**Files:**
- Modify: `src/main/meta/snowcrows.ts`
- Test: `src/main/meta/snowcrows.test.ts`

- [ ] **Step 1: Write the failing test** (append):
```ts
import { assembleBuildDoc } from './snowcrows'

describe('assembleBuildDoc', () => {
  it('builds a structured doc from parsed + names', () => {
    const parsed = { items: [{ id: 1, statId: 10, upgradeIds: [2] }], skills: [5], specs: [{ id: 31, traitIds: [296] }] }
    const names = {
      items: { 1: 'Helm', 2: 'Sigil of Force' },
      itemstats: { 10: "Berserker's" },
      skills: { 5: 'Fire Attunement' },
      specs: { 31: 'Fire' },
      traits: { 296: 'Empowering Flame' }
    }
    const doc = assembleBuildDoc('Power Weaver', parsed, names)
    expect(doc).toContain('Power Weaver — Snowcrows')
    expect(doc).toContain('Specializations: Fire')
    expect(doc).toContain('Traits: Empowering Flame')
    expect(doc).toContain('Skills: Fire Attunement')
    expect(doc).toContain("Gear: Helm (Berserker's) + Sigil of Force")
  })
  it('omits sections with no resolved data', () => {
    const doc = assembleBuildDoc('X', { items: [], skills: [], specs: [] }, { items: {}, itemstats: {}, skills: {}, specs: {}, traits: {} })
    expect(doc).toBe('X — Snowcrows')
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/snowcrows.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** (append):
```ts
export function assembleBuildDoc(title: string, parsed: ParsedArmory, names: ArmoryNames): string {
  const lines: string[] = [`${title} — Snowcrows`]
  const specNames = parsed.specs.map((s) => names.specs[s.id]).filter(Boolean)
  if (specNames.length) lines.push(`Specializations: ${specNames.join(', ')}`)
  const traitNames = [...new Set(parsed.specs.flatMap((s) => s.traitIds.map((t) => names.traits[t])).filter(Boolean))]
  if (traitNames.length) lines.push(`Traits: ${traitNames.join(', ')}`)
  const skillNames = [...new Set(parsed.skills.map((s) => names.skills[s]).filter(Boolean))]
  if (skillNames.length) lines.push(`Skills: ${skillNames.join(', ')}`)
  const gear = [
    ...new Set(
      parsed.items
        .map((it) => {
          const nm = names.items[it.id]
          if (!nm) return null
          const stat = it.statId != null ? names.itemstats[it.statId] : null
          const ups = it.upgradeIds.map((u) => names.items[u]).filter(Boolean)
          return nm + (stat ? ` (${stat})` : '') + (ups.length ? ` + ${ups.join(', ')}` : '')
        })
        .filter((x): x is string => Boolean(x))
    )
  ]
  if (gear.length) lines.push(`Gear: ${gear.join('; ')}`)
  return lines.join('\n')
}
```

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/meta/snowcrows.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 5: Commit**
```bash
git add src/main/meta/snowcrows.ts src/main/meta/snowcrows.test.ts
git commit -m "feat(meta): snowcrows assembleBuildDoc (structured build text)"
```

---

### Task 4: `fetchSnowcrowsStatic` crawler + fetcher/sources wiring

**Files:**
- Modify: `src/main/meta/snowcrows.ts`, `src/main/meta/fetcher.ts`, `src/main/meta/sources.ts`
- Test: `src/main/meta/snowcrows.test.ts`, `src/main/meta/sources.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `snowcrows.test.ts`:
```ts
import { fetchSnowcrowsStatic } from './snowcrows'

describe('fetchSnowcrowsStatic', () => {
  const buildHtml = '<h1>Power Weaver</h1>' +
    '<div data-armory-embed="specializations" data-armory-ids="31" data-armory-31-traits="296"></div>' +
    '<div data-armory-embed="skills" data-armory-ids="5503"></div>'
  const landingHtml = '<a href="/builds/raids/ele/power-weaver">Power Weaver</a>'

  it('crawls landing -> build page and returns assembled pages', async () => {
    const f = (async (url: string) => ({
      ok: true,
      json: async () => [],
      text: async () => (url.includes('/power-weaver') ? buildHtml : landingHtml)
    })) as FetchLike
    const resolve = async () => ({ items: {}, itemstats: {}, skills: { 5503: 'Fire Attunement' }, specs: { 31: 'Fire' }, traits: { 296: 'Empowering Flame' } })
    const r = await fetchSnowcrowsStatic('https://snowcrows.com/builds/raids', { fetchImpl: f, resolve, crawlDepth: 2 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pages.map((p) => p.url)).toContain('https://snowcrows.com/builds/raids/ele/power-weaver')
      expect(r.pages.find((p) => p.url.includes('power-weaver'))!.text).toContain('Skills: Fire Attunement')
    }
  })

  it('returns {ok:false} when nothing parses', async () => {
    const f = (async () => ({ ok: true, json: async () => [], text: async () => '<p>nothing</p>' })) as FetchLike
    const r = await fetchSnowcrowsStatic('https://snowcrows.com/builds/raids', { fetchImpl: f, resolve: async () => ({ items: {}, itemstats: {}, skills: {}, specs: {}, traits: {} }) })
    expect(r.ok).toBe(false)
  })
})
```
Append to `sources.test.ts`:
```ts
  it('uses the static extractor for Snowcrows', () => {
    const c = configForUrl('https://snowcrows.com/builds/raids')
    expect(c?.kind).toBe('static')
    expect(c?.crawlDepth).toBe(2)
  })
```

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/meta/snowcrows.test.ts src/main/meta/sources.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement the crawler** (append to `snowcrows.ts`):
```ts
const MAX_PAGES = 30
const BUDGET_MS = 120_000

export interface SnowcrowsDeps {
  fetchImpl?: FetchLike
  resolve?: (parsed: ParsedArmory) => Promise<ArmoryNames>
  crawlDepth?: number
  now?: () => number
}

export async function fetchSnowcrowsStatic(url: string, deps: SnowcrowsDeps = {}): Promise<FetchResult> {
  const fetchImpl = deps.fetchImpl ?? ((u: string) => fetch(u, { headers: { 'User-Agent': SCRAPE_UA } }))
  const resolve = deps.resolve ?? ((p: ParsedArmory) => resolveArmoryNames(p, fetchImpl))
  const depth = deps.crawlDepth ?? 2
  const now = deps.now ?? Date.now

  const getHtml = async (u: string): Promise<string | null> => {
    try {
      const r = await fetchImpl(u)
      return r.ok ? await r.text() : null
    } catch {
      return null
    }
  }

  const pages: FetchedPage[] = []
  const visited = new Set<string>()
  const queue: Array<{ url: string; level: number }> = [{ url, level: 0 }]
  const start = now()

  while (queue.length > 0) {
    if (pages.length >= MAX_PAGES || now() - start > BUDGET_MS) break
    const { url: pageUrl, level } = queue.shift()!
    const key = normKey(pageUrl)
    if (key === null || visited.has(key)) continue
    visited.add(key)

    const html = await getHtml(pageUrl)
    if (!html) continue

    const parsed = parseArmory(html)
    if (parsed.items.length || parsed.skills.length || parsed.specs.length) {
      const title = (/<h1[^>]*>([^<]+)<\/h1>/i.exec(html)?.[1] ?? pageUrl).trim()
      const names = await resolve(parsed)
      const text = assembleBuildDoc(title, parsed, names)
      if (text) pages.push({ url: pageUrl, title, text })
    }
    if (level < depth) {
      for (const link of pickBuildLinks(extractHrefs(html, pageUrl), pageUrl, MAX_PAGES)) {
        const k = normKey(link)
        if (k !== null && !visited.has(k)) queue.push({ url: link, level: level + 1 })
      }
    }
  }

  if (pages.length === 0) return { ok: false, error: 'empty' }
  const text = pages.map((p) => p.text).join('\n\n=== build page ===\n\n')
  return { ok: true, text, pages }
}
```

- [ ] **Step 4: Wire the dispatch.** In `src/main/meta/fetcher.ts`, add the import at the top:
```ts
import { fetchSnowcrowsStatic } from './snowcrows'
```
and in `fetchOne`, right after the `if (cfg.kind === 'wiki') return fetchWiki(url, cfg)` line:
```ts
    if (cfg.kind === 'static') return fetchSnowcrowsStatic(url, { crawlDepth: cfg.crawlDepth })
```

- [ ] **Step 5: Update sources.** In `src/main/meta/sources.ts`, widen the `kind` union in the `SourceConfig` interface to `'browser' | 'wiki' | 'static'`, and change the Snowcrows entry to:
```ts
  { host: 'snowcrows.com', kind: 'static', crawlDepth: 2 },
```

- [ ] **Step 6: Run, expect PASS:** `npx vitest run src/main/meta/snowcrows.test.ts src/main/meta/sources.test.ts --maxWorkers=2`; `npm run typecheck`.
- [ ] **Step 7: Commit**
```bash
git add src/main/meta/snowcrows.ts src/main/meta/fetcher.ts src/main/meta/sources.ts src/main/meta/sources.test.ts
git commit -m "feat(meta): snowcrows static crawler + fetcher dispatch (kind: static)"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `npx vitest run --maxWorkers=2` → PASS.
- [ ] **Step 2:** `npm run typecheck` → PASS.
- [ ] **Step 3:** `npm run build` → PASS.
- [ ] **Step 4: Manual smoke (controller).** Dev run → Force re-crawl → Index inspector: Snowcrows now shows build chunks with resolved names ("Power Weaver — Snowcrows / Specializations: … / Gear: … (Berserker's) + …"). `meta_search` for a Snowcrows build returns the structured doc, not `error`.

---

## Self-Review

**Spec coverage:**
- `kind:'static'` + Snowcrows config → Task 4 (sources). ✔
- `parseArmory` (items+stat+upgrades / specs+traits / skills, deduped) → Task 1. ✔
- `extractHrefs` + `pickBuildLinks` (same-origin, /builds/, dedupe, cap) → Task 1. ✔
- `resolveArmoryNames` (batched per endpoint, cached, id-string fallback, injectable fetch) → Task 2. ✔
- `assembleBuildDoc` (structured text, omits empty sections, no raw ids on success) → Task 3. ✔
- `fetchSnowcrowsStatic` crawl (BFS to depth, caps, {ok:false} when empty) + fetcher dispatch → Task 4. ✔
- Structured-only / no prose → inherent (doc is from armory only). ✔
- Error handling (fetch fail → skip; all-empty → error, prior chunks survive; batch fail → id fallback) → Tasks 2/4. ✔
- Tests: pure parsers, resolver (mocked fetch), assembler, crawler (injected fetch+resolve), sources config; real network = smoke → Tasks 1–5. ✔

**Placeholder scan:** none — full code in every step.

**Type consistency:** `ParsedArmory`/`ArmoryItem` (Task 1) consumed by `resolveArmoryNames` (Task 2), `assembleBuildDoc` (Task 3), `fetchSnowcrowsStatic` (Task 4). `ArmoryNames` (Task 2) consumed by Task 3/4. `FetchLike` (Task 2) used by Task 4's deps + tests. `FetchResult`/`FetchedPage` are `import type` from `./fetcher` (no runtime cycle); the fetcher imports `fetchSnowcrowsStatic` one-way. `normKey` is module-private and reused by `pickBuildLinks` + the crawler. `SCRAPE_UA` defined in Task 1, used in Task 4.
