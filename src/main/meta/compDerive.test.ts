import { describe, it, expect } from 'vitest'
import { compDerive, extractReportComp, type ReportComp } from './compDerive'

const report = (profs: Record<string, number>, roles: Array<[string, string]>, parties: string[][]): ReportComp => ({
  squadClassData: Object.entries(profs).map(([name, value]) => ({ name, value })),
  roleClassifications: roles.map(([profession, role]) => ({ profession, role })),
  parties
})

describe('compDerive', () => {
  it('returns lowConfidence + zeros for an empty pool', () => {
    const d = compDerive([], { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' })
    expect(d.sampleSize).toBe(0)
    expect(d.lowConfidence).toBe(true)
    expect(d.professions).toEqual([])
  })

  it('aggregates profession counts, presence, and run-as across reports', () => {
    const r1 = report(
      { Firebrand: 2, Reaper: 2, Druid: 1 },
      [['Firebrand', 'support'], ['Firebrand', 'support'], ['Reaper', 'damage'], ['Reaper', 'damage'], ['Druid', 'support']],
      [['Firebrand', 'Druid', 'Reaper', 'Reaper', 'Firebrand']]
    )
    const r2 = report(
      { Firebrand: 1, Reaper: 3 },
      [['Firebrand', 'support'], ['Reaper', 'damage'], ['Reaper', 'damage'], ['Reaper', 'damage']],
      [['Firebrand', 'Reaper', 'Reaper', 'Reaper', 'Druid']]
    )
    const d = compDerive([r1, r2], { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' })
    expect(d.sampleSize).toBe(2)
    expect(d.lowConfidence).toBe(true) // 2 < MIN_SAMPLE(3)
    const fb = d.professions.find((p) => p.name === 'Firebrand')!
    expect(fb.avgPerSquad).toBeCloseTo(1.5, 1) // (2+1)/2
    expect(fb.presencePct).toBe(100)
    expect(fb.runAs).toBe('support')
    const reaper = d.professions.find((p) => p.name === 'Reaper')!
    expect(reaper.runAs).toBe('damage')
    // support% across all roleClassifications: r1 3sup/2dmg, r2 1sup/3dmg => 4/9
    expect(d.supportPct).toBe(44)
    // professions sorted by avgPerSquad desc
    expect(d.professions[0].avgPerSquad).toBeGreaterThanOrEqual(d.professions[1].avgPerSquad)
  })

  it('marks subgroup core = profession in >=50% of 5-player parties', () => {
    const mk = (parties: string[][]): ReportComp => report({}, [], parties)
    const d = compDerive(
      [mk([['Firebrand', 'Druid', 'Reaper', 'Troubadour', 'Specter'], ['Firebrand', 'Druid', 'Reaper', 'Troubadour', 'Berserker']])],
      { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' }
    )
    expect(d.subgroup.core).toEqual(expect.arrayContaining(['Firebrand', 'Druid', 'Reaper', 'Troubadour']))
    expect(d.subgroup.core).not.toContain('Specter') // only 1/2 parties = 50% exactly excluded by >50%? see impl
    expect(d.subgroup.flex).toEqual(expect.arrayContaining(['Specter', 'Berserker']))
  })

  it('extractReportComp pulls the largest fight as the representative parties', () => {
    const raw = {
      stats: {
        squadClassData: [{ name: 'Reaper', value: 1 }],
        roleClassifications: [{ profession: 'Reaper', role: 'damage' }],
        squadCompByFight: [
          { parties: [{ players: [{ profession: 'Reaper' }] }] },
          { parties: [{ players: [{ profession: 'Reaper' }, { profession: 'Druid' }] }] }
        ]
      }
    }
    const rc = extractReportComp(raw)!
    expect(rc.parties).toEqual([['Reaper', 'Druid']]) // the 2-player fight wins
  })

  it('extractReportComp returns null when comp slices are absent', () => {
    expect(extractReportComp({ stats: {} })).toBeNull()
    expect(extractReportComp(null)).toBeNull()
  })

  it('extractReportComp returns parties:[] when squadCompByFight is absent', () => {
    const rc = extractReportComp({ stats: { squadClassData: [{ name: 'Reaper', value: 1 }], roleClassifications: [{ profession: 'Reaper', role: 'damage' }] } })!
    expect(rc).not.toBeNull()
    expect(rc.parties).toEqual([])
  })

  it('yields empty subgroup when no 5-player parties exist', () => {
    const d = compDerive([{ squadClassData: [{ name: 'Reaper', value: 1 }], roleClassifications: [{ profession: 'Reaper', role: 'damage' }], parties: [] }], { repos: ['a/b'], days: 30, fromISO: '2026-05-15', toISO: '2026-06-15' })
    expect(d.subgroup).toEqual({ core: [], flex: [] })
  })
})
