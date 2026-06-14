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
