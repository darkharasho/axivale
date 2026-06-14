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
})
