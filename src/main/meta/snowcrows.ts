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

const MAX_PAGES = 30
const BUDGET_MS = 120_000
const MAX_TOTAL_CHARS = 16_000 // bound the joined excerpt handed to the distiller (parity with the browser path)

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
  const text = pages.map((p) => p.text).join('\n\n=== build page ===\n\n').slice(0, MAX_TOTAL_CHARS)
  return { ok: true, text, pages }
}
