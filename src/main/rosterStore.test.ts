import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RosterStore } from './rosterStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rosterstore-'))
  path = join(dir, 'rosterAnnotations.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('RosterStore', () => {
  it('creates an annotation on first upsert with timestamps', () => {
    const s = new RosterStore(path)
    expect(s.list()).toHaveLength(0)
    const a = s.upsert('m1', { nickname: 'Bob', aliases: ['bobby'], notes: 'main tank' })
    expect(a?.memberId).toBe('m1')
    expect(a?.nickname).toBe('Bob')
    expect(a?.aliases).toEqual(['bobby'])
    expect(a?.createdAt).toBeTruthy()
    expect(s.get('m1')?.notes).toBe('main tank')
  })

  it('updates only the provided fields and keeps the rest', () => {
    const s = new RosterStore(path)
    s.upsert('m1', { nickname: 'Bob', aliases: ['bobby'], notes: 'tank' })
    s.upsert('m1', { notes: 'tank, late nights' })
    const a = s.get('m1')
    expect(a?.nickname).toBe('Bob')
    expect(a?.aliases).toEqual(['bobby'])
    expect(a?.notes).toBe('tank, late nights')
    expect(s.list()).toHaveLength(1)
  })

  it('dedupes and trims aliases/tags (case-insensitive)', () => {
    const s = new RosterStore(path)
    const a = s.upsert('m1', { nickname: ' Bob ', aliases: ['bobby', ' Bobby ', 'BOBBY', 'b'], tags: ['core', 'core'] })
    expect(a?.nickname).toBe('Bob')
    expect(a?.aliases).toEqual(['bobby', 'b'])
    expect(a?.tags).toEqual(['core'])
  })

  it('removes the record when every field is cleared', () => {
    const s = new RosterStore(path)
    s.upsert('m1', { nickname: 'Bob' })
    const cleared = s.upsert('m1', { nickname: '', aliases: [], notes: '', tags: [] })
    expect(cleared).toBeNull()
    expect(s.get('m1')).toBeNull()
    expect(s.list()).toHaveLength(0)
  })

  it('persists across instances and survives a corrupt file', () => {
    const s = new RosterStore(path)
    s.upsert('m1', { nickname: 'Bob' })
    s.flush()
    expect(existsSync(path)).toBe(true)
    expect(new RosterStore(path).get('m1')?.nickname).toBe('Bob')

    writeFileSync(path, '{ not json')
    expect(new RosterStore(path).list()).toEqual([])
  })
})
