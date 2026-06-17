// src/main/tools/memory.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, type ToolDeps } from './shared'

const KIND = z.enum(['fact', 'playbook', 'anti_pattern', 'heuristic'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMemoryTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'remember',
      'Save a durable memory so future sessions can reuse it. kind "fact" = a short standing truth (a person\'s build/comp preference, a schedule, a guild convention); "playbook"/"anti_pattern"/"heuristic" = operational know-how (needs a title + markdown body). Pass entity (a person\'s name/handle like "Zara" or "@zara") when the memory is ABOUT someone — it is resolved to that roster member. Use this when you learn something worth keeping, not for one-off chat. Non-destructive; saved immediately.',
      {
        kind: KIND,
        body: z.string().describe('Fact text, or the artifact markdown body'),
        title: z.string().optional().describe('Required for playbook/anti_pattern/heuristic'),
        entity: z.string().optional().describe('Person this is about — a loose name/handle to resolve, e.g. "Zara"'),
        tags: z.array(z.string()).optional().describe('Lowercase labels, e.g. ["wvw","build"]')
      },
      safe(async ({ kind, body, title, entity, tags }: {
        kind: 'fact' | 'playbook' | 'anti_pattern' | 'heuristic'
        body: string; title?: string; entity?: string; tags?: string[]
      }) => {
        let key: string | null = null
        let resolvedName: string | undefined
        const extraTags = [...(tags ?? [])]
        if (entity && entity.trim()) {
          const hit = await deps.resolveEntityKey(entity)
          if (hit) { key = hit.key; resolvedName = hit.name }
          else extraTags.push(entity.trim()) // unresolved → keep the name as a tag
        }
        const r = await deps.memory().remember({ kind, body, title, entity: key, tags: extraTags })
        return { id: r.id, kind: r.kind, merged: r.merged, entity: key, entity_name: resolvedName }
      })
    ),
    tool(
      'recall',
      "Search AxiVale's durable memory from past sessions. Call at the START of a task that resembles past work or concerns a specific person, before answering from scratch. Pass entity (a name/handle) to focus on that person (their facts plus global ones). Returns facts and operational artifacts with provenance (when learned, how often used) — weigh fresh, frequently-used memory over stale.",
      {
        query: z.string().describe('What to look up, e.g. "comp style" or "raid schedule"'),
        entity: z.string().optional().describe('Focus on this person — a loose name/handle'),
        kinds: z.array(KIND).optional().describe('Filter to these memory kinds'),
        limit: z.number().optional().describe('Max results (default 5, max 20)')
      },
      safe(async ({ query, entity, kinds, limit }: {
        query: string; entity?: string; kinds?: Array<'fact' | 'playbook' | 'anti_pattern' | 'heuristic'>; limit?: number
      }) => {
        let key: string | null = null
        if (entity && entity.trim()) key = (await deps.resolveEntityKey(entity))?.key ?? null
        const out = await deps.memory().recall({ query, entity: key, kinds, limit })
        if (out.facts.length === 0 && out.artifacts.length === 0) return { note: 'no matching memory yet' }
        return out
      })
    )
  ]
}
