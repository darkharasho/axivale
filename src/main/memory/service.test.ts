// src/main/memory/service.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memoryStore'
import { FakeMemoryIndex } from './index'
import { MemoryService } from './service'

function svc(): { service: MemoryService; store: MemoryStore; index: FakeMemoryIndex } {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json'))
  const index = new FakeMemoryIndex()
  const service = new MemoryService(store, index, { entityName: (k) => (k === '111' ? 'Zara' : undefined) })
  return { service, store, index }
}

describe('MemoryService.remember', () => {
  it('creates a new fact and indexes it', async () => {
    const { service, index } = svc()
    const r = await service.remember({ kind: 'fact', body: 'Zara prefers WvW small-scale', entity: '111', tags: ['wvw'] })
    expect(r.merged).toBe(false)
    expect((await index.search('wvw', { entity: '111' })).map((h) => h.id)).toContain(r.id)
  })

  it('merges an exact-duplicate fact instead of inserting twice', async () => {
    const { service, store } = svc()
    await service.remember({ kind: 'fact', body: 'mains firebrand', entity: null })
    const r2 = await service.remember({ kind: 'fact', body: 'Mains firebrand.', entity: null })
    expect(r2.merged).toBe(true)
    expect(store.list().facts).toHaveLength(1)
    expect(store.list().facts[0].useCount).toBe(1)
  })

  it('merges a semantic near-duplicate above the cosine threshold', async () => {
    const { service, store } = svc()
    await service.remember({ kind: 'fact', body: 'zara plays wvw small scale roaming open field skirmish duel fights kiting bomb cleave peel rez stealth dodge', entity: null })
    const r2 = await service.remember({ kind: 'fact', body: 'zara plays wvw small scale roaming open field skirmish duel fights kiting bomb cleave peel rez stealth dodge often', entity: null })
    expect(r2.merged).toBe(true)
    expect(store.list().facts).toHaveLength(1)
  })

  it('keeps the same sentence about different entities as distinct facts', async () => {
    const { service, store } = svc()
    await service.remember({ kind: 'fact', body: 'plays small scale', entity: '111' })
    await service.remember({ kind: 'fact', body: 'plays small scale', entity: '222' })
    expect(store.list().facts).toHaveLength(2)
  })
})

describe('MemoryService.recall', () => {
  it('returns provenance and the resolved entity name, and bumps useCount', async () => {
    const { service, store } = svc()
    const { id } = await service.remember({ kind: 'fact', body: 'Zara prefers wvw', entity: '111' })
    const out = await service.recall({ query: 'wvw', entity: '111', limit: 5 })
    expect(out.facts[0].id).toBe(id)
    expect(out.facts[0].entityName).toBe('Zara')
    expect(out.facts[0].timesUsed).toBe(0)
    expect(store.getFact(id)?.useCount).toBe(1)
  })
})

describe('MemoryService.reindexAll', () => {
  it('rebuilds the index from all stored records', async () => {
    const { service, index } = svc()
    await service.remember({ kind: 'fact', body: 'alpha beta', entity: null })
    await service.remember({ kind: 'heuristic', body: 'gamma delta', title: 'A rule', entity: null })
    await index.reindex([]) // wipe
    await service.reindexAll()
    expect((await index.stats()).total).toBe(2)
  })
})
