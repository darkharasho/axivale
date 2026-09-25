// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCENT_STORAGE_KEY, applyAccent, applyTheme, readAccent } from './applyTheme'
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

describe('applyAccent', () => {
  it('applies the accent and persists it', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const settled = await applyAccent('emerald-mint', DEFAULT_ACCENT_ID, persist)
    expect(persist).toHaveBeenCalledWith('emerald-mint')
    expect(settled).toBe('emerald-mint')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('emerald-mint')
  })

  it('applies optimistically, before the store answers', async () => {
    let release: () => void = () => {}
    const persist = vi.fn(() => new Promise<void>((r) => (release = r)))
    const pending = applyAccent('rose-pink', DEFAULT_ACCENT_ID, persist)
    // The swatch should already be live while the IPC round-trip is outstanding.
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('rose-pink')
    release()
    await pending
  })

  // Review Focus 4: the store is encrypted and answers over IPC. If the write
  // fails, the UI must not keep showing an accent the store does not hold —
  // that survives until the next boot and then silently reverts.
  it('rolls back to the previous accent when the store rejects', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('store locked'))
    const settled = await applyAccent('violet-purple', 'teal-ocean', persist)
    expect(settled).toBe('teal-ocean')
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('teal-ocean')
  })

  it('does not reject when the store rejects', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('store locked'))
    await expect(applyAccent('violet-purple', 'teal-ocean', persist)).resolves.toBeDefined()
  })
})
