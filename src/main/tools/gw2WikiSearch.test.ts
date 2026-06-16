// src/main/tools/gw2WikiSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildGw2WikiSearchTools } from './gw2WikiSearch'
import type { MetaIndex } from '../meta/rag/index'

const idx = (hits: unknown[]): MetaIndex => ({
  indexedHash: async () => null,
  replacePage: async () => {},
  search: async () => hits as never,
  stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
  sample: async () => []
}) as MetaIndex

describe('gw2_wiki_search fallback', () => {
  it('falls back to live search when the index is empty', async () => {
    const live = async () => [{ title: 'Twilight', url: 'https://wiki.guildwars2.com/wiki/Twilight', snippet: 'craft' }]
    const tools = buildGw2WikiSearchTools(() => idx([]), live)
    const t = tools.find((x) => x.name === 'gw2_wiki_search')!
    const res = await t.handler({ query: 'how to craft twilight' }, {})
    expect((res.content[0] as { text: string }).text).toContain('Twilight')
  })
  it('uses index hits when present (no fallback)', async () => {
    let called = false
    const live = async () => { called = true; return [] }
    const tools = buildGw2WikiSearchTools(() => idx([{ source: 'wiki', url: 'u', title: 'Boon', snippet: 's' }]), live)
    const t = tools.find((x) => x.name === 'gw2_wiki_search')!
    await t.handler({ query: 'boon duration' }, {})
    expect(called).toBe(false)
  })
  it('forwards category arg to index search as mode', async () => {
    let capturedOpts: unknown
    const spyIdx: MetaIndex = {
      indexedHash: async () => null,
      replacePage: async () => {},
      search: async (_q, opts) => { capturedOpts = opts; return [{ source: 'wiki', url: 'u', title: 'Stats', snippet: 's' }] as never },
      stats: async () => ({ total: 1, byMode: {}, bySource: {}, lastIndexedAt: null }),
      sample: async () => []
    } as MetaIndex
    const tools = buildGw2WikiSearchTools(() => spyIdx)
    const t = tools.find((x) => x.name === 'gw2_wiki_search')!
    await t.handler({ query: 'x', category: 'stats' }, {})
    expect((capturedOpts as { mode?: string }).mode).toBe('stats')
  })
})
