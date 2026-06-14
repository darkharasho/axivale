import { describe, it, expect } from 'vitest'
import { toWikiFactsResult } from './wikiFacts'

describe('toWikiFactsResult', () => {
  it('maps parsed mode-split facts, surfacing WvW values that differ from PvE', () => {
    const parsed = {
      pve: [{ type: 'Recharge', value: 20 }],
      wvw: [{ type: 'Recharge', value: 30 }],
      pvp: [{ type: 'Recharge', value: 25 }],
      hasSplit: true,
      recharge: { pve: 20, wvw: 30, pvp: 25 },
      activation: { pve: 0.5, wvw: 0.5, pvp: 0.5 }
    }
    const r = toWikiFactsResult('Winds of Disenchantment', parsed)
    expect(r.found).toBe(true)
    expect(r.hasSplit).toBe(true)
    expect(r.recharge).toEqual({ pve: 20, wvw: 30, pvp: 25 })
    expect(r.wvw).toEqual([{ type: 'Recharge', value: 30 }])
    expect(r.name).toBe('Winds of Disenchantment')
  })

  it('returns a clean not-found result for null parse', () => {
    const r = toWikiFactsResult('Nope', null)
    expect(r).toEqual({
      name: 'Nope',
      found: false,
      hasSplit: false,
      pve: [],
      wvw: [],
      pvp: [],
      recharge: { pve: null, wvw: null, pvp: null },
      activation: { pve: null, wvw: null, pvp: null }
    })
  })

  it('tolerates a parse object missing optional fields', () => {
    const r = toWikiFactsResult('X', { pve: [], wvw: [], pvp: [], hasSplit: false } as never)
    expect(r.found).toBe(true)
    expect(r.recharge).toEqual({ pve: null, wvw: null, pvp: null })
  })
})
