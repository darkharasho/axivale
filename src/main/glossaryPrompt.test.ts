import { describe, it, expect } from 'vitest'
import { buildGlossaryReference } from './glossaryPrompt'

describe('buildGlossaryReference', () => {
  const out = buildGlossaryReference()

  it('renders the abbreviations heading', () => {
    expect(out).toContain('# GW2 abbreviations')
  })

  it('covers the core build/role abbreviations the app deals with', () => {
    for (const term of ['condi', 'HFB', 'QB', 'WvW', 'boon strip', 'alac', 'vuln']) {
      expect(out).toContain(term)
    }
  })

  it('covers profession + elite-spec shorthand', () => {
    for (const spec of ['Scourge', 'Firebrand', 'Spellbreaker', 'Druid', 'Reaper']) {
      expect(out).toContain(spec)
    }
  })

  it('tells the model to disambiguate and fall back to wiki search', () => {
    expect(out).toMatch(/gw2_wiki_search/)
    expect(out).toMatch(/context/i)
  })

  it('leads with a blank-line separator so it appends cleanly', () => {
    expect(out.startsWith('\n\n')).toBe(true)
  })
})
