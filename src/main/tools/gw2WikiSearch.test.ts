// src/main/tools/gw2WikiSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildGw2WikiSearchTools } from './gw2WikiSearch'
import { FakeMetaIndex } from '../meta/rag/testFake'

describe('gw2_wiki_search tool', () => {
  it('returns mapped hits and forwards the category filter', async () => {
    const idx = new FakeMetaIndex([{ source: 'wiki.guildwars2.com', url: 'u', title: 'Concentration', snippet: 'boon duration', score: 1 }])
    const t = buildGw2WikiSearchTools(() => idx)[0]
    const res = await t.handler({ query: 'boon duration', category: 'stats' }, {})
    expect(idx.queries[0]).toMatchObject({ query: 'boon duration', mode: 'stats' })
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('Concentration')
  })
  it('returns a clean message when empty', async () => {
    const t = buildGw2WikiSearchTools(() => new FakeMetaIndex())[0]
    const res = await t.handler({ query: 'x' }, {})
    expect((res.content[0] as { text: string }).text.toLowerCase()).toContain('no wiki reference')
  })
})
