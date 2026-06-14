// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { Turn } from './state'
import type { RendererConversation } from '../../preload/index.d'

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
    axiforgeLaunch: vi.fn().mockResolvedValue({ ok: true }),
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
    githubDiscoverRepos: vi.fn().mockResolvedValue({ ok: false }),
    shareConversation: vi.fn().mockResolvedValue({ ok: false, error: '' }),
    shareResponse: vi.fn().mockResolvedValue({ ok: false, error: '' }),
    shareList: vi.fn().mockResolvedValue([]),
    shareDelete: vi.fn().mockResolvedValue({ ok: true }),
    shareStatus: vi
      .fn()
      .mockResolvedValue({ signedIn: false, repoReady: false, pagesUrl: null }),
    forgeCatalogUpgrades: vi.fn().mockResolvedValue(null),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    metaList: vi.fn().mockResolvedValue([]),
    metaAddMode: vi.fn().mockResolvedValue({} as never),
    metaUpdateMode: vi.fn().mockResolvedValue(null),
    metaRemoveMode: vi.fn().mockResolvedValue(undefined),
    skillsList: vi.fn().mockResolvedValue([]),
    skillsCreate: vi.fn().mockResolvedValue({} as never),
    skillsUpdate: vi.fn().mockResolvedValue(null),
    skillsDelete: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue(undefined),
    cancelTurn: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([
      {
        id: 'c1',
        title: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turns: [],
        provider: 'claude',
        session: {},
        seenTurnCount: 0
      }
    ]),
    getConversation: vi.fn().mockResolvedValue({
      id: 'c1',
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
      provider: 'claude',
      session: {},
      seenTurnCount: 0
    }),
    createConversation: vi.fn().mockResolvedValue({
      id: 'c1',
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
      provider: 'claude',
      session: {},
      seenTurnCount: 0
    }),
    saveTurns: vi.fn().mockResolvedValue(undefined),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    setActiveConversation: vi.fn().mockResolvedValue(undefined),
    markConversationSeen: vi.fn().mockResolvedValue(undefined),
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
  RightRail: () => null
}))
vi.mock('./components/Editions', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <>
      <button data-testid="select-c1" onClick={() => onSelect('c1')}>
        open c1
      </button>
      <button data-testid="select-c2" onClick={() => onSelect('c2')}>
        open c2
      </button>
    </>
  )
}))
vi.mock('./components/InputBar', () => ({
  default: ({ disabled, onSubmit }: { disabled: boolean; onSubmit: (t: string) => void }) => (
    <button
      data-testid="submit-btn"
      data-disabled={disabled ? 'true' : 'false'}
      onClick={() => onSubmit('hello')}
    >
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
    await act(async () => {
      render(<App />)
    })

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
    await act(async () => {
      render(<App />)
    })

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
    await act(async () => {
      render(<App />)
    })

    // Fire progress without starting a turn (running is still false)
    act(() => {
      progressCb('fetching run 1 of 5')
    })

    // The indicator is gated on `running && bridgeProgress` — must not appear
    expect(screen.queryByText('fetching run 1 of 5')).toBeNull()
  })
})

describe('App per-conversation accumulation + running tracking', () => {
  let agentCb: (event: unknown) => void
  let saveTurns: ReturnType<typeof vi.fn>

  function conv(id: string, turns: unknown[] = []): RendererConversation {
    return {
      id,
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns,
      provider: 'claude',
      session: {},
      seenTurnCount: 0
    }
  }

  beforeEach(() => {
    saveTurns = vi.fn().mockResolvedValue(undefined)
    const conversations = [conv('c1'), conv('c2')]
    const officer = makeOfficer({
      listConversations: vi.fn().mockResolvedValue(conversations),
      // c1 opens on mount; c2 opens on select. c2 starts empty on disk.
      getConversation: vi.fn().mockImplementation((id: string) => Promise.resolve(conv(id))),
      saveTurns,
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

  it('captures a backgrounded conversation transcript and resets running on switch', async () => {
    await act(async () => {
      render(<App />)
    })

    // Start a turn in the active conversation (c1) → running true.
    const submitBtn = screen.getByTestId('submit-btn')
    act(() => {
      submitBtn.click()
    })
    expect(screen.getByTestId('submit-btn').getAttribute('data-disabled')).toBe('true')

    // Switch to c2 (c1 still running in the background) → c2 has no in-flight
    // turn, so the InputBar must become usable.
    await act(async () => {
      screen.getByTestId('select-c2').click()
    })
    expect(screen.getByTestId('submit-btn').getAttribute('data-disabled')).toBe('false')

    // c1 streams + completes in the background; events carry its conversationId.
    await act(async () => {
      agentCb({ kind: 'text-delta', text: 'background reply', conversationId: 'c1' })
      agentCb({ kind: 'done', sessionId: null, error: null, conversationId: 'c1' })
    })

    // Viewing c2: it is unaffected and input stays usable.
    expect(screen.getByTestId('submit-btn').getAttribute('data-disabled')).toBe('false')

    // Reopen c1 — its captured transcript shows the reply, and since the turn
    // is now done, input is usable (no eternal spinner).
    await act(async () => {
      screen.getByTestId('select-c1').click()
    })
    expect(screen.getByTestId('submit-btn').getAttribute('data-disabled')).toBe('false')

    // c1's transcript was persisted (debounced) with the reply text and done.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })
    const c1Saves = saveTurns.mock.calls.filter((c) => c[0] === 'c1')
    const lastC1 = c1Saves[c1Saves.length - 1][1] as Turn[]
    expect(lastC1[lastC1.length - 1].agentText).toBe('background reply')
    expect(lastC1[lastC1.length - 1].done).toBe(true)
  })

  it('disables input when reopening a conversation with an in-flight turn', async () => {
    await act(async () => {
      render(<App />)
    })

    // Start a turn in c1 → running true.
    act(() => {
      screen.getByTestId('submit-btn').click()
    })
    // Switch away to c2 → running false (c2 idle).
    await act(async () => {
      screen.getByTestId('select-c2').click()
    })
    expect(screen.getByTestId('submit-btn').getAttribute('data-disabled')).toBe('false')

    // Reopen c1 — its live in-memory turn is still not done, so input disables.
    // (openConversation keeps the live transcript rather than the empty disk one.)
    await act(async () => {
      screen.getByTestId('select-c1').click()
    })
    expect(screen.getByTestId('submit-btn').getAttribute('data-disabled')).toBe('true')
  })
})
