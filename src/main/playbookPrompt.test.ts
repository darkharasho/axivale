import { describe, it, expect } from 'vitest'
import { buildPlaybookReference } from './playbookPrompt'
import type { MetaMode } from './metaStore'

const mode = (over: Partial<MetaMode['playbook']>): MetaMode => ({
  id: '1',
  mode: 'WvW',
  sources: [],
  notes: '',
  refreshedAt: null,
  updatedAt: '',
  playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false, ...over }
})

describe('buildPlaybookReference', () => {
  it('returns empty string when no mode has a blessed playbook', () => {
    expect(buildPlaybookReference([mode({ blessed: false, principles: 'x' })])).toBe('')
  })

  it('emits a baseline-to-iterate block with principles when blessed', () => {
    const out = buildPlaybookReference([mode({ blessed: true, principles: '- 1 cleanse per subgroup' })])
    expect(out).toMatch(/comp playbook/i)
    expect(out).toMatch(/baseline/i)
    expect(out).toMatch(/not.*optimal/i)
    expect(out).toContain('1 cleanse per subgroup')
  })

  it('includes derived provenance and core builds when present', () => {
    const out = buildPlaybookReference([
      mode({
        blessed: true,
        principles: 'p',
        derived: {
          window: { fromISO: '2026-05-15', toISO: '2026-06-15', days: 30 },
          sampleSize: 20,
          sourceRepos: ['Fibbs23/Agg-Report'],
          lowConfidence: false,
          avgSquadSize: 36,
          supportPct: 49,
          professions: [{ name: 'Troubadour', avgPerSquad: 7.7, presencePct: 100, runAs: 'support' }],
          subgroup: { core: ['Firebrand', 'Druid', 'Reaper', 'Troubadour'], flex: ['Specter'] }
        }
      })
    ])
    expect(out).toMatch(/20 reports/)
    expect(out).toContain('Fibbs23/Agg-Report')
    expect(out).toContain('Troubadour')
    expect(out).toMatch(/49% support/)
  })

  it('frames the playbook as descriptive reference, not a law to enforce', () => {
    const out = buildPlaybookReference([mode({ blessed: true, principles: 'p' })])
    // It is a snapshot of what was actually run, not a prescriptive optimum.
    expect(out).toMatch(/reference, not law/i)
    expect(out).toMatch(/descriptive snapshot/i)
    // And the model must not frame a user's own comp as having "gaps" to "fix".
    expect(out).toMatch(/do not frame/i)
    expect(out).toMatch(/gaps/i)
  })

  it('flags low confidence', () => {
    const out = buildPlaybookReference([
      mode({
        blessed: true,
        principles: 'p',
        derived: {
          window: { fromISO: '2026-05-15', toISO: '2026-06-15', days: 30 },
          sampleSize: 2, sourceRepos: ['a/b'], lowConfidence: true,
          avgSquadSize: 30, supportPct: 50, professions: [], subgroup: { core: [], flex: [] }
        }
      })
    ])
    expect(out).toMatch(/low confidence/i)
  })
})
