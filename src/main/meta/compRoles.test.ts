import { describe, it, expect } from 'vitest'
import { WVW_ROLES, boonsForRole, type WvwRole } from './compRoles'

describe('WvW role→boon mapping', () => {
  it('lists the WvW role taxonomy from the Snowcrows roles guide', () => {
    const names = WVW_ROLES.map((r) => r.role)
    expect(names).toEqual(
      expect.arrayContaining([
        'Primary Support',
        'Secondary Support',
        'Tertiary Support',
        'Boon Strip DPS',
        'Pure DPS'
      ])
    )
  })

  it('maps Primary Support to stability', () => {
    expect(boonsForRole('Primary Support')).toContain('Stability')
  })

  it('marks Boon Strip DPS as a stripper, not a boon provider', () => {
    const r = WVW_ROLES.find((x) => x.role === 'Boon Strip DPS')!
    expect(r.strips).toBe(true)
    expect(boonsForRole('Boon Strip DPS')).not.toContain('Stability')
  })

  it('every role carries a source URL', () => {
    for (const r of WVW_ROLES) expect(r.source).toMatch(/^https?:\/\//)
  })

  it('boonsForRole returns [] for an unknown role', () => {
    expect(boonsForRole('Nonsense' as WvwRole)).toEqual([])
  })
})
