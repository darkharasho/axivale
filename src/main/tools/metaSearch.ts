// src/main/tools/metaSearch.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { MetaIndex } from '../meta/rag/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMetaSearchTools(metaIndex: () => MetaIndex): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'meta_search',
      'Search the indexed GW2 community meta corpus (Snowcrows, MetaBattle, Hardstuck, GuildJen) for build detail beyond the per-mode summary — specific builds, weapon/sigil/rune choices, trait lines, and the tradeoffs between variants. Pass the question and, when known, the game mode. Returns community-sourced passages with their source URLs; treat them as recommendations to cite and verify, not mechanical ground truth.',
      {
        query: z.string().describe('What to look up, e.g. "condi alac tempest sigils and why"'),
        mode: z.enum(['PvE', 'WvW', 'WvW Roaming']).optional().describe('Game mode filter')
      },
      safe(async ({ query, mode }: { query: string; mode?: 'PvE' | 'WvW' | 'WvW Roaming' }) => {
        const hits = await metaIndex().search(query, { mode, k: 6 })
        if (hits.length === 0) return { note: 'no indexed meta yet — the background refresh may not have run' }
        return hits.map((h) => ({ source: h.source, url: h.url, title: h.title, snippet: h.snippet }))
      })
    )
  ]
}
