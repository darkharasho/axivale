// src/main/buildNoteLinks.test.ts
import { describe, it, expect } from 'vitest'
import { transpileNotes } from './buildNoteLinks'

// Build with its own skills (heal/utility/elite) and spec traits — all id+name pairs.
const build = {
  profession: 'Guardian',
  gameMode: 'wvw',
  skills: {
    heal: { id: 9102, name: 'Shelter' },
    utility: [{ id: 9168, name: 'Stand Your Ground' }, null, null],
    elite: { id: 30273, name: 'Renewed Focus' }
  },
  specs: [
    { id: 62, name: 'Firebrand', minorTraits: [{ id: 2063, name: 'Stoic Demeanor' }], majorTraitsByTier: { 1: [{ id: 1909, name: 'Unscathed Contender' }] } }
  ],
  equipment: { runes: { helm: 'Rune of the Scholar' } } // gear is name-only, resolved via catalog
}
const catalog = {
  profession: null,
  upgrades: [{ id: 24836, name: 'Rune of the Scholar' }]
}

describe('transpileNotes', () => {
  it('resolves a build skill marker to an @[skill:id:name] token', () => {
    const r = transpileNotes('Open with [[skill:Shelter]].', build, catalog)
    expect(r.notes).toBe('Open with @[skill:9102:Shelter].')
    expect(r.resolved).toBe(1)
    expect(r.unresolved).toEqual([])
  })

  it('resolves trait and item markers (item from catalog)', () => {
    const r = transpileNotes('[[trait:Unscathed Contender]] + [[item:Rune of the Scholar]]', build, catalog)
    expect(r.notes).toBe('@[trait:1909:Unscathed Contender] + @[item:24836:Rune of the Scholar]')
    expect(r.resolved).toBe(2)
  })

  it('matches names case-insensitively and trims whitespace', () => {
    const r = transpileNotes('[[skill:  shelter  ]]', build, catalog)
    expect(r.notes).toBe('@[skill:9102:shelter]')
    expect(r.resolved).toBe(1)
  })

  it('leaves an unknown name as plain text and reports it', () => {
    const r = transpileNotes('Use [[skill:Made Up Skill]] now.', build, catalog)
    expect(r.notes).toBe('Use Made Up Skill now.')
    expect(r.unresolved).toEqual([{ name: 'Made Up Skill', type: 'skill', reason: 'not-found' }])
  })

  it('reports catalog-unavailable when catalog is null and the name is not in the build', () => {
    const r = transpileNotes('[[item:Rune of the Scholar]]', build, null)
    expect(r.notes).toBe('Rune of the Scholar')
    expect(r.unresolved[0].reason).toBe('catalog-unavailable')
  })

  it('passes existing @[...] tokens through untouched', () => {
    const r = transpileNotes('Keep @[skill:1234:Old Token] and add [[skill:Shelter]]', build, catalog)
    expect(r.notes).toBe('Keep @[skill:1234:Old Token] and add @[skill:9102:Shelter]')
  })

  it('prefers the build id over a catalog id for the same name', () => {
    const r = transpileNotes('[[skill:Shelter]]', build, { upgrades: [{ id: 999, name: 'Shelter' }] })
    expect(r.notes).toBe('@[skill:9102:Shelter]') // build (9102) wins
  })
})
