import { describe, it, expect } from 'vitest'
import { buildMemoryReference } from './memoryPrompt'
import type { MemoryFact } from './memory/types'

const f = (over: Partial<MemoryFact>): MemoryFact => ({
  id: 'x', body: 'b', bodyNorm: 'b', entity: null, tags: [], pinned: true, userPinned: false,
  useCount: 0, score: 0, source: 'agent', createdAt: '', lastUsedAt: null, archived: false, ...over
})

describe('buildMemoryReference', () => {
  it('returns empty string with no facts', () => {
    expect(buildMemoryReference([])).toBe('')
  })
  it('renders a heading and one bullet per fact', () => {
    const out = buildMemoryReference([f({ body: 'Raids Tue/Thu 8pm EST' }), f({ body: 'Prefers Snowcrows' })])
    expect(out).toContain('# What AxiVale remembers')
    expect(out).toContain('- Raids Tue/Thu 8pm EST')
    expect(out).toContain('- Prefers Snowcrows')
  })
})
