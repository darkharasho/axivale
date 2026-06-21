// src/main/axibridgeSections.test.ts
import { describe, it, expect } from 'vitest'
import { SECTIONS, getSection } from './axibridgeSections'

const boonReport = {
  meta: { id: 'r1', title: 'Run 1' },
  stats: {
    boonTables: [
      {
        id: 'b717', name: 'Protection', stacking: false,
        rows: [
          { account: 'A.1', profession: 'Firebrand', professionList: ['Firebrand'], activeTimeMs: 300000, numFights: 3,
            groupSupported: 15, squadSupported: 111,
            categories: {
              selfBuffs: { generationMs: 50000, wastedMs: 40000 },
              groupBuffs: { generationMs: 120000, wastedMs: 90000 },
              squadBuffs: { generationMs: 130000, wastedMs: 92000 }
            } },
          { account: 'B.2', profession: 'Scrapper', professionList: ['Scrapper'], activeTimeMs: 300000, numFights: 3,
            groupSupported: 5, squadSupported: 20,
            categories: {
              selfBuffs: { generationMs: 10000, wastedMs: 5000 },
              groupBuffs: { generationMs: 30000, wastedMs: 6000 },
              squadBuffs: { generationMs: 32000, wastedMs: 7000 }
            } }
        ]
      }
    ]
  }
}

describe('boons shaper', () => {
  it('returns per-account self/group/squad generation+waste+uptime for a named boon', () => {
    const boons = getSection('boons')!
    const res = boons.shape(boonReport, { granularity: 'player', boon: 'Protection' })
    expect(res.rows).toHaveLength(2)
    const a = res.rows.find((r) => r.account === 'A.1')!
    expect(a.boon).toBe('Protection')
    expect(a.groupGenSec).toBe(120) // 120000ms -> 120.0s
    expect(a.groupWasteSec).toBe(90)
    // uptime = groupGenerationMs / activeTimeMs as a %
    expect(a.groupUptimePct).toBe(40) // 120000/300000
  })

  it('sums squad generation across players when no boon filter and granularity=squad', () => {
    const boons = getSection('boons')!
    const res = boons.shape(boonReport, { granularity: 'squad' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].squadGenSec).toBe(162) // (130000+32000)/1000
  })

  it('lists boons as a section', () => {
    expect(SECTIONS.some((s) => s.key === 'boons')).toBe(true)
  })
})
