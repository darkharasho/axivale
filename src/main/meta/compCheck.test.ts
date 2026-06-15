import { describe, it, expect } from 'vitest'
import { checkComp, type Roster } from './compCheck'

const subgroup = (roles: string[]) => roles.map((role, i) => ({ build: `${role} ${i}`, role }))

describe('checkComp', () => {
  it('passes a covered subgroup', () => {
    const roster: Roster = {
      subgroups: [
        subgroup(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Boon Strip DPS'])
      ]
    }
    const r = checkComp(roster)
    expect(r.findings).toHaveLength(0)
  })

  it('flags a subgroup with pure DPS but no stability source', () => {
    const roster: Roster = { subgroups: [subgroup(['Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])] }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /stability/i.test(f.message) && f.severity === 'error')).toBe(true)
  })

  it('warns when the squad has no boon strip at all', () => {
    const roster: Roster = {
      subgroups: [subgroup(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /boon strip/i.test(f.message) && f.severity === 'warning')).toBe(true)
  })

  it('flags doubled Primary Support in one subgroup as a warning', () => {
    const roster: Roster = {
      subgroups: [subgroup(['Primary Support', 'Primary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /doubl/i.test(f.message) && f.severity === 'warning')).toBe(true)
  })

  it('reports an unknown role instead of silently passing', () => {
    const roster: Roster = { subgroups: [subgroup(['Healer', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])] }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /unknown role/i.test(f.message))).toBe(true)
  })

  it('flags an oversized subgroup (>5)', () => {
    const roster: Roster = {
      subgroups: [subgroup(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /5 players/i.test(f.message) && f.severity === 'error')).toBe(true)
  })

  it('returns a single error for an empty roster', () => {
    const roster: Roster = { subgroups: [] }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /roster is empty/i.test(f.message) && f.severity === 'error')).toBe(true)
  })

  it('warns about an empty subgroup', () => {
    const roster: Roster = { subgroups: [[]] }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /empty/i.test(f.message))).toBe(true)
  })

  it('oversized subgroup with 2 Primary Support does not emit a doubling warning', () => {
    const roster: Roster = {
      subgroups: [
        subgroup(['Primary Support', 'Primary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])
      ]
    }
    const r = checkComp(roster)
    expect(r.findings.some((f) => /5 players/i.test(f.message) && f.severity === 'error')).toBe(true)
    expect(r.findings.some((f) => /doubl/i.test(f.message))).toBe(false)
  })
})
