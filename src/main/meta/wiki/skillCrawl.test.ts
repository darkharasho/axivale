import { describe, it, expect, vi } from 'vitest'
import { fetchCategoryMembers, compressWikiPage } from './skillCrawl'

const METEOR_SHOWER = `{{Skill infobox
| description = Call down a meteor shower onto the target area.<br>{{gray|Damage is reduced per target each time they are struck by this ability.}}
| split = pve, wvw, pvp
| facts =
{{skill fact|damage|weapon=staff|coefficient=1.6|game mode = pve}}
| activation = 3.75
| recharge = 30
| profession = elementalist
| slot = weapon
| twohand = staff
| attunement = fire
| id = 5501
}}
== Notes ==
* Each of the 24 meteors deal damage randomly around the targeted area.`

const SCHOLAR_RUNE = `{{Upgrade component infobox
| description = Double-click to apply to a piece of armor.
| bonus1 = +25 {{Power}}
| bonus2 = +35 {{Ferocity}}
| bonus6 = +125 {{Ferocity}}; +5% damage while above 90% Health.
| type = Rune
| rarity = Exotic
| id = 24836
}}
== Acquisition ==
{{contained in}}`

describe('compressWikiPage', () => {
  it('compresses a skill page: descriptor, description, recharge, split, notes', () => {
    const out = compressWikiPage(METEOR_SHOWER, 'Meteor Shower')
    expect(out).not.toMatch(/\{\{|\}\}/) // no template braces
    expect(out).toContain('Meteor Shower')
    expect(out).toContain('fire') // attunement
    expect(out).toContain('staff') // weapon
    expect(out).toContain('Call down a meteor shower onto the target area.')
    expect(out).toContain('recharge 30s')
    expect(out).toContain('cast 3.75s')
    expect(out).toContain('Has PvE/WvW/PvP balance splits.')
    expect(out).toContain('24 meteors') // a slice of the notes body
  })

  it('compresses a rune page: keeps stat icons inside the bonuses', () => {
    const out = compressWikiPage(SCHOLAR_RUNE, 'Superior Rune of the Scholar')
    expect(out).toContain('Superior Rune of the Scholar')
    expect(out).toContain('Rune') // type
    expect(out).toContain('+25 Power') // {{Power}} icon preserved as text
    expect(out).toContain('+35 Ferocity')
    expect(out).toContain('damage while above 90% Health')
    expect(out).not.toMatch(/\{\{|\}\}/)
  })

  it('returns empty for empty input', () => {
    expect(compressWikiPage('', 'X')).toBe('')
  })
})

describe('fetchCategoryMembers', () => {
  it('follows cmcontinue and returns all ns=0 titles', async () => {
    const pages = [
      { query: { categorymembers: [{ title: 'Meteor Shower' }, { title: 'Fireball' }] }, continue: { cmcontinue: 'p2' } },
      { query: { categorymembers: [{ title: 'Lava Font' }] } }
    ]
    let call = 0
    const fetchImpl = vi.fn(async (url: string) => {
      const body = pages[call++]
      expect(url).toContain('categorymembers')
      return { ok: true, json: async () => body }
    })
    const titles = await fetchCategoryMembers('Category:Elementalist skills', fetchImpl)
    expect(titles).toEqual(['Meteor Shower', 'Fireball', 'Lava Font'])
    expect(fetchImpl).toHaveBeenCalledTimes(2) // stopped when no cmcontinue
  })

  it('stops on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    expect(await fetchCategoryMembers('Category:Whatever', fetchImpl)).toEqual([])
  })
})
