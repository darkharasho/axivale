// src/main/memoryStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from './memoryStore'

function freshPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json')
}

describe('MemoryStore', () => {
  let store: MemoryStore
  beforeEach(() => { store = new MemoryStore(freshPath()) })

  it('inserts a fact with a normalized dedup key and finds it back', () => {
    const f = store.insertFact({ body: '- Prefers WvW.', entity: null, tags: ['wvw'], source: 'agent' })
    expect(f.bodyNorm).toBe('prefers wvw')
    expect(store.findFactByNorm('prefers wvw', null)?.id).toBe(f.id)
  })

  it('scopes exact-norm dedup by entity', () => {
    store.insertFact({ body: 'plays small-scale', entity: '111', tags: [], source: 'agent' })
    expect(store.findFactByNorm('plays small-scale', '222')).toBeNull()
    expect(store.findFactByNorm('plays small-scale', '111')).not.toBeNull()
  })

  it('markFactRelearned bumps useCount, un-archives, fills missing entity, merges tags', () => {
    const f = store.insertFact({ body: 'mains fb', entity: null, tags: ['build'], source: 'agent' })
    store.updateFact(f.id, { archived: true })
    const r = store.markFactRelearned(f.id, { entity: '111', tags: ['wvw'] })
    expect(r?.archived).toBe(false)
    expect(r?.useCount).toBe(1)
    expect(r?.entity).toBe('111')
    expect(r?.tags.sort()).toEqual(['build', 'wvw'])
  })

  it('rerank auto-pins the top FACT_PIN_BUDGET and keeps user pins sticky', () => {
    for (let i = 0; i < 45; i++) store.insertFact({ body: `f${i}`, entity: null, tags: [], source: 'agent' })
    const last = store.insertFact({ body: 'sticky', entity: null, tags: [], source: 'agent' })
    store.setUserPinned(last.id, true)
    store.rerank()
    const pinned = store.list().facts.filter((f) => f.pinned)
    expect(pinned.length).toBe(40)
    expect(pinned.find((f) => f.id === last.id)).toBeDefined()
  })

  it('rerank archives unpinned facts untouched past ARCHIVE_AFTER_MS', () => {
    const f = store.insertFact({ body: 'stale', entity: null, tags: [], source: 'agent' })
    store.updateFact(f.id, {}) // no-op; set createdAt below via reload is overkill — use rerank clock
    const future = Date.parse(f.createdAt) + 181 * 86_400_000
    store.rerank(future)
    expect(store.list({ includeArchived: true }).facts.find((x) => x.id === f.id)?.archived).toBe(true)
  })

  it('persists across reload', () => {
    const p = freshPath()
    const s1 = new MemoryStore(p)
    s1.insertFact({ body: 'durable', entity: null, tags: [], source: 'user' })
    s1.flush()
    const s2 = new MemoryStore(p)
    expect(s2.list().facts).toHaveLength(1)
  })

  it('finds an artifact by its normalized title for global dedup', () => {
    const a = store.insertArtifact({ kind: 'heuristic', title: 'On macOS use screencapture', body: 'detail', entity: null, tags: [], source: 'agent' })
    expect(a.bodyNorm).toBe('on macos use screencapture')
    expect(store.findArtifactByNorm('on macos use screencapture')?.id).toBe(a.id)
    expect(store.findArtifactByNorm('something else')).toBeNull()
  })
})
