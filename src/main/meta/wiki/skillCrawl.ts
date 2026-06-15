// src/main/meta/wiki/skillCrawl.ts
//
// Per-page skill/trait crawl + compression for the wiki corpus. The aggregate
// "List of <profession> skills" pages are terse tables; the individual pages carry
// the real description, mechanics notes, and PvE/WvW/PvP split markers. We
// enumerate each profession's skill/trait category, then COMPRESS each page to a
// dense record (descriptor + description + recharge/cast + split flag + a slice of
// notes) so the corpus gains real per-skill content without thousands of bloated
// chunks. Exact numbers still come live from gw2_wiki_facts.
import { stripWikiMarkup, parseFactsByMode } from '@axiapps/gw2-data'
import { cleanWikiText } from './cleanText'

export interface CategoryFetch {
  (url: string): Promise<{ ok: boolean; json(): Promise<unknown> }>
}

const WIKI_API = 'https://wiki.guildwars2.com/api.php'

interface CmResponse {
  query?: { categorymembers?: Array<{ title?: string }> }
  continue?: { cmcontinue?: string }
}

/** All ns=0 page titles in a wiki category, following cmcontinue. Network-only. */
export async function fetchCategoryMembers(
  category: string,
  fetchImpl: CategoryFetch,
  maxPages = 20
): Promise<string[]> {
  const titles: string[] = []
  let cont: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${WIKI_API}?action=query&list=categorymembers` +
      `&cmtitle=${encodeURIComponent(category)}` +
      `&cmnamespace=0&cmlimit=500&format=json&formatversion=2` +
      (cont ? `&cmcontinue=${encodeURIComponent(cont)}` : '')
    const res = await fetchImpl(url)
    if (!res.ok) break
    // The wiki API returns HTML (not JSON) to UA-less/blocked requests; tolerate it.
    let body: CmResponse
    try {
      body = (await res.json()) as CmResponse
    } catch {
      break
    }
    for (const m of body.query?.categorymembers ?? []) {
      if (m.title) titles.push(m.title)
    }
    cont = body.continue?.cmcontinue
    if (!cont) break
  }
  return titles
}

// Pull a top-level infobox param value (e.g. "| recharge = 30"). The "|" must be at
// a line start so nested template params (e.g. |weapon=utility inside a {{skill
// fact}}) don't match. Stops at the next "\n|" param or the "\n}}" close.
function infoboxField(wikitext: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*\\|\\s*${name}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\||\\n\\}\\})`, 'i')
  const m = re.exec(wikitext)
  return m ? m[1].trim() : null
}

// Index just past the first {{Skill/Trait infobox …}} block (brace-matched), so we
// can take the page body (Notes etc.) without the raw infobox template.
function bodyStart(wikitext: string): number {
  const m = /\{\{\s*(?:skill|trait) infobox/i.exec(wikitext)
  if (!m) return 0
  let depth = 0
  for (let i = m.index; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++
      i++
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--
      i++
      if (depth === 0) return i + 1
    }
  }
  return wikitext.length
}

// --- Mode-split facts (PvE/WvW/PvP) via @axiapps/gw2-data parseFactsByMode ---
// Each fact carries one value-ish field; we compare it across modes to surface the
// balance splits the official API lacks (the whole reason the wiki matters here).
interface ModeFact {
  type?: string
  text?: string
  status?: string
  value?: number
  duration?: number
  percent?: number
  distance?: number
  dmg_multiplier?: number
  hit_count?: number
  apply_count?: number
  coefficient?: number
}
interface ModeNums {
  pve?: number | null
  wvw?: number | null
  pvp?: number | null
}
interface ParsedFacts {
  pve?: ModeFact[]
  wvw?: ModeFact[]
  pvp?: ModeFact[]
  hasSplit?: boolean
  recharge?: ModeNums
  activation?: ModeNums
}

const VALUE_KEYS: Array<keyof ModeFact> = [
  'dmg_multiplier',
  'coefficient',
  'duration',
  'percent',
  'distance',
  'apply_count',
  'hit_count',
  'value'
]

const factKey = (f: ModeFact): string =>
  f.status ? `${f.type}:${f.status}` : `${f.type}:${(f.text ?? '').toLowerCase()}`

function factValue(f: ModeFact): { key: keyof ModeFact; val: number } | null {
  for (const k of VALUE_KEYS) {
    const v = f[k]
    if (typeof v === 'number') return { key: k, val: v }
  }
  return null
}

function renderVal(key: keyof ModeFact, val: number): string {
  if (key === 'dmg_multiplier' || key === 'coefficient' || key === 'apply_count' || key === 'hit_count')
    return `×${val}`
  if (key === 'duration') return `${val}s`
  if (key === 'percent') return `${val}%`
  return `${val}`
}

// "recharge 30s (WvW 35s)" — only shows a mode when it differs from PvE.
function renderModeNums(label: string, m: ModeNums | undefined, fallback: string | null): string {
  const pve = m?.pve ?? (fallback != null && fallback !== '' ? Number(fallback) : null)
  if (pve == null || Number.isNaN(pve)) return ''
  const splits: string[] = []
  if (m?.wvw != null && m.wvw !== pve) splits.push(`WvW ${m.wvw}s`)
  if (m?.pvp != null && m.pvp !== pve) splits.push(`PvP ${m.pvp}s`)
  return `${label} ${pve}s${splits.length ? ` (${splits.join(', ')})` : ''}`
}

// "Damage ×1.6 (WvW ×0.88, PvP ×1.1); Fury 4s" — leads with split facts, capped.
// A split fact appears once per mode array under the same key, so pair the Nth
// PvE fact of a key with the Nth WvW/PvP fact of that key (not just by key — a
// skill can have several "Damage" facts, and key-only matching mis-pairs them).
function formatFacts(parsed: ParsedFacts): string {
  const pve = parsed.pve ?? []
  if (pve.length === 0) return ''
  const groupByKey = (arr: ModeFact[]): Map<string, ModeFact[]> => {
    const m = new Map<string, ModeFact[]>()
    for (const f of arr) {
      const k = factKey(f)
      const list = m.get(k) ?? []
      list.push(f)
      m.set(k, list)
    }
    return m
  }
  const wvw = groupByKey(parsed.wvw ?? [])
  const pvp = groupByKey(parsed.pvp ?? [])
  const seen = new Map<string, number>()
  const out: string[] = []
  for (const f of pve) {
    const v = factValue(f)
    if (!v) continue
    const k = factKey(f)
    const idx = seen.get(k) ?? 0
    seen.set(k, idx + 1)
    const w = wvw.get(k)?.[idx]
    const p = pvp.get(k)?.[idx]
    const wv = w ? factValue(w) : null
    const pv = p ? factValue(p) : null
    const splits: string[] = []
    if (wv && wv.val !== v.val) splits.push(`WvW ${renderVal(wv.key, wv.val)}`)
    if (pv && pv.val !== v.val) splits.push(`PvP ${renderVal(pv.key, pv.val)}`)
    const labelText = f.text || f.type || 'Fact'
    out.push(`${labelText} ${renderVal(v.key, v.val)}${splits.length ? ` (${splits.join(', ')})` : ''}`)
    if (out.length >= 10) break
  }
  return out.join('; ')
}

// Icon templates ({{Power}}, {{Condition Damage}}) carry meaning but stripWikiMarkup
// deletes them; keep the inner label for stat lines like rune bonuses.
function cleanInline(s: string): string {
  return cleanWikiText(
    s
      .replace(/\{\{([^}|]+)[^}]*\}\}/g, '$1') // {{Power}} → Power
      .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1') // [[x|label]] → label
      .replace(/\[\[([^\]|]+)\]\]/g, '$1') // [[Damage]] → Damage
  )
}

/** Compress one skill/trait/upgrade page's wikitext into a dense, embeddable record. */
export function compressWikiPage(wikitext: string, title: string): string {
  if (!wikitext) return ''
  const f = (n: string): string | null => infoboxField(wikitext, n)
  if (/\{\{\s*(?:upgrade component|rune|sigil|relic) infobox/i.test(wikitext)) {
    return compressUpgrade(wikitext, title, f)
  }
  const desc = cleanWikiText(stripWikiMarkup(f('description') ?? ''))
  const profession = f('profession')
  const weapon = f('twohand') ?? f('mainhand') ?? f('offhand') ?? f('weapon')
  const slot = f('slot')
  const attunement = f('attunement')
  const type = f('type')
  const recharge = f('recharge')
  const activation = f('activation')
  let parsed: ParsedFacts | null = null
  try {
    parsed = parseFactsByMode(wikitext) as ParsedFacts
  } catch {
    parsed = null
  }

  const descriptor = [
    attunement,
    weapon,
    type,
    slot ? `${slot} skill` : null,
    profession ? `(${profession})` : null
  ]
    .filter(Boolean)
    .join(' ')

  let body = cleanWikiText(stripWikiMarkup(wikitext.slice(bodyStart(wikitext))))
  // Cut the low-value tail sections (changelog/trivia/gallery) entirely. No \b —
  // collapsed headings can fuse to the prior word ("traitsVersion history").
  body = body.split(/Version history|Trivia|See also|Gallery/i)[0]
  // …then drop the leftover related-* labels.
  body = body.replace(/Related traits|Related skills/gi, ' ')
  body = body.replace(/\s+/g, ' ').trim().slice(0, 500)

  const parts: string[] = [`${title}${descriptor ? ` — ${descriptor}` : ''}.`]
  if (desc) parts.push(desc)
  const nums = [
    renderModeNums('recharge', parsed?.recharge, recharge),
    renderModeNums('cast', parsed?.activation, activation)
  ].filter(Boolean)
  if (nums.length) parts.push(`${nums.join(', ')}.`)
  const facts = parsed ? formatFacts(parsed) : ''
  if (facts) parts.push(`Facts: ${facts}.`)
  else if (parsed?.hasSplit) parts.push('Has PvE/WvW/PvP balance splits.')
  if (body.length > 40) parts.push(body)

  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200)
}

// Runes / sigils / relics: the bonuses live in bonus1..bonusN infobox params, and
// stripWikiMarkup would drop the {{Power}}-style stat icons inside them.
function compressUpgrade(
  wikitext: string,
  title: string,
  f: (n: string) => string | null
): string {
  const type = f('type')
  const desc = cleanWikiText(stripWikiMarkup(f('description') ?? ''))
  // Sigils/relics put their effect in "variables"; runes use bonus1..6.
  const variables = f('variables')
  const bonuses: string[] = []
  for (let n = 1; n <= 6; n++) {
    const b = f(`bonus${n}`)
    if (b) bonuses.push(`(${n}) ${cleanInline(b)}`)
  }
  const parts: string[] = [`${title}${type ? ` — ${type}` : ''}.`]
  if (desc) parts.push(desc)
  if (variables) parts.push(`Effect: ${cleanInline(variables)}.`)
  if (bonuses.length) parts.push(`Bonuses: ${bonuses.join('; ')}.`)
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
}
