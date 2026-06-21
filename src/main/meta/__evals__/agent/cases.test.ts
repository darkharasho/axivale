// src/main/meta/__evals__/agent/cases.test.ts
import { describe, it, expect } from 'vitest'
import { AGENT_EVAL_CASES } from './cases'

describe('AGENT_EVAL_CASES', () => {
  it('every case has a name, prompt, and rubric, with unique names', () => {
    expect(AGENT_EVAL_CASES.length).toBeGreaterThan(0)
    const names = new Set<string>()
    for (const c of AGENT_EVAL_CASES) {
      expect(c.name, 'case name').toBeTruthy()
      expect(c.prompt, `prompt for ${c.name}`).toBeTruthy()
      expect(c.rubric, `rubric for ${c.name}`).toBeTruthy()
      expect(names.has(c.name), `duplicate case name ${c.name}`).toBe(false)
      names.add(c.name)
    }
  })

  it('the boon regression cases assert the section tool is called', () => {
    const boon = AGENT_EVAL_CASES.find((c) => c.name === 'wasted-protection')
    expect(boon?.mustCall?.some((m) => m.name === 'axibridge_section')).toBe(true)
  })
})
