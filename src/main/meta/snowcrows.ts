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
