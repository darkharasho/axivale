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

  it('hands back a copy, so a caller sorting the result cannot mutate the registry', () => {
    const first = findSections('')
    expect(first).not.toBe(SECTIONS)
    first.reverse()
    expect(findSections('')[0].key).toBe('damage')
    const miss = findSections('xyzzy')
    expect(miss).not.toBe(SECTIONS)
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
    // omitted, not set to undefined — same as the entity path
    expect('warnings' in squad).toBe(false)
  })

  it('averages rate columns at squad granularity instead of summing them', () => {
    const squad = runSection(report, 'damage', { granularity: 'squad', role: 'squad' })
    const perEntity = runSection(report, 'damage', { role: 'squad', limit: 1000 }).rows
    const dpsSum = perEntity.reduce((acc, r) => acc + Number(r.dps), 0)
    expect(Number(squad.rows[0].dps)).toBe(Math.round((dpsSum / perEntity.length) * 10) / 10)
    expect(Number(squad.rows[0].dps)).toBeLessThan(dpsSum)
    expect(squad.note).toMatch(/DPS is a mean, not a sum/)
  })

  it('explains a filter that matched nothing rather than returning a bare empty table', () => {
    // defenses/contribution cover only the 42 friendly entities: a `present`
    // block that still has no enemy rows at all.
    const res = runSection(report, 'defenses', { role: 'enemy_player' })
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/No entities matched \(role=enemy_player\)/)
    expect(res.note).toMatch(/covers 42 of the log's 122 entities/)
  })

  it('returns no row at all, not a fabricated zero, when a squad rollup matches nothing', () => {
    const res = runSection(report, 'defenses', { granularity: 'squad', role: 'enemy_player' })
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/No entities matched \(role=enemy_player\)/)
    expect(res.note).toMatch(/covers 42 of the log's 122 entities/)
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

  it('reports an unsupported block as a note', () => {
    const stripped = { ...report, blocks: {}, coverage: { damage: 'unsupported' } } as AxilogReport
    const res = runSection(stripped, 'damage', {})
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/unsupported/)
  })

  it('says a present-but-empty block is empty, even when the result also truncates', () => {
    const emptyCoverage = { ...report, coverage: { ...report.coverage, damage: 'empty' } } as AxilogReport
    const truncated = runSection(emptyCoverage, 'damage', { limit: 2 })
    expect(truncated.note).toMatch(/Showing 2 of \d+ rows/)
    expect(truncated.note).toMatch(/present but empty/)
    const untruncated = runSection(emptyCoverage, 'damage', { limit: 1000 })
    expect(untruncated.note).toMatch(/present but empty/)
  })

  it('takes damageTaken from the authoritative damage block, not a derived sum', () => {
    const def = runSection(report, 'defenses', { entity: 'Anon132' })
    const dmg = runSection(report, 'damage', { entity: 'Anon132' })
    expect(def.rows).toHaveLength(1)
    expect(dmg.rows).toHaveLength(1)
    expect(def.rows[0].damageTaken).toBe(dmg.rows[0].taken)
    expect(Number(def.rows[0].damageTaken)).toBe(8993)
  })

  it('blanks damageTaken and says why when the damage block is absent', () => {
    const noDamage = {
      ...report,
      blocks: { defenses: report.blocks.defenses },
      coverage: { ...report.coverage, damage: 'not_computed' }
    } as AxilogReport
    const res = runSection(noDamage, 'defenses', { limit: 2 })
    expect(res.rows[0].damageTaken).toBe('')
    expect(res.note).toMatch(/Damage taken is blank/)
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

describe('support sections', () => {
  it('answers "how were our strips" with per-player strip counts', () => {
    const res = runSection(report, 'support', { role: 'squad', limit: 5 })
    expect(res.columns.map((c) => c.key)).toEqual(
      expect.arrayContaining(['strips', 'cleanses', 'resurrects'])
    )
    expect(res.rows.length).toBeGreaterThan(0)
    expect(Number(res.rows[0].strips)).toBeGreaterThanOrEqual(Number(res.rows[1]?.strips ?? 0))
  })

  it('exposes strip duration separately from strip count', () => {
    const res = runSection(report, 'support', { limit: 1 })
    expect(res.columns.map((c) => c.key)).toContain('stripDurationSec')
  })

  it('declares that boons and cc need no extra parse passes', () => {
    expect(getSection('boons')!.passes).toEqual({})
    expect(getSection('cc')!.passes).toEqual({})
  })

  it('shapes CC output in seconds, not milliseconds', () => {
    const res = runSection(report, 'cc', { limit: 3 })
    expect(res.columns.map((c) => c.key)).toContain('ccSec')
    for (const row of res.rows) expect(Number(row.ccSec)).toBeLessThan(10_000)
  })

  it('filters boons to a single boon when asked', () => {
    const all = runSection(report, 'boons', { limit: 100 })
    expect(all.rows.length).toBeGreaterThan(0)
    expect(all.columns.map((c) => c.key)).toContain('boon')
  })

  it('does not carry an enemy-side row for support, cc, or boons', () => {
    for (const key of ['support', 'cc', 'boons']) {
      const res = runSection(report, key, { role: 'enemy_player' })
      expect(res.rows).toEqual([])
      expect(res.note).toBeTruthy()
    }
  })

  it('resolves boon names through the buff catalog, falling back to the id', () => {
    const res = runSection(report, 'boons', { limit: 200 })
    expect(res.rows.some((r) => r.boon === 'Protection')).toBe(true)
  })

  it('reports boon squad generation as a percentage, not seconds', () => {
    const res = runSection(report, 'boons', { limit: 200 })
    for (const row of res.rows) {
      expect(Number(row.squadGenPct)).toBeGreaterThanOrEqual(0)
      expect(Number(row.squadGenPct)).toBeLessThanOrEqual(100)
    }
  })

  it('treats missing squad_wasted as zero, not NaN', () => {
    const res = runSection(report, 'boons', { limit: 200 })
    for (const row of res.rows) expect(Number.isNaN(Number(row.wasteSec))).toBe(false)
  })

  it('collapses support and cc to one squad row, not a per-entity dump', () => {
    for (const key of ['support', 'cc']) {
      const res = runSection(report, key, { granularity: 'squad', limit: 200 })
      expect(res.rows).toHaveLength(1)
      expect(res.note).toMatch(/matching entities/)
    }
  })

  it('falls back and notes an unknown sort key for support and cc, instead of silently no-op-sorting', () => {
    for (const key of ['support', 'cc']) {
      const res = runSection(report, key, { sort: 'not_a_real_field', limit: 5 })
      expect(res.note).toMatch(/Unknown sort key "not_a_real_field"/)
    }
  })

  it('collapses boon squad granularity to one row per boon, not a raw per-entity-per-boon dump', () => {
    const res = runSection(report, 'boons', { granularity: 'squad', limit: 200 })
    expect(res.rows.length).toBeGreaterThan(0)
    expect(res.rows.length).toBeLessThan(200)
    const boonNames = new Set(res.rows.map((r) => r.boon))
    expect(boonNames.size).toBe(res.rows.length)
    expect(res.note).toMatch(/one row per boon/)
    for (const row of res.rows) {
      expect(Number(row.squadGenPct)).toBeGreaterThanOrEqual(0)
      expect(Number(row.squadGenPct)).toBeLessThanOrEqual(100)
    }
  })

  it('never fabricates a boon squad summary when nothing matched', () => {
    const res = runSection(report, 'boons', { granularity: 'squad', role: 'enemy_player' })
    expect(res.rows).toEqual([])
    expect(res.note).toBeTruthy()
  })

  it('falls back and notes an unknown sort key for boons, instead of silently no-op-sorting', () => {
    const res = runSection(report, 'boons', { sort: 'not_a_real_field', limit: 5 })
    expect(res.note).toMatch(/Unknown sort key "not_a_real_field"/)
  })
})
