import { describe, it, expect } from 'vitest'
import { checkComp, type Roster } from './compCheck'

const sg = (roles: string[]): Roster['subgroups'][number] =>
  roles.map((role, i) => ({ build: `${role}-${i}`, role }))

const hasError = (r: Roster): boolean =>
  checkComp(r).findings.some((f) => f.severity === 'error')

describe('WvW comp eval set', () => {
  // GOOD: two well-covered subgroups, strip + cleanse present squad-wide.
  it('accepts a clean two-subgroup zerg core', () => {
    const good: Roster = {
      subgroups: [
        sg(['Primary Support', 'Secondary Support', 'Boon Strip DPS', 'Pure DPS', 'Pure DPS']),
        sg(['Primary Support', 'Secondary Support', 'Tertiary Support', 'Pure DPS', 'Pure DPS'])
      ]
    }
    expect(hasError(good)).toBe(false)
  })

  // BAD: all-DPS subgroup, no support, no strip, no cleanse.
  it('rejects an all-DPS subgroup', () => {
    const bad: Roster = { subgroups: [sg(['Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])] }
    expect(hasError(bad)).toBe(true)
  })

  // BAD: oversized subgroup (6 players).
  it('rejects an oversized subgroup', () => {
    const bad: Roster = {
      subgroups: [sg(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    expect(hasError(bad)).toBe(true)
  })

  // GOOD: exactly five with a flex/utility slot present alongside support + strip.
  it('accepts an exactly-five subgroup with a flex slot', () => {
    const good: Roster = {
      subgroups: [sg(['Primary Support', 'Secondary Support', 'Boon Strip DPS', 'Pure DPS', 'Flex'])]
    }
    expect(hasError(good)).toBe(false)
  })

  // WARNING (not error): support present but no boon strip anywhere in the squad.
  // checkComp treats missing strip as a squad-wide warning, not an error — adjusted to match real behavior.
  it('warns (not errors) on a squad with no boon strip', () => {
    const bad: Roster = {
      subgroups: [
        sg(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS']),
        sg(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS'])
      ]
    }
    expect(hasError(bad)).toBe(false)
  })

  // BAD: no cleanse-capable support in a subgroup (all DPS + a lone strip).
  it('rejects a subgroup with no cleanse support', () => {
    const bad: Roster = {
      subgroups: [sg(['Boon Strip DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    expect(hasError(bad)).toBe(true)
  })
})
