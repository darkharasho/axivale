import { describe, it, expect } from 'vitest'
import { buildSkillTools } from './tools/skills'

function call(loadSkill: (n: string) => string | null, name: string): Promise<string> {
  const tool = buildSkillTools(loadSkill)[0]
  // SDK tool handler returns { content: [{ type:'text', text }] }
  return tool
    .handler({ name }, {} as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .then((r: any) => (r.content[0] as { text: string }).text)
}

describe('load_skill tool', () => {
  it('returns the skill instructions when found', async () => {
    expect(await call((n) => (n === 'Raid Recap' ? 'do the recap' : null), 'Raid Recap')).toContain(
      'do the recap'
    )
  })

  it('returns a friendly miss string when unknown/disabled', async () => {
    expect(await call(() => null, 'Ghost')).toMatch(/no such skill/i)
  })
})
