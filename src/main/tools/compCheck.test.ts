import { describe, it, expect } from 'vitest'
import { buildCompCheckTools } from './compCheck'

const tool = buildCompCheckTools()[0]

describe('comp_check tool', () => {
  it('is named comp_check', () => {
    expect(tool.name).toBe('comp_check')
  })

  it('returns findings for a roster with a coverage gap', async () => {
    const res = await tool.handler(
      { subgroups: [[{ build: 'Zerk', role: 'Pure DPS' }, { build: 'Zerk2', role: 'Pure DPS' }]] },
      {} as never
    )
    const text = JSON.stringify(res)
    expect(text).toMatch(/stability|Primary Support/i)
    const envelope = JSON.parse((res as any).content[0].text)
    expect(envelope.ok).toBe(false)
    expect(envelope.errors.length).toBeGreaterThan(0)
  })

  it('returns ok:true with no errors for a covered subgroup', async () => {
    const raw = await tool.handler(
      {
        subgroups: [
          [
            { build: 'FB', role: 'Primary Support' },
            { build: 'Scrapper', role: 'Secondary Support' },
            { build: 'Spb', role: 'Boon Strip DPS' },
            { build: 'Zerk', role: 'Pure DPS' },
            { build: 'Zerk2', role: 'Pure DPS' }
          ]
        ]
      },
      {} as never
    )
    const res = JSON.parse((raw as any).content[0].text)
    expect(res.ok).toBe(true)
    expect(res.errors).toHaveLength(0)
    expect(res.boonCap).toBe(5)
  })
})
