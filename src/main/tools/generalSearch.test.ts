import { describe, it, expect } from 'vitest'
import { buildGeneralSearchTools } from './generalSearch'
import type { MetaIndex } from '../meta/rag/index'

const idx = (hits: unknown[]): MetaIndex => ({
  indexedHash: async () => null, replacePage: async () => {},
  search: async () => hits as never, stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
  sample: async () => []
}) as MetaIndex

describe('general_search', () => {
  it('returns shaped hits from the general corpus', async () => {
    const tools = buildGeneralSearchTools(() => idx([{ source: 'discretize.eu', url: 'u', title: 't', snippet: 's' }]))
    const t = tools.find((x) => x.name === 'general_search')!
    const res = await t.handler({ query: 'fractal cm' }, {})
    expect(res.content[0].text).toContain('discretize.eu')
  })
  it('reports empty corpus instead of throwing', async () => {
    const tools = buildGeneralSearchTools(() => idx([]))
    const t = tools.find((x) => x.name === 'general_search')!
    const res = await t.handler({ query: 'x' }, {})
    expect(res.content[0].text).toContain('no')
  })
})
