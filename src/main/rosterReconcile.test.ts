import { describe, it, expect } from 'vitest'
import { reconcileRoster, type ReconcileInput } from './rosterReconcile'

const base: ReconcileInput = {
  discordMembers: [
    { id: 'm1', name: 'harasho', display_name: 'Bob', roles: ['member', 'raider'] },
    { id: 'm2', name: 'logan', display_name: 'Logan', roles: ['member'] },
    { id: 'm3', name: 'lurker', display_name: 'Lurker', roles: ['guest'] }
  ],
  linked: [
    { member_id: 'm1', accounts: [{ account_name: 'harasho.4281', characters: ['Axi'] }] },
    { member_id: 'm2', accounts: [{ account_name: 'Logan.1234' }] }
  ],
  inGameRoster: [
    { name: 'harasho.4281', rank: 'Officer', joined: '2024-11-01' },
    { name: 'Ghost.0000', rank: 'Member', joined: '2025-01-01' }
  ],
  manualLinks: [],
  annotations: [{ memberId: 'm1', nickname: 'Bob', aliases: ['bobby'], notes: 'tank', tags: ['core'] }],
  memberRoleId: 'member',
  haveInGame: true
}

describe('reconcileRoster (GW2-first)', () => {
  it('bases the roster on the in-game guild and matches Discord on top', () => {
    const r = reconcileRoster(base)
    const bob = r.find((m) => m.accountName === 'harasho.4281')!
    expect(bob.status).toBe('verified')
    expect(bob.memberId).toBe('m1')
    expect(bob.linkSource).toBe('auto')
    expect(bob.rank).toBe('Officer')
    expect(bob.nickname).toBe('Bob')
    expect(bob.inGuild).toBe(true)
  })

  it('shows an in-game account with no Discord match as unlinked', () => {
    const r = reconcileRoster(base)
    const ghost = r.find((m) => m.accountName === 'Ghost.0000')!
    expect(ghost.status).toBe('unlinked')
    expect(ghost.memberId).toBeNull()
    expect(ghost.linkSource).toBeNull()
  })

  it('honors a manual link over (and without) an auto link', () => {
    const r = reconcileRoster({
      ...base,
      manualLinks: [{ accountName: 'ghost.0000', memberId: 'm2' }]
    })
    const ghost = r.find((m) => m.accountName === 'Ghost.0000')!
    expect(ghost.status).toBe('verified')
    expect(ghost.memberId).toBe('m2')
    expect(ghost.linkSource).toBe('manual')
    // m2 is now placed in-game, so it should NOT also appear as left-guild
    expect(r.filter((m) => m.memberId === 'm2')).toHaveLength(1)
  })

  it('lists a linked member not in the in-game roster as left-guild', () => {
    const r = reconcileRoster(base)
    const logan = r.find((m) => m.memberId === 'm2')!
    expect(logan.status).toBe('left-guild')
    expect(logan.inGuild).toBe(false)
  })

  it('lists a role member with no key as no-key, excludes non-members', () => {
    const r = reconcileRoster({
      ...base,
      discordMembers: [...base.discordMembers, { id: 'm4', name: 'newbie', roles: ['member'] }]
    })
    expect(r.find((m) => m.memberId === 'm4')!.status).toBe('no-key')
    expect(r.find((m) => m.memberId === 'm3')).toBeUndefined() // 'guest' role, not linked
  })

  it('falls back to the linked roster when no in-game roster is available', () => {
    const r = reconcileRoster({ ...base, inGameRoster: [], haveInGame: false })
    const bob = r.find((m) => m.memberId === 'm1')!
    expect(bob.status).toBe('linked')
    expect(r.some((m) => m.status === 'unlinked')).toBe(false)
    expect(r.find((m) => m.memberId === 'm2')!.status).toBe('linked')
  })

  it('fallback still honors manual links for the Discord match label', () => {
    const r = reconcileRoster({
      ...base,
      inGameRoster: [],
      haveInGame: false,
      manualLinks: [{ accountName: 'harasho.4281', memberId: 'm1' }]
    })
    // m1 still resolves with its annotation nickname
    expect(r.find((m) => m.memberId === 'm1')!.label).toBe('Bob')
  })
})
