import { describe, it, expect } from 'vitest'
import { buildGw2WikiTools } from './gw2Wiki'
import type { WikiFacts, WikiFactsResult } from '../meta/wikiFacts'

function fakeWiki(over: Partial<WikiFactsResult> = {}, spy?: (n: string) => void): WikiFacts {
  return {
    lookup: async (name) => {
      spy?.(name)
      return {
        name, found: true, hasSplit: true,
        pve: [{ type: 'Recharge', value: 20 }],
        wvw: [{ type: 'Recharge', value: 30 }],
        pvp: [], recharge: { pve: 20, wvw: 30, pvp: 20 },
        activation: { pve: null, wvw: null, pvp: null }, ...over
      }
    }
  }
}

describe('gw2_wiki_facts tool', () => {
  it('returns the mode-split facts and forwards the name', async () => {
    let asked = ''
    const t = buildGw2WikiTools(fakeWiki({}, (n) => { asked = n }))[0]
    const res = await t.handler({ name: 'Winds of Disenchantment' }, {})
    expect(asked).toBe('Winds of Disenchantment')
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('"wvw"')
    expect(text).toContain('30') // WvW recharge differs from PvE
  })

  it('passes through a not-found result cleanly', async () => {
    const t = buildGw2WikiTools(fakeWiki({ found: false, hasSplit: false, pve: [], wvw: [], pvp: [] }))[0]
    const res = await t.handler({ name: 'Nope' }, {})
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('"found":false')
  })
})
