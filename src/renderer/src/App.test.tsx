// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Minimal window.officer mock — every method the App constructor touches must
// exist or the component will throw before we can assert anything.
function makeOfficer(overrides: Partial<typeof window.officer> = {}): typeof window.officer {
  const noop = (): (() => void) => () => {}
  return {
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    setSecret: vi.fn().mockResolvedValue(undefined),
    hasSecret: vi.fn().mockResolvedValue(false),
    validateGw2Key: vi.fn().mockResolvedValue({ ok: false }),
    axitoolsStatus: vi.fn().mockResolvedValue({ ok: false }),
    axiforgeStatus: vi.fn().mockResolvedValue({ state: 'offline' }),
    axibridgeReposList: vi.fn().mockResolvedValue([]),
    axibridgeReposAdd: vi.fn().mockResolvedValue({ ok: false, error: '' }),
    axibridgeReposRemove: vi.fn().mockResolvedValue([]),
    axibridgeStatus: vi.fn().mockResolvedValue({ ok: false, error: '' }),
    githubAuthBegin: vi.fn().mockResolvedValue({
      userCode: '',
      verificationUri: '',
      deviceCode: '',
      interval: 5,
      expiresIn: 900
    }),
    githubAuthComplete: vi.fn().mockResolvedValue({ ok: false }),
    forgeCatalogUpgrades: vi.fn().mockResolvedValue(null),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue(undefined),
    cancelTurn: vi.fn(),
    onAgentEvent: vi.fn().mockImplementation(noop),
    onConfirmRequest: vi.fn().mockImplementation(noop),
    onAxibridgeProgress: vi.fn().mockImplementation(noop),
    respondConfirm: vi.fn(),
    windowControl: vi.fn(),
    listKeys: vi.fn().mockResolvedValue([]),
    addKey: vi.fn().mockResolvedValue(undefined),
    removeKey: vi.fn().mockResolvedValue(undefined),
    setActiveKey: vi.fn().mockResolvedValue(undefined),
    axitools: vi.fn().mockResolvedValue(undefined),
    localStatus: vi.fn().mockResolvedValue({ ok: false }),
    providerStatus: vi.fn().mockResolvedValue({ provider: 'claude', ready: false, note: null }),
    appVersion: vi.fn().mockResolvedValue('0.0.0'),
    checkUpdates: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateStatus: vi.fn().mockImplementation(noop),
    ...overrides
  }
}

// App imports Masthead which imports fonts via CSS — suppress errors from
// modules that don't work in jsdom (e.g. CSS imports).
vi.mock('./components/Masthead', () => ({
  default: () => <div data-testid="masthead" />
}))
vi.mock('./components/UpdateBanner', () => ({
  default: () => null
}))
vi.mock('./components/panels/Builds', () => ({ default: () => null }))
vi.mock('./components/panels/Comps', () => ({ default: () => null }))
vi.mock('./components/panels/Roster', () => ({ default: () => null }))
vi.mock('./components/panels/Bureau', () => ({ default: () => null }))
vi.mock('./components/Settings', () => ({ default: () => null }))
vi.mock('./components/Rails', () => ({
  LeftRail: () => null,
  RightRail: () => null
}))
vi.mock('./components/InputBar', () => ({
  default: ({ onSubmit }: { onSubmit: (t: string) => void }) => (
    <button data-testid="submit-btn" onClick={() => onSubmit('hello')}>
      send
    </button>
  )
}))
vi.mock('./components/ConfirmDialog', () => ({ default: () => null }))

// Import after mocks (vitest hoists vi.mock)
const { default: App } = await import('./App')

describe('App bridgeProgress indicator', () => {
  let progressCb: (message: unknown) => void
  let agentCb: (event: unknown) => void

  beforeEach(() => {
    // Capture the callbacks registered by App
    const officer = makeOfficer({
      onAxibridgeProgress: vi.fn().mockImplementation((cb) => {
        progressCb = cb
        return () => {}
      }),
      onAgentEvent: vi.fn().mockImplementation((cb) => {
        agentCb = cb
        return () => {}
      })
    })
    Object.defineProperty(window, 'officer', {
      value: officer,
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows progress text while running and a progress message is set', async () => {
    render(<App />)

    // Simulate a turn being submitted (sets running=true)
    const submitBtn = screen.getByTestId('submit-btn')
    act(() => {
      submitBtn.click()
    })

    // Now fire a progress message
    act(() => {
      progressCb('fetching run 3 of 12')
    })

    expect(screen.getByText('fetching run 3 of 12')).toBeTruthy()
  })

  it('clears progress text when the done event arrives', async () => {
    render(<App />)

    // Start a turn
    const submitBtn = screen.getByTestId('submit-btn')
    act(() => {
      submitBtn.click()
    })

    // Receive progress
    act(() => {
      progressCb('fetching run 3 of 12')
    })
    expect(screen.getByText('fetching run 3 of 12')).toBeTruthy()

    // Fire the 'done' agent event
    act(() => {
      agentCb({ kind: 'done' })
    })

    expect(screen.queryByText('fetching run 3 of 12')).toBeNull()
  })

  it('does not show progress when not running', async () => {
    render(<App />)

    // Fire progress without starting a turn (running is still false)
    act(() => {
      progressCb('fetching run 1 of 5')
    })

    // The indicator is gated on `running && bridgeProgress` — must not appear
    expect(screen.queryByText('fetching run 1 of 5')).toBeNull()
  })
})
