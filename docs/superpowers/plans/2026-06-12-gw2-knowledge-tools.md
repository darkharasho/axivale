# GW2 Knowledge Tools (Meta Sites + Wiki) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec sections **4 (GW2 meta knowledge tools)** and **5 (GW2 wiki tool suite)** of `docs/superpowers/specs/2026-06-12-axiforge-integration-design.md`: live-fetch meta-build knowledge from metabattle / gw2mists / hardstuck / guildjen behind a common `MetaSource` interface with a shared TTL disk cache and per-site failure isolation, plus a GW2 wiki client and tools — exposed as MCP tools `meta_search_builds`, `meta_get_build`, `gw2wiki_search`, `gw2wiki_page`, `gw2wiki_lookup`.

**Working directory:** /var/home/mstephens/Documents/GitHub/axivale

**Architecture:** New `src/main/knowledge/` (shared `DiskCache` with TTL + namespaces, `HttpQueue` throttled fetch — max 3 concurrent with retry, mirroring AxiForge `src/main/gw2Data/fetch.js` and the existing `gw2Client.ts` error style). New `src/main/metaSources/` with `types.ts` defining `MetaSource { search(filters), getBuild(url) }` and a normalized `BuildSummary` (traits, skills, gear, notes, source URL), plus one module per site: `metabattle.ts` (MediaWiki API — **verified live**: `https://metabattle.com/wiki/api.php`, builds live in custom namespace **3000** `Build:`), `hardstuck.ts` + `guildjen.ts` (HTML fetch + regex parse, fixture-driven), `gw2mists.ts` (client-rendered SPA — JSON endpoint **unverified**; designed around fixtures captured at implementation time). New `src/main/wikiClient.ts` against `https://wiki.guildwars2.com/api.php` (same MediaWiki patterns as AxiForge `src/main/gw2Data/wiki.js`, in TypeScript). Tools live in `src/main/tools/meta.ts` and `src/main/tools/wiki.ts` as standalone `build*Tools(deps)` factories composed into `buildOfficerTools()`.

**Tool registration note:** A sibling plan splits `src/main/tools.ts` into `src/main/tools/<module>.ts` composed by `src/main/tools/index.ts:buildOfficerTools()`. **If `src/main/tools/index.ts` exists at execution time**, register the new factories there (Task 10, option A). **If it does not exist yet**, keep `src/main/tools/meta.ts` and `src/main/tools/wiki.ts` exactly as written, and append their tools inside the array returned by `buildOfficerTools()` in `src/main/tools.ts` (Task 10, option B) — the factories are self-contained either way.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Node 22 `fetch`, zod 4, `@anthropic-ai/claude-agent-sdk` `tool()`, vitest 2 (config at `vitest.config.ts` already caps `forks.maxForks: 2` — every run below also passes `--maxWorkers=2` per global instructions). **No new dependencies** — HTML/wikitext parsing is regex-based, exactly like AxiForge's `wiki.js`. **No live network in tests** — all parser tests run against checked-in fixtures in `__fixtures__/` directories; HTTP is injected (`fetchImpl`) and mocked.

---

## Live observations this plan is based on (verified 2026-06-12)

| Site | Verified? | Findings |
|---|---|---|
| **metabattle.com** | **Yes (live API calls)** | MediaWiki + Semantic MediaWiki at `https://metabattle.com/wiki/api.php`. Builds in custom namespace **3000** (`Build:`), guides in 3002. `action=query&list=search&srnamespace=3000&srsearch=firebrand` → 26 hits, titles like `Build:Firebrand - Support Firebrand`. **Without `srnamespace=3000` search returns 0 hits** — the param is mandatory. `action=query&list=allpages&apnamespace=3000` works. `action=parse&page=Build:...&prop=wikitext` returns wikitext containing `{{Build |profession=Guardian |specialization=Firebrand |designed for=wvw zerg |focus=... |rating=great}}`, `{{Specialization|Honor|bot|top|mid}}` trait lines, `{{Skill bar |profession=... |weapon1=staff |healing=Mantra of Solace |elite=Mantra of Liberation ...}}`, and equipment templates like `{{PvE equipment |stats=Minstrel |rune=Superior Rune of the Water ...}}`. Page URL: `https://metabattle.com/wiki/Build:<Title_with_underscores>`. |
| **hardstuck.gg** | **Yes (listing + build page)** | Listing `https://hardstuck.gg/gw2/builds/` is server-rendered; build links follow `/gw2/builds/<profession>/<slug>/` (e.g. `/gw2/builds/necromancer/blood-harbinger/`, `/gw2/builds/guardian/heal-alacrity-willbender/`, numeric slugs also occur: `/gw2/builds/mesmer/24929/`). Cards carry role labels (Damage, Support, Bruiser, Roamer, …) and game modes (PvP, Group PvE, WvW (Zerg), Open World). Build pages have Traits / Weapons & Sigils / Utility Skills / Rotation / Introduction sections; trait & skill icons are links carrying name text; no chat code observed on the sampled PvP page. |
| **guildjen.com** | **Yes (listing + build page)** | WordPress. Mode listing pages: `https://guildjen.com/gw2-wvw-builds/`, `gw2-pvp-builds/`, `gw2-raid-builds/`, `gw2-fractal-builds/`, `gw2-leveling-builds/`, `gw2-open-world-builds/` (last one inferred from nav pattern — confirm at capture time). Listings group builds by profession with table rows (Specialization, Name, Playstyle, Role, Difficulty, Ranking). Build pages: flat slugs `https://guildjen.com/<descriptive-name>-build/` (e.g. `power-rifle-deadeye-roaming-build/`), contain `Role: <role>` text, equipment tables, and a copyable **chat code** like `[&DQUUKiwnOicKAQwBWACJACAXIBcfFlgBPRY9FgAAAAAAAAAAAAAAAAAAAAA=]`. |
| **gw2mists.com** | **No — unreachable for structure** | Client-rendered SPA: `/builds`, `/sitemap.xml`, and a probe of `/api/builds` all returned only the app shell title ("Guild Wars 2 WvW Builds, Guides, Matchups, Guilds and Leaderboards"); no server-rendered build links or JSON visible to a plain fetch-to-markdown tool. The parser is therefore designed around an **assumed** JSON API consumed by the SPA, with the real endpoint + payload to be captured at implementation time via browser devtools (network tab on `https://gw2mists.com/builds`). The module is interface-complete and degrades to "site unavailable" if the captured shape differs until fixtures are updated. |
| **wiki.guildwars2.com** | Pattern proven by AxiForge | `https://wiki.guildwars2.com/api.php` with `action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1&redirects=1&titles=...&format=json&formatversion=2` (exact pattern in AxiForge `../axiforge/src/main/gw2Data/wiki.js`, in production use). `action=query&list=search` and `action=parse&prop=wikitext` are standard MediaWiki, same as the verified metabattle calls. Infobox template names (`{{Skill infobox}}` etc.) are extracted generically (any template whose name ends with `infobox`), so exact names don't need to be assumed. |

---

## Task 1: Knowledge infrastructure — `HttpQueue` (throttle + retry) and `DiskCache` (TTL, namespaced)

Mirrors AxiForge `src/main/gw2Data/fetch.js`: max 3 concurrent requests, retry on 429/5xx with backoff, two-level (memory + disk) cache with TTL and debounced flush — rewritten as injectable TypeScript classes.

**Files:**
- Create: `src/main/knowledge/httpQueue.ts`
- Create: `src/main/knowledge/httpQueue.test.ts`
- Create: `src/main/knowledge/diskCache.ts`
- Create: `src/main/knowledge/diskCache.test.ts`

**Steps:**

- [ ] Write the failing tests.

`src/main/knowledge/httpQueue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { HttpQueue } from './httpQueue'

function deferredFetch() {
  const pending: Array<() => void> = []
  const fetchImpl = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(() =>
          resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
        )
      })
  )
  return { fetchImpl, pending }
}

describe('HttpQueue', () => {
  it('never runs more than maxConcurrent requests at once', async () => {
    const { fetchImpl, pending } = deferredFetch()
    const q = new HttpQueue({ maxConcurrent: 3, fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 })
    const jobs = Array.from({ length: 7 }, (_, i) => q.json(`https://example.test/${i}`))
    await Promise.resolve() // let the queue drain
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    pending.splice(0).forEach((release) => release())
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(6)
    pending.splice(0).forEach((release) => release())
    await Promise.all(jobs)
    expect(fetchImpl).toHaveBeenCalledTimes(7)
  })

  it('retries retryable statuses then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('[1,2]', { status: 200 }))
    const q = new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 })
    await expect(q.json('https://example.test/x')).resolves.toEqual([1, 2])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable statuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }))
    const q = new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 })
    await expect(q.text('https://example.test/missing')).rejects.toThrow(/404/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sends a User-Agent header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 }))
    const q = new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch })
    await q.text('https://example.test/page')
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['User-Agent']).toBe('axivale-desktop')
  })
})
```

`src/main/knowledge/diskCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiskCache } from './diskCache'

describe('DiskCache', () => {
  it('returns undefined on miss and the value within TTL, namespaced', async () => {
    const cache = new DiskCache()
    await cache.init(await mkdtemp(join(tmpdir(), 'axivale-cache-')))
    expect(cache.get('metabattle', 'a')).toBeUndefined()
    cache.set('metabattle', 'a', { hits: 26 }, 60_000)
    expect(cache.get('metabattle', 'a')).toEqual({ hits: 26 })
    expect(cache.get('guildjen', 'a')).toBeUndefined() // namespace isolation
  })

  it('expires entries after their TTL', async () => {
    const cache = new DiskCache()
    await cache.init(await mkdtemp(join(tmpdir(), 'axivale-cache-')))
    cache.set('wiki', 'k', 'v', -1) // already expired
    expect(cache.get('wiki', 'k')).toBeUndefined()
  })

  it('persists to disk and reloads, pruning expired entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'axivale-cache-'))
    const a = new DiskCache()
    await a.init(dir)
    a.set('wiki', 'keep', 'kept', 60_000)
    a.set('wiki', 'drop', 'dropped', -1)
    await a.flush()
    const raw = JSON.parse(await readFile(join(dir, 'knowledge-cache.json'), 'utf8'))
    expect(raw['wiki:keep']).toBeDefined()

    const b = new DiskCache()
    await b.init(dir)
    expect(b.get('wiki', 'keep')).toBe('kept')
    expect(b.get('wiki', 'drop')).toBeUndefined()
  })

  it('init tolerates a missing or corrupt cache file', async () => {
    const cache = new DiskCache()
    await expect(cache.init(await mkdtemp(join(tmpdir(), 'axivale-cache-')))).resolves.toBeUndefined()
    cache.set('x', 'y', 1, 1000)
    expect(cache.get('x', 'y')).toBe(1)
  })
})
```

- [ ] Run and confirm both fail (modules don't exist):

```
npx vitest run --maxWorkers=2 src/main/knowledge/httpQueue.test.ts src/main/knowledge/diskCache.test.ts
```

Expected: both suites error with "Cannot find module './httpQueue'" / "'./diskCache'".

- [ ] Implement `src/main/knowledge/httpQueue.ts`:

```ts
/**
 * Throttled fetch with retry — mirrors AxiForge src/main/gw2Data/fetch.js
 * (MAX_CONCURRENT request queue + retry on 429/5xx) as an injectable class.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

export interface HttpQueueOptions {
  maxConcurrent?: number
  /** Base backoff in ms (multiplied by attempt). Tests pass 0. */
  retryDelayMs?: number
  fetchImpl?: typeof fetch
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export class HttpQueue {
  private active = 0
  private readonly waiting: Array<() => void> = []
  private readonly maxConcurrent: number
  private readonly retryDelayMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: HttpQueueOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? 3
    this.retryDelayMs = opts.retryDelayMs ?? 800
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async json(url: string): Promise<unknown> {
    const res = await this.request(url, 'application/json')
    return res.json()
  }

  async text(url: string): Promise<string> {
    const res = await this.request(url, 'text/html')
    return res.text()
  }

  private async request(url: string, accept: string): Promise<Response> {
    await this.acquire()
    try {
      return await this.fetchWithRetry(url, accept)
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) =>
      this.waiting.push(() => {
        this.active++
        resolve()
      })
    )
  }

  private release(): void {
    this.active--
    const next = this.waiting.shift()
    if (next) next()
  }

  private async fetchWithRetry(url: string, accept: string): Promise<Response> {
    let lastErr: unknown
    let lastStatus = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0 && this.retryDelayMs > 0) {
        const delay = lastStatus === 429 ? this.retryDelayMs * 2 * attempt : this.retryDelayMs * attempt
        await new Promise((r) => setTimeout(r, delay))
      }
      let res: Response
      try {
        res = await this.fetchImpl(url, {
          headers: { Accept: accept, 'User-Agent': 'axivale-desktop' }
        })
      } catch (err) {
        lastErr = err
        continue
      }
      if (res.ok) return res
      lastStatus = res.status
      lastErr = new HttpError(`Request failed (${res.status}) for ${url}`, res.status)
      if (!RETRYABLE.has(res.status)) throw lastErr
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }
}
```

- [ ] Implement `src/main/knowledge/diskCache.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Two-level (memory + disk) TTL cache, namespaced by knowledge source.
 * Mirrors AxiForge src/main/gw2Data/fetch.js disk-cache pattern: prune on
 * load, debounced best-effort flush, single JSON file.
 */
interface Entry {
  value: unknown
  expiresAt: number
}

const FLUSH_DELAY_MS = 2000

export class DiskCache {
  private mem = new Map<string, Entry>()
  private disk: Record<string, Entry> = {}
  private filePath: string | null = null
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  async init(dir: string): Promise<void> {
    this.filePath = path.join(dir, 'knowledge-cache.json')
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Record<string, Entry>
      const now = Date.now()
      for (const [k, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.expiresAt === 'number' && entry.expiresAt > now) this.disk[k] = entry
      }
    } catch {
      this.disk = {} // missing or corrupt file — start clean
    }
  }

  get<T = unknown>(namespace: string, key: string): T | undefined {
    const fullKey = `${namespace}:${key}`
    const now = Date.now()
    const inMem = this.mem.get(fullKey)
    if (inMem) {
      if (now < inMem.expiresAt) return inMem.value as T
      this.mem.delete(fullKey)
    }
    const onDisk = this.disk[fullKey]
    if (onDisk && now < onDisk.expiresAt) {
      this.mem.set(fullKey, onDisk) // promote
      return onDisk.value as T
    }
    return undefined
  }

  set(namespace: string, key: string, value: unknown, ttlMs: number): void {
    const entry: Entry = { value, expiresAt: Date.now() + ttlMs }
    const fullKey = `${namespace}:${key}`
    this.mem.set(fullKey, entry)
    this.disk[fullKey] = entry
    this.scheduleFlush()
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.filePath || !this.dirty) return
    this.dirty = false
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.disk), 'utf8')
    } catch {
      /* best-effort, like AxiForge */
    }
  }

  private scheduleFlush(): void {
    this.dirty = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS)
    // Don't keep the process alive just to flush a cache.
    this.flushTimer.unref?.()
  }
}
```

- [ ] Run again, expect all tests green:

```
npx vitest run --maxWorkers=2 src/main/knowledge/httpQueue.test.ts src/main/knowledge/diskCache.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: knowledge infra — throttled HttpQueue + namespaced TTL DiskCache`

---

## Task 2: Meta-source contract — `types.ts` + wikitext template parser helpers

The shared interface every site module implements, the normalized build summary shape (traits, skills, gear, role notes, source URL), and the wikitext template parsing helpers used by both metabattle and the wiki client's infobox extraction.

**Files:**
- Create: `src/main/metaSources/types.ts`
- Create: `src/main/metaSources/wikitext.ts`
- Create: `src/main/metaSources/wikitext.test.ts`

**Steps:**

- [ ] Create `src/main/metaSources/types.ts` (pure types — no test of its own; consumed by every later task):

```ts
export type SiteId = 'metabattle' | 'gw2mists' | 'hardstuck' | 'guildjen'

export type GameMode = 'pve' | 'open-world' | 'fractal' | 'raid' | 'pvp' | 'wvw'

export interface SearchFilters {
  profession?: string
  mode?: GameMode
  role?: string
}

/** Compact row returned by meta_search_builds. */
export interface BuildListing {
  site: SiteId
  title: string
  url: string
  profession?: string
  specialization?: string
  mode?: string
  role?: string
  rating?: string
}

export interface TraitLine {
  /** Specialization line name, e.g. "Honor" or "Firebrand". */
  line: string
  /** Trait choices top-to-bottom per tier — names when known, else tier positions like "top"/"mid"/"bot". */
  choices: string[]
}

export interface SkillBar {
  weapons: string[]
  heal?: string
  utilities: string[]
  elite?: string
}

export interface GearEntry {
  /** e.g. "stats", "rune", "relic", "sigil1", "amulet", "helm" */
  slot: string
  item: string
}

/** Normalized build summary returned by meta_get_build (spec §4). */
export interface BuildSummary {
  site: SiteId
  title: string
  url: string
  profession?: string
  specialization?: string
  mode?: string
  role?: string
  rating?: string
  traits: TraitLine[]
  skills: SkillBar
  gear: GearEntry[]
  /** In-game build template chat code when the site shows one, e.g. "[&DQ...=]". */
  chatCode?: string
  /** Role/usage notes — capped, plain text. */
  notes: string
  /** True when the parser could not extract a complete picture (HTML drift, sparse page). */
  partial: boolean
}

export interface MetaSource {
  readonly id: SiteId
  /** True when this source owns the given build URL (hostname match). */
  canHandle(url: string): boolean
  search(filters: SearchFilters): Promise<BuildListing[]>
  getBuild(url: string): Promise<BuildSummary>
}

/** Thrown when a site is unreachable or its payload no longer parses — isolated per site by the tools. */
export class SiteUnavailableError extends Error {
  constructor(
    readonly site: SiteId,
    detail: string
  ) {
    super(`${site} unavailable: ${detail}`)
  }
}
```

- [ ] Write the failing parser test `src/main/metaSources/wikitext.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractTemplates, templateParams, stripTags, decodeEntities } from './wikitext'

const SAMPLE = `{{Build
| profession = Guardian
| specialization = Firebrand
| designed for = wvw zerg
| focus = Healing, Boon Support, Crowd Control
| rating = great
}}
Intro text.
{{Specialization|Honor|bot|top|mid}}
{{Specialization|Virtues|mid|mid|bot}}
{{Specialization|Firebrand|mid|mid|top}}
{{Skill bar
| profession = Guardian
| specialization = Firebrand
| weapon1 = staff
| weapon2 = axe
| healing = Mantra of Solace
| utility1 = Mantra of Potence
| utility2 = Stand Your Ground!
| utility3 = Mantra of Lore
| elite = Mantra of Liberation
}}
{{PvE equipment
| stats = Minstrel
| rune = Superior Rune of the Water
| relic = Relic of the Monk
| weapon1 = Staff
| sigil1 = Superior Sigil of Transference
}}`

describe('wikitext helpers', () => {
  it('extracts a named template block including nested braces', () => {
    const withNested = '{{Build | note = uses {{tooltip|Stability}} a lot | rating = good }} tail'
    const blocks = extractTemplates(withNested, 'Build')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('{{tooltip|Stability}}')
    expect(blocks[0].endsWith('}}')).toBe(true)
  })

  it('extracts all occurrences of a repeated template', () => {
    expect(extractTemplates(SAMPLE, 'Specialization')).toHaveLength(3)
  })

  it('parses named params with normalized lowercase keys', () => {
    const [build] = extractTemplates(SAMPLE, 'Build')
    const { named } = templateParams(build)
    expect(named['profession']).toBe('Guardian')
    expect(named['designed for']).toBe('wvw zerg')
    expect(named['rating']).toBe('great')
  })

  it('parses positional params', () => {
    const [spec] = extractTemplates(SAMPLE, 'Specialization')
    const { positional } = templateParams(spec)
    expect(positional).toEqual(['Honor', 'bot', 'top', 'mid'])
  })

  it('keeps nested templates intact inside param values', () => {
    const { named } = templateParams('{{Build|note = see {{tooltip|Aegis}} here}}')
    expect(named['note']).toBe('see {{tooltip|Aegis}} here')
  })

  it('stripTags and decodeEntities mirror the AxiForge wiki.js behavior', () => {
    expect(stripTags('<b>Hi</b> <a href="/x">there</a>')).toBe('Hi there')
    expect(decodeEntities('Fire &amp; Frost&#160;&#8212; intro')).toBe('Fire & Frost — intro')
  })
})
```

- [ ] Run and confirm it fails (module missing):

```
npx vitest run --maxWorkers=2 src/main/metaSources/wikitext.test.ts
```

- [ ] Implement `src/main/metaSources/wikitext.ts`:

```ts
/**
 * Minimal MediaWiki wikitext template parsing — regex + brace counting,
 * same dependency-free style as AxiForge src/main/gw2Data/wiki.js.
 */

/** All occurrences of {{Name ...}} (case-insensitive), nested braces preserved. */
export function extractTemplates(wikitext: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(wikitext)) !== null) {
    let depth = 0
    let i = m.index
    while (i < wikitext.length) {
      if (wikitext.startsWith('{{', i)) {
        depth++
        i += 2
      } else if (wikitext.startsWith('}}', i)) {
        depth--
        i += 2
        if (depth === 0) break
      } else {
        i++
      }
    }
    out.push(wikitext.slice(m.index, i))
    re.lastIndex = i
  }
  return out
}

/** Split one {{...}} block into positional params and a lowercase-keyed named-param map. */
export function templateParams(template: string): {
  positional: string[]
  named: Record<string, string>
} {
  const inner = template.replace(/^\{\{/, '').replace(/\}\}$/, '')
  // Split on | at depth 0 (nested {{...}} and [[...]] stay intact).
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < inner.length; i++) {
    if (inner.startsWith('{{', i) || inner.startsWith('[[', i)) {
      depth++
      cur += inner.slice(i, i + 2)
      i++
    } else if (inner.startsWith('}}', i) || inner.startsWith(']]', i)) {
      depth--
      cur += inner.slice(i, i + 2)
      i++
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += inner[i]
    }
  }
  parts.push(cur)

  const positional: string[] = []
  const named: Record<string, string> = {}
  for (const part of parts.slice(1)) {
    // parts[0] is the template name
    const eq = part.indexOf('=')
    // A '=' inside a nested template is not a named param — check depth-0 only:
    const before = part.slice(0, eq)
    if (eq > 0 && !before.includes('{{') && !before.includes('[[')) {
      named[before.trim().toLowerCase()] = part.slice(eq + 1).trim()
    } else {
      const v = part.trim()
      if (v) positional.push(v)
    }
  }
  return { positional, named }
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

export function decodeEntities(str: string): string {
  return str
    .replace(/&#160;/g, ' ')
    .replace(/&#32;/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, '’')
    .replace(/&#8201;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
}
```

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/metaSources/wikitext.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: MetaSource contract, normalized BuildSummary, wikitext parser helpers`

---

## Task 3: MetaBattle source (MediaWiki API — verified)

**Files:**
- Create: `src/main/metaSources/__fixtures__/metabattle-search.json`
- Create: `src/main/metaSources/__fixtures__/metabattle-build-wikitext.json`
- Create: `src/main/metaSources/metabattle.ts`
- Create: `src/main/metaSources/metabattle.test.ts`

**Steps:**

- [ ] Check in fixtures. `src/main/metaSources/__fixtures__/metabattle-search.json` (shape verified live against `action=query&list=search&srnamespace=3000&srsearch=firebrand`):

```json
{
  "batchcomplete": true,
  "query": {
    "searchinfo": { "totalhits": 26 },
    "search": [
      { "ns": 3000, "title": "Build:Firebrand - Support Firebrand", "pageid": 9001, "snippet": "Heal/boon support for WvW zergs" },
      { "ns": 3000, "title": "Build:Firebrand - Condi Firebrand", "pageid": 9002, "snippet": "Condition DPS firebrand" },
      { "ns": 3000, "title": "Build:Firebrand - Zerg Healer", "pageid": 9003, "snippet": "Dedicated zerg healer" }
    ]
  }
}
```

`src/main/metaSources/__fixtures__/metabattle-build-wikitext.json` (template structure verified live via `action=parse&page=Build:Firebrand%20-%20Support%20Firebrand&prop=wikitext`):

```json
{
  "parse": {
    "title": "Build:Firebrand - Support Firebrand",
    "pageid": 9001,
    "wikitext": "{{Build\n| profession = Guardian\n| specialization = Firebrand\n| designed for = wvw zerg\n| focus = Healing, Boon Support, Crowd Control\n| rating = great\n}}\nA dedicated frontline support build.\n{{Skill bar\n| profession = Guardian\n| specialization = Firebrand\n| weapon1 = staff\n| weapon2 = axe\n| weapon3 = shield\n| healing = Mantra of Solace\n| utility1 = Mantra of Potence\n| utility2 = \"Stand Your Ground!\"\n| utility3 = Mantra of Lore\n| elite = Mantra of Liberation\n}}\n{{Specialization|Honor|bot|top|mid}}\n{{Specialization|Virtues|mid|mid|bot}}\n{{Specialization|Firebrand|mid|mid|top}}\n{{PvE equipment\n| stats = Minstrel\n| rune = Superior Rune of the Water\n| relic = Relic of the Monk\n| weapon1 = Staff\n| sigil1 = Superior Sigil of Transference\n| sigil2 = Superior Sigil of Concentration\n}}\n== Usage ==\nStay with your subgroup and cycle mantras off cooldown.\n"
  }
}
```

> At implementation time, optionally refresh these from the live API (`curl 'https://metabattle.com/wiki/api.php?action=query&list=search&srnamespace=3000&srsearch=firebrand&format=json&formatversion=2'` and the parse call above) — but the checked-in fixtures already match the verified live shape and the tests must keep passing offline.

- [ ] Write the failing test `src/main/metaSources/metabattle.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MetabattleSource } from './metabattle'
import { DiskCache } from '../knowledge/diskCache'
import { HttpQueue } from '../knowledge/httpQueue'
import { SiteUnavailableError } from './types'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const searchJson = readFileSync(join(fixtures, 'metabattle-search.json'), 'utf8')
const buildJson = readFileSync(join(fixtures, 'metabattle-build-wikitext.json'), 'utf8')

function makeSource(byUrl: (url: string) => string) {
  const fetchImpl = vi.fn(async (url: string | URL) =>
    new Response(byUrl(String(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  )
  const http = new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 })
  return { source: new MetabattleSource(http, new DiskCache()), fetchImpl }
}

describe('MetabattleSource', () => {
  it('searches namespace 3000 and maps results to listings', async () => {
    const { source, fetchImpl } = makeSource(() => searchJson)
    const listings = await source.search({ profession: 'guardian', role: 'support', mode: 'wvw' })
    const calledUrl = String(fetchImpl.mock.calls[0][0])
    expect(calledUrl).toContain('srnamespace=3000') // mandatory — search returns 0 hits without it
    expect(calledUrl).toContain('list=search')
    expect(listings[0]).toMatchObject({
      site: 'metabattle',
      title: 'Firebrand - Support Firebrand',
      specialization: 'Firebrand',
      url: 'https://metabattle.com/wiki/Build:Firebrand_-_Support_Firebrand'
    })
  })

  it('parses a build page into the normalized BuildSummary', async () => {
    const { source } = makeSource(() => buildJson)
    const build = await source.getBuild('https://metabattle.com/wiki/Build:Firebrand_-_Support_Firebrand')
    expect(build.site).toBe('metabattle')
    expect(build.profession).toBe('Guardian')
    expect(build.specialization).toBe('Firebrand')
    expect(build.mode).toBe('wvw zerg')
    expect(build.rating).toBe('great')
    expect(build.traits).toEqual([
      { line: 'Honor', choices: ['bot', 'top', 'mid'] },
      { line: 'Virtues', choices: ['mid', 'mid', 'bot'] },
      { line: 'Firebrand', choices: ['mid', 'mid', 'top'] }
    ])
    expect(build.skills).toEqual({
      weapons: ['staff', 'axe', 'shield'],
      heal: 'Mantra of Solace',
      utilities: ['Mantra of Potence', '"Stand Your Ground!"', 'Mantra of Lore'],
      elite: 'Mantra of Liberation'
    })
    expect(build.gear).toContainEqual({ slot: 'stats', item: 'Minstrel' })
    expect(build.gear).toContainEqual({ slot: 'relic', item: 'Relic of the Monk' })
    expect(build.notes).toContain('Healing, Boon Support')
    expect(build.partial).toBe(false)
    expect(build.url).toBe('https://metabattle.com/wiki/Build:Firebrand_-_Support_Firebrand')
  })

  it('canHandle matches only metabattle URLs', () => {
    const { source } = makeSource(() => '{}')
    expect(source.canHandle('https://metabattle.com/wiki/Build:X')).toBe(true)
    expect(source.canHandle('https://hardstuck.gg/gw2/builds/x/')).toBe(false)
  })

  it('wraps network failure as SiteUnavailableError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const http = new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 })
    const source = new MetabattleSource(http, new DiskCache())
    await expect(source.search({})).rejects.toBeInstanceOf(SiteUnavailableError)
  })

  it('serves repeated searches from cache (one network call)', async () => {
    const { source, fetchImpl } = makeSource(() => searchJson)
    await source.search({ profession: 'guardian' })
    await source.search({ profession: 'guardian' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/metaSources/metabattle.test.ts
```

- [ ] Implement `src/main/metaSources/metabattle.ts`:

```ts
import type { DiskCache } from '../knowledge/diskCache'
import type { HttpQueue } from '../knowledge/httpQueue'
import {
  SiteUnavailableError,
  type BuildListing,
  type BuildSummary,
  type GearEntry,
  type MetaSource,
  type SearchFilters,
  type SkillBar,
  type TraitLine
} from './types'
import { extractTemplates, templateParams, stripTags, decodeEntities } from './wikitext'

const API = 'https://metabattle.com/wiki/api.php'
const BUILD_NAMESPACE = '3000' // verified: Build: namespace; search without it returns 0 hits
const TTL_SEARCH = 12 * 60 * 60 * 1000 // 12h
const TTL_BUILD = 24 * 60 * 60 * 1000 // 24h
const NOTES_MAX = 500

interface SearchResponse {
  query?: { search?: Array<{ title: string; snippet?: string }> }
}
interface ParseResponse {
  parse?: { title?: string; wikitext?: string }
}

export class MetabattleSource implements MetaSource {
  readonly id = 'metabattle' as const

  constructor(
    private readonly http: HttpQueue,
    private readonly cache: DiskCache
  ) {}

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.endsWith('metabattle.com')
    } catch {
      return false
    }
  }

  async search(filters: SearchFilters): Promise<BuildListing[]> {
    const terms = [filters.profession, filters.role, filters.mode].filter(Boolean).join(' ') || 'meta'
    const cached = this.cache.get<BuildListing[]>(this.id, `search:${terms.toLowerCase()}`)
    if (cached) return cached

    const url = new URL(API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('list', 'search')
    url.searchParams.set('srsearch', terms)
    url.searchParams.set('srnamespace', BUILD_NAMESPACE)
    url.searchParams.set('srlimit', '25')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')

    const data = (await this.fetch(url.toString())) as SearchResponse
    const results = data.query?.search
    if (!Array.isArray(results)) throw new SiteUnavailableError(this.id, 'unexpected search response shape')

    const listings = results.map((r): BuildListing => {
      const bare = r.title.replace(/^Build:/, '')
      return {
        site: this.id,
        title: bare,
        url: pageUrl(r.title),
        // Titles follow "Build:<Specialization> - <Name>" (verified live).
        specialization: bare.includes(' - ') ? bare.split(' - ')[0].trim() : undefined,
        role: filters.role,
        mode: filters.mode
      }
    })
    this.cache.set(this.id, `search:${terms.toLowerCase()}`, listings, TTL_SEARCH)
    return listings
  }

  async getBuild(buildUrl: string): Promise<BuildSummary> {
    const title = titleFromUrl(buildUrl)
    if (!title) throw new SiteUnavailableError(this.id, `not a metabattle build URL: ${buildUrl}`)
    const cached = this.cache.get<BuildSummary>(this.id, `build:${title.toLowerCase()}`)
    if (cached) return cached

    const url = new URL(API)
    url.searchParams.set('action', 'parse')
    url.searchParams.set('page', title)
    url.searchParams.set('prop', 'wikitext')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')

    const data = (await this.fetch(url.toString())) as ParseResponse
    const wikitext = data.parse?.wikitext
    if (typeof wikitext !== 'string') throw new SiteUnavailableError(this.id, 'page has no wikitext')

    const summary = parseBuildWikitext(wikitext, data.parse?.title ?? title, pageUrl(title))
    this.cache.set(this.id, `build:${title.toLowerCase()}`, summary, TTL_BUILD)
    return summary
  }

  private async fetch(url: string): Promise<unknown> {
    try {
      return await this.http.json(url)
    } catch (err) {
      throw new SiteUnavailableError(this.id, err instanceof Error ? err.message : String(err))
    }
  }
}

function pageUrl(title: string): string {
  return `https://metabattle.com/wiki/${encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%3A', ':')}`
}

function titleFromUrl(url: string): string | null {
  const m = /metabattle\.com\/wiki\/(.+)$/.exec(url)
  if (!m) return null
  return decodeURIComponent(m[1]).replaceAll('_', ' ')
}

export function parseBuildWikitext(wikitext: string, pageTitle: string, url: string): BuildSummary {
  const [buildTpl] = extractTemplates(wikitext, 'Build')
  const meta = buildTpl ? templateParams(buildTpl).named : {}

  const traits: TraitLine[] = extractTemplates(wikitext, 'Specialization').map((tpl) => {
    const { positional } = templateParams(tpl)
    return { line: positional[0] ?? '', choices: positional.slice(1) }
  })

  const skills: SkillBar = { weapons: [], utilities: [] }
  const [skillTpl] = extractTemplates(wikitext, 'Skill bar')
  if (skillTpl) {
    const { named } = templateParams(skillTpl)
    for (const [key, value] of Object.entries(named)) {
      if (!value) continue
      if (/^weapon\d+$/.test(key)) skills.weapons.push(value)
      else if (key === 'healing') skills.heal = value
      else if (/^utility\d+$/.test(key)) skills.utilities.push(value)
      else if (key === 'elite') skills.elite = value
    }
  }

  // Any "* equipment" template ({{PvE equipment}}, {{WvW equipment}}, ...) → gear entries.
  const gear: GearEntry[] = []
  for (const tpl of extractTemplates(wikitext, '[A-Za-z]+ equipment')) {
    const { named } = templateParams(tpl)
    for (const [slot, item] of Object.entries(named)) {
      if (item && slot !== 'profession' && slot !== 'specialization') gear.push({ slot, item })
    }
  }

  // Notes: focus line + first prose under == Usage == (or first non-template prose).
  const usage = /==\s*Usage\s*==\s*([\s\S]*?)(?:\n==|$)/i.exec(wikitext)?.[1] ?? ''
  const prose = decodeEntities(stripTags(usage)).replace(/\{\{[^}]*\}\}/g, '').trim()
  const notes = [meta['focus'] ? `Focus: ${meta['focus']}` : '', prose]
    .filter(Boolean)
    .join(' — ')
    .slice(0, NOTES_MAX)

  return {
    site: 'metabattle',
    title: pageTitle.replace(/^Build:/, ''),
    url,
    profession: meta['profession'],
    specialization: meta['specialization'],
    mode: meta['designed for'],
    rating: meta['rating'],
    traits,
    skills,
    gear,
    notes,
    partial: traits.length === 0 && skills.weapons.length === 0
  }
}
```

> Note: `extractTemplates` receives a regex-escaped name; for the equipment match it needs a character-class pattern. Adjust `extractTemplates` to accept a `RegExp | string`: when a string contains `[`, skip escaping (or add an `extractTemplatesPattern` variant). Implementer: simplest correct fix — add a second exported function `extractTemplatesByPattern(wikitext: string, pattern: string)` that skips the escape, and use it for `'[A-Za-z]+ equipment'`. Update the wikitext test with one case for it.

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/metaSources/metabattle.test.ts src/main/metaSources/wikitext.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: metabattle MetaSource via MediaWiki API (ns 3000) with wikitext build parser`

---

## Task 4: Hardstuck source (HTML listing + build page)

Listing is server-rendered with build links `/gw2/builds/<profession>/<slug>/` (verified live). Parsers are class-agnostic (anchor href pattern + text), so cosmetic CSS changes don't break them.

**Files:**
- Create: `src/main/metaSources/__fixtures__/hardstuck-listing.html`
- Create: `src/main/metaSources/__fixtures__/hardstuck-build.html`
- Create: `src/main/metaSources/hardstuck.ts`
- Create: `src/main/metaSources/hardstuck.test.ts`

**Steps:**

- [ ] Capture real fixtures (one-time, at implementation — not in tests):

```
curl -sA 'axivale-desktop' 'https://hardstuck.gg/gw2/builds/' -o src/main/metaSources/__fixtures__/hardstuck-listing.html
curl -sA 'axivale-desktop' 'https://hardstuck.gg/gw2/builds/necromancer/blood-harbinger/' -o src/main/metaSources/__fixtures__/hardstuck-build.html
```

If the captures are very large (>500 KB), trim to the `<main>`/content region by hand, keeping at least 5 build anchors across 2+ professions in the listing and the full traits/skills/intro region of the build page. **If capture fails at implementation time, fall back to the minimal structural samples below** (matching the live-verified URL pattern and observed card fields) and note it in the commit message:

Minimal `hardstuck-listing.html` fallback:

```html
<html><body><main>
<a href="/gw2/builds/necromancer/blood-harbinger/"><h3>Blood Harbinger</h3><span class="role">Bruiser</span><span class="mode">PvP</span></a>
<a href="/gw2/builds/guardian/heal-alacrity-willbender/"><h3>Heal Alacrity Willbender</h3><span class="role">Support</span><span class="mode">Group PvE</span></a>
<a href="/gw2/builds/mesmer/24929/"><h3>Power Virtuoso</h3><span class="role">Damage</span><span class="mode">Group PvE</span></a>
<a href="/gw2/builds/ranger/condition-druid/"><h3>Condition Druid</h3><span class="role">Damage</span><span class="mode">Open World</span></a>
<a href="/gw2/builds/guardian/power-dragonhunter/"><h3>Power Dragonhunter</h3><span class="role">Damage</span><span class="mode">WvW (Zerg)</span></a>
</main></body></html>
```

Minimal `hardstuck-build.html` fallback:

```html
<html><head><title>Blood Harbinger - Hardstuck</title></head><body><main>
<h1>Blood Harbinger</h1>
<p class="meta">PvP · Bruiser · February 2025</p>
<h2>Traits</h2>
<a href="https://wiki.guildwars2.com/wiki/Blood_Magic" title="Blood Magic">Blood Magic</a>
<a href="https://wiki.guildwars2.com/wiki/Soul_Reaping" title="Soul Reaping">Soul Reaping</a>
<a href="https://wiki.guildwars2.com/wiki/Harbinger" title="Harbinger">Harbinger</a>
<h2>Utility Skills</h2>
<a title="Elixir of Promise">Elixir of Promise</a>
<a title="Elixir of Risk">Elixir of Risk</a>
<h2>Introduction</h2>
<p>Blood Harbinger is a self-sustaining bruiser that converts Blight into healing through Blood Bank.</p>
<h2>Rotation</h2>
<ol><li>Open with Pistol 2</li></ol>
</main></body></html>
```

- [ ] Write the failing test `src/main/metaSources/hardstuck.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HardstuckSource, parseListing, parseBuildPage } from './hardstuck'
import { DiskCache } from '../knowledge/diskCache'
import { HttpQueue } from '../knowledge/httpQueue'
import { SiteUnavailableError } from './types'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const listingHtml = readFileSync(join(fixtures, 'hardstuck-listing.html'), 'utf8')
const buildHtml = readFileSync(join(fixtures, 'hardstuck-build.html'), 'utf8')

describe('hardstuck parsers (fixture-based, no network)', () => {
  it('extracts build listings with the /gw2/builds/<profession>/<slug>/ pattern', () => {
    const listings = parseListing(listingHtml)
    expect(listings.length).toBeGreaterThanOrEqual(2)
    for (const l of listings) {
      expect(l.url).toMatch(/^https:\/\/hardstuck\.gg\/gw2\/builds\/[a-z-]+\/[^/]+\/$/)
      expect(l.profession).toMatch(/^[a-z-]+$/)
      expect(l.title.length).toBeGreaterThan(0)
      expect(l.site).toBe('hardstuck')
    }
  })

  it('parses a build page into a (possibly partial) BuildSummary', () => {
    const build = parseBuildPage(buildHtml, 'https://hardstuck.gg/gw2/builds/necromancer/blood-harbinger/')
    expect(build.site).toBe('hardstuck')
    expect(build.title.length).toBeGreaterThan(0)
    expect(build.profession).toBe('necromancer')
    expect(build.notes.length).toBeGreaterThan(0)
    expect(build.url).toBe('https://hardstuck.gg/gw2/builds/necromancer/blood-harbinger/')
    expect(typeof build.partial).toBe('boolean')
  })
})

describe('HardstuckSource', () => {
  it('filters search results by profession', async () => {
    const fetchImpl = vi.fn(async () => new Response(listingHtml, { status: 200 }))
    const source = new HardstuckSource(
      new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }),
      new DiskCache()
    )
    const all = await source.search({})
    const guardians = await source.search({ profession: 'Guardian' })
    expect(guardians.length).toBeLessThan(all.length)
    expect(guardians.every((l) => l.profession === 'guardian')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // second search hits the cache
  })

  it('wraps fetch failure as SiteUnavailableError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'))
    const source = new HardstuckSource(
      new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }),
      new DiskCache()
    )
    await expect(source.search({})).rejects.toBeInstanceOf(SiteUnavailableError)
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/metaSources/hardstuck.test.ts
```

- [ ] Implement `src/main/metaSources/hardstuck.ts`:

```ts
import type { DiskCache } from '../knowledge/diskCache'
import type { HttpQueue } from '../knowledge/httpQueue'
import {
  SiteUnavailableError,
  type BuildListing,
  type BuildSummary,
  type MetaSource,
  type SearchFilters
} from './types'
import { stripTags, decodeEntities } from './wikitext'

const BASE = 'https://hardstuck.gg'
const LISTING_URL = `${BASE}/gw2/builds/`
const TTL_SEARCH = 12 * 60 * 60 * 1000
const TTL_BUILD = 24 * 60 * 60 * 1000
const NOTES_MAX = 500

/** Mode labels observed live on the listing page. */
const MODE_WORDS: Record<string, string[]> = {
  pvp: ['pvp'],
  wvw: ['wvw'],
  raid: ['group pve', 'raid'],
  fractal: ['group pve', 'fractal'],
  'open-world': ['open world'],
  pve: ['pve']
}

/**
 * Class-agnostic listing parser: anchors whose href matches the verified
 * /gw2/builds/<profession>/<slug>/ pattern; title/role/mode from the card text.
 */
export function parseListing(html: string): BuildListing[] {
  const out: BuildListing[] = []
  const seen = new Set<string>()
  const re = /<a\b[^>]*href="(\/gw2\/builds\/([a-z-]+)\/[^"/]+\/)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const [, href, profession, inner] = m
    if (seen.has(href)) continue
    seen.add(href)
    const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
    if (!text) continue
    // First text chunk is the build title; role/mode words may follow in the card.
    const title = text.split(/(?= Damage| Support| Bruiser| Roamer| Sidenoder| Niche| PvP| WvW| Open World| Group PvE)/)[0].trim() || text
    out.push({
      site: 'hardstuck',
      title,
      url: `${BASE}${href}`,
      profession,
      role: matchWord(text, ['Damage', 'Support', 'Offensive Support', 'Defensive Support', 'Bruiser', 'Roamer', 'Sidenoder', 'Niche']),
      mode: matchWord(text, ['PvP', 'Group PvE', 'WvW', 'Open World'])
    })
  }
  return out
}

function matchWord(text: string, words: string[]): string | undefined {
  const lower = text.toLowerCase()
  // Longest match first so "Offensive Support" beats "Support".
  return [...words].sort((a, b) => b.length - a.length).find((w) => lower.includes(w.toLowerCase()))
}

export function parseBuildPage(html: string, url: string): BuildSummary {
  const profession = /\/gw2\/builds\/([a-z-]+)\//.exec(url)?.[1]
  const title =
    decodeEntities(stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')).trim() ||
    decodeEntities(/<title>([^<|–-]+)/i.exec(html)?.[1] ?? '').trim()

  // Trait line names: wiki links inside the section after a "Traits" heading.
  const traitsSection = sectionAfterHeading(html, 'Traits')
  const traitLines = [...traitsSection.matchAll(/<a\b[^>]*title="([^"]+)"[^>]*>/gi)]
    .map((m) => decodeEntities(m[1]))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 3)

  const utilitySection = sectionAfterHeading(html, 'Utility Skills')
  const utilities = [...utilitySection.matchAll(/<a\b[^>]*title="([^"]+)"[^>]*>/gi)]
    .map((m) => decodeEntities(m[1]))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 5)

  const intro = decodeEntities(stripTags(sectionAfterHeading(html, 'Introduction')))
    .replace(/\s+/g, ' ')
    .trim()
  const chatCode = /\[&[A-Za-z0-9+/=]+\]/.exec(html)?.[0]

  return {
    site: 'hardstuck',
    title,
    url,
    profession,
    traits: traitLines.map((line) => ({ line, choices: [] })),
    skills: { weapons: [], utilities },
    gear: [],
    ...(chatCode ? { chatCode } : {}),
    notes: intro.slice(0, NOTES_MAX),
    // Hardstuck pages are icon-heavy; traits/gear extraction is best-effort.
    partial: traitLines.length === 0 || intro.length === 0
  }
}

/** Content between a heading containing `label` and the next h2/h3. */
function sectionAfterHeading(html: string, label: string): string {
  const re = new RegExp(`<h[23][^>]*>[^<]*${label}[^<]*</h[23]>([\\s\\S]*?)(?=<h[23][^>]*>|$)`, 'i')
  return re.exec(html)?.[1] ?? ''
}

export class HardstuckSource implements MetaSource {
  readonly id = 'hardstuck' as const

  constructor(
    private readonly http: HttpQueue,
    private readonly cache: DiskCache
  ) {}

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.endsWith('hardstuck.gg')
    } catch {
      return false
    }
  }

  async search(filters: SearchFilters): Promise<BuildListing[]> {
    let all = this.cache.get<BuildListing[]>(this.id, 'listing')
    if (!all) {
      const html = await this.fetch(LISTING_URL)
      all = parseListing(html)
      if (all.length === 0) throw new SiteUnavailableError(this.id, 'listing page yielded no build links — markup changed?')
      this.cache.set(this.id, 'listing', all, TTL_SEARCH)
    }
    return all
      .filter((l) => !filters.profession || l.profession === filters.profession.toLowerCase())
      .filter((l) => {
        if (!filters.mode) return true
        const words = MODE_WORDS[filters.mode] ?? [filters.mode]
        const hay = `${l.mode ?? ''}`.toLowerCase()
        return words.some((w) => hay.includes(w))
      })
      .filter((l) => !filters.role || (l.role ?? '').toLowerCase().includes(filters.role.toLowerCase()))
      .slice(0, 25)
  }

  async getBuild(url: string): Promise<BuildSummary> {
    if (!this.canHandle(url)) throw new SiteUnavailableError(this.id, `not a hardstuck URL: ${url}`)
    const cached = this.cache.get<BuildSummary>(this.id, `build:${url}`)
    if (cached) return cached
    const summary = parseBuildPage(await this.fetch(url), url)
    this.cache.set(this.id, `build:${url}`, summary, TTL_BUILD)
    return summary
  }

  private async fetch(url: string): Promise<string> {
    try {
      return await this.http.text(url)
    } catch (err) {
      throw new SiteUnavailableError(this.id, err instanceof Error ? err.message : String(err))
    }
  }
}
```

- [ ] Run, expect green (if running against real captured fixtures, adjust the *title-splitting* expectation only if the real card text differs — keep URL-pattern assertions as-is, they are live-verified):

```
npx vitest run --maxWorkers=2 src/main/metaSources/hardstuck.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: hardstuck MetaSource — fixture-tested HTML listing/build parsers`

---

## Task 5: GuildJen source (WordPress listings + build pages)

Mode listing pages and flat `/<slug>-build/` URLs verified live; build pages contain `Role:` text and a `[&...]` chat code.

**Files:**
- Create: `src/main/metaSources/__fixtures__/guildjen-listing.html`
- Create: `src/main/metaSources/__fixtures__/guildjen-build.html`
- Create: `src/main/metaSources/guildjen.ts`
- Create: `src/main/metaSources/guildjen.test.ts`

**Steps:**

- [ ] Capture real fixtures (same policy as Task 4 — trim if huge; fall back to the samples below if capture fails):

```
curl -sA 'axivale-desktop' 'https://guildjen.com/gw2-wvw-builds/' -o src/main/metaSources/__fixtures__/guildjen-listing.html
curl -sA 'axivale-desktop' 'https://guildjen.com/power-rifle-deadeye-roaming-build/' -o src/main/metaSources/__fixtures__/guildjen-build.html
```

Minimal `guildjen-listing.html` fallback (profession headings + table rows, per live observation):

```html
<html><body><article>
<h2>Thief</h2>
<table><tr><td>Daredevil</td><td><a href="https://guildjen.com/power-staff-daredevil-havoc-build/">Power Staff Daredevil</a></td><td>Havoc</td><td>Damage</td></tr>
<tr><td>Deadeye</td><td><a href="https://guildjen.com/power-rifle-deadeye-roaming-build/">Power Rifle Deadeye</a></td><td>Roaming</td><td>Assassin</td></tr></table>
<h2>Revenant</h2>
<table><tr><td>Vindicator</td><td><a href="https://guildjen.com/support-vindicator-havoc-build/">Support Vindicator</a></td><td>Havoc</td><td>Support</td></tr></table>
<h2>Ranger</h2>
<table><tr><td>Druid</td><td><a href="https://guildjen.com/support-druid-cloud-build/">Support Druid</a></td><td>Cloud</td><td>Support</td></tr></table>
</article></body></html>
```

Minimal `guildjen-build.html` fallback:

```html
<html><head><title>Power Rifle Deadeye Roaming Build - GuildJen</title></head><body><article>
<h1 class="entry-title">Power Rifle Deadeye Roaming Build</h1>
<p>Role: Assassin</p>
<p>Preferred Group Size: 1-5</p>
<p>This build marks single targets and builds Malice to spike them down from stealth.</p>
<pre>[&DQUUKiwnOicKAQwBWACJACAXIBcfFlgBPRY9FgAAAAAAAAAAAAAAAAAAAAA=]</pre>
<h2>Equipment</h2>
<table><tr><td>Helm</td><td>Marauder</td></tr><tr><td>Rifle</td><td>Dragon</td></tr></table>
</article></body></html>
```

- [ ] Write the failing test `src/main/metaSources/guildjen.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GuildjenSource, parseListing, parseBuildPage } from './guildjen'
import { DiskCache } from '../knowledge/diskCache'
import { HttpQueue } from '../knowledge/httpQueue'
import { SiteUnavailableError } from './types'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const listingHtml = readFileSync(join(fixtures, 'guildjen-listing.html'), 'utf8')
const buildHtml = readFileSync(join(fixtures, 'guildjen-build.html'), 'utf8')

describe('guildjen parsers (fixture-based, no network)', () => {
  it('extracts listings grouped under profession headings', () => {
    const listings = parseListing(listingHtml, 'wvw')
    expect(listings.length).toBeGreaterThanOrEqual(2)
    const thief = listings.filter((l) => l.profession === 'thief')
    expect(thief.length).toBeGreaterThanOrEqual(1)
    for (const l of listings) {
      expect(l.url).toMatch(/^https:\/\/guildjen\.com\/[a-z0-9-]+\/$/)
      expect(l.site).toBe('guildjen')
      expect(l.mode).toBe('wvw')
    }
  })

  it('parses a build page: title, role, chat code, notes', () => {
    const build = parseBuildPage(buildHtml, 'https://guildjen.com/power-rifle-deadeye-roaming-build/')
    expect(build.title.toLowerCase()).toContain('deadeye')
    expect(build.role?.toLowerCase()).toContain('assassin')
    expect(build.chatCode).toMatch(/^\[&[A-Za-z0-9+/=]+\]$/)
    expect(build.notes.length).toBeGreaterThan(0)
    expect(build.site).toBe('guildjen')
  })
})

describe('GuildjenSource', () => {
  it('fetches the mode listing page matching the mode filter', async () => {
    const fetchImpl = vi.fn(async () => new Response(listingHtml, { status: 200 }))
    const source = new GuildjenSource(
      new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }),
      new DiskCache()
    )
    await source.search({ mode: 'wvw', profession: 'thief' })
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://guildjen.com/gw2-wvw-builds/')
  })

  it('wraps failure as SiteUnavailableError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'))
    const source = new GuildjenSource(
      new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }),
      new DiskCache()
    )
    await expect(source.search({ mode: 'wvw' })).rejects.toBeInstanceOf(SiteUnavailableError)
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/metaSources/guildjen.test.ts
```

- [ ] Implement `src/main/metaSources/guildjen.ts`:

```ts
import type { DiskCache } from '../knowledge/diskCache'
import type { HttpQueue } from '../knowledge/httpQueue'
import {
  SiteUnavailableError,
  type BuildListing,
  type BuildSummary,
  type GameMode,
  type MetaSource,
  type SearchFilters
} from './types'
import { stripTags, decodeEntities } from './wikitext'

const TTL_SEARCH = 12 * 60 * 60 * 1000
const TTL_BUILD = 24 * 60 * 60 * 1000
const NOTES_MAX = 500

/** Listing pages verified live (open-world inferred from the nav pattern — verify at capture time). */
const LISTING_PAGES: Record<GameMode, string> = {
  wvw: 'https://guildjen.com/gw2-wvw-builds/',
  pvp: 'https://guildjen.com/gw2-pvp-builds/',
  raid: 'https://guildjen.com/gw2-raid-builds/',
  fractal: 'https://guildjen.com/gw2-fractal-builds/',
  'open-world': 'https://guildjen.com/gw2-open-world-builds/',
  pve: 'https://guildjen.com/gw2-raid-builds/'
}
const DEFAULT_MODES: GameMode[] = ['wvw', 'pvp']

const PROFESSIONS = [
  'elementalist', 'engineer', 'guardian', 'mesmer', 'necromancer',
  'ranger', 'revenant', 'thief', 'warrior'
]

/** Split on profession headings, collect guildjen.com/...-build/ anchors per chunk. */
export function parseListing(html: string, mode: string): BuildListing[] {
  const out: BuildListing[] = []
  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  const boundaries: Array<{ profession: string; start: number }> = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(html)) !== null) {
    const text = stripTags(m[1]).trim().toLowerCase()
    const profession = PROFESSIONS.find((p) => text === p || text.startsWith(p))
    if (profession) boundaries.push({ profession, start: headingRe.lastIndex })
  }
  for (let i = 0; i < boundaries.length; i++) {
    const chunk = html.slice(boundaries[i].start, boundaries[i + 1]?.start ?? html.length)
    const linkRe = /<a\b[^>]*href="(https:\/\/guildjen\.com\/[a-z0-9-]+\/)"[^>]*>([\s\S]*?)<\/a>/gi
    let lm: RegExpExecArray | null
    while ((lm = linkRe.exec(chunk)) !== null) {
      const [, url, inner] = lm
      // Build pages end in "-build/"; skip category/nav links.
      if (!/-build\/$/.test(url)) continue
      const title = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
      if (!title) continue
      out.push({ site: 'guildjen', title, url, profession: boundaries[i].profession, mode })
    }
  }
  return out
}

export function parseBuildPage(html: string, url: string): BuildSummary {
  const title =
    decodeEntities(stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')).trim() ||
    decodeEntities(/<title>([^<|–-]+)/i.exec(html)?.[1] ?? '').trim()
  const text = decodeEntities(stripTags(html)).replace(/\s+/g, ' ')
  const role = /Role:\s*([A-Za-z /]+?)(?:\s{2,}|Preferred|$)/.exec(text)?.[1]?.trim()
  const chatCode = /\[&[A-Za-z0-9+/=]+\]/.exec(html)?.[0]

  // Notes: first ~2 sentences of body prose after the role line.
  const roleIdx = text.indexOf('Role:')
  const notes = (roleIdx >= 0 ? text.slice(roleIdx) : text).slice(0, NOTES_MAX).trim()

  // Equipment table rows → gear (slot | stats), best-effort.
  const gear: Array<{ slot: string; item: string }> = []
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(html)) !== null && gear.length < 24) {
    const slot = decodeEntities(stripTags(rm[1])).trim()
    const item = decodeEntities(stripTags(rm[2])).trim()
    if (slot && item) gear.push({ slot, item })
  }

  return {
    site: 'guildjen',
    title,
    url,
    role,
    traits: [],
    skills: { weapons: [], utilities: [] },
    gear,
    ...(chatCode ? { chatCode } : {}),
    notes,
    // GuildJen renders traits/skills as images; the chat code is the authoritative payload.
    partial: !chatCode
  }
}

export class GuildjenSource implements MetaSource {
  readonly id = 'guildjen' as const

  constructor(
    private readonly http: HttpQueue,
    private readonly cache: DiskCache
  ) {}

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.endsWith('guildjen.com')
    } catch {
      return false
    }
  }

  async search(filters: SearchFilters): Promise<BuildListing[]> {
    const modes: GameMode[] = filters.mode ? [filters.mode] : DEFAULT_MODES
    const all: BuildListing[] = []
    for (const mode of modes) {
      const pageUrl = LISTING_PAGES[mode]
      if (!pageUrl) continue
      let listings = this.cache.get<BuildListing[]>(this.id, `listing:${mode}`)
      if (!listings) {
        listings = parseListing(await this.fetch(pageUrl), mode)
        this.cache.set(this.id, `listing:${mode}`, listings, TTL_SEARCH)
      }
      all.push(...listings)
    }
    if (all.length === 0 && modes.some((m) => LISTING_PAGES[m]))
      throw new SiteUnavailableError(this.id, 'listing pages yielded no build links — markup changed?')
    return all
      .filter((l) => !filters.profession || l.profession === filters.profession.toLowerCase())
      .filter(
        (l) =>
          !filters.role ||
          l.title.toLowerCase().includes(filters.role.toLowerCase()) ||
          (l.role ?? '').toLowerCase().includes(filters.role.toLowerCase())
      )
      .slice(0, 25)
  }

  async getBuild(url: string): Promise<BuildSummary> {
    if (!this.canHandle(url)) throw new SiteUnavailableError(this.id, `not a guildjen URL: ${url}`)
    const cached = this.cache.get<BuildSummary>(this.id, `build:${url}`)
    if (cached) return cached
    const summary = parseBuildPage(await this.fetch(url), url)
    this.cache.set(this.id, `build:${url}`, summary, TTL_BUILD)
    return summary
  }

  private async fetch(url: string): Promise<string> {
    try {
      return await this.http.text(url)
    } catch (err) {
      throw new SiteUnavailableError(this.id, err instanceof Error ? err.message : String(err))
    }
  }
}
```

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/metaSources/guildjen.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: guildjen MetaSource — WordPress listing/build parsers with chat-code extraction`

---

## Task 6: GW2Mists source (SPA — fixture-first, endpoint unverified)

**Live check result:** gw2mists.com is fully client-rendered; `/builds`, `/sitemap.xml`, and `/api/builds` all returned only the SPA shell to a plain fetch. **The JSON endpoint shape below is an assumption** and must be confirmed at implementation time: open `https://gw2mists.com/builds` in a browser with devtools → Network → filter XHR/fetch, note the builds request URL + response, and save the response as the fixture. If the real shape differs, adapt `parseApiBuilds()` and the fixture together — the module's public surface and tests' assertions on `BuildListing` stay the same. Until corrected, a shape mismatch throws `SiteUnavailableError`, which the tools isolate (spec §4: a broken parser degrades to "site unavailable" for that site only).

**Files:**
- Create: `src/main/metaSources/__fixtures__/gw2mists-builds.json`
- Create: `src/main/metaSources/gw2mists.ts`
- Create: `src/main/metaSources/gw2mists.test.ts`

**Steps:**

- [ ] At implementation time, attempt live capture (browser devtools as above; also try `curl -sA 'axivale-desktop' 'https://gw2mists.com/api/builds'` — if it returns JSON, use it). **If capture fails**, check in this assumed-shape fixture `src/main/metaSources/__fixtures__/gw2mists-builds.json` and record `ENDPOINT UNVERIFIED` in the commit message:

```json
{
  "builds": [
    {
      "id": 101,
      "name": "Support Firebrand",
      "profession": "Guardian",
      "specialization": "Firebrand",
      "role": "Support",
      "rating": 4.7,
      "slug": "support-firebrand",
      "description": "Frontline boon/heal support for zergs."
    },
    {
      "id": 102,
      "name": "Power Hammer Vindicator",
      "profession": "Revenant",
      "specialization": "Vindicator",
      "role": "DPS",
      "rating": 4.5,
      "slug": "power-hammer-vindicator",
      "description": "Backline hammer damage."
    }
  ]
}
```

- [ ] Write the failing test `src/main/metaSources/gw2mists.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Gw2MistsSource } from './gw2mists'
import { DiskCache } from '../knowledge/diskCache'
import { HttpQueue } from '../knowledge/httpQueue'
import { SiteUnavailableError } from './types'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const buildsJson = readFileSync(join(fixtures, 'gw2mists-builds.json'), 'utf8')

function makeSource(body: string, status = 200) {
  const fetchImpl = vi.fn(async () => new Response(body, { status }))
  return {
    source: new Gw2MistsSource(
      new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }),
      new DiskCache()
    ),
    fetchImpl
  }
}

describe('Gw2MistsSource', () => {
  it('maps the builds payload to listings (all gw2mists builds are WvW)', async () => {
    const { source } = makeSource(buildsJson)
    const listings = await source.search({ profession: 'Guardian' })
    expect(listings).toHaveLength(1)
    expect(listings[0]).toMatchObject({
      site: 'gw2mists',
      title: 'Support Firebrand',
      profession: 'Guardian',
      mode: 'wvw',
      role: 'Support'
    })
    expect(listings[0].url).toContain('gw2mists.com')
  })

  it('treats a non-JSON (SPA shell) response as site unavailable', async () => {
    const { source } = makeSource('<!doctype html><html><title>Guild Wars 2 WvW Builds</title></html>')
    await expect(source.search({})).rejects.toBeInstanceOf(SiteUnavailableError)
  })

  it('treats an unexpected JSON shape as site unavailable', async () => {
    const { source } = makeSource('{"unexpected": true}')
    await expect(source.search({})).rejects.toBeInstanceOf(SiteUnavailableError)
  })

  it('getBuild returns a partial summary built from listing data', async () => {
    const { source } = makeSource(buildsJson)
    const [listing] = await source.search({ profession: 'Guardian' })
    const build = await source.getBuild(listing.url)
    expect(build.site).toBe('gw2mists')
    expect(build.title).toBe('Support Firebrand')
    expect(build.partial).toBe(true) // listing data only until the detail endpoint is confirmed
    expect(build.notes.length).toBeGreaterThan(0)
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/metaSources/gw2mists.test.ts
```

- [ ] Implement `src/main/metaSources/gw2mists.ts`:

```ts
import type { DiskCache } from '../knowledge/diskCache'
import type { HttpQueue } from '../knowledge/httpQueue'
import {
  SiteUnavailableError,
  type BuildListing,
  type BuildSummary,
  type MetaSource,
  type SearchFilters
} from './types'

// UNVERIFIED ENDPOINT (2026-06-12): gw2mists.com is a client-rendered SPA and
// exposed no server-rendered build data to a plain fetch. This URL and the
// payload shape in parseApiBuilds() are assumptions to be confirmed against
// the SPA's own XHR traffic at implementation time (see plan Task 6). A shape
// mismatch throws SiteUnavailableError — isolated per site by the meta tools.
const API_URL = 'https://gw2mists.com/api/builds'
const SITE = 'https://gw2mists.com'
const TTL_SEARCH = 12 * 60 * 60 * 1000
const NOTES_MAX = 500

interface ApiBuild {
  id: number
  name: string
  profession?: string
  specialization?: string
  role?: string
  rating?: number
  slug?: string
  description?: string
}

function parseApiBuilds(data: unknown): ApiBuild[] {
  const list = Array.isArray(data) ? data : (data as { builds?: unknown })?.builds
  if (!Array.isArray(list) || list.some((b) => typeof b?.name !== 'string')) {
    throw new SiteUnavailableError('gw2mists', 'builds payload shape not recognized — capture the real API response and update the parser')
  }
  return list as ApiBuild[]
}

export class Gw2MistsSource implements MetaSource {
  readonly id = 'gw2mists' as const

  constructor(
    private readonly http: HttpQueue,
    private readonly cache: DiskCache
  ) {}

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.endsWith('gw2mists.com')
    } catch {
      return false
    }
  }

  async search(filters: SearchFilters): Promise<BuildListing[]> {
    // gw2mists is WvW-only — a non-WvW mode filter never matches.
    if (filters.mode && filters.mode !== 'wvw') return []
    const listings = await this.allListings()
    return listings
      .filter((l) => !filters.profession || (l.profession ?? '').toLowerCase() === filters.profession.toLowerCase())
      .filter((l) => !filters.role || (l.role ?? '').toLowerCase().includes(filters.role.toLowerCase()))
      .slice(0, 25)
  }

  async getBuild(url: string): Promise<BuildSummary> {
    if (!this.canHandle(url)) throw new SiteUnavailableError(this.id, `not a gw2mists URL: ${url}`)
    // Detail endpoint unconfirmed — synthesize a partial summary from listing data.
    const listings = await this.allListings()
    const match = listings.find((l) => l.url === url)
    if (!match) throw new SiteUnavailableError(this.id, `build not found in listing: ${url}`)
    return {
      site: this.id,
      title: match.title,
      url,
      profession: match.profession,
      specialization: match.specialization,
      mode: 'wvw',
      role: match.role,
      rating: match.rating,
      traits: [],
      skills: { weapons: [], utilities: [] },
      gear: [],
      notes: (this.cache.get<string>(this.id, `desc:${url}`) ?? `${match.title} — WvW ${match.role ?? 'build'} on gw2mists.`).slice(0, NOTES_MAX),
      partial: true
    }
  }

  private async allListings(): Promise<BuildListing[]> {
    const cached = this.cache.get<BuildListing[]>(this.id, 'listing')
    if (cached) return cached
    let data: unknown
    try {
      data = await this.http.json(API_URL)
    } catch (err) {
      throw new SiteUnavailableError(this.id, err instanceof Error ? err.message : String(err))
    }
    const listings = parseApiBuilds(data).map((b): BuildListing => {
      const url = `${SITE}/builds/${(b.profession ?? 'unknown').toLowerCase()}/${b.slug ?? b.id}`
      if (b.description) this.cache.set(this.id, `desc:${url}`, b.description, TTL_SEARCH)
      return {
        site: this.id,
        title: b.name,
        url,
        profession: b.profession,
        specialization: b.specialization,
        mode: 'wvw',
        role: b.role,
        rating: b.rating !== undefined ? String(b.rating) : undefined
      }
    })
    this.cache.set(this.id, 'listing', listings, TTL_SEARCH)
    return listings
  }
}
```

> Note: `Response.json()` on the SPA-shell HTML throws a SyntaxError inside `http.json()` — caught and wrapped as `SiteUnavailableError` by the try/catch in `allListings()`, which is what the second test asserts.

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/metaSources/gw2mists.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: gw2mists MetaSource — fixture-first, endpoint flagged UNVERIFIED, fails soft`

---

## Task 7: Meta tools — `meta_search_builds` + `meta_get_build` with per-site isolation

Self-contained tool factory in `src/main/tools/meta.ts` (mkdir `src/main/tools/` if the sibling modularization hasn't created it yet — both files in this plan only ever *add* to that directory).

**Files:**
- Create: `src/main/tools/meta.ts`
- Create: `src/main/tools/meta.test.ts`

**Steps:**

- [ ] Write the failing test `src/main/tools/meta.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildMetaTools, type MetaToolDeps } from './meta'
import { SiteUnavailableError, type BuildListing, type BuildSummary, type MetaSource } from '../metaSources/types'

const listing = (site: BuildListing['site'], title: string): BuildListing => ({
  site,
  title,
  url: `https://${site}.example/${title.toLowerCase().replace(/ /g, '-')}`
})

const summary: BuildSummary = {
  site: 'metabattle',
  title: 'Support Firebrand',
  url: 'https://metabattle.com/wiki/Build:Firebrand_-_Support_Firebrand',
  profession: 'Guardian',
  traits: [{ line: 'Honor', choices: ['bot', 'top', 'mid'] }],
  skills: { weapons: ['staff'], utilities: ['Mantra of Potence'] },
  gear: [{ slot: 'stats', item: 'Minstrel' }],
  notes: 'Focus: healing',
  partial: false
}

function fakeSource(id: MetaSource['id'], opts: { fail?: boolean } = {}): MetaSource {
  return {
    id,
    canHandle: (url: string) => url.includes(id),
    search: opts.fail
      ? vi.fn().mockRejectedValue(new SiteUnavailableError(id, 'parser broke'))
      : vi.fn().mockResolvedValue([listing(id, `${id} build`)]),
    getBuild: vi.fn().mockResolvedValue({ ...summary, site: id })
  }
}

function handlerOf(deps: MetaToolDeps, name: string) {
  const t = buildMetaTools(deps).find((t) => t.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return async (args: unknown) => {
    const res = await t.handler(args, {})
    return { res, body: JSON.parse(res.content[0].text) }
  }
}

describe('meta tools', () => {
  it('exposes meta_search_builds and meta_get_build', () => {
    const names = buildMetaTools({ metaSources: [fakeSource('metabattle')] }).map((t) => t.name)
    expect(names).toEqual(['meta_search_builds', 'meta_get_build'])
  })

  it('search fans out to all sources and isolates per-site failures', async () => {
    const deps: MetaToolDeps = {
      metaSources: [fakeSource('metabattle'), fakeSource('hardstuck', { fail: true }), fakeSource('guildjen')]
    }
    const { res, body } = await handlerOf(deps, 'meta_search_builds')({})
    expect(res.isError).toBeUndefined()
    const bySite = Object.fromEntries(body.results.map((r: { site: string }) => [r.site, r]))
    expect(bySite.metabattle.builds).toHaveLength(1)
    expect(bySite.guildjen.builds).toHaveLength(1)
    expect(bySite.hardstuck.error).toContain('unavailable')
    expect(bySite.hardstuck.builds).toBeUndefined()
  })

  it('search restricted to one site only queries that site', async () => {
    const meta = fakeSource('metabattle')
    const guildjen = fakeSource('guildjen')
    const { body } = await handlerOf({ metaSources: [meta, guildjen] }, 'meta_search_builds')({ site: 'guildjen' })
    expect(body.results).toHaveLength(1)
    expect(meta.search).not.toHaveBeenCalled()
  })

  it('get_build routes by URL to the owning source', async () => {
    const meta = fakeSource('metabattle')
    const hs = fakeSource('hardstuck')
    const { body } = await handlerOf({ metaSources: [meta, hs] }, 'meta_get_build')({
      url: 'https://hardstuck.example/x'
    })
    expect(body.site).toBe('hardstuck')
    expect(meta.getBuild).not.toHaveBeenCalled()
  })

  it('get_build with an unknown host returns a friendly error result', async () => {
    const { res } = await handlerOf({ metaSources: [fakeSource('metabattle')] }, 'meta_get_build')({
      url: 'https://snowcrows.com/builds/x'
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/metabattle/)
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/tools/meta.test.ts
```

- [ ] Implement `src/main/tools/meta.ts`:

```ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { MetaSource, SearchFilters, SiteId } from '../metaSources/types'

export interface MetaToolDeps {
  metaSources: MetaSource[]
}

interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

// Compact JSON on purpose — results land in model context (same rationale as tools.ts).
function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function safe<A>(fn: (args: A) => Promise<unknown>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}

const SITE_IDS = ['metabattle', 'gw2mists', 'hardstuck', 'guildjen'] as const
const MODES = ['pve', 'open-world', 'fractal', 'raid', 'pvp', 'wvw'] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMetaTools(deps: MetaToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'meta_search_builds',
      'Search community meta-build sites (metabattle, gw2mists, hardstuck, guildjen) for current GW2 builds. Returns compact per-site listings with source URLs — pass a URL to meta_get_build for details. Sites that are down or unparseable report "unavailable" without affecting the others. Use this (not memory) for current meta builds: game balance changes frequently.',
      {
        profession: z.string().optional().describe('Base profession, e.g. Guardian'),
        mode: z.enum(MODES).optional().describe('Game mode to filter by'),
        role: z.string().optional().describe('Role, e.g. support, dps, roamer, bruiser'),
        site: z.enum(SITE_IDS).optional().describe('Restrict to one site; omit to query all')
      },
      safe(async ({ profession, mode, role, site }) => {
        const filters: SearchFilters = { profession, mode, role }
        const sources = site ? deps.metaSources.filter((s) => s.id === site) : deps.metaSources
        if (sources.length === 0) throw new Error(`Unknown site "${site}" — valid: ${SITE_IDS.join(', ')}`)
        const settled = await Promise.allSettled(sources.map((s) => s.search(filters)))
        const results = sources.map((s, i) => {
          const r = settled[i]
          return r.status === 'fulfilled'
            ? { site: s.id, builds: r.value }
            : {
                site: s.id,
                error: `site unavailable: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
              }
        })
        return { results }
      })
    ),
    tool(
      'meta_get_build',
      'Fetch one meta build by URL (from meta_search_builds or a user-pasted link) and return a normalized summary: traits, skills, gear, chat code when available, role notes, and the source URL. partial=true means the source page only allowed a partial extraction — tell the user to check the source URL for full details.',
      { url: z.string().describe('Build page URL on metabattle/gw2mists/hardstuck/guildjen') },
      safe(async ({ url }) => {
        const source = deps.metaSources.find((s) => s.canHandle(url))
        if (!source)
          throw new Error(
            `No parser for that URL. Supported sites: ${deps.metaSources.map((s) => s.id).join(', ')}`
          )
        return source.getBuild(url)
      })
    )
  ]
}
```

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/tools/meta.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: meta_search_builds + meta_get_build tools with per-site failure isolation`

---

## Task 8: Wiki client (`wiki.guildwars2.com/api.php`)

TypeScript port of the AxiForge `wiki.js` approach (extracts + info, redirects, plaintext intro), extended with search and infobox-fact extraction, cached via `DiskCache`.

**Files:**
- Create: `src/main/knowledge/__fixtures__/wiki-search.json`
- Create: `src/main/knowledge/__fixtures__/wiki-page.json`
- Create: `src/main/knowledge/__fixtures__/wiki-infobox.json`
- Create: `src/main/knowledge/wikiClient.ts`
- Create: `src/main/knowledge/wikiClient.test.ts`

**Steps:**

- [ ] Check in fixtures (standard MediaWiki `formatversion=2` shapes — same family as the live-verified metabattle responses; optionally refresh from the live wiki with curl at implementation time):

`wiki-search.json`:

```json
{
  "batchcomplete": true,
  "query": {
    "searchinfo": { "totalhits": 2 },
    "search": [
      { "ns": 0, "title": "Mantra of Solace", "pageid": 1, "snippet": "<span class=\"searchmatch\">Mantra of Solace</span> is a firebrand healing skill." },
      { "ns": 0, "title": "Mantra of Liberation", "pageid": 2, "snippet": "Elite mantra." }
    ]
  }
}
```

`wiki-page.json`:

```json
{
  "batchcomplete": true,
  "query": {
    "pages": [
      {
        "pageid": 1,
        "title": "Mantra of Solace",
        "extract": "Mantra of Solace is a healing mantra skill used by the firebrand.",
        "fullurl": "https://wiki.guildwars2.com/wiki/Mantra_of_Solace"
      }
    ]
  }
}
```

`wiki-infobox.json`:

```json
{
  "parse": {
    "title": "Mantra of Solace",
    "wikitext": "{{Skill infobox\n| description = Mantra. Heal yourself and grant aegis.\n| recharge = 10\n| profession = guardian\n| specialization = firebrand\n| slot = heal\n}}\nBody text."
  }
}
```

- [ ] Write the failing test `src/main/knowledge/wikiClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WikiClient } from './wikiClient'
import { DiskCache } from './diskCache'
import { HttpQueue } from './httpQueue'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const searchJson = readFileSync(join(fixtures, 'wiki-search.json'), 'utf8')
const pageJson = readFileSync(join(fixtures, 'wiki-page.json'), 'utf8')
const infoboxJson = readFileSync(join(fixtures, 'wiki-infobox.json'), 'utf8')

function makeClient(byUrl: (url: string) => string) {
  const fetchImpl = vi.fn(async (url: string | URL) => new Response(byUrl(String(url)), { status: 200 }))
  return {
    client: new WikiClient(
      new HttpQueue({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }),
      new DiskCache()
    ),
    fetchImpl
  }
}

describe('WikiClient', () => {
  it('search returns titles, plain-text snippets, and URLs', async () => {
    const { client, fetchImpl } = makeClient(() => searchJson)
    const results = await client.search('mantra of solace')
    expect(String(fetchImpl.mock.calls[0][0])).toContain('wiki.guildwars2.com/api.php')
    expect(results[0]).toEqual({
      title: 'Mantra of Solace',
      snippet: 'Mantra of Solace is a firebrand healing skill.',
      url: 'https://wiki.guildwars2.com/wiki/Mantra_of_Solace'
    })
  })

  it('page returns the intro extract + canonical URL (extracts|info pattern from AxiForge wiki.js)', async () => {
    const { client, fetchImpl } = makeClient(() => pageJson)
    const page = await client.page('Mantra of Solace')
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('prop=extracts%7Cinfo')
    expect(url).toContain('explaintext=1')
    expect(url).toContain('redirects=1')
    expect(page).toMatchObject({
      title: 'Mantra of Solace',
      summary: expect.stringContaining('healing mantra'),
      url: 'https://wiki.guildwars2.com/wiki/Mantra_of_Solace',
      missing: false
    })
  })

  it('page flags missing pages with a fallback URL', async () => {
    const { client } = makeClient(() => '{"query":{"pages":[{"missing":true,"title":"Nope"}]}}')
    const page = await client.page('Nope')
    expect(page.missing).toBe(true)
    expect(page.url).toBe('https://wiki.guildwars2.com/wiki/Nope')
  })

  it('lookup merges the summary with infobox facts', async () => {
    const { client } = makeClient((url) => (url.includes('action=parse') ? infoboxJson : pageJson))
    const result = await client.lookup('skill', 'Mantra of Solace')
    expect(result.title).toBe('Mantra of Solace')
    expect(result.facts).toMatchObject({ recharge: '10', slot: 'heal', profession: 'guardian' })
    expect(result.summary).toContain('healing mantra')
  })

  it('lookup("relic", name) tries the "Relic of" prefixed title', async () => {
    const { client, fetchImpl } = makeClient(() => pageJson)
    await client.lookup('relic', 'the Monk')
    expect(decodeURIComponent(String(fetchImpl.mock.calls[0][0]))).toContain('Relic of the Monk')
  })

  it('caches page lookups (one fetch per title)', async () => {
    const { client, fetchImpl } = makeClient(() => pageJson)
    await client.page('Mantra of Solace')
    await client.page('Mantra of Solace')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/knowledge/wikiClient.test.ts
```

- [ ] Implement `src/main/knowledge/wikiClient.ts`:

```ts
import type { DiskCache } from './diskCache'
import type { HttpQueue } from './httpQueue'
import { extractTemplates, templateParams, stripTags, decodeEntities } from '../metaSources/wikitext'

const WIKI_API = 'https://wiki.guildwars2.com/api.php'
const NAMESPACE = 'wiki'
const TTL = 24 * 60 * 60 * 1000 // 24h on disk (AxiForge used 15min in-memory; we persist)

export type WikiLookupType = 'skill' | 'trait' | 'item' | 'relic'

export interface WikiSearchResult {
  title: string
  snippet: string
  url: string
}

export interface WikiPage {
  title: string
  summary: string
  url: string
  missing: boolean
}

export interface WikiLookupResult extends WikiPage {
  type: WikiLookupType
  facts: Record<string, string>
}

interface SearchResponse {
  query?: { search?: Array<{ title: string; snippet?: string }> }
}
interface PagesResponse {
  query?: { pages?: Array<{ title?: string; extract?: string; fullurl?: string; missing?: boolean }> }
}
interface ParseResponse {
  parse?: { wikitext?: string }
}

function wikiUrl(title: string): string {
  return `https://wiki.guildwars2.com/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`
}

function api(params: Record<string, string>): string {
  const url = new URL(WIKI_API)
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) {
    url.searchParams.set(k, v)
  }
  return url.toString()
}

export class WikiClient {
  constructor(
    private readonly http: HttpQueue,
    private readonly cache: DiskCache
  ) {}

  async search(query: string): Promise<WikiSearchResult[]> {
    const key = `search:${query.toLowerCase()}`
    const cached = this.cache.get<WikiSearchResult[]>(NAMESPACE, key)
    if (cached) return cached
    const data = (await this.http.json(
      api({ action: 'query', list: 'search', srsearch: query, srlimit: '15' })
    )) as SearchResponse
    const results = (data.query?.search ?? []).map((r) => ({
      title: r.title,
      snippet: decodeEntities(stripTags(r.snippet ?? '')),
      url: wikiUrl(r.title)
    }))
    this.cache.set(NAMESPACE, key, results, TTL)
    return results
  }

  /** Intro summary + canonical URL — exact prop set used by AxiForge wiki.js getWikiSummary. */
  async page(title: string): Promise<WikiPage> {
    const key = `page:${title.toLowerCase()}`
    const cached = this.cache.get<WikiPage>(NAMESPACE, key)
    if (cached) return cached
    const data = (await this.http.json(
      api({
        action: 'query',
        prop: 'extracts|info',
        inprop: 'url',
        exintro: '1',
        explaintext: '1',
        redirects: '1',
        titles: title
      })
    )) as PagesResponse
    const found = (data.query?.pages ?? []).find((p) => p && !p.missing)
    const result: WikiPage = {
      title: found?.title ?? title,
      summary: found?.extract ?? '',
      url: found?.fullurl ?? wikiUrl(title),
      missing: !found
    }
    this.cache.set(NAMESPACE, key, result, TTL)
    return result
  }

  /**
   * Type-aware lookup: resolves the page (with type-specific title candidates),
   * then extracts key facts from the page's infobox template. Infobox templates
   * are matched generically (any "{{... infobox}}") so exact template names per
   * type don't need to be hardcoded.
   */
  async lookup(type: WikiLookupType, name: string): Promise<WikiLookupResult> {
    const candidates = titleCandidates(type, name)
    let page = await this.page(candidates[0])
    for (let i = 1; page.missing && i < candidates.length; i++) {
      page = await this.page(candidates[i])
    }
    const facts = page.missing ? {} : await this.infoboxFacts(page.title)
    return { ...page, type, facts }
  }

  private async infoboxFacts(title: string): Promise<Record<string, string>> {
    const key = `infobox:${title.toLowerCase()}`
    const cached = this.cache.get<Record<string, string>>(NAMESPACE, key)
    if (cached) return cached
    let facts: Record<string, string> = {}
    try {
      const data = (await this.http.json(
        api({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' })
      )) as ParseResponse
      const wikitext = data.parse?.wikitext ?? ''
      const [infobox] = extractTemplates(wikitext, '[A-Za-z ]*infobox')
      if (infobox) {
        const { named } = templateParams(infobox)
        for (const [k, v] of Object.entries(named)) {
          const clean = decodeEntities(stripTags(v)).replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1').trim()
          if (clean) facts[k] = clean.slice(0, 200)
        }
      }
    } catch {
      facts = {} // facts are best-effort garnish; the summary already answered
    }
    this.cache.set(NAMESPACE, key, facts, TTL)
    return facts
  }
}

function titleCandidates(type: WikiLookupType, name: string): string[] {
  const trimmed = name.trim()
  if (type === 'relic' && !/^relic of /i.test(trimmed)) {
    return [`Relic of ${trimmed}`, trimmed]
  }
  return [trimmed]
}
```

> `extractTemplates` is called with the pattern `'[A-Za-z ]*infobox'` — this requires the Task 3 note's `extractTemplatesByPattern` variant (or the `RegExp`-accepting overload). Use whichever was implemented in Task 3 consistently.

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/knowledge/wikiClient.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: GW2 wiki client — search, page summary, infobox-fact lookup with disk cache`

---## Task 9: Wiki tools — `gw2wiki_search`, `gw2wiki_page`, `gw2wiki_lookup`

**Files:**
- Create: `src/main/tools/wiki.ts`
- Create: `src/main/tools/wiki.test.ts`

**Steps:**

- [ ] Write the failing test `src/main/tools/wiki.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildWikiTools, type WikiToolDeps } from './wiki'

function makeDeps(): WikiToolDeps {
  return {
    wiki: {
      search: vi.fn().mockResolvedValue([
        { title: 'Mantra of Solace', snippet: 'A heal skill', url: 'https://wiki.guildwars2.com/wiki/Mantra_of_Solace' }
      ]),
      page: vi.fn().mockResolvedValue({
        title: 'Firebrand',
        summary: 'Firebrand is an elite specialization for the guardian.',
        url: 'https://wiki.guildwars2.com/wiki/Firebrand',
        missing: false
      }),
      lookup: vi.fn().mockResolvedValue({
        type: 'relic',
        title: 'Relic of the Monk',
        summary: 'Grants outgoing healing.',
        url: 'https://wiki.guildwars2.com/wiki/Relic_of_the_Monk',
        missing: false,
        facts: { type: 'relic' }
      })
    } as never
  }
}

function handlerOf(deps: WikiToolDeps, name: string) {
  const t = buildWikiTools(deps).find((t) => t.name === name)
  if (!t) throw new Error(`tool ${name} not found`)
  return async (args: unknown) => {
    const res = await t.handler(args, {})
    return { res, body: JSON.parse(res.content[0].text) }
  }
}

describe('wiki tools', () => {
  it('exposes the three wiki tools', () => {
    expect(buildWikiTools(makeDeps()).map((t) => t.name)).toEqual([
      'gw2wiki_search',
      'gw2wiki_page',
      'gw2wiki_lookup'
    ])
  })

  it('gw2wiki_search passes the query through', async () => {
    const deps = makeDeps()
    const { body } = await handlerOf(deps, 'gw2wiki_search')({ query: 'mantra' })
    expect(deps.wiki.search).toHaveBeenCalledWith('mantra')
    expect(body[0].title).toBe('Mantra of Solace')
  })

  it('gw2wiki_page returns summary + url', async () => {
    const { body } = await handlerOf(makeDeps(), 'gw2wiki_page')({ title: 'Firebrand' })
    expect(body.summary).toContain('elite specialization')
    expect(body.url).toContain('/wiki/Firebrand')
  })

  it('gw2wiki_lookup forwards type and name', async () => {
    const deps = makeDeps()
    const { body } = await handlerOf(deps, 'gw2wiki_lookup')({ type: 'relic', name: 'the Monk' })
    expect(deps.wiki.lookup).toHaveBeenCalledWith('relic', 'the Monk')
    expect(body.facts).toBeDefined()
  })

  it('wraps client errors as MCP error results, not exceptions', async () => {
    const deps = makeDeps()
    ;(deps.wiki.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('wiki down'))
    const { res } = await handlerOf(deps, 'gw2wiki_search')({ query: 'x' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('wiki down')
  })
})
```

- [ ] Run and confirm failure:

```
npx vitest run --maxWorkers=2 src/main/tools/wiki.test.ts
```

- [ ] Implement `src/main/tools/wiki.ts`:

```ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { WikiClient } from '../knowledge/wikiClient'

export interface WikiToolDeps {
  wiki: WikiClient
}

interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function safe<A>(fn: (args: A) => Promise<unknown>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildWikiTools(deps: WikiToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2wiki_search',
      'Search the official Guild Wars 2 wiki (wiki.guildwars2.com). Returns titles, plain-text snippets, and page URLs. Use this to ground game knowledge — mechanics, skills, items, events — instead of relying on training data, which is stale for GW2 balance.',
      { query: z.string().describe('Search terms, e.g. "Mantra of Solace" or "WvW objective scaling"') },
      safe(async ({ query }) => deps.wiki.search(query))
    ),
    tool(
      'gw2wiki_page',
      'Fetch a GW2 wiki page intro summary by exact title (redirects followed). Returns title, plain-text summary, canonical URL, and missing=true when the page does not exist (use gw2wiki_search first when unsure of the title).',
      { title: z.string().describe('Exact wiki page title, e.g. "Firebrand"') },
      safe(async ({ title }) => deps.wiki.page(title))
    ),
    tool(
      'gw2wiki_lookup',
      'Look up a specific GW2 skill, trait, item, or relic on the wiki and return its summary plus structured key facts pulled from the page infobox (recharge, slot, profession, stats, …). For relics, pass the short name — "the Monk" resolves to "Relic of the Monk".',
      {
        type: z.enum(['skill', 'trait', 'item', 'relic']).describe('What kind of thing this is'),
        name: z.string().describe('Name, e.g. "Mantra of Solace", "Quick Draw", "the Monk"')
      },
      safe(async ({ type, name }) => deps.wiki.lookup(type, name))
    )
  ]
}
```

- [ ] Run, expect green:

```
npx vitest run --maxWorkers=2 src/main/tools/wiki.test.ts
```

- [ ] Run `npm run typecheck` — expect clean.
- [ ] Commit: `feat: gw2wiki_search / gw2wiki_page / gw2wiki_lookup tools`

---

## Task 10: Wire into `buildOfficerTools()` and the main process

**Files:**
- Modify: `src/main/tools/index.ts` (option A — exists) **or** `src/main/tools.ts` (option B — sibling plan not yet executed)
- Modify: `src/main/index.ts`
- Modify: `src/main/tools.test.ts` (option B only)

**Steps:**

- [ ] **Check which layout exists:** `ls src/main/tools/index.ts`.

- [ ] **Option A — `src/main/tools/index.ts` exists (sibling modular layout):** extend its `ToolDeps` with the two new dep fields and spread the new factories into the composed array:

```ts
// additions to src/main/tools/index.ts
import { buildMetaTools, type MetaToolDeps } from './meta'
import { buildWikiTools, type WikiToolDeps } from './wiki'

// ToolDeps gains:
//   metaSources: MetaSource[]
//   wiki: WikiClient
// (i.e. `export interface ToolDeps extends ..., MetaToolDeps, WikiToolDeps`)

// inside buildOfficerTools(deps):
return [
  ...existingModules,
  ...buildMetaTools(deps),
  ...buildWikiTools(deps)
]
```

Add to the index's tool-name test (wherever the sibling plan put it) that `meta_search_builds`, `meta_get_build`, `gw2wiki_search`, `gw2wiki_page`, `gw2wiki_lookup` appear in `buildOfficerTools(...)` output. **None of these join `DESTRUCTIVE_TOOLS`** — all five are read-only.

- [ ] **Option B — only monolithic `src/main/tools.ts` exists:** add to `ToolDeps`:

```ts
import type { MetaSource } from './metaSources/types'
import type { WikiClient } from './knowledge/wikiClient'

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  metaSources: MetaSource[]
  wiki: WikiClient
  discordGuildId: () => string
  gw2GuildId: () => string
}
```

and append inside the returned array of `buildOfficerTools(deps)` (after the `gw2_guild_log` tool):

```ts
    ...buildMetaTools({ metaSources: deps.metaSources }),
    ...buildWikiTools({ wiki: deps.wiki })
```

with imports `import { buildMetaTools } from './tools/meta'` and `import { buildWikiTools } from './tools/wiki'`. Then extend `makeDeps()` in `src/main/tools.test.ts` with:

```ts
    metaSources: [] as never,
    wiki: {
      search: vi.fn().mockResolvedValue([]),
      page: vi.fn().mockResolvedValue({ title: 'X', summary: '', url: '', missing: true }),
      lookup: vi.fn().mockResolvedValue({})
    } as never,
```

and add the five new tool names to the `expect.arrayContaining([...])` list in the "exposes the expected tool names" test.

- [ ] Wire the main process in `src/main/index.ts` — instantiate shared infra once inside `app.whenReady().then(async () => { ... })` (near the `SettingsStore` construction at line ~58) and add the two deps to the `toolDeps: () => ({ ... })` object (line ~88):

```ts
import { DiskCache } from './knowledge/diskCache'
import { HttpQueue } from './knowledge/httpQueue'
import { WikiClient } from './knowledge/wikiClient'
import { MetabattleSource } from './metaSources/metabattle'
import { Gw2MistsSource } from './metaSources/gw2mists'
import { HardstuckSource } from './metaSources/hardstuck'
import { GuildjenSource } from './metaSources/guildjen'

// inside app.whenReady().then(async () => { ... }), after the store is built:
const knowledgeCache = new DiskCache()
await knowledgeCache.init(app.getPath('userData'))
const knowledgeHttp = new HttpQueue() // max 3 concurrent, shared across all sources + wiki
const metaSources = [
  new MetabattleSource(knowledgeHttp, knowledgeCache),
  new Gw2MistsSource(knowledgeHttp, knowledgeCache),
  new HardstuckSource(knowledgeHttp, knowledgeCache),
  new GuildjenSource(knowledgeHttp, knowledgeCache)
]
const wiki = new WikiClient(knowledgeHttp, knowledgeCache)

// in toolDeps:
    toolDeps: () => ({
      axitools: buildAxitools(),
      gw2: buildGw2(),
      metaSources,
      wiki,
      discordGuildId: () => store.getSetting('guildId') ?? '',
      gw2GuildId: () => store.getSetting('gw2GuildId') ?? ''
    }),
```

Unlike `buildAxitools()`/`buildGw2()` these are stateful (shared cache/queue) and keyless, so single instances captured by the closure are correct.

- [ ] Run the full suite and typecheck:

```
npx vitest run --maxWorkers=2
npm run typecheck
```

Expected: every suite green (including pre-existing ones), typecheck clean.

- [ ] Manual smoke test (live network, not CI): `npm run dev`, then in chat ask "search metabattle for a wvw support firebrand and summarize the top result" — expect `meta_search_builds` → listings with metabattle URLs, `meta_get_build` → traits/skills/gear summary. Then "what does Relic of the Monk do?" — expect `gw2wiki_lookup`. Kill networking (or use a bogus DNS) and re-ask the meta search — expect per-site `"site unavailable: ..."` entries rather than a thrown tool error.

- [ ] Commit: `feat: register GW2 meta + wiki knowledge tools in buildOfficerTools`

---

## Verification checklist (whole plan)

- [ ] `npx vitest run --maxWorkers=2` — all green, no live network used by any test (grep tests for `https://` fetches: all `fetchImpl` are mocks/fixtures).
- [ ] `npm run typecheck` — clean.
- [ ] All five tools appear in `buildOfficerTools()` output; none added to `DESTRUCTIVE_TOOLS` (read-only).
- [ ] Per-site isolation proven by test: one failing source → `"site unavailable"` entry, other sites' results intact.
- [ ] Throttling: single shared `HttpQueue` (max 3 concurrent) across all meta sources + wiki, proven by test.
- [ ] Cache: namespaced per source (`metabattle:`/`gw2mists:`/`hardstuck:`/`guildjen:`/`wiki:`), TTL 12h (searches/listings) and 24h (build pages/wiki), persisted to `<userData>/knowledge-cache.json`.
- [ ] gw2mists module carries the `UNVERIFIED ENDPOINT` comment and fails soft until real fixtures are captured.

## Out of scope (other plans / spec sections)

- `build-card` display payload attachment on `meta_get_build` results (spec §4 mentions it; the `display` infrastructure is spec §6, a separate plan — when it lands, attach `display: { kind: 'build-card', data: summary }` in `tools/meta.ts` when `partial === false`).
- System-prompt additions about grounding in these tools (spec §7, separate plan).
- AxiForge tools, local API, launcher (spec §§1–3, sibling plans).
