import { describe, it, expect } from 'vitest'
import { rankIdentities, type ResolveMemberLite, type ResolveAnnotationLite } from './identityResolve'

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

  it('matches a character name', () => {
    const out = rankIdentities('Vale', members, annotations)
    expect(out[0].member_id).toBe('m1')
  })

  it('returns nothing for an unknown name', () => {
    expect(rankIdentities('nobody', members, annotations)).toEqual([])
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
