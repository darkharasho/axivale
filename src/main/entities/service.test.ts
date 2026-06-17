// src/main/entities/service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EntityService } from './service'

const FAKE_DETAIL = {
  description: 'Smash <c=@reminder>the</c> ground.',
  icon: 'https://render.gw2.com/shelter-detail.png',
  facts: [
    { type: 'Recharge', value: 4 },
    { type: 'Number', text: 'Number of Targets', value: 5 }
  ]
}

function makeService(over: Partial<ConstructorParameters<typeof EntityService>[0]> = {}) {
  return new EntityService({
    getCatalog: async () => ({
      runes: [{ id: 1, name: 'Superior Rune of the Monk', icon: 'https://render.gw2.com/rune.png', bonuses: ['+25 Healing'] }],
      relics: [{ name: 'Relic of the Monk', icon: 'https://render.gw2.com/relic.png' }]
    }),
    fetchEntities: async (e) => (e === 'skills'
      ? [{ id: 101, name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
      : [{ id: 202, name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]),
    fetchEntityDetail: vi.fn(async () => FAKE_DETAIL),
    ...over
  })
}

describe('EntityService.resolve', () => {
  it('resolves a skill via GW2 API and returns description (markup stripped) + facts', async () => {
    const svc = makeService()
    const card = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(card?.name).toBe('Shelter')
    expect(card?.description).toBe('Smash the ground.')
    expect(card?.facts).toContainEqual({ label: 'Recharge', value: '4s' })
    expect(card?.facts).toContainEqual({ label: 'Number of Targets', value: '5' })
  })

  it('resolved skill card has icon from detail response', async () => {
    const svc = makeService()
    const card = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(card?.icon).toBe('https://render.gw2.com/shelter-detail.png')
  })

  it('falls back to index icon when detail has no icon', async () => {
    const svc = makeService({
      fetchEntityDetail: vi.fn(async () => ({ description: 'desc', facts: [] }))
    })
    const card = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(card?.icon).toBe('https://render.gw2.com/shelter.png')
  })

  it('resolved skill card has correct wikiUrl', async () => {
    const svc = makeService()
    const card = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(card?.wikiUrl).toBe('https://wiki.guildwars2.com/wiki/Shelter')
  })

  it('caches success: fetchEntityDetail called once for repeat resolves', async () => {
    const fetchEntityDetail = vi.fn(async () => FAKE_DETAIL)
    const svc = makeService({ fetchEntityDetail })
    const a = await svc.resolve({ type: 'skill', name: 'Shelter' })
    const b = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(a?.name).toBe('Shelter')
    expect(b).toEqual(a)
    expect(fetchEntityDetail).toHaveBeenCalledTimes(1)
  })

  it('returns null for a name NOT in the entity index (unknown name)', async () => {
    const svc = makeService()
    const card = await svc.resolve({ type: 'skill', name: 'NonExistentSkill' })
    expect(card).toBeNull()
  })

  it('does not cache a miss: fetchEntityDetail never called for unknown name', async () => {
    const fetchEntities = vi.fn(async (e: 'skills' | 'traits') =>
      e === 'skills'
        ? [{ id: 101, name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
        : [{ id: 202, name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]
    )
    const fetchEntityDetail = vi.fn(async () => FAKE_DETAIL)
    const svc = makeService({ fetchEntities, fetchEntityDetail })
    // Miss twice
    await svc.resolve({ type: 'skill', name: 'GhostSkill' })
    await svc.resolve({ type: 'skill', name: 'GhostSkill' })
    expect(fetchEntityDetail).not.toHaveBeenCalled()
    // Index still fetched only once
    const skillCalls = fetchEntities.mock.calls.filter(([e]) => e === 'skills').length
    expect(skillCalls).toBe(1)
  })

  it('resolves an item from the catalog by name', async () => {
    const card = await makeService().resolve({ type: 'item', name: 'Superior Rune of the Monk' })
    expect(card).toMatchObject({ type: 'item', name: 'Superior Rune of the Monk' })
    expect(card?.facts).toContainEqual({ label: '', value: '+25 Healing' })
  })

  it('returns null for an unknown item and does not cache the miss', async () => {
    const getCatalog = vi.fn(async () => ({ runes: [], relics: [] }))
    const svc = makeService({ getCatalog })
    expect(await svc.resolve({ type: 'item', name: 'Nope' })).toBeNull()
    await svc.resolve({ type: 'item', name: 'Nope' })
    expect(getCatalog).toHaveBeenCalledTimes(2)
  })

  it('fetchEntities is called at most once per endpoint across multiple resolves', async () => {
    const fetchEntities = vi.fn(async (e: 'skills' | 'traits') =>
      e === 'skills'
        ? [{ id: 101, name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
        : [{ id: 202, name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]
    )
    const svc = makeService({ fetchEntities })
    await Promise.all([
      svc.resolve({ type: 'skill', name: 'Shelter' }),
      svc.resolve({ type: 'trait', name: 'Zeal' }),
      svc.resolve({ type: 'skill', name: 'Shelter' })
    ])
    const skillCalls = fetchEntities.mock.calls.filter(([e]) => e === 'skills').length
    const traitCalls = fetchEntities.mock.calls.filter(([e]) => e === 'traits').length
    expect(skillCalls).toBe(1)
    expect(traitCalls).toBe(1)
  })

  it('resolves a trait card with subtitle Trait', async () => {
    const svc = makeService()
    const card = await svc.resolve({ type: 'trait', name: 'Zeal' })
    expect(card?.subtitle).toBe('Trait')
    expect(card?.name).toBe('Zeal')
  })
})

describe('EntityService.dictionary', () => {
  it('merges catalog item names with fetched skill/trait names', async () => {
    const dict = await makeService().dictionary()
    const names = dict.entries.map((e) => e.name)
    expect(names).toContain('Shelter')
    expect(names).toContain('Zeal')
    expect(names).toContain('Superior Rune of the Monk')
    expect(names).toContain('Relic of the Monk')
  })

  it('dictionary entries carry icon from fetched data', async () => {
    const dict = await makeService().dictionary()
    const shelter = dict.entries.find((e) => e.name === 'Shelter')
    expect(shelter?.icon).toBe('https://render.gw2.com/shelter.png')
    const rune = dict.entries.find((e) => e.name === 'Superior Rune of the Monk')
    expect(rune?.icon).toBe('https://render.gw2.com/rune.png')
  })

  it('fetchEntities is not called again when dictionary() follows resolve()', async () => {
    const fetchEntities = vi.fn(async (e: 'skills' | 'traits') =>
      e === 'skills'
        ? [{ id: 101, name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
        : [{ id: 202, name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]
    )
    const svc = makeService({ fetchEntities })
    await svc.resolve({ type: 'skill', name: 'Shelter' })
    await svc.dictionary()
    const skillCalls = fetchEntities.mock.calls.filter(([e]) => e === 'skills').length
    const traitCalls = fetchEntities.mock.calls.filter(([e]) => e === 'traits').length
    expect(skillCalls).toBe(1)
    expect(traitCalls).toBe(1)
  })
})
