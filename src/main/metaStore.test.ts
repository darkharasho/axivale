import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from './metaStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'metastore-'))
  path = join(dir, 'meta.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('MetaStore', () => {
  it('seeds default modes on first run (PvE, WvW, WvW Roaming) and persists them', () => {
    const s = new MetaStore(path)
    const modes = s.list().map((m) => m.mode)
    expect(modes).toContain('PvE')
    expect(modes).toContain('WvW')
    expect(modes).toContain('WvW Roaming')
    expect(existsSync(path)).toBe(true)
    // PvE points at Snowcrows
    const pve = s.list().find((m) => m.mode === 'PvE')!
    expect(pve.sources.some((src) => /snowcrows/i.test(src.url))).toBe(true)
    expect(pve.notes).toBe('')
  })

  it('adds, updates, and removes modes', () => {
    const s = new MetaStore(path)
    const m = s.addMode({ mode: 'PvP', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com' }], notes: '' })
    expect(m.id).toBeTruthy()
    const up = s.updateMode(m.id, { notes: 'condi everywhere' })
    expect(up?.notes).toBe('condi everywhere')
    s.removeMode(m.id)
    expect(s.get(m.id)).toBeNull()
  })

  it('survives a corrupt file by reseeding defaults', () => {
    writeFileSync(path, 'not json')
    expect(new MetaStore(path).list().length).toBeGreaterThan(0)
  })
})
