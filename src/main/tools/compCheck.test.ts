import { describe, it, expect } from 'vitest'
import { buildCompCheckTools } from './compCheck'

const tool = buildCompCheckTools()[0]
const sketch = buildCompCheckTools().find((t) => t.name === 'comp_sketch')!

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

describe('comp_sketch tool', () => {
  it('is registered and named comp_sketch', () => {
    expect(sketch?.name).toBe('comp_sketch')
  })

  it('echoes the comp as a comp-sketch display payload', async () => {
    const res = (await sketch.handler(
      {
        title: 'WvW Zerg — 25',
        subtitle: '5 parties',
        subgroups: [[{ spec: 'Firebrand', role: 'support' }, { spec: 'Reaper', role: 'damage' }]],
        builds: [
          { spec: 'Firebrand', role: 'support', count: 5, weapons: 'Axe/Shield · Staff', note: 'Stability anchor' },
          { spec: 'Reaper', role: 'damage', count: 3 }
        ]
      },
      {} as never
    )) as any
    expect(res.display.kind).toBe('comp-sketch')
    expect(res.display.data.title).toBe('WvW Zerg — 25')
    expect(res.display.data.subgroups).toHaveLength(1)
    expect(res.display.data.builds[0].spec).toBe('Firebrand')
    // The model-facing text is a compact summary, not the full payload.
    const envelope = JSON.parse(res.content[0].text)
    expect(envelope.rendered).toBe(true)
  })
})
