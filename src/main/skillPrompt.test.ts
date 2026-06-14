import { describe, it, expect } from 'vitest'
import { buildTurnSystemPrompt } from './skillPrompt'
import type { Skill } from './skillStore'

const BASE = 'BASE PROMPT'
function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'a', name: 'Raid Recap', whenToUse: 'how a raid/WvW night went',
    instructions: 'Lead with W/L then a {{figure}} trend then top 3.',
    enabled: true, createdAt: 'x', updatedAt: 'x', ...over
  }
}

describe('buildTurnSystemPrompt', () => {
  it('returns the base unchanged with no skills', () => {
    expect(buildTurnSystemPrompt(BASE, [])).toBe(BASE)
  })

  it('adds a registry of names + when-to-use, but NOT full instructions', () => {
    const out = buildTurnSystemPrompt(BASE, [skill()])
    expect(out.startsWith(BASE)).toBe(true)
    expect(out).toContain('Raid Recap')
    expect(out).toContain('how a raid/WvW night went')
    expect(out).toContain('load_skill')
    expect(out).not.toContain('Lead with W/L') // full recipe stays out
  })

  it('injects the forced skill recipe in full and omits the registry directive for it', () => {
    const out = buildTurnSystemPrompt(BASE, [skill()], skill())
    expect(out).toContain('Lead with W/L') // full recipe present
    expect(out).toContain('Raid Recap')
  })
})
