// src/main/memory/index.test.ts
import { describe, it, expect } from 'vitest'
import { FakeMemoryIndex } from './index'

describe('FakeMemoryIndex', () => {
  it('search matches on shared words and filters by entity (entity OR global)', async () => {
    const ix = new FakeMemoryIndex()
    await ix.upsert({ id: '1', kind: 'fact', entity: '111', text: 'prefers wvw small scale' })
    await ix.upsert({ id: '2', kind: 'fact', entity: '222', text: 'prefers pve raids' })
    await ix.upsert({ id: '3', kind: 'fact', entity: null, text: 'guild raids tuesday wvw' })
    const hits = await ix.search('wvw', { entity: '111' })
    const ids = hits.map((h) => h.id)
    expect(ids).toContain('1')
    expect(ids).toContain('3')
    expect(ids).not.toContain('2')
  })

  it('nearest returns the best same-kind candidate with a cosine score', async () => {
    const ix = new FakeMemoryIndex()
    await ix.upsert({ id: '1', kind: 'fact', entity: null, text: 'mains firebrand support' })
    const near = await ix.nearest('mains firebrand support', 'fact', {})
    expect(near?.id).toBe('1')
    expect(near?.cosine).toBeGreaterThan(0.99)
  })

  it('remove drops a row', async () => {
    const ix = new FakeMemoryIndex()
    await ix.upsert({ id: '1', kind: 'fact', entity: null, text: 'x y z' })
    await ix.remove('1')
    expect(await ix.search('x', {})).toHaveLength(0)
  })
})
