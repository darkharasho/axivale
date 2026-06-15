// src/main/meta/wiki/refPages.test.ts
import { describe, it, expect } from 'vitest'
import { WIKI_REF_PAGES } from './refPages'

describe('WIKI_REF_PAGES', () => {
  it('is a non-empty registry with category + title on every entry', () => {
    expect(WIKI_REF_PAGES.length).toBeGreaterThan(40)
    for (const p of WIKI_REF_PAGES) {
      expect(typeof p.category).toBe('string')
      expect(p.category.length).toBeGreaterThan(0)
      expect(typeof p.title).toBe('string')
      expect(p.title.length).toBeGreaterThan(0)
    }
  })
  it('covers skills + traits for all 9 professions and the key categories', () => {
    const cats = new Set(WIKI_REF_PAGES.map((p) => p.category))
    for (const c of ['skills', 'traits', 'upgrades', 'classes', 'stats', 'armor', 'weapons', 'boons-conditions', 'mechanics']) {
      expect(cats.has(c)).toBe(true)
    }
    expect(WIKI_REF_PAGES.filter((p) => p.category === 'skills')).toHaveLength(9)
    expect(WIKI_REF_PAGES.filter((p) => p.category === 'traits')).toHaveLength(9)
  })
})
