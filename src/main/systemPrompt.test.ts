import { describe, it, expect } from 'vitest'
import { AXIVALE_SYSTEM_PROMPT } from './agent'

describe('system prompt', () => {
  it('describes the AxiForge capabilities and confirm flow', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/headless/i)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/deletes and publishes prompt the user to confirm/i)
  })

  it('requires grounding build edits in catalog/API data, not model memory', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_catalog')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/balance patches invalidate your training data/i)
  })

  it('separates the AxiForge store from the AxiTools Discord store', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/axiforge_\* .*axitools_builds_\*/s)
  })

  it('instructs inline {{figure}} placement, not piling figures at the end', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('{{figure}}')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/do NOT\s+pile every figure at the end/i)
  })

  it('forbids enumerating every run/report', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/never list out every run\/report/i)
  })
})
