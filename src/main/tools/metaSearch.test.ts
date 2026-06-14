// src/main/tools/metaSearch.test.ts
import { describe, it, expect } from 'vitest'
import { buildMetaSearchTools } from './metaSearch'
import { FakeMetaIndex } from '../meta/rag/testFake'

function toolFor(idx = new FakeMetaIndex()) {
  const t = buildMetaSearchTools(() => idx)[0]
  return { t, idx }
}

describe('meta_search tool', () => {
  it('returns mapped hits and forwards the mode filter', async () => {
    const idx = new FakeMetaIndex([{ source: 'snowcrows.com', url: 'u', title: 'Power Tempest', snippet: 'runs Force', score: 1 }])
    const t = buildMetaSearchTools(() => idx)[0]
    const res = await t.handler({ query: 'sigils', mode: 'PvE' }, {})
    expect(idx.queries[0]).toMatchObject({ query: 'sigils', mode: 'PvE' })
    expect((res.content[0] as { text: string }).text).toContain('Power Tempest')
    expect((res.content[0] as { text: string }).text).toContain('snowcrows.com')
  })

  it('returns a clean message when the index is empty', async () => {
    const { t } = toolFor()
    const res = await t.handler({ query: 'anything' }, {})
    expect((res.content[0] as { text: string }).text.toLowerCase()).toContain('no indexed meta')
  })
})
