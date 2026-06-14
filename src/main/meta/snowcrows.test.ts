// src/main/meta/snowcrows.test.ts
import { describe, it, expect } from 'vitest'
import { parseArmory, extractHrefs, pickBuildLinks } from './snowcrows'
import { resolveArmoryNames, __resetArmoryCache, type FetchLike } from './snowcrows'
import { beforeEach, vi } from 'vitest'

beforeEach(() => __resetArmoryCache())

function fakeFetch(map: Record<string, unknown[]>): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const fn = (async (url: string) => {
    calls.push(url)
    const endpoint = new URL(url).pathname.split('/').pop() as string
    return { ok: true, json: async () => map[endpoint] ?? [], text: async () => '' }
  }) as FetchLike & { calls: string[] }
  fn.calls = calls
  return fn
}

describe('resolveArmoryNames', () => {
  const parsed = { items: [{ id: 48081, statId: 1077, upgradeIds: [74978] }], skills: [5503], specs: [{ id: 31, traitIds: [296] }] }
  it('resolves ids to names per endpoint', async () => {
    const f = fakeFetch({
      items: [{ id: 48081, name: "Zojja's Masque" }, { id: 74978, name: 'Sigil of Force' }],
      itemstats: [{ id: 1077, name: "Berserker's" }],
      skills: [{ id: 5503, name: 'Fire Attunement' }],
      specializations: [{ id: 31, name: 'Fire' }],
      traits: [{ id: 296, name: 'Empowering Flame' }]
    })
    const n = await resolveArmoryNames(parsed, f)
    expect(n.items[48081]).toBe("Zojja's Masque")
    expect(n.items[74978]).toBe('Sigil of Force')
    expect(n.itemstats[1077]).toBe("Berserker's")
    expect(n.skills[5503]).toBe('Fire Attunement')
    expect(n.specs[31]).toBe('Fire')
    expect(n.traits[296]).toBe('Empowering Flame')
  })
  it('caches across calls (no refetch of known ids)', async () => {
    const f = fakeFetch({ items: [{ id: 48081, name: 'X' }, { id: 74978, name: 'Y' }], itemstats: [{ id: 1077, name: 'Z' }], skills: [{ id: 5503, name: 'S' }], specializations: [{ id: 31, name: 'F' }], traits: [{ id: 296, name: 'T' }] })
    await resolveArmoryNames(parsed, f)
    const before = f.calls.length
    await resolveArmoryNames(parsed, f)
    expect(f.calls.length).toBe(before) // fully cached
  })
  it('falls back to the id string when a batch fails', async () => {
    const f = (async () => ({ ok: false, json: async () => [], text: async () => '' })) as FetchLike
    const n = await resolveArmoryNames(parsed, f)
    expect(n.skills[5503]).toBe('5503')
  })
})

import { assembleBuildDoc } from './snowcrows'

describe('assembleBuildDoc', () => {
  it('builds a structured doc from parsed + names', () => {
    const parsed = { items: [{ id: 1, statId: 10, upgradeIds: [2] }], skills: [5], specs: [{ id: 31, traitIds: [296] }] }
    const names = {
      items: { 1: 'Helm', 2: 'Sigil of Force' },
      itemstats: { 10: "Berserker's" },
      skills: { 5: 'Fire Attunement' },
      specs: { 31: 'Fire' },
      traits: { 296: 'Empowering Flame' }
    }
    const doc = assembleBuildDoc('Power Weaver', parsed, names)
    expect(doc).toContain('Power Weaver — Snowcrows')
    expect(doc).toContain('Specializations: Fire')
    expect(doc).toContain('Traits: Empowering Flame')
    expect(doc).toContain('Skills: Fire Attunement')
    expect(doc).toContain("Gear: Helm (Berserker's) + Sigil of Force")
  })
  it('omits sections with no resolved data', () => {
    const doc = assembleBuildDoc('X', { items: [], skills: [], specs: [] }, { items: {}, itemstats: {}, skills: {}, specs: {}, traits: {} })
    expect(doc).toBe('X — Snowcrows')
  })
})

const ITEM = '<div data-armory-embed="items" data-armory-ids="48081" data-armory-48081-stat="1077" data-armory-48081-upgrades="74978"></div>'
const SPEC = '<div data-armory-embed="specializations" data-armory-ids="31" data-armory-31-traits="296,334,1510"></div>'
const SKILLS = '<div data-armory-embed="skills" data-armory-ids="5503,40183,5503"></div>'

describe('parseArmory', () => {
  it('parses items (id+stat+upgrades), specs (id+traits), skills (deduped)', () => {
    const p = parseArmory(ITEM + SPEC + SKILLS)
    expect(p.items).toEqual([{ id: 48081, statId: 1077, upgradeIds: [74978] }])
    expect(p.specs).toEqual([{ id: 31, traitIds: [296, 334, 1510] }])
    expect(p.skills).toEqual([5503, 40183]) // deduped, order preserved
  })
  it('dedupes repeated item embeds by id', () => {
    const p = parseArmory(ITEM + ITEM)
    expect(p.items).toHaveLength(1)
  })
  it('handles missing stat/upgrades', () => {
    const p = parseArmory('<div data-armory-embed="items" data-armory-ids="999"></div>')
    expect(p.items).toEqual([{ id: 999, statId: null, upgradeIds: [] }])
  })
})

describe('extractHrefs', () => {
  it('resolves relative + absolute hrefs against the base', () => {
    const html = '<a href="/builds/raids/x">a</a><a href="https://snowcrows.com/builds/wvw/y">b</a>'
    expect(extractHrefs(html, 'https://snowcrows.com/builds/raids')).toEqual([
      'https://snowcrows.com/builds/raids/x',
      'https://snowcrows.com/builds/wvw/y'
    ])
  })
})

describe('pickBuildLinks', () => {
  it('keeps same-origin /builds/ pages, drops the landing + dupes + off-site + non-build', () => {
    const links = pickBuildLinks(
      [
        'https://snowcrows.com/builds/raids',            // landing — drop
        'https://snowcrows.com/builds/raids/ele/weaver', // keep
        'https://snowcrows.com/builds/raids/ele/weaver', // dup — drop
        'https://snowcrows.com/guides/intro',            // non-build — drop
        'https://discord.gg/x'                            // off-site — drop
      ],
      'https://snowcrows.com/builds/raids',
      10
    )
    expect(links).toEqual(['https://snowcrows.com/builds/raids/ele/weaver'])
  })
})
