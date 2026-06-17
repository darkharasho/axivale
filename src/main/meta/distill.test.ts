// src/main/meta/distill.test.ts
import { describe, it, expect, vi } from 'vitest'
import { distill } from './distill'

/** Build SourceExcerpt[] with simple labels for tests. */
const ex = (...texts: string[]): Array<{ source: string; text: string }> =>
  texts.map((t, i) => ({ source: `Site${i + 1}`, text: t }))

describe('distill', () => {
  it('passes mode + raw text to the model and returns the trimmed summary', async () => {
    const model = vi.fn().mockResolvedValue('  Scourge + Firebrand core.  ')
    const out = await distill('WvW', ex('raw one', 'raw two'), model)
    expect(out).toBe('Scourge + Firebrand core.')
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('WvW')
    expect(prompt).toContain('raw one')
    expect(prompt).toContain('raw two')
  })

  it('returns null without calling the model when there is no raw text', async () => {
    const model = vi.fn()
    expect(await distill('PvE', ex('', '   '), model)).toBeNull()
    expect(model).not.toHaveBeenCalled()
  })

  it('returns null when the model yields an empty string', async () => {
    expect(await distill('PvE', ex('raw'), vi.fn().mockResolvedValue('   '))).toBeNull()
  })

  it('instructs the model to ignore navigation boilerplate and name specs', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ex('raw'), model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('ignore')
    expect(prompt.toLowerCase()).toContain('elite spec')
  })

  it('forbids substituting names from prior knowledge (latest-expansion faithfulness)', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('PvE', ex('raw'), model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('verbatim')
    expect(prompt.toLowerCase()).toContain('do not')
  })

  it('requests a markdown table of builds plus a notes section', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ex('raw'), model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt.toLowerCase()).toContain('table')
    expect(prompt.toLowerCase()).toContain('notes')
  })

  it('injects the authoritative spec→profession map when provided', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('PvE', ex('raw'), model, { Luminary: 'Guardian', Amalgam: 'Engineer' })
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('Luminary = Guardian')
    expect(prompt).toContain('Amalgam = Engineer')
    expect(prompt.toLowerCase()).toContain('ground truth')
  })

  it('omits the map block when no map is given', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('PvE', ex('raw'), model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).not.toContain('AUTHORITATIVE elite-spec')
  })

  it('asks for an "As of" date line and an Updated column, and passes today when given', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ex('raw'), model, {}, '2026-06-17')
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('### As of')
    expect(prompt).toContain('`Updated`')
    expect(prompt).toContain('today is 2026-06-17')
    expect(prompt.toLowerCase()).toContain('stale')
  })

  it('omits the today-relative recency block when no date is given', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ex('raw'), model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).not.toContain('today is')
    expect(prompt).toContain('### As of')
  })

  it('labels each excerpt with its source so attribution is grounded', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', [
      { source: 'MetaBattle (WvW)', text: 'Core Necro is meta' },
      { source: 'gw2mists (Zerg)', text: 'Power Reaper is meta' }
    ], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('## SOURCE: MetaBattle (WvW)')
    expect(prompt).toContain('## SOURCE: gw2mists (Zerg)')
  })

  it('asks for a Sources column and cross-source consensus ranking', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', ex('raw one', 'raw two'), model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('`Sources`')
    expect(prompt).toMatch(/consensus/i)
    expect(prompt).toMatch(/single-source/i)
  })

  it('forbids inventing a source name (the "Aros" bug) and lists the valid names', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', [
      { source: 'MetaBattle (WvW)', text: 'a' },
      { source: 'gw2mists (Zerg)', text: 'b' }
    ], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toMatch(/NEVER invent a source name/i)
    expect(prompt).toContain('the only valid source names are: MetaBattle (WvW), gw2mists (Zerg)')
  })

  it('defaults a blank source label to "unknown source"', async () => {
    const model = vi.fn().mockResolvedValue('summary')
    await distill('WvW', [{ source: '  ', text: 'raw' }], model)
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('## SOURCE: unknown source')
  })
})
