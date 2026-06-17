// src/main/meta/wiki/refPages.test.ts
import { describe, it, expect } from 'vitest'
import { WIKI_REF_PAGES } from './refPages'
import { DEFAULT_CRAWL_TARGETS } from './ingest'

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
  it('covers the key concept categories (skills/traits come from the crawl, not here)', () => {
    const cats = new Set(WIKI_REF_PAGES.map((p) => p.category))
    for (const c of ['upgrades', 'classes', 'stats', 'armor', 'weapons', 'boons-conditions', 'mechanics']) {
      expect(cats.has(c)).toBe(true)
    }
    // The "List of …" skill/trait pages strip to noise; they're intentionally excluded.
    expect(cats.has('skills')).toBe(false)
    expect(cats.has('traits')).toBe(false)
  })
  it('includes the 27 individual elite-specialization pages', () => {
    const specs = WIKI_REF_PAGES.filter((p) => p.category === 'elite-specs')
    expect(specs).toHaveLength(27) // 3 per profession × 9
    expect(specs.map((p) => p.title)).toContain('Firebrand')
    expect(specs.map((p) => p.title)).toContain('Harbinger')
  })
})

describe('expanded wiki coverage', () => {
  it('includes legendary + mastery registry pages', () => {
    const titles = WIKI_REF_PAGES.map((p) => p.title)
    expect(titles).toContain('Legendary weapon')
    expect(titles).toContain('Mastery')
  })
  it('crawls legendary and mastery categories', () => {
    const cats = DEFAULT_CRAWL_TARGETS.map((t) => t.category)
    expect(cats).toContain('Legendary weapons')
    expect(cats).toContain('Masteries')
  })
})
