// src/main/meta/rag/index.test.ts
import { describe, it, expect } from 'vitest'
import { FakeMetaIndex } from './testFake'

describe('FakeMetaIndex (test double for MetaIndex)', () => {
  it('records replacePage and returns indexedHash', async () => {
    const idx = new FakeMetaIndex()
    await idx.replacePage('u', [
      { id: 'h:0', mode: 'PvE', source: 's', url: 'u', title: 't', text: 'hello', contentHash: 'abc' }
    ])
    expect(await idx.indexedHash('u')).toBe('abc')
    expect(idx.replaced).toEqual(['u'])
  })

  it('search returns canned hits and records the query + mode', async () => {
    const idx = new FakeMetaIndex([{ source: 's', url: 'u', title: 't', snippet: 'snip', score: 1 }])
    const hits = await idx.search('sigils', { mode: 'WvW', k: 6 })
    expect(hits[0].snippet).toBe('snip')
    expect(idx.queries).toEqual([{ query: 'sigils', mode: 'WvW', k: 6 }])
  })
})

describe('FakeMetaIndex stats + sample', () => {
  it('stats tallies rows by mode and source', async () => {
    const idx = new FakeMetaIndex()
    idx.sampleRows = [
      { id: 'a:0', mode: 'PvE', source: 'snowcrows.com', url: 'a', title: 'A', snippet: 'x', indexedAt: '2026-06-14T00:00:00.000Z' },
      { id: 'b:0', mode: 'PvE', source: 'metabattle.com', url: 'b', title: 'B', snippet: 'y', indexedAt: '2026-06-14T01:00:00.000Z' },
      { id: 'c:0', mode: 'WvW', source: 'snowcrows.com', url: 'c', title: 'C', snippet: 'z', indexedAt: '2026-06-13T00:00:00.000Z' }
    ]
    const s = await idx.stats()
    expect(s.total).toBe(3)
    expect(s.byMode).toEqual({ PvE: 2, WvW: 1 })
    expect(s.bySource).toEqual({ 'snowcrows.com': 2, 'metabattle.com': 1 })
    expect(s.lastIndexedAt).toBe('2026-06-14T01:00:00.000Z')
  })

  it('sample filters by mode and caps to limit', async () => {
    const idx = new FakeMetaIndex()
    idx.sampleRows = [
      { id: 'a:0', mode: 'PvE', source: 's', url: 'a', title: 'A', snippet: 'x', indexedAt: '' },
      { id: 'b:0', mode: 'WvW', source: 's', url: 'b', title: 'B', snippet: 'y', indexedAt: '' }
    ]
    expect((await idx.sample({ limit: 25 })).length).toBe(2)
    const pve = await idx.sample({ mode: 'PvE', limit: 25 })
    expect(pve.map((r) => r.id)).toEqual(['a:0'])
    expect((await idx.sample({ limit: 1 })).length).toBe(1)
  })

  it('empty index → zero stats', async () => {
    const s = await new FakeMetaIndex().stats()
    expect(s).toEqual({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null })
  })
})
