import { describe, it, expect } from 'vitest'
import { scrapeBuildGear, parseMetabattleSlots } from './buildGear'

// Faithful slice of a MetaBattle build page's Equipment section: each piece is its
// own equipment-slot embed with a <small> label; sigils follow their weapon SET in
// document order (a 2H weapon takes two; a 1H pair takes one each).
const MB_HTML =
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="72698" data-armory-72698-stat="1134" data-armory-size="46" class="equipment-slot-asc"></div><small>Head<br />Minstrel</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="75200" data-armory-75200-stat="1134" data-armory-size="46" class="equipment-slot-asc"></div><small>Staff<br />Minstrel</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="72339" data-armory-size="46" class="equipment-slot-asc"></div><small>Sigil</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="24584" data-armory-size="46" class="equipment-slot-asc"></div><small>Sigil</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="71457" data-armory-71457-stat="1134" data-armory-size="46" class="equipment-slot-asc"></div><small>Mace<br />Minstrel</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="74748" data-armory-74748-stat="1134" data-armory-size="46" class="equipment-slot-asc"></div><small>Shield<br />Minstrel</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="24607" data-armory-size="46" class="equipment-slot-asc"></div><small>Sigil</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="24839" data-armory-size="46" class="equipment-slot-asc"></div><small>Rune<br />x6</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="86986" data-armory-size="46" class="equipment-slot-asc"></div><small>Infusion<br />x18</small></div>' +
  '<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="101116" data-armory-size="46" class="equipment-slot-asc"></div><small>Relic</small></div>'

describe('parseMetabattleSlots', () => {
  it('reads ordered equipment slots with kind, weapon type, stat, and counts', () => {
    const slots = parseMetabattleSlots(MB_HTML)
    expect(slots).toEqual([
      { id: 72698, kind: 'gear', type: 'Head', stat: 'Minstrel', statId: 1134, count: 1 },
      { id: 75200, kind: 'weapon', type: 'Staff', stat: 'Minstrel', statId: 1134, count: 1 },
      { id: 72339, kind: 'sigil', type: 'Sigil', stat: null, statId: null, count: 1 },
      { id: 24584, kind: 'sigil', type: 'Sigil', stat: null, statId: null, count: 1 },
      { id: 71457, kind: 'weapon', type: 'Mace', stat: 'Minstrel', statId: 1134, count: 1 },
      { id: 74748, kind: 'weapon', type: 'Shield', stat: 'Minstrel', statId: 1134, count: 1 },
      { id: 24607, kind: 'sigil', type: 'Sigil', stat: null, statId: null, count: 1 },
      { id: 24839, kind: 'rune', type: 'Rune', stat: null, statId: null, count: 6 },
      { id: 86986, kind: 'infusion', type: 'Infusion', stat: null, statId: null, count: 18 },
      { id: 101116, kind: 'relic', type: 'Relic', stat: null, statId: null, count: 1 }
    ])
  })

  it('returns [] for a Snowcrows-style page that inlines upgrades (no slot labels)', () => {
    expect(parseMetabattleSlots(HTML)).toEqual([])
  })
})

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

  it('assembles MetaBattle slot-labeled gear: per-weapon sigils, rune count, stat, infusions', async () => {
    const gear = await scrapeBuildGear(MB_HTML, 'Guardian', mbFetch())
    expect(gear).not.toBeNull()
    // Staff (2H) keeps both sigils; the Mace+Shield set distributes its one sigil to the Mace.
    expect(gear!.weapons).toEqual([
      {
        type: 'Staff',
        name: 'Staff',
        icon: 'i-staff',
        sigils: [
          { name: 'Sigil of Concentration', icon: 'i-conc' },
          { name: 'Sigil of Transference', icon: 'i-trans' }
        ]
      },
      { type: 'Mace', name: 'Mace', icon: 'i-mace', sigils: [{ name: 'Sigil of Energy', icon: 'i-energy' }] },
      { type: 'Shield', name: 'Shield', icon: 'i-shield', sigils: [] }
    ])
    expect(gear!.rune).toEqual({ name: 'Rune of the Monk', icon: 'i-rune', count: 6 })
    expect(gear!.stats).toBe("Minstrel's")
    expect(gear!.infusions).toEqual([{ name: 'Healing Infusion', icon: 'i-inf' }])
    expect(gear!.weaponSkills).toEqual([{ id: 9, name: 'Wave of Wrath', icon: 'i-skill' }])
  })
})

// Fake GW2 API for the MetaBattle fixture ids.
function mbFetch(): (
  url: string
) => Promise<{ ok: boolean; json(): Promise<unknown>; text(): Promise<string> }> {
  const items = [
    { id: 72698, name: 'Minstrel Helm', icon: 'i-head', type: 'Armor', details: { type: 'Helm' } },
    { id: 75200, name: 'Staff', icon: 'i-staff', type: 'Weapon', details: { type: 'Staff' } },
    { id: 72339, name: 'Sigil of Concentration', icon: 'i-conc', type: 'UpgradeComponent', details: { type: 'Sigil' } },
    { id: 24584, name: 'Sigil of Transference', icon: 'i-trans', type: 'UpgradeComponent', details: { type: 'Sigil' } },
    { id: 71457, name: 'Mace', icon: 'i-mace', type: 'Weapon', details: { type: 'Mace' } },
    { id: 74748, name: 'Shield', icon: 'i-shield', type: 'Weapon', details: { type: 'Shield' } },
    { id: 24607, name: 'Sigil of Energy', icon: 'i-energy', type: 'UpgradeComponent', details: { type: 'Sigil' } },
    { id: 24839, name: 'Rune of the Monk', icon: 'i-rune', type: 'UpgradeComponent', details: { type: 'Rune' } },
    { id: 86986, name: 'Healing Infusion', icon: 'i-inf', type: 'UpgradeComponent', details: { type: 'Default' } },
    { id: 101116, name: 'Relic of the Monk', icon: 'i-relic', type: 'Relic' }
  ]
  return async (url: string) => {
    let body: unknown = []
    if (url.includes('/v2/items?')) body = items
    else if (url.includes('/v2/itemstats?')) body = [{ id: 1134, name: "Minstrel's" }]
    else if (url.includes('/v2/professions/')) body = { weapons: { Staff: { skills: [{ id: 9, slot: 'Weapon_1' }] } } }
    else if (url.includes('/v2/skills?')) body = [{ id: 9, name: 'Wave of Wrath', icon: 'i-skill' }]
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
  }
}
