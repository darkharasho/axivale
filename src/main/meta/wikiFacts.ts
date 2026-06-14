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
