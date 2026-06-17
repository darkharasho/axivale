import { describe, it, expect } from 'vitest'
import { buildMetaReference } from './metaPrompt'
import type { MetaMode } from './metaStore'

function mode(over: Partial<MetaMode> = {}): MetaMode {
  return {
    id: 'a', mode: 'WvW', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com', group: 'meta' as const, status: 'never', fetchedAt: null, error: null, sourceDate: null }],
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

  it('carries a recency directive', () => {
    const out = buildMetaReference([mode()]).toLowerCase()
    expect(out).toContain('recency')
    expect(out).toContain('as of')
  })

  it('surfaces the crawl date when refreshedAt is set, and omits it otherwise', () => {
    expect(buildMetaReference([mode({ refreshedAt: '2026-06-17T08:00:00.000Z' })])).toContain('crawled 2026-06-17')
    expect(buildMetaReference([mode({ refreshedAt: null })])).not.toContain('crawled')
  })

  it('surfaces a source\'s own publish date as "updated <date>" when present', () => {
    const withDate = mode({
      sources: [{ label: 'MetaBattle', url: 'https://metabattle.com', group: 'meta', status: 'ok', fetchedAt: null, error: null, sourceDate: '2026-06-10' }]
    })
    expect(buildMetaReference([withDate])).toContain('metabattle.com, updated 2026-06-10)')
    // a dateless source renders no ", updated …" suffix on its url
    expect(buildMetaReference([mode()])).not.toMatch(/metabattle\.com, updated/)
  })
})
