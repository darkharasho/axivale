// src/main/meta/wiki/ingest.test.ts
import { describe, it, expect, vi } from 'vitest'
import { WikiRefIngester, type WikiClientLike } from './ingest'
import { FakeMetaIndex } from '../rag/testFake'

function wiki(map: Record<string, string | null>): WikiClientLike & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    getWikitextBatch: async (titles) => {
      calls.push(titles)
      return new Map(titles.map((t) => [t, map[t] ?? null]))
    }
  }
}

const PAGES = [
  { category: 'stats', title: 'Power' },
  { category: 'skills', title: 'List of elementalist skills' },
  { category: 'mechanics', title: 'Gone' } // missing
]

describe('WikiRefIngester', () => {
  it('cleans, chunks, and indexes each present page; skips missing', async () => {
    const idx = new FakeMetaIndex()
    const w = wiki({
      Power: "'''Power''' is an [[attribute]] that increases damage. ".repeat(20),
      'List of elementalist skills': 'Fireball deals damage. Lightning Flash teleports. '.repeat(20),
      Gone: null
    })
    await new WikiRefIngester({ wiki: w, index: idx, pages: PAGES }).ingest()
    const replaced = idx.replaced.join(' ')
    expect(replaced).toContain('Power')
    expect(replaced).toContain('List_of_elementalist_skills')
    expect(replaced).not.toContain('Gone')
  })

  it('skips a page whose content hash is unchanged (no re-index)', async () => {
    const idx = new FakeMetaIndex()
    const w = wiki({ Power: 'Power is an attribute that boosts damage. '.repeat(20) })
    const deps = { wiki: w, index: idx, pages: [{ category: 'stats', title: 'Power' }] }
    await new WikiRefIngester(deps).ingest()
    const first = idx.replaced.length
    await new WikiRefIngester(deps).ingest() // same content → skipped
    expect(idx.replaced.length).toBe(first)
  })

  it('isolates a page that throws (others still index)', async () => {
    const idx = new FakeMetaIndex()
    const throwing = {
      indexedHash: async () => null,
      replacePage: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined),
      search: async () => [],
      stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
      sample: async () => []
    }
    const w = wiki({ A: 'alpha alpha alpha '.repeat(40), B: 'beta beta beta '.repeat(40) })
    await new WikiRefIngester({ wiki: w, index: throwing, pages: [{ category: 'x', title: 'A' }, { category: 'x', title: 'B' }] }).ingest()
    expect(throwing.replacePage).toHaveBeenCalledTimes(2) // didn't abort after the throw
  })

  it('emits a wiki progress phase: start, one advance per page, then done', async () => {
    const idx = new FakeMetaIndex()
    const w = wiki({
      Power: 'Power is an attribute. '.repeat(20),
      Gone: null
    })
    const events: import('../progress').LearnProgress[] = []
    await new WikiRefIngester({
      wiki: w,
      index: idx,
      pages: [{ category: 'stats', title: 'Power' }, { category: 'mechanics', title: 'Gone' }],
      emit: (e) => events.push(e)
    }).ingest()
    expect(events[0]).toEqual({ phase: 'wiki', kind: 'start', total: 2, label: 'Reading the GW2 wiki…' })
    expect(events[events.length - 1]).toEqual({ phase: 'wiki', kind: 'done' })
    // one advance per page, including the missing one
    expect(events.filter((e) => e.kind === 'advance')).toHaveLength(2)
  })

  it('advances for every page even when the whole batch fetch throws', async () => {
    const idx = new FakeMetaIndex()
    const failing: WikiClientLike = { getWikitextBatch: async () => { throw new Error('network') } }
    const events: import('../progress').LearnProgress[] = []
    await new WikiRefIngester({
      wiki: failing,
      index: idx,
      pages: [{ category: 'x', title: 'A' }, { category: 'x', title: 'B' }, { category: 'x', title: 'C' }],
      emit: (e) => events.push(e)
    }).ingest()
    expect(events.filter((e) => e.kind === 'advance')).toHaveLength(3)
    expect(events[events.length - 1]).toEqual({ phase: 'wiki', kind: 'done' })
  })
})
