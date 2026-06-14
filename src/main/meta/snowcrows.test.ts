// src/main/meta/snowcrows.test.ts
import { describe, it, expect } from 'vitest'
import { parseArmory, extractHrefs, pickBuildLinks } from './snowcrows'

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
