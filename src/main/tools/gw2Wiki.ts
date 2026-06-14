// src/main/tools/gw2Wiki.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import type { WikiFacts } from '../meta/wikiFacts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2WikiTools(wikiFacts: WikiFacts): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_wiki_facts',
      'Look up official GW2 wiki mechanical facts for a SKILL or TRAIT by name — damage coefficients, recharge, boon/condition durations, combo fields — WITH the PvE/WvW/PvP balance splits the GW2 API does NOT provide. Use this to ground WvW/roaming or any mechanics/tradeoff reasoning in real numbers (e.g. WvW recharge/coefficients differ from PvE). Skill/trait names come from meta_search results or build pages.',
      { name: z.string().describe('Exact skill or trait name, e.g. "Winds of Disenchantment"') },
      safe(async ({ name }: { name: string }) => wikiFacts.lookup(name))
    )
  ]
}
