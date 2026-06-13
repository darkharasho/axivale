// src/main/shareStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ShareStore } from './shareStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sharestore-'))
  path = join(dir, 'shares.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const entry = {
  id: 'abc',
  kind: 'conversation' as const,
  title: 'Hello',
  url: 'https://alice.github.io/axivale-shares/#/s/abc',
  sourceConversationId: 'c1',
  createdAt: '2026-06-13T00:00:00Z'
}

describe('ShareStore', () => {
  it('starts empty and adds entries newest-first', () => {
    const s = new ShareStore(path)
    s.add(entry)
    s.add({ ...entry, id: 'def', createdAt: '2026-06-13T01:00:00Z' })
    expect(s.list().map((e) => e.id)).toEqual(['def', 'abc'])
  })

  it('persists across instances via flush', () => {
    const s = new ShareStore(path)
    s.add(entry)
    s.flush()
    expect(existsSync(path)).toBe(true)
    expect(new ShareStore(path).list().map((e) => e.id)).toEqual(['abc'])
  })

  it('get and remove work by id', () => {
    const s = new ShareStore(path)
    s.add(entry)
    expect(s.get('abc')?.title).toBe('Hello')
    s.remove('abc')
    expect(s.get('abc')).toBeNull()
    expect(s.list()).toHaveLength(0)
  })

  it('returns an empty list for a corrupt file', () => {
    const s = new ShareStore(path)
    s.add(entry)
    s.flush()
    require('fs').writeFileSync(path, 'not json')
    expect(new ShareStore(path).list()).toEqual([])
  })
})
