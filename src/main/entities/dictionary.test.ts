// src/main/entities/dictionary.test.ts
import { describe, it, expect } from 'vitest'
import { buildDictionary, fetchGw2Names, fetchGw2Entities } from './dictionary'

describe('buildDictionary', () => {
  it('trims, drops empties, and sorts entries longest-first', () => {
    const dict = buildDictionary({
      skills: [{ name: 'Shelter' }, { name: '  ' }, { name: ' Lily of the Elon ' }],
      traits: [],
      items: []
    })
    expect(dict.entries.map((e) => e.name)).toEqual(['Lily of the Elon', 'Shelter'])
    expect(dict.entries[0]).toEqual({ name: 'Lily of the Elon', type: 'skill' })
  })
  it('dedupes a name across types with item > skill > trait precedence', () => {
    const dict = buildDictionary({
      skills: [{ name: 'Resolve' }],
      traits: [{ name: 'Resolve' }],
      items: [{ name: 'Resolve' }]
    })
    expect(dict.entries).toEqual([{ name: 'Resolve', type: 'item' }])
  })
  it('carries icon onto entries', () => {
    const dict = buildDictionary({
      skills: [{ name: 'Shelter', icon: 'https://render.guildwars2.com/file/shelter.png' }],
      traits: [],
      items: []
    })
    expect(dict.entries[0].icon).toBe('https://render.guildwars2.com/file/shelter.png')
  })
  it('entries without icon have no icon property set', () => {
    const dict = buildDictionary({ skills: [{ name: 'Shelter' }], traits: [], items: [] })
    expect(dict.entries[0].icon).toBeUndefined()
  })
})

describe('fetchGw2Names', () => {
  it('requests ?ids=all and returns the names', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      return { ok: true, json: async () => [{ id: 1, name: 'Shelter' }, { id: 2 }, { id: 3, name: 'Bane Signet' }] }
    }
    const names = await fetchGw2Names('skills', fetchImpl)
    expect(calls).toEqual(['https://api.guildwars2.com/v2/skills?ids=all'])
    expect(names).toEqual(['Shelter', 'Bane Signet'])
  })
  it('returns [] when the response is not ok', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => [] })
    expect(await fetchGw2Names('traits', fetchImpl)).toEqual([])
  })
})

describe('fetchGw2Entities', () => {
  it('requests ?ids=all and returns id+name+icon, skipping rows without a string name or numeric id', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => [
          { id: 1, name: 'Shelter', icon: 'https://render.guildwars2.com/file/shelter.png' },
          { id: 2 },
          { id: 3, name: 'Bane Signet' }
        ]
      }
    }
    const entities = await fetchGw2Entities('skills', fetchImpl)
    expect(calls).toEqual(['https://api.guildwars2.com/v2/skills?ids=all'])
    expect(entities).toEqual([
      { id: 1, name: 'Shelter', icon: 'https://render.guildwars2.com/file/shelter.png' },
      { id: 3, name: 'Bane Signet' }
    ])
  })
  it('returns [] when the response is not ok', async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => [] })
    expect(await fetchGw2Entities('traits', fetchImpl)).toEqual([])
  })
})
