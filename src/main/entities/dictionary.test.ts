// src/main/entities/dictionary.test.ts
import { describe, it, expect } from 'vitest'
import { buildDictionary, fetchGw2Names } from './dictionary'

describe('buildDictionary', () => {
  it('trims, drops empties, and sorts entries longest-first', () => {
    const dict = buildDictionary({ skills: ['Shelter', '  ', ' Lily of the Elon '], traits: [], items: [] })
    expect(dict.entries.map((e) => e.name)).toEqual(['Lily of the Elon', 'Shelter'])
    expect(dict.entries[0]).toEqual({ name: 'Lily of the Elon', type: 'skill' })
  })
  it('dedupes a name across types with item > skill > trait precedence', () => {
    const dict = buildDictionary({ skills: ['Resolve'], traits: ['Resolve'], items: ['Resolve'] })
    expect(dict.entries).toEqual([{ name: 'Resolve', type: 'item' }])
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
