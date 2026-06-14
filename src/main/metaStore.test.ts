import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from './metaStore'

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'metastore-')), 'meta.json')
}

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

describe('MetaStore provenance', () => {
  it('seeds sources with never-fetched provenance', () => {
    const s = new MetaStore(tmpPath())
    const src = s.list()[0].sources[0]
    expect(src.status).toBe('never')
    expect(src.fetchedAt).toBeNull()
    expect(src.error).toBeNull()
    expect(s.list()[0].refreshedAt).toBeNull()
  })

  it('backfills provenance on legacy files missing the fields', () => {
    const p = tmpPath()
    writeFileSync(
      p,
      JSON.stringify({
        modes: [
          {
            id: 'a',
            mode: 'WvW',
            sources: [{ label: 'MB', url: 'https://metabattle.com' }],
            notes: 'old',
            updatedAt: ''
          }
        ]
      })
    )
    const s = new MetaStore(p)
    const m = s.list()[0]
    expect(m.refreshedAt).toBeNull()
    expect(m.sources[0].status).toBe('never')
    expect(m.sources[0].fetchedAt).toBeNull()
    expect(m.sources[0].error).toBeNull()
    expect(m.notes).toBe('old')
  })

  it('recordFetch sets ok status + timestamp, clears error', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    const url = m.sources[0].url
    s.recordFetch(m.id, url, { ok: true })
    const after = s.get(m.id)!.sources[0]
    expect(after.status).toBe('ok')
    expect(after.fetchedAt).toBeTruthy()
    expect(after.error).toBeNull()
  })

  it('recordFetch sets error status + message', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    s.recordFetch(m.id, m.sources[0].url, { ok: false, error: 'timeout' })
    const after = s.get(m.id)!.sources[0]
    expect(after.status).toBe('error')
    expect(after.error).toBe('timeout')
  })

  it('recordDistill sets notes + refreshedAt', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    s.recordDistill(m.id, 'current meta is X')
    const after = s.get(m.id)!
    expect(after.notes).toBe('current meta is X')
    expect(after.refreshedAt).toBeTruthy()
  })

  it('markAllStale nulls every mode refreshedAt', () => {
    const s = new MetaStore(tmpPath())
    s.list().forEach((m) => s.recordDistill(m.id, 'notes')) // sets refreshedAt
    s.markAllStale()
    expect(s.list().every((m) => m.refreshedAt === null)).toBe(true)
  })

  it('updateMode preserves existing source provenance on a bare patch', () => {
    const s = new MetaStore(tmpPath())
    const m = s.list()[0]
    const url = m.sources[0].url
    s.recordFetch(m.id, url, { ok: true })
    s.updateMode(m.id, { sources: m.sources.map((x) => ({ label: x.label, url: x.url })) })
    const after = s.get(m.id)!.sources[0]
    expect(after.status).toBe('ok')
    expect(after.fetchedAt).toBeTruthy()
  })
})

describe('MetaStore reconcile', () => {
  it('seeds PvE with snowcrows + metabattle + hardstuck', () => {
    const s = new MetaStore(tmpPath())
    const pve = s.list().find((m) => m.mode === 'PvE')!
    const urls = pve.sources.map((x) => x.url)
    expect(urls).toContain('https://snowcrows.com')
    expect(urls).toContain('https://metabattle.com/wiki/Category:PvE_builds')
    expect(urls).toContain('https://hardstuck.gg/gw2/builds/')
  })

  it('adds missing canonical sources to an existing mode without touching notes/provenance', () => {
    const p = tmpPath()
    writeFileSync(
      p,
      JSON.stringify({
        modes: [
          {
            id: 'a',
            mode: 'PvE',
            sources: [
              { label: 'Snowcrows', url: 'https://snowcrows.com', status: 'ok', fetchedAt: '2026-01-01T00:00:00.000Z', error: null }
            ],
            notes: 'kept',
            refreshedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: ''
          }
        ]
      })
    )
    const s = new MetaStore(p)
    const pve = s.list().find((m) => m.mode === 'PvE')!
    expect(pve.notes).toBe('kept')
    expect(pve.sources.find((x) => x.url === 'https://snowcrows.com')!.status).toBe('ok')
    expect(pve.sources.map((x) => x.url)).toContain('https://metabattle.com/wiki/Category:PvE_builds')
    expect(pve.sources.map((x) => x.url)).toContain('https://hardstuck.gg/gw2/builds/')
  })

  it('is idempotent — a second construct adds nothing', () => {
    const p = tmpPath()
    const a = new MetaStore(p)
    const before = a.list().find((m) => m.mode === 'PvE')!.sources.length
    const b = new MetaStore(p)
    expect(b.list().find((m) => m.mode === 'PvE')!.sources.length).toBe(before)
  })

  it('adds a wholly missing canonical mode', () => {
    const p = tmpPath()
    writeFileSync(p, JSON.stringify({ modes: [{ id: 'a', mode: 'PvE', sources: [], notes: '', refreshedAt: null, updatedAt: '' }] }))
    const s = new MetaStore(p)
    expect(s.list().map((m) => m.mode)).toContain('WvW')
  })
})
