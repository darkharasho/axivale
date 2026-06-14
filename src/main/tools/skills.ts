// src/main/tools/skills.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * The load_skill tool: returns a user-defined skill's full instructions by exact
 * name so the model can follow the recipe. Read-only — never destructive.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSkillTools(loadSkill: (name: string) => string | null): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'load_skill',
      'Load a user-defined skill\'s instructions by its exact name (from the "Available skills" list), then follow them for this reply.',
      { name: z.string().describe('Exact skill name from the Available skills list') },
      async ({ name }: { name: string }) => {
        const instructions = loadSkill(name)
        const text = instructions
          ? `Skill "${name}" — follow these instructions for this reply:\n\n${instructions}`
          : `No such skill: "${name}". Answer normally.`
        return { content: [{ type: 'text' as const, text }] }
      }
    )
  ]
}
