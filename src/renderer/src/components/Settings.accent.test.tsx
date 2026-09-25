// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'
import { ACCENT_STORAGE_KEY } from '../themes/applyTheme'

/**
 * Settings touches dozens of officer methods on mount. Enumerating them all
 * would be a maintenance burden for a test about one of them, so anything not
 * explicitly overridden resolves to null.
 */
function mockOfficer(overrides: Record<string, unknown>): void {
  const target: Record<string, unknown> = {
    // Subscriptions are called in effects and their return value is used as
    // the cleanup, so these must hand back a function synchronously.
    ...Object.fromEntries(
      ['onOllamaProgress', 'onUpdateStatus', 'onAxiforgeStatus', 'onAxibridgeProgress'].map(
        (k) => [k, () => () => {}]
      )
    ),
    // Dereferenced directly in a mount effect, so it cannot be null.
    ollamaDetectHardware: vi
      .fn()
      .mockResolvedValue({ totalRamGb: 32, recommendedModel: '', modelOptions: [] }),
    // These two sit on the load effect's serial await chain ahead of the
    // accent read — the reason the window this test exercises is wide. If
    // they resolve to null the chain throws and never reaches the accent.
    codexAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
    antigravityAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
    listKeys: vi.fn().mockResolvedValue([]),
    appVersion: vi.fn().mockResolvedValue('0.0.0'),
    axibridgeStatus: vi.fn().mockResolvedValue({ ok: false, repos: [] }),
    ...overrides
  }
  ;(window as unknown as { officer: unknown }).officer = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      // Anything named like a subscription gets a cleanup; everything else is
      // an async IPC call that resolves to nothing.
      if (/^on[A-Z]/.test(prop)) return () => () => {}
      return vi.fn().mockResolvedValue(null)
    },
    has: () => true
  })
}

let deferredAccent: { resolve: (v: string | null) => void }

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-axi-accent')
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-axi-accent')
})

describe('Settings accent reconcile', () => {
  it('does not clobber a selection made while the store is still loading', async () => {
    // The store holds the old accent, and answers slowly — Settings awaits a
    // dozen serial IPC calls (including two auth-status round trips) before it
    // reads the accent at all.
    let release: (v: string | null) => void = () => {}
    const pending = new Promise<string | null>((r) => (release = r))
    deferredAccent = { resolve: release }

    mockOfficer({
      getSetting: vi.fn((key: string) =>
        key === 'accent' ? pending : Promise.resolve(null)
      ),
      setSetting: vi.fn().mockResolvedValue(undefined)
    })

    const { container } = render(
      <Settings section="appearance" onChanged={vi.fn()} onProviderChanged={vi.fn()} />
    )

    await waitFor(() => expect(container.querySelector('.accent-swatch')).toBeTruthy())

    // The user picks teal while the store read is still outstanding.
    await act(async () => {
      fireEvent.click(container.querySelector('[data-accent-id="teal-ocean"]')!)
    })
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('teal-ocean')

    // Now the store finally answers, with the value from before the click.
    await act(async () => {
      deferredAccent.resolve('violet-purple')
      await pending
    })

    // The user's choice is newer than the stored value and must survive, in
    // the DOM, in the pressed swatch, and in the boot mirror.
    expect(document.documentElement.getAttribute('data-axi-accent')).toBe('teal-ocean')
    expect(
      container.querySelector('.accent-swatch[aria-pressed="true"]')?.getAttribute('data-accent-id')
    ).toBe('teal-ocean')
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('teal-ocean')
  })

  it('still adopts the stored accent when the user has not chosen', async () => {
    mockOfficer({
      getSetting: vi.fn((key: string) =>
        Promise.resolve(key === 'accent' ? 'emerald-mint' : null)
      ),
      setSetting: vi.fn().mockResolvedValue(undefined)
    })

    const { container } = render(
      <Settings section="appearance" onChanged={vi.fn()} onProviderChanged={vi.fn()} />
    )

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-axi-accent')).toBe('emerald-mint')
    )
    expect(
      container.querySelector('.accent-swatch[aria-pressed="true"]')?.getAttribute('data-accent-id')
    ).toBe('emerald-mint')
  })
})
