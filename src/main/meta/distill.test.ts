// src/main/meta/distill.test.ts
import { describe, it, expect, vi } from 'vitest'
import { distill } from './distill'

describe('distill', () => {
  it('passes mode + raw text to the model and returns the trimmed summary', async () => {
    const model = vi.fn().mockResolvedValue('  Scourge + Firebrand core.  ')
    const out = await distill('WvW', ['raw one', 'raw two'], model)
    expect(out).toBe('Scourge + Firebrand core.')
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('WvW')
    expect(prompt).toContain('raw one')
    expect(prompt).toContain('raw two')
  })

  it('returns null without calling the model when there is no raw text', async () => {
    const model = vi.fn()
    expect(await distill('PvE', ['', '   '], model)).toBeNull()
    expect(model).not.toHaveBeenCalled()
  })

  it('returns null when the model yields an empty string', async () => {
    expect(await distill('PvE', ['raw'], vi.fn().mockResolvedValue('   '))).toBeNull()
  })

  it('instructs the model to ignore navigation boilerplate and name specs', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ['raw'], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('ignore')
    expect(prompt.toLowerCase()).toContain('elite spec')
  })

  it('forbids substituting names from prior knowledge (latest-expansion faithfulness)', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('PvE', ['raw'], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('verbatim')
    expect(prompt.toLowerCase()).toContain('do not')
  })

  it('requests a markdown table of builds plus a notes section', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ['raw'], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('table')
    expect(prompt.toLowerCase()).toContain('notes')
  })

  it('injects the authoritative spec→profession map when provided', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('PvE', ['raw'], model, { Luminary: 'Guardian', Amalgam: 'Engineer' })
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('Luminary = Guardian')
    expect(prompt).toContain('Amalgam = Engineer')
    expect(prompt.toLowerCase()).toContain('ground truth')
  })

  it('omits the map block when no map is given', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('PvE', ['raw'], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).not.toContain('AUTHORITATIVE elite-spec')
  })

  it('asks for an "As of" date line and an Updated column, and passes today when given', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ['raw'], model, {}, '2026-06-17')
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('### As of')
    expect(prompt).toContain('`Updated`')
    expect(prompt).toContain('today is 2026-06-17')
    expect(prompt.toLowerCase()).toContain('stale')
  })

  it('omits the today-relative recency block when no date is given', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ['raw'], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).not.toContain('today is')
    // the As-of structure is still requested regardless of the date
    expect(prompt).toContain('### As of')
  })
})
