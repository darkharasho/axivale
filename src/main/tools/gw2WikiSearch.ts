// src/main/tools/gw2WikiSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2WikiSearchTools(wikiIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_wiki_search',
      'Search the indexed GW2 wiki reference corpus for game mechanics and concepts — how attributes/boons/conditions/combos/armor weights/upgrades work, and which skills/traits a profession has (skills and traits are grouped by profession). Use this for conceptual/"how does X work" questions; for a SPECIFIC skill or trait\'s exact numbers and WvW/PvP splits use gw2_wiki_facts instead. Optional category: classes, specializations, stats, armor, weapons, upgrades, boons-conditions, mechanics, skills, traits.',
      {
        query: z.string().describe('What to look up, e.g. "how does Concentration affect boon duration"'),
        category: z.string().optional().describe('Optional category filter')
      },
      safe(async ({ query, category }: { query: string; category?: string }) => {
        const hits = await wikiIndex().search(query, { mode: category, k: 6 })
        if (hits.length === 0) return { note: 'no wiki reference indexed yet — the background ingest may not have run' }
        return hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet }))
      })
    )
  ]
}
