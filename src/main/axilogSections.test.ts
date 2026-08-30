import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSection, findSections, getSection, SECTIONS, DEFAULT_ROW_LIMIT } from './axilogSections'
import type { AxilogReport } from './axilogEntities'

const report = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'wvw-small.report.json'), 'utf8')
) as AxilogReport

describe('section registry', () => {
  it('finds the damage section by an alias, not just its key', () => {
    expect(findSections('dps')[0].key).toBe('damage')
    expect(findSections('who did the most damage')[0].key).toBe('damage')
  })

  it('returns the whole catalog for an empty or unmatched query', () => {
    expect(findSections('').length).toBeGreaterThan(1)
    expect(findSections('xyzzy').length).toBe(findSections('').length)
  })

  it('declares which parse passes each section needs', () => {
    expect(getSection('damage')!.passes).toEqual({})
  })

  it('names every descriptor after a block the fixture actually carries', () => {
    for (const s of SECTIONS) expect(report.coverage[s.block]).toBe('present')
  })
})

describe('runSection', () => {
  it('names every row instead of returning raw entity ids', () => {
    const res = runSection(report, 'damage', {})
    expect(res.rows.length).toBeGreaterThan(0)
    for (const row of res.rows) {
      expect(row.name).toBeTypeOf('string')
      expect(String(row.name)).not.toMatch(/^\d+$/)
    }
  })

  it('defaults to a row limit so a 122-entity roster cannot flood context', () => {
    expect(runSection(report, 'damage', {}).rows.length).toBeLessThanOrEqual(DEFAULT_ROW_LIMIT)
  })

  it('sorts descending by the section default so the top performers lead', () => {
    const rows = runSection(report, 'damage', { limit: 5 }).rows
    const values = rows.map((r) => Number(r.total))
    expect([...values].sort((a, b) => b - a)).toEqual(values)
    expect(values[0]).toBeGreaterThan(0)
  })

  it('sorts by an explicit column when asked', () => {
    const rows = runSection(report, 'damage', { limit: 5, sort: 'kills' }).rows
    const values = rows.map((r) => Number(r.kills))
    expect([...values].sort((a, b) => b - a)).toEqual(values)
  })

  it('filters to enemy players when asked', () => {
    const enemies = runSection(report, 'damage', { role: 'enemy_player', limit: 100 })
    const squad = runSection(report, 'damage', { role: 'squad', limit: 100 })
    expect(enemies.rows.length).toBeGreaterThan(0)
    expect(squad.rows.length).toBeGreaterThan(0)
    const overlap = enemies.rows.filter((e) => squad.rows.some((s) => s.name === e.name))
    expect(overlap).toEqual([])
  })

  it('filters to one entity through the loose name resolver', () => {
    const all = runSection(report, 'damage', { role: 'squad', limit: 100 })
    const target = String(all.rows[0].name)
    const one = runSection(report, 'damage', { entity: target })
    expect(one.rows.map((r) => r.name)).toEqual([target])
  })

  it('says so, with rows empty, when an entity name cannot be resolved', () => {
    const res = runSection(report, 'damage', { entity: 'definitely-not-a-player' })
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/could not resolve/i)
  })

  it('collapses to a single summed row at squad granularity', () => {
    const squad = runSection(report, 'damage', { granularity: 'squad', role: 'squad' })
    expect(squad.rows.length).toBe(1)
    const perEntity = runSection(report, 'damage', { role: 'squad', limit: 1000 }).rows
    const summed = perEntity.reduce((acc, r) => acc + Number(r.total), 0)
    expect(Number(squad.rows[0].total)).toBe(summed)
  })

  it('reports an absent block as a note rather than empty rows', () => {
    const stripped = { ...report, blocks: {}, coverage: { damage: 'not_computed' } } as AxilogReport
    const res = runSection(stripped, 'damage', {})
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/not_computed|does not carry/i)
  })

  it('warns instead of throwing when by_entity carries an id the roster lacks', () => {
    const ghost = {
      ...report,
      blocks: { damage: { by_entity: { '99999': { total: 5 } } } }
    } as unknown as AxilogReport
    const res = runSection(ghost, 'damage', {})
    expect(res.rows).toEqual([])
    expect(res.warnings?.[0]).toMatch(/99999/)
  })

  it('throws an actionable error for an unknown section', () => {
    expect(() => runSection(report, 'nonsense', {})).toThrow(/unknown section "nonsense"/i)
  })

  it('shapes defenses with damage taken and downs', () => {
    const res = runSection(report, 'defenses', { limit: 3 })
    expect(res.columns.map((c) => c.key)).toContain('damageTaken')
    expect(res.columns.map((c) => c.key)).toContain('downsTaken')
    expect(res.rows.length).toBe(3)
    expect(Number(res.rows[0].damageTaken)).toBeGreaterThan(0)
  })

  it('shapes down contribution from the contribution block', () => {
    const res = runSection(report, 'contribution', { limit: 5 })
    expect(res.columns.map((c) => c.key)).toContain('downsContribDamage')
    expect(Number(res.rows[0].downsContribDamage)).toBeGreaterThan(0)
  })

  it('returns nothing but the table shape — never a report fragment', () => {
    const res = runSection(report, 'damage', { limit: 2 })
    for (const k of Object.keys(res)) {
      expect(['rows', 'columns', 'note', 'warnings']).toContain(k)
    }
    for (const row of res.rows) {
      for (const v of Object.values(row)) expect(['string', 'number']).toContain(typeof v)
    }
  })
})
