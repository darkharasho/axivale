// src/main/meta/rag/chunk.test.ts
import { describe, it, expect } from 'vitest'
import { chunkPage } from './chunk'

const meta = { mode: 'PvE', source: 'snowcrows.com', url: 'https://snowcrows.com/builds/x', title: 'Power Tempest' }

describe('chunkPage', () => {
  it('returns one chunk for short text, carrying metadata + stable id + contentHash', () => {
    const chunks = chunkPage('A short build note.', meta)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ ...meta, text: 'A short build note.' })
    expect(chunks[0].id).toBe(chunks[0].id) // present
    expect(chunks[0].id.endsWith(':0')).toBe(true)
    expect(chunks[0].contentHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('splits long text into multiple word-bounded chunks with sequential ids', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ')
    const chunks = chunkPage(text, meta)
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((c, i) => expect(c.id.endsWith(`:${i}`)).toBe(true))
    // every chunk well under a hard ceiling
    chunks.forEach((c) => expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(400))
  })

  it('gives every chunk of a page the same contentHash (page-level)', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(' ')
    const chunks = chunkPage(text, meta)
    const hashes = new Set(chunks.map((c) => c.contentHash))
    expect(hashes.size).toBe(1)
  })

  it('returns no chunks for blank text', () => {
    expect(chunkPage('   ', meta)).toEqual([])
  })
})
