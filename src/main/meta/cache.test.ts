// src/main/meta/cache.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaCache } from './cache'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'metacache-'))
}

describe('MetaCache', () => {
  it('round-trips text by url', () => {
    const c = new MetaCache(dir())
    c.put('https://snowcrows.com', 'hello meta')
    expect(c.get('https://snowcrows.com')).toBe('hello meta')
  })

  it('returns null for a missing url', () => {
    expect(new MetaCache(dir()).get('https://nope.com')).toBeNull()
  })

  it('overwrites on re-put', () => {
    const c = new MetaCache(dir())
    c.put('https://x.com', 'a')
    c.put('https://x.com', 'b')
    expect(c.get('https://x.com')).toBe('b')
  })

  it('tolerates a corrupt cache file', () => {
    const d = dir()
    const c = new MetaCache(d)
    c.put('https://x.com', 'a')
    const f = readdirSync(d)[0]
    writeFileSync(join(d, f), '{not json')
    expect(c.get('https://x.com')).toBeNull()
  })
})
