import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGeneralSearchTools(generalIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'general_search',
      'Search the indexed GW2 general-guides corpus (Snowcrows guides, GuildJen, Hardstuck, Discretize) for long-form how-to content — boss/encounter and fractal CM strategy, open-world/farming, and "how to get good at X" guides. Use for strategy and approach questions; for exact builds use meta_search, for game mechanics/legendaries/achievements use wiki_search. Returns community-sourced passages with their source URLs; cite and verify, never present as mechanical ground truth.',
      {
        query: z.string().describe('What to look up, e.g. "how to do Sunqua Peak CM mechanics"')
      },
      safe(async ({ query }: { query: string }) => {
        const hits = await generalIndex().search(query, { k: 6 })
        if (hits.length === 0) return { note: 'no indexed general guides yet — the background refresh may not have run' }
        return hits.map((h) => ({ source: h.source, url: h.url, title: h.title, snippet: h.snippet }))
      })
    )
  ]
}
