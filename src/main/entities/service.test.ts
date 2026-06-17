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
      runes: [{ id: 1, name: 'Superior Rune of the Monk', bonuses: ['+25 Healing'] }],
      relics: [{ name: 'Relic of the Monk' }]
    }),
    fetchNames: async (e) => (e === 'skills' ? ['Shelter'] : ['Zeal']),
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
})
