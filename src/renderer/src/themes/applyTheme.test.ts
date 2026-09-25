// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCENT_STORAGE_KEY, applyTheme, readAccent } from './applyTheme'
import { DEFAULT_ACCENT_ID } from './accents'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-axi-accent')
  vi.restoreAllMocks()
})

describe('applyTheme', () => {
  it('sets data-axi-accent on the document root', () => {
    applyTheme('teal-ocean')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('teal-ocean')
  })

  it('resolves an unknown id before applying it', () => {
    applyTheme('nonsense')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe(DEFAULT_ACCENT_ID)
  })

  it('mirrors the applied accent into localStorage for the next boot', () => {
    applyTheme('violet-purple')
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('violet-purple')
  })

  // Review Focus 2: the mirror is read before anything else renders. A throw
  // here is a white window, not a degraded accent.
  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => applyTheme('rose-pink')).not.toThrow()
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('rose-pink')
  })
})

describe('readAccent', () => {
  it('returns the default when nothing is stored', () => {
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
  })

  it('returns the mirrored accent', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'amber-warm')
    expect(readAccent()).toBe('amber-warm')
  })

  it('returns the default when the mirror holds garbage', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, '{"not":"an id"}')
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
  })

  it('does not throw when localStorage getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(readAccent()).toBe(DEFAULT_ACCENT_ID)
  })
})
