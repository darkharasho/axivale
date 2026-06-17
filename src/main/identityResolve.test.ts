import { describe, it, expect } from 'vitest'
import {
  rankIdentities,
  mergeManualLinks,
  loggedPlayerMembers,
  MIN_LOGGED_RUNS,
  type ResolveMemberLite,
  type ResolveAnnotationLite
} from './identityResolve'

const members: ResolveMemberLite[] = [
  {
    member_id: 'm1',
    member_name: 'harasho',
    accounts: [{ account_name: 'harasho.4281', characters: ['Axi', 'Vale'] }]
  },
  {
    member_id: 'm2',
    member_name: 'logan',
    accounts: [{ account_name: 'Logan.1234', characters: ['Logan Thackeray'] }]
  }
]

const annotations: ResolveAnnotationLite[] = [
  { memberId: 'm1', nickname: 'Bob', aliases: ['bobby', 'the tank'], notes: 'main tank', tags: ['core'] }
]

describe('rankIdentities', () => {
  it('resolves a nickname to the right member', () => {
    const out = rankIdentities('Bob', members, annotations)
    expect(out[0].member_id).toBe('m1')
    expect(out[0].account_names).toEqual(['harasho.4281'])
    expect(out[0].matched_on.some((r) => r.startsWith('nickname:'))).toBe(true)
  })

  it('resolves an alias and strips a leading @', () => {
    const out = rankIdentities('@bobby', members, annotations)
    expect(out[0].member_id).toBe('m1')
    expect(out[0].matched_on.some((r) => r.startsWith('alias:'))).toBe(true)
  })

  it('matches a GW2 account by its local part (pre-discriminator)', () => {
    const out = rankIdentities('logan', members, annotations)
    expect(out[0].member_id).toBe('m2')
  })

  it('matches a Discord display name and its cleaned form', () => {
    const m: ResolveMemberLite[] = [
      { member_id: 'mx', member_name: '.harasho', display_name: 'full art haro', accounts: [{ account_name: 'harasho.4281' }] }
    ]
    expect(rankIdentities('full art haro', m, [])[0]?.member_id).toBe('mx')
    // username ".harasho" resolves via its cleaned form "harasho"
    expect(rankIdentities('harasho', m, [])[0]?.member_id).toBe('mx')
  })

  it('matches a character name', () => {
    const out = rankIdentities('Vale', members, annotations)
    expect(out[0].member_id).toBe('m1')
  })

  it('returns nothing for an unknown name', () => {
    expect(rankIdentities('nobody', members, annotations)).toEqual([])
  })

  it('resolves a manually-linked account via mergeManualLinks', () => {
    // m1 (Bob) was never auto-linked to Spare.5555; a manual link ties them.
    const merged = mergeManualLinks(members, [{ accountName: 'Spare.5555', memberId: 'm1' }])
    const out = rankIdentities('spare', merged, annotations)
    expect(out[0].member_id).toBe('m1')
    expect(out[0].account_names).toContain('Spare.5555')
    // and the nickname still resolves to the now-richer account set
    expect(rankIdentities('Bob', merged, annotations)[0].account_names).toContain('Spare.5555')
  })

  it('creates a synthetic member when a manual link targets an unlinked member', () => {
    const merged = mergeManualLinks([], [{ accountName: 'New.1', memberId: 'mX' }])
    expect(merged).toHaveLength(1)
    expect(merged[0].member_id).toBe('mX')
    expect(merged[0].accounts?.[0].account_name).toBe('New.1')
  })

  it('ranks an exact nickname above a loose substring', () => {
    const anns: ResolveAnnotationLite[] = [
      { memberId: 'm1', nickname: 'Bob', aliases: [], notes: '', tags: [] },
      { memberId: 'm2', nickname: 'Bobby Jones', aliases: [], notes: '', tags: [] }
    ]
    const out = rankIdentities('Bob', members, anns)
    expect(out[0].member_id).toBe('m1')
  })
})

describe('loggedPlayerMembers', () => {
  it('builds acct: members for players at/above the run threshold', () => {
    const out = loggedPlayerMembers(
      [{ account: 'BreakN.5496', runs: 59 }, { account: 'Pug.1', runs: 1 }],
      []
    )
    expect(out).toHaveLength(1)
    expect(out[0].member_id).toBe('acct:BreakN.5496')
    expect(out[0].accounts?.[0].account_name).toBe('BreakN.5496')
  })

  it('lets a loose name resolve to a logged account via the discriminator local-part', () => {
    const logged = loggedPlayerMembers([{ account: 'BreakN.5496', runs: 59 }], [])
    const out = rankIdentities('break', logged, [])
    expect(out[0]?.member_id).toBe('acct:BreakN.5496')
  })

  it('skips accounts already present on the linked roster (no duplicate candidate)', () => {
    const existing: ResolveMemberLite[] = [
      { member_id: 'm1', accounts: [{ account_name: 'BreakN.5496' }] }
    ]
    expect(loggedPlayerMembers([{ account: 'BreakN.5496', runs: 59 }], existing)).toHaveLength(0)
  })

  it('honors the default run threshold', () => {
    const below = loggedPlayerMembers([{ account: 'Rare.1', runs: MIN_LOGGED_RUNS - 1 }], [])
    const atOrAbove = loggedPlayerMembers([{ account: 'Reg.2', runs: MIN_LOGGED_RUNS }], [])
    expect(below).toHaveLength(0)
    expect(atOrAbove).toHaveLength(1)
  })
})
