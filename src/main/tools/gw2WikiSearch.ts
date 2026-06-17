// src/main/tools/gw2WikiSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

type LiveSearch = (query: string) => Promise<Array<{ title: string; url: string; snippet: string }>>

// Queries about OBTAINING something (crafting, collections, recipes, achievements)
// need the live wiki: the per-tier task tables live in MediaWiki templates that
// the pre-ingested wikitext corpus strips away, so the index only holds weak
// overview chunks for them. Consult the live (rendered-HTML) lookup for these even
// when the index returns hits, so the actual current tier task lists reach the model.
const OBTAIN_RE =
  /\b(craft|crafting|precursor|collection|collections|recipe|recipes|achievement|achievements|unlock|obtain|gift of|how (do i|to)\b.*\b(get|make|craft|unlock|obtain|build))\b/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2WikiSearchTools(wikiIndex: () => MetaIndex, liveSearch?: LiveSearch): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_wiki_search',
      'Search the indexed GW2 wiki for game knowledge — mechanics and concepts (attributes/boons/conditions/combos/armor/upgrades), profession skills/traits, AND broader content like legendary crafting, achievements, collections, and masteries (e.g. "how do I make Twilight", "what do I need for this achievement"). Use for "how does X work" and "how do I get/make X" questions; for a SPECIFIC skill or trait\'s exact numbers and WvW/PvP splits use gw2_wiki_facts; for builds use meta_search; for long-form strategy guides use general_search. If nothing is pre-indexed, this falls back to a live wiki lookup. Optional category: classes, specializations, stats, armor, weapons, upgrades, boons-conditions, mechanics, skills, traits, legendaries, achievements, masteries.',
      {
        query: z.string().describe('What to look up, e.g. "how to craft the legendary Twilight"'),
        category: z.string().optional().describe('Optional category filter')
      },
      safe(async ({ query, category }: { query: string; category?: string }) => {
        const hits = await wikiIndex().search(query, { mode: category, k: 6 })
        const indexed = hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
        // Hit the live lookup when the index is empty OR the question is about
        // obtaining/crafting something (where the index only holds weak overview
        // chunks and the real tier tables live on rendered collection pages).
        const wantLive = !!liveSearch && (indexed.length === 0 || OBTAIN_RE.test(query))
        let live: Array<{ title: string; url: string; snippet: string }> = []
        if (wantLive && liveSearch) {
          try {
            live = await liveSearch(query)
          } catch {
            /* live lookup is best-effort; fall through to index hits */
          }
        }
        // Live results first (current, table-complete), then index hits; dedup by url.
        const seen = new Set<string>()
        const merged: Array<{ title: string; url: string; snippet: string }> = []
        for (const h of [...live, ...indexed]) {
          if (seen.has(h.url)) continue
          seen.add(h.url)
          merged.push(h)
          if (merged.length >= 6) break
        }
        if (merged.length === 0) return { note: 'no wiki match indexed or found live' }
        return merged
      })
    )
  ]
}
