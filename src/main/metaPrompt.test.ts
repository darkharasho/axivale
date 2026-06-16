import { describe, it, expect } from 'vitest'
import { buildMetaReference } from './metaPrompt'
import type { MetaMode } from './metaStore'

function mode(over: Partial<MetaMode> = {}): MetaMode {
  return {
    id: 'a', mode: 'WvW', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com', status: 'never', fetchedAt: null, error: null }],
    notes: '', refreshedAt: null, updatedAt: 'x',
    playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false },
    ...over
  }
}

describe('buildMetaReference', () => {
  it('returns empty string when there are no modes', () => {
    expect(buildMetaReference([])).toBe('')
  })

  it('lists each mode + its source urls and the directive', () => {
    const out = buildMetaReference([mode()])
    expect(out).toContain('GW2 meta reference')
    expect(out).toContain('WvW')
    expect(out).toContain('https://metabattle.com')
    expect(out.toLowerCase()).toContain('cite')
  })

  it('includes notes when present, omits the notes line when empty', () => {
    expect(buildMetaReference([mode({ notes: 'scourge meta' })])).toContain('scourge meta')
    expect(buildMetaReference([mode({ notes: '' })])).not.toMatch(/notes:/i)
  })
})
