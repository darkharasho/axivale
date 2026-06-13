import { describe, it, expect } from 'vitest'
import { localRunDate } from './axibridgeRunDate'

describe('localRunDate', () => {
  it('uses the local date from the run-id prefix over the day-ahead UTC dateStart', () => {
    // Jun 11 20:08 local raid; dateStart is already Jun 12 in UTC.
    expect(localRunDate('20260611-180811-zq6c', '2026-06-12T01:30:00Z')).toBe('2026-06-11')
  })

  it('falls back to the ISO date when the id has no timestamp prefix', () => {
    expect(localRunDate('weird-id', '2026-06-12T01:30:00Z')).toBe('2026-06-12')
  })

  it('returns null when neither source yields a date', () => {
    expect(localRunDate('weird-id', null)).toBeNull()
    expect(localRunDate(undefined, undefined)).toBeNull()
  })
})
