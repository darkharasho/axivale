import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillStore } from './skillStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillstore-'))
  path = join(dir, 'skills.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SkillStore', () => {
  it('creates skills with ids/timestamps and defaults enabled', () => {
    const s = new SkillStore(path)
    const sk = s.create({ name: 'Raid Recap', whenToUse: 'how raid went', instructions: 'do x' })
    expect(sk.id).toBeTruthy()
    expect(sk.enabled).toBe(true)
    expect(sk.createdAt).toBeTruthy()
    expect(s.list()).toHaveLength(1)
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
    s.create({ name: 'A', whenToUse: 'w', instructions: 'i' })
    s.flush()
    expect(existsSync(path)).toBe(true)
    expect(new SkillStore(path).list()).toHaveLength(1)
    writeFileSync(path, 'not json')
    expect(new SkillStore(path).list()).toEqual([])
  })
})
