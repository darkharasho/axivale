// src/main/axilogPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildAxilogReference } from './axilogPrompt'

describe('buildAxilogReference', () => {
  it('costs nothing when there is no log source', () => {
    expect(buildAxilogReference(false)).toBe('')
  })

  it('teaches the container shape so the model does not write axibridge-shaped jq', () => {
    const block = buildAxilogReference(true)
    expect(block).toContain('by_entity')
    expect(block).toMatch(/string/i)
    expect(block).toContain('entities[]')
  })

  it('names the workflow order', () => {
    const block = buildAxilogReference(true)
    expect(block.indexOf('axilog_fight_overview')).toBeLessThan(block.indexOf('axilog_section'))
  })

  it('bounds the scope to one fight and makes coverage authoritative', () => {
    const block = buildAxilogReference(true)
    expect(block).toMatch(/one fight/i)
    expect(block).toMatch(/coverage/i)
    expect(block).toMatch(/axibridge/i)
  })

  it('scopes the raw-document FORMAT paragraph to axilog_query, not the section/overview tools', () => {
    const block = buildAxilogReference(true)
    const formatIdx = block.indexOf('FORMAT')
    expect(formatIdx).toBeGreaterThan(-1)
    expect(block.slice(formatIdx, formatIdx + 40)).toContain('axilog_query')
  })

  it('makes coverage the only licence to explain WHY data is missing', () => {
    // The reported bug in prompt form: the agent grouped a roster by the base
    // profession field, got one bucket, and explained its own filter's output by
    // asserting the log had not captured elite specs. Nothing in coverage said so.
    const block = buildAxilogReference(true)
    expect(block).toMatch(/only licence to say WHY/i)
    expect(block).toMatch(/did not record|did not capture/i)
    expect(block).toMatch(/your own filter/i)
  })

  it('teaches the empty coverage state alongside not_computed/unsupported', () => {
    const block = buildAxilogReference(true)
    expect(block).toMatch(/\bempty\b/)
    expect(block).toMatch(/not_computed/)
    expect(block).toMatch(/unsupported/)
  })
})
