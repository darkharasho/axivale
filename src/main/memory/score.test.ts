// src/main/memory/score.test.ts
import { describe, it, expect } from 'vitest'
import { factScore, artifactScore, HALF_LIFE_MS } from './score'
import type { MemoryFact, MemoryArtifact } from './types'

const base: MemoryFact = {
  id: 'a', body: 'x', bodyNorm: 'x', entity: null, tags: [],
  pinned: false, userPinned: false, useCount: 0, score: 0,
  source: 'agent', createdAt: '', lastUsedAt: null, archived: false
}
const now = 1_000_000_000_000

describe('factScore', () => {
  it('decays to half over one half-life', () => {
    const fresh = factScore({ ...base, lastUsedAt: new Date(now).toISOString() }, now)
    const old = factScore({ ...base, lastUsedAt: new Date(now - HALF_LIFE_MS).toISOString() }, now)
    expect(old).toBeCloseTo(fresh / 2, 3)
  })
  it('ranks user source above agent source, all else equal', () => {
    const iso = new Date(now).toISOString()
    expect(factScore({ ...base, source: 'user', createdAt: iso }, now))
      .toBeGreaterThan(factScore({ ...base, source: 'agent', createdAt: iso }, now))
  })
  it('gives user-pinned facts a dominating constant', () => {
    const ancient = new Date(now - 10 * HALF_LIFE_MS).toISOString()
    expect(factScore({ ...base, userPinned: true, lastUsedAt: ancient }, now))
      .toBeGreaterThan(factScore({ ...base, source: 'user', lastUsedAt: new Date(now).toISOString() }, now))
  })
  it('uses createdAt when never recalled', () => {
    expect(factScore({ ...base, createdAt: new Date(now).toISOString() }, now)).toBeGreaterThan(0)
  })
})

const artBase: MemoryArtifact = {
  id: 'a', kind: 'heuristic', title: 't', body: 'b', bodyNorm: 'b', tags: [], entity: null,
  useCount: 0, score: 0, source: 'agent', createdAt: '', updatedAt: '', lastUsedAt: null, archived: false
}

describe('artifactScore', () => {
  it('decays to half over one half-life (using lastUsedAt)', () => {
    const fresh = artifactScore({ ...artBase, lastUsedAt: new Date(now).toISOString() }, now)
    const old = artifactScore({ ...artBase, lastUsedAt: new Date(now - HALF_LIFE_MS).toISOString() }, now)
    expect(old).toBeCloseTo(fresh / 2, 3)
  })
  it('ranks user source above agent source, all else equal', () => {
    const iso = new Date(now).toISOString()
    expect(artifactScore({ ...artBase, source: 'user', updatedAt: iso }, now))
      .toBeGreaterThan(artifactScore({ ...artBase, source: 'agent', updatedAt: iso }, now))
  })
})
