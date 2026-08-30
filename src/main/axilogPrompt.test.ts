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
})
