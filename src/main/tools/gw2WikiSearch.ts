// src/main/tools/gw2WikiSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

type LiveSearch = (query: string) => Promise<Array<{ title: string; url: string; snippet: string }>>

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
        if (hits.length > 0) return hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
        if (liveSearch) {
          const live = await liveSearch(query)
          if (live.length > 0) return live
        }
        return { note: 'no wiki match indexed or found live' }
      })
    )
  ]
}
