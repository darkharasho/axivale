// src/main/meta/wiki/skillCrawl.ts
//
// Per-page skill/trait crawl + compression for the wiki corpus. The aggregate
// "List of <profession> skills" pages are terse tables; the individual pages carry
// the real description, mechanics notes, and PvE/WvW/PvP split markers. We
// enumerate each profession's skill/trait category, then COMPRESS each page to a
// dense record (descriptor + description + recharge/cast + split flag + a slice of
// notes) so the corpus gains real per-skill content without thousands of bloated
// chunks. Exact numbers still come live from gw2_wiki_facts.
import { stripWikiMarkup } from '@axiapps/gw2-data'
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
    const body = (await res.json()) as CmResponse
    for (const m of body.query?.categorymembers ?? []) {
      if (m.title) titles.push(m.title)
    }
    cont = body.continue?.cmcontinue
    if (!cont) break
  }
  return titles
}

// Pull a top-level infobox param value (e.g. "| recharge = 30"). Stops at the next
// "\n|" param or the template's "\n}}" close, so multi-line values are captured.
function infoboxField(wikitext: string, name: string): string | null {
  const re = new RegExp(`\\|\\s*${name}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\||\\n\\}\\})`, 'i')
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

// Icon templates ({{Power}}, {{Condition Damage}}) carry meaning but stripWikiMarkup
// deletes them; keep the inner label for stat lines like rune bonuses.
function cleanInline(s: string): string {
  return cleanWikiText(s.replace(/\{\{([^}|]+)[^}]*\}\}/g, '$1'))
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
  const hasSplit = /\|\s*split\s*=/.test(wikitext)

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
  // Drop boilerplate section labels the templates leave behind.
  body = body.replace(/\b(?:Related traits|Related skills|See also|Trivia|Version history)\b/gi, ' ')
  body = body.replace(/\s+/g, ' ').trim().slice(0, 500)

  const parts: string[] = [`${title}${descriptor ? ` — ${descriptor}` : ''}.`]
  if (desc) parts.push(desc)
  const nums: string[] = []
  if (recharge) nums.push(`recharge ${recharge}s`)
  if (activation) nums.push(`cast ${activation}s`)
  if (nums.length) parts.push(`${nums.join(', ')}.`)
  if (hasSplit) parts.push('Has PvE/WvW/PvP balance splits.')
  if (body.length > 40) parts.push(body)

  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
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
  const bonuses: string[] = []
  for (let n = 1; n <= 6; n++) {
    const b = f(`bonus${n}`)
    if (b) bonuses.push(`(${n}) ${cleanInline(b)}`)
  }
  const parts: string[] = [`${title}${type ? ` — ${type}` : ''}.`]
  if (desc) parts.push(desc)
  if (bonuses.length) parts.push(`Bonuses: ${bonuses.join('; ')}.`)
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
}
