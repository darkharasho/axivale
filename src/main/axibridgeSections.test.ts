// src/main/axibridgeSections.test.ts
import { describe, it, expect } from 'vitest'
import { SECTIONS, getSection } from './axibridgeSections'
import { getSection as gs } from './axibridgeSections'

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

const totalsReport = {
  meta: { id: 'r1' },
  stats: {
    defensePlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], activeMs: 300000,
        defenseTotals: { damageTaken: 500000, powerDamageTaken: 300000, conditionDamageTaken: 200000,
          blockedCount: 40, evadedCount: 20, missedCount: 5, dodgeCount: 12, invulnedCount: 3,
          interruptedCount: 2, downCount: 1, deadCount: 0, damageBarrier: 80000,
          boonStrips: 50, conditionCleanses: 10, receivedCrowdControl: 7 } }
    ],
    supportPlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], activeMs: 300000,
        supportTotals: { condiCleanse: 60, condiCleanseSelf: 10, boonStrips: 120,
          boonStripDownContribution: 9000, stunBreak: 4, removedStunDuration: 8000, resurrects: 2 } }
    ],
    healingPlayers: [
      { account: 'H.1', profession: 'Druid', professionList: ['Druid'], activeMs: 300000,
        healingTotals: { healing: 400000, squadHealing: 250000, groupHealing: 120000,
          selfHealing: 30000, offSquadHealing: 0 } }
    ],
    offensePlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], totalFightMs: 300000,
        offenseTotals: {}, offenseRateWeights: {}, downs: 5, downContribution: 22000 }
    ],
    outgoingConditionPlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], totalFightMs: 300000,
        totalApplications: 900, totalDamage: 120000, conditions: {} }
    ],
    incomingConditionPlayers: [
      { account: 'A.1', profession: 'Spellbreaker', professionList: ['Spellbreaker'], totalFightMs: 300000,
        totalApplications: 700, totalDamage: 90000, conditions: {} }
    ]
  }
}

describe('player-totals sections', () => {
  it('damage_mitigation pulls block/evade/etc from defenseTotals', () => {
    const res = gs('damage_mitigation')!.shape(totalsReport, { granularity: 'player' })
    const a = res.rows.find((r) => r.account === 'A.1')!
    expect(a.blocked).toBe(40)
    expect(a.evaded).toBe(20)
    expect(a.interrupted).toBe(2)
  })

  it('strips includes boonStripDownContribution', () => {
    const res = gs('strips')!.shape(totalsReport, { granularity: 'player' })
    expect(res.rows[0].boonStrips).toBe(120)
    expect(res.rows[0].stripDownContribution).toBe(9000)
  })

  it('squad granularity sums the numeric columns into one row', () => {
    const res = gs('damage_mitigation')!.shape(totalsReport, { granularity: 'squad' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].blocked).toBe(40)
  })

  it('absent section returns empty rows + note, never throws', () => {
    const res = gs('healing')!.shape({ meta: {}, stats: {} }, {})
    expect(res.rows).toEqual([])
    expect(res.note).toMatch(/did not include/i)
  })

  it('account filter narrows to one player', () => {
    const res = gs('strips')!.shape(totalsReport, { account: 'A.1' })
    expect(res.rows).toHaveLength(1)
  })
})
