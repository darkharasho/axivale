import { describe, it, expect } from 'vitest'
import { scrapeBuildGear } from './buildGear'

// Fake GW2 API: route by URL to canned item/stat/profession/skill responses.
function fakeFetch(): (
  url: string
) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }> {
  const items = [
    { id: 100, name: 'Scepter', icon: 'i-scepter', type: 'Weapon', details: { type: 'Scepter' } },
    { id: 200, name: 'Superior Sigil of Force', icon: 'i-sigil', type: 'UpgradeComponent', details: { type: 'Sigil' } },
    { id: 101, name: 'Chest', icon: 'i-chest', type: 'Armor' },
    { id: 300, name: 'Superior Rune of Divinity', icon: 'i-rune', type: 'UpgradeComponent', details: { type: 'Rune' } }
  ]
  return async (url: string) => {
    let body: unknown = []
    if (url.includes('/v2/items?')) body = items
    else if (url.includes('/v2/itemstats?')) body = [{ id: 1, name: 'Berserker' }]
    else if (url.includes('/v2/professions/')) body = { weapons: { Scepter: { skills: [{ id: 9, slot: 'Weapon_1' }] } } }
    else if (url.includes('/v2/skills?')) body = [{ id: 9, name: 'Orb of Wrath', icon: 'i-skill' }]
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
  }
}

const HTML =
  '<div data-armory-embed="items" data-armory-ids="100" data-armory-100-stat="1" data-armory-100-upgrades="200"></div>' +
  '<div data-armory-embed="items" data-armory-ids="101" data-armory-101-upgrades="300"></div>'

describe('scrapeBuildGear', () => {
  it('assembles weapons+sigils, armor runes, and the stat prefix from armory embeds', async () => {
    const gear = await scrapeBuildGear(HTML, 'Warrior', fakeFetch())
    expect(gear).not.toBeNull()
    expect(gear!.weapons).toEqual([
      { type: 'Scepter', name: 'Scepter', icon: 'i-scepter', sigils: [{ name: 'Superior Sigil of Force', icon: 'i-sigil' }] }
    ])
    expect(gear!.rune).toEqual({ name: 'Superior Rune of Divinity', icon: 'i-rune', count: 1 })
    expect(gear!.stats).toBe('Berserker')
    expect(gear!.weaponSkills).toEqual([{ id: 9, name: 'Orb of Wrath', icon: 'i-skill' }])
  })

  it('returns null when the page has no armory embeds', async () => {
    expect(await scrapeBuildGear('<p>no gear here</p>', 'Warrior', fakeFetch())).toBeNull()
  })
})
