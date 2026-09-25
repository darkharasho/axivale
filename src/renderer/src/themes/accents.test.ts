import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT_ID, resolveAccentId } from './accents'

describe('ACCENTS', () => {
  it('ships all 11 official accents with id, label and hex', () => {
    expect(ACCENTS).toHaveLength(11)
    for (const a of ACCENTS) {
      expect(a.id).toMatch(/^[a-z-]+$/)
      expect(a.label.length).toBeGreaterThan(0)
      expect(a.hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('contains the AxiVale default', () => {
    expect(ACCENTS.map((a) => a.id)).toContain(DEFAULT_ACCENT_ID)
    expect(DEFAULT_ACCENT_ID).toBe('crimson-red')
  })
})

describe('resolveAccentId', () => {
  it('passes through a known id', () => {
    expect(resolveAccentId('emerald-mint')).toBe('emerald-mint')
  })

  // Review Focus 1: a value written by a future build or hand-edited into
  // settings.json must not leave the app unstyled.
  it('falls back to the default for an unknown id', () => {
    expect(resolveAccentId('chartreuse-surprise')).toBe(DEFAULT_ACCENT_ID)
  })

  it('falls back to the default for null, undefined and empty string', () => {
    expect(resolveAccentId(null)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId(undefined)).toBe(DEFAULT_ACCENT_ID)
    expect(resolveAccentId('')).toBe(DEFAULT_ACCENT_ID)
  })

  it('maps AxiVale legacy theme names onto official accents', () => {
    expect(resolveAccentId('red')).toBe('crimson-red')
    expect(resolveAccentId('accent')).toBe('crimson-red')
  })
})
