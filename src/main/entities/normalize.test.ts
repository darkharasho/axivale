// src/main/entities/normalize.test.ts
import { describe, it, expect } from 'vitest'
import { wikiUrlFor, wikiFactsToCard, catalogItemToCard } from './normalize'
import type { WikiFactsResult } from '../meta/wikiFacts'

describe('wikiUrlFor', () => {
  it('builds a wiki url with spaces as underscores', () => {
    expect(wikiUrlFor('Lily of the Elon')).toBe('https://wiki.guildwars2.com/wiki/Lily_of_the_Elon')
  })
  it('encodes special characters but keeps underscores', () => {
    expect(wikiUrlFor("Zealot's Speed")).toBe("https://wiki.guildwars2.com/wiki/Zealot's_Speed")
  })
})

describe('wikiFactsToCard', () => {
  const base: WikiFactsResult = {
    name: 'Shelter', found: true, hasSplit: false,
    pve: [], wvw: [], pvp: [],
    recharge: { pve: 30, wvw: 30, pvp: 30 }, activation: { pve: 0, wvw: 0, pvp: 0 }
  }
  it('returns null when the page was not found', () => {
    expect(wikiFactsToCard('skill', { ...base, found: false })).toBeNull()
  })
  it('maps a found skill to a card with recharge fact, subtitle, and wiki url', () => {
    const card = wikiFactsToCard('skill', base)
    expect(card).toMatchObject({
      type: 'skill', name: 'Shelter', subtitle: 'Skill',
      wikiUrl: 'https://wiki.guildwars2.com/wiki/Shelter'
    })
    expect(card?.facts).toContainEqual({ label: 'Recharge', value: '30s' })
  })
})

describe('catalogItemToCard', () => {
  it('maps a catalog rune to an item card with its bonuses as facts', () => {
    const card = catalogItemToCard({ id: 1, name: 'Superior Rune of the Monk', icon: 'x.png', bonuses: ['+25 Healing'] })
    expect(card).toEqual({
      type: 'item', name: 'Superior Rune of the Monk', icon: 'x.png',
      subtitle: 'Item', description: undefined,
      facts: [{ label: '', value: '+25 Healing' }],
      wikiUrl: 'https://wiki.guildwars2.com/wiki/Superior_Rune_of_the_Monk'
    })
  })
})
