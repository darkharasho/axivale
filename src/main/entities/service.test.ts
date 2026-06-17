// src/main/entities/service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EntityService } from './service'

function makeService(over: Partial<ConstructorParameters<typeof EntityService>[0]> = {}) {
  return new EntityService({
    wikiFacts: { lookup: vi.fn(async (name: string) => ({
      name, found: true, hasSplit: false, pve: [], wvw: [], pvp: [],
      recharge: { pve: 30, wvw: 30, pvp: 30 }, activation: { pve: 0, wvw: 0, pvp: 0 }
    })) },
    getCatalog: async () => ({
      runes: [{ id: 1, name: 'Superior Rune of the Monk', icon: 'https://render.gw2.com/rune.png', bonuses: ['+25 Healing'] }],
      relics: [{ name: 'Relic of the Monk', icon: 'https://render.gw2.com/relic.png' }]
    }),
    fetchEntities: async (e) => (e === 'skills'
      ? [{ name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
      : [{ name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]),
    ...over
  })
}

describe('EntityService.resolve', () => {
  it('resolves a skill via wiki facts and caches it (second call does not re-lookup)', async () => {
    const lookup = vi.fn(async (name: string) => ({
      name, found: true, hasSplit: false, pve: [], wvw: [], pvp: [],
      recharge: { pve: 30, wvw: 30, pvp: 30 }, activation: { pve: 0, wvw: 0, pvp: 0 }
    }))
    const svc = makeService({ wikiFacts: { lookup } })
    const a = await svc.resolve({ type: 'skill', name: 'Shelter' })
    const b = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(a?.name).toBe('Shelter')
    expect(b).toEqual(a)
    expect(lookup).toHaveBeenCalledTimes(1)
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
  it('attaches icon from icon index to a resolved skill card', async () => {
    const svc = makeService()
    // dictionary() must be called first to build the icon index
    await svc.dictionary()
    const card = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(card?.icon).toBe('https://render.gw2.com/shelter.png')
  })
  it('attaches icon WITHOUT calling dictionary() first (regression: icon was cached-missing before fix)', async () => {
    // Call resolve on a fresh service without ever calling dictionary()
    // Before the fix: iconIndex was null → card cached with no icon
    // After the fix: ensureIconIndex() is awaited inside resolve → icon is set before caching
    const svc = makeService()
    const card = await svc.resolve({ type: 'skill', name: 'Shelter' })
    expect(card?.icon).toBe('https://render.gw2.com/shelter.png')
  })
  it('attaches icon on trait resolve WITHOUT calling dictionary() first', async () => {
    const svc = makeService()
    const card = await svc.resolve({ type: 'trait', name: 'Zeal' })
    expect(card?.icon).toBe('https://render.gw2.com/zeal.png')
  })
  it('fetchEntities is called at most once per endpoint across multiple resolves', async () => {
    const fetchEntities = vi.fn(async (e: 'skills' | 'traits') =>
      e === 'skills'
        ? [{ name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
        : [{ name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]
    )
    const svc = makeService({ fetchEntities })
    // Multiple resolves for different skill/trait cards
    await Promise.all([
      svc.resolve({ type: 'skill', name: 'Shelter' }),
      svc.resolve({ type: 'trait', name: 'Zeal' }),
      svc.resolve({ type: 'skill', name: 'Shelter' }),
    ])
    // fetchEntities should be called once for 'skills' and once for 'traits' total
    const skillCalls = fetchEntities.mock.calls.filter(([e]) => e === 'skills').length
    const traitCalls = fetchEntities.mock.calls.filter(([e]) => e === 'traits').length
    expect(skillCalls).toBe(1)
    expect(traitCalls).toBe(1)
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
        ? [{ name: 'Shelter', icon: 'https://render.gw2.com/shelter.png' }]
        : [{ name: 'Zeal', icon: 'https://render.gw2.com/zeal.png' }]
    )
    const svc = makeService({ fetchEntities })
    await svc.resolve({ type: 'skill', name: 'Shelter' })
    await svc.dictionary()
    // Both resolve and dictionary share ensureData — should still be 1 call each
    const skillCalls = fetchEntities.mock.calls.filter(([e]) => e === 'skills').length
    const traitCalls = fetchEntities.mock.calls.filter(([e]) => e === 'traits').length
    expect(skillCalls).toBe(1)
    expect(traitCalls).toBe(1)
  })
})
