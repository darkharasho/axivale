import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LinkStore } from './linkStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linkstore-'))
  path = join(dir, 'rosterLinks.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('LinkStore', () => {
  it('sets and resolves a link case-insensitively', () => {
    const s = new LinkStore(path)
    s.set('Harasho.4281', 'm1')
    expect(s.memberFor('harasho.4281')).toBe('m1')
    expect(s.memberFor('HARASHO.4281')).toBe('m1')
    expect(s.memberFor('other.0000')).toBeNull()
  })

  it('moves an account to a new member instead of duplicating', () => {
    const s = new LinkStore(path)
    s.set('Logan.1234', 'm1')
    s.set('logan.1234', 'm2')
    expect(s.memberFor('Logan.1234')).toBe('m2')
    expect(s.list()).toHaveLength(1)
  })

  it('removes a link', () => {
    const s = new LinkStore(path)
    s.set('Sera.9012', 'm3')
    s.remove('sera.9012')
    expect(s.memberFor('Sera.9012')).toBeNull()
    expect(s.list()).toHaveLength(0)
  })

  it('persists across instances and survives a corrupt file', () => {
    const s = new LinkStore(path)
    s.set('Axi.1', 'm1')
    s.flush()
    expect(new LinkStore(path).memberFor('axi.1')).toBe('m1')
    writeFileSync(path, 'not json')
    expect(new LinkStore(path).list()).toEqual([])
  })
})
