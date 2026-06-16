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
  inGameAccounts: ['harasho.4281', 'Ghost.0000'],
  annotations: [{ memberId: 'm1', nickname: 'Bob', aliases: ['bobby'], notes: 'tank', tags: ['core'] }],
  memberRoleId: 'member',
  haveInGame: true
}

describe('reconcileRoster', () => {
  it('marks a linked + in-game member as verified and carries annotations', () => {
    const r = reconcileRoster(base)
    const bob = r.find((m) => m.memberId === 'm1')!
    expect(bob.status).toBe('verified')
    expect(bob.hasMemberRole).toBe(true)
    expect(bob.linked).toBe(true)
    expect(bob.inGuild).toBe(true)
    expect(bob.nickname).toBe('Bob')
    expect(bob.label).toBe('Bob')
  })

  it('flags a linked member not in the in-game roster as left-guild', () => {
    const r = reconcileRoster(base)
    const logan = r.find((m) => m.memberId === 'm2')!
    expect(logan.status).toBe('left-guild')
    expect(logan.inGuild).toBe(false)
  })

  it('excludes non-member-role users who are not linked', () => {
    const r = reconcileRoster(base)
    expect(r.find((m) => m.memberId === 'm3')).toBeUndefined()
  })

  it('surfaces in-game accounts with no Discord match', () => {
    const r = reconcileRoster(base)
    const ghost = r.find((m) => m.status === 'in-game-only')!
    expect(ghost.memberId).toBeNull()
    expect(ghost.accounts[0].account_name).toBe('Ghost.0000')
  })

  it('reports no-key for a role member who never linked', () => {
    const r = reconcileRoster({
      ...base,
      discordMembers: [{ id: 'm4', name: 'newbie', roles: ['member'] }],
      linked: [],
      inGameAccounts: [],
      annotations: []
    })
    const newbie = r.find((m) => m.memberId === 'm4')!
    expect(newbie.status).toBe('no-key')
    expect(newbie.linked).toBe(false)
  })

  it('falls back to the linked roster when no role is configured', () => {
    const r = reconcileRoster({ ...base, memberRoleId: null })
    // m3 (no link, no role match) excluded; m1/m2 present via their links
    expect(r.some((m) => m.memberId === 'm1')).toBe(true)
    expect(r.some((m) => m.memberId === 'm3')).toBe(false)
    expect(r.find((m) => m.memberId === 'm1')!.hasMemberRole).toBe(false)
  })

  it('still lists linked members when the Discord overview is unavailable', () => {
    // Regression: roster must not blank out just because discordOverview returned
    // no members — linked members are the floor.
    const r = reconcileRoster({
      ...base,
      discordMembers: [],
      annotations: []
    })
    expect(r.find((m) => m.memberId === 'm1')!.status).toBe('verified')
    expect(r.find((m) => m.memberId === 'm2')!.status).toBe('left-guild')
    // falls back to linked member_name when no Discord overlay is present
    const withName = reconcileRoster({
      discordMembers: [],
      linked: [{ member_id: 'mX', member_name: 'solo', accounts: [{ account_name: 'Solo.1' }] }],
      inGameAccounts: [],
      annotations: [],
      memberRoleId: 'member',
      haveInGame: false
    })
    expect(withName[0].discordName).toBe('solo')
    expect(withName[0].label).toBe('solo')
  })

  it('uses linked status (not left-guild) when the in-game roster is unavailable', () => {
    const r = reconcileRoster({ ...base, inGameAccounts: [], haveInGame: false })
    expect(r.find((m) => m.memberId === 'm1')!.status).toBe('linked')
    expect(r.find((m) => m.memberId === 'm2')!.status).toBe('linked')
    expect(r.some((m) => m.status === 'in-game-only')).toBe(false)
  })
})
