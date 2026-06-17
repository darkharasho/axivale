import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from './metaStore'
import type { DerivedComp } from './meta/compDerive'

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'metastore-')), 'meta.json')
}

// reuse the same helper name as the existing beforeEach sets up
function tmpFile(): string {
  return tmpPath()
}

const fakeDerived = (): DerivedComp => ({
  window: { fromISO: '2026-05-15', toISO: '2026-06-15', days: 30 },
  sampleSize: 5,
  sourceRepos: ['a/b'],
  lowConfidence: false,
  avgSquadSize: 36,
  supportPct: 49,
  professions: [{ name: 'Reaper', avgPerSquad: 6, presencePct: 100, runAs: 'damage' }],
  subgroup: { core: ['Firebrand'], flex: ['Specter'] }
})

it('seeds WvW playbook with principles and blessed=true', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  expect(wvw.playbook).toBeTruthy()
  expect(wvw.playbook!.blessed).toBe(true)
  expect(wvw.playbook!.principles).toMatch(/cleanse/i)
  expect(wvw.playbook!.derived).toBeNull()
})

it('recordDerivedComp sets derived without touching principles/blessed', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  store.recordDerivedComp(wvw.id, fakeDerived())
  const after = store.get(wvw.id)!
  expect(after.playbook!.derived!.avgSquadSize).toBe(36)
  expect(after.playbook!.derivedAt).toBeTruthy()
  expect(after.playbook!.blessed).toBe(true) // unchanged
  expect(after.playbook!.principles).toMatch(/cleanse/i) // unchanged
})

it('recordDistill never touches the playbook', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  store.recordDerivedComp(wvw.id, fakeDerived())
  store.recordDistill(wvw.id, 'new build summary')
  const after = store.get(wvw.id)!
  expect(after.notes).toBe('new build summary')
  expect(after.playbook!.derived!.avgSquadSize).toBe(36) // survived
})

it('updatePlaybook patches curation fields', () => {
  const store = new MetaStore(tmpFile())
  const wvw = store.list().find((m) => m.mode === 'WvW')!
  store.updatePlaybook(wvw.id, { overrides: 'prefer reaper', blessed: false })
  const after = store.get(wvw.id)!
  expect(after.playbook!.overrides).toBe('prefer reaper')
  expect(after.playbook!.blessed).toBe(false)
})

it('persists the playbook across reload', () => {
  const path = tmpFile()
  const s1 = new MetaStore(path)
  const wvw = s1.list().find((m) => m.mode === 'WvW')!
  s1.updatePlaybook(wvw.id, { overrides: 'reaper backline', blessed: false })
  s1.flush()
  const s2 = new MetaStore(path)
  const reloaded = s2.list().find((m) => m.mode === 'WvW')!
  expect(reloaded.playbook.overrides).toBe('reaper backline')
  expect(reloaded.playbook.blessed).toBe(false)
  expect(reloaded.playbook.principles).toMatch(/cleanse/i)
})

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

describe('MetaStore groups', () => {
  it('seeds a Guides mode whose sources are group=general', () => {
    const store = new MetaStore(tmpFile())
    const guides = store.list().find((m) => m.mode === 'Guides')
    expect(guides).toBeTruthy()
    expect(guides!.sources.length).toBeGreaterThan(0)
    expect(guides!.sources.every((s) => s.group === 'general')).toBe(true)
  })

  it('migrates a legacy General mode to Guides on load', () => {
    const path = tmpFile()
    writeFileSync(path, JSON.stringify({
      modes: [{
        id: 'g', mode: 'General',
        sources: [{ label: 'Snowcrows (Guides)', url: 'https://snowcrows.com/guides', group: 'general', status: 'ok', fetchedAt: null, error: null }],
        notes: '', playbook: {}, refreshedAt: null, updatedAt: 'now'
      }]
    }))
    const store = new MetaStore(path)
    expect(store.list().find((m) => m.mode === 'General')).toBeUndefined()
    expect(store.list().find((m) => m.mode === 'Guides')).toBeTruthy()
  })

  it('tags WvW GW2-wiki sources as group=wiki and build sources as group=meta', () => {
    const store = new MetaStore(tmpFile())
    const wvw = store.list().find((m) => m.mode === 'WvW')!
    const wikiSrc = wvw.sources.find((s) => s.url.includes('wiki.guildwars2.com'))!
    const buildSrc = wvw.sources.find((s) => s.url.includes('metabattle.com'))!
    expect(wikiSrc.group).toBe('wiki')
    expect(buildSrc.group).toBe('meta')
  })

  it('normalizes a legacy source with no group to meta', () => {
    const path = tmpFile()
    writeFileSync(path, JSON.stringify({
      modes: [{
        id: 'x', mode: 'PvE',
        sources: [{ label: 'L', url: 'https://snowcrows.com/builds/raids', status: 'ok', fetchedAt: null, error: null }],
        notes: '', playbook: {}, refreshedAt: null, updatedAt: 'now'
      }]
    }))
    const store = new MetaStore(path)
    const pve = store.list().find((m) => m.mode === 'PvE')!
    expect(pve.sources[0].group).toBe('meta')
  })
})

describe('MetaStore reconcile', () => {
  it('seeds PvE with snowcrows raids/open-world + metabattle (no hardstuck)', () => {
    const s = new MetaStore(tmpPath())
    const pve = s.list().find((m) => m.mode === 'PvE')!
    const urls = pve.sources.map((x) => x.url)
    expect(urls).toContain('https://snowcrows.com/builds/raids')
    expect(urls).toContain('https://snowcrows.com/builds/open-world')
    expect(urls).toContain('https://metabattle.com/wiki/Raid_Builds')
    expect(urls).toContain('https://metabattle.com/wiki/Fractal')
    expect(urls).toContain('https://metabattle.com/wiki/Open_World')
    expect(urls.some((u) => /hardstuck/.test(u))).toBe(false)
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
              { label: 'Snowcrows (Raids)', url: 'https://snowcrows.com/builds/raids', status: 'ok', fetchedAt: '2026-01-01T00:00:00.000Z', error: null }
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
    expect(pve.sources.find((x) => x.url === 'https://snowcrows.com/builds/raids')!.status).toBe('ok')
    expect(pve.sources.map((x) => x.url)).toContain('https://metabattle.com/wiki/Raid_Builds')
    expect(pve.sources.map((x) => x.url)).toContain('https://snowcrows.com/builds/open-world')
  })

  it('reconcile drops sources no longer in the seed', () => {
    const p = tmpPath()
    writeFileSync(p, JSON.stringify({ modes: [{ id: 'a', mode: 'WvW Roaming', sources: [
      { label: 'Old Hardstuck', url: 'https://hardstuck.gg', status: 'ok', fetchedAt: '2026-01-01T00:00:00.000Z', error: null },
      { label: 'MetaBattle (Roaming)', url: 'https://metabattle.com/wiki/WvW_Roaming', status: 'never', fetchedAt: null, error: null }
    ], notes: 'keep', refreshedAt: null, updatedAt: '' }] }))
    const s = new MetaStore(p)
    const m = s.list().find((x) => x.mode === 'WvW Roaming')!
    const urls = m.sources.map((x) => x.url)
    expect(urls).not.toContain('https://hardstuck.gg')          // dropped (not in seed)
    expect(urls).toContain('https://metabattle.com/wiki/WvW_Roaming')
    expect(urls).toContain('https://guildjen.com/gw2-wvw-builds/') // added from seed
    expect(m.notes).toBe('keep')
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

  it('seeds WvW with comp-rule + mechanics sources', () => {
    const store = new MetaStore(tmpPath())
    const wvw = store.list().find((m) => m.mode === 'WvW')!
    const urls = wvw.sources.map((s) => s.url)
    expect(urls).toContain('https://wiki.guildwars2.com/wiki/Squad')
    expect(urls).toContain('https://wiki.guildwars2.com/wiki/Boon')
    expect(urls).toContain('https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles')
    expect(urls).toContain('https://guildorder.com/games/gw2/guides/wvw-squad-leadership')
    expect(urls).toContain('https://snowcrows.com/news/wvw')
  })
})
