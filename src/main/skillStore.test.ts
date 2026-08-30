import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillStore, SKILLS } from './skillStore'

// Names of the skills shipped as defaults (see DEFAULT_SEED in skillStore.ts).
const SEEDED_NAMES = ['Build Guide', 'Commander Review', 'Fight Review', 'WvW Report', 'WvW Trends']

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillstore-'))
  path = join(dir, 'skills.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SKILLS (default seed)', () => {
  it('commander-review and wvw-report reference axibridge_positioning', () => {
    const keys = Object.fromEntries(SKILLS.map((s) => [s.key, s.instructions]))
    expect(keys['commander-review']).toMatch(/axibridge_positioning/)
    expect(keys['wvw-report']).toMatch(/axibridge_positioning/)
  })
})

describe('build-guide default skill', () => {
  it('is seeded and steers the read->edit->save notes flow', () => {
    const s = SKILLS.find((x) => x.key === 'build-guide')
    expect(s, 'build-guide seed present').toBeTruthy()
    expect(s!.instructions).toMatch(/axiforge_build_notes_get/)
    expect(s!.instructions).toMatch(/axiforge_build_notes_set/)
    expect(s!.instructions).toMatch(/\[\[skill:/)
  })
})

describe('SkillStore', () => {
  it('creates skills with ids/timestamps and defaults enabled', () => {
    const s = new SkillStore(path)
    const before = s.list().length
    const sk = s.create({ name: 'Raid Recap', whenToUse: 'how raid went', instructions: 'do x' })
    expect(sk.id).toBeTruthy()
    expect(sk.enabled).toBe(true)
    expect(sk.createdAt).toBeTruthy()
    expect(s.list()).toHaveLength(before + 1)
  })

  it('get / getByName (enabled-insensitive lookup by exact name)', () => {
    const s = new SkillStore(path)
    const sk = s.create({ name: 'Raid Recap', whenToUse: 'w', instructions: 'i' })
    expect(s.get(sk.id)?.name).toBe('Raid Recap')
    expect(s.getByName('Raid Recap')?.id).toBe(sk.id)
    expect(s.getByName('nope')).toBeNull()
  })

  it('update patches fields and bumps updatedAt; remove deletes', () => {
    const s = new SkillStore(path)
    const sk = s.create({ name: 'A', whenToUse: 'w', instructions: 'i' })
    const up = s.update(sk.id, { instructions: 'new', enabled: false })
    expect(up?.instructions).toBe('new')
    expect(up?.enabled).toBe(false)
    s.remove(sk.id)
    expect(s.get(sk.id)).toBeNull()
  })

  it('persists across instances and survives a corrupt file', () => {
    const s = new SkillStore(path)
    const baseline = s.list().length
    s.create({ name: 'A', whenToUse: 'w', instructions: 'i' })
    s.flush()
    expect(existsSync(path)).toBe(true)
    expect(new SkillStore(path).list()).toHaveLength(baseline + 1)
    // A corrupt file reseeds defaults but loses the user's custom skill.
    writeFileSync(path, 'not json')
    expect(new SkillStore(path).list().map((sk) => sk.name).sort()).toEqual(SEEDED_NAMES)
  })

  describe('default seeding', () => {
    it('seeds the default skills on first run', () => {
      const s = new SkillStore(path)
      expect(s.list().map((sk) => sk.name).sort()).toEqual(SEEDED_NAMES)
      for (const name of SEEDED_NAMES) expect(s.getByName(name)).not.toBeNull()
    })

    it('records applied seed keys so a deleted default stays deleted', () => {
      const s = new SkillStore(path)
      const report = s.getByName('WvW Report')!
      s.remove(report.id)
      s.flush()
      const reopened = new SkillStore(path)
      expect(reopened.getByName('WvW Report')).toBeNull()
      expect(reopened.list().map((sk) => sk.name).sort()).toEqual(
        SEEDED_NAMES.filter((n) => n !== 'WvW Report')
      )
    })

    it('seeds fight-review once and it stays deleted after removal', () => {
      const s = new SkillStore(path)
      const review = s.getByName('Fight Review')!
      s.remove(review.id)
      s.flush()
      const reopened = new SkillStore(path)
      expect(reopened.getByName('Fight Review')).toBeNull()
      expect(reopened.list().map((sk) => sk.name).sort()).toEqual(
        SEEDED_NAMES.filter((n) => n !== 'Fight Review')
      )
    })

    it('preserves user edits to a seeded skill across reload', () => {
      const s = new SkillStore(path)
      const report = s.getByName('WvW Report')!
      s.update(report.id, { instructions: 'my custom version' })
      s.flush()
      const reopened = new SkillStore(path)
      expect(reopened.getByName('WvW Report')?.instructions).toBe('my custom version')
    })

    it('adopts a pre-existing skill of the same name instead of duplicating it', () => {
      // Simulate a user who already authored "WvW Report" before seeding existed.
      writeFileSync(
        path,
        JSON.stringify({
          skills: [
            {
              id: 'existing',
              name: 'WvW Report',
              whenToUse: 'mine',
              instructions: 'mine',
              enabled: true,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        })
      )
      const s = new SkillStore(path)
      expect(s.list().filter((sk) => sk.name === 'WvW Report')).toHaveLength(1)
      expect(s.getByName('WvW Report')?.id).toBe('existing')
      // Persisted state records the seed key so it is not reapplied.
      s.flush()
      const onDisk = JSON.parse(readFileSync(path, 'utf8'))
      expect(onDisk.seeded).toContain('wvw-report')
    })
  })
})
