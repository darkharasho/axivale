import { describe, it, expect, vi } from 'vitest'
import { evaluateToolPermission, AXIVALE_SYSTEM_PROMPT } from './agent'

describe('AXIVALE_SYSTEM_PROMPT', () => {
  it('includes the analytics methodology section', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('Analytics methodology')
    expect(AXIVALE_SYSTEM_PROMPT).toContain('own baselines')
  })
})

// ---------------------------------------------------------------------------
// Fix 2: evaluateToolPermission
// ---------------------------------------------------------------------------

describe('evaluateToolPermission', () => {
  const neverConfirm = vi.fn()

  it('denies a non-officer tool without calling confirm', async () => {
    const result = await evaluateToolPermission('Bash', {}, { confirm: neverConfirm })
    expect(result).toEqual({ behavior: 'deny', message: 'Only officer tools are available in this app.' })
    expect(neverConfirm).not.toHaveBeenCalled()
  })

  it('denies a destructive tool when the user declines', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const result = await evaluateToolPermission(
      'mcp__officer__axitools_builds_delete',
      { build_id: 'b1' },
      { confirm }
    )
    expect(result).toEqual({ behavior: 'deny', message: 'The user declined this action.' })
    expect(confirm).toHaveBeenCalledWith('axitools_builds_delete', { build_id: 'b1' })
  })

  it('allows a destructive tool when the user confirms', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const result = await evaluateToolPermission(
      'mcp__officer__axitools_comp_presets_delete',
      { name: 'p1' },
      { confirm }
    )
    expect(result.behavior).toBe('allow')
    expect(confirm).toHaveBeenCalledWith('axitools_comp_presets_delete', { name: 'p1' })
  })

  it('allows a normal officer tool without calling confirm', async () => {
    const confirm = vi.fn()
    const result = await evaluateToolPermission(
      'mcp__officer__axitools_builds_list',
      {},
      { confirm }
    )
    expect(result.behavior).toBe('allow')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('allows safe discord actions without confirm', async () => {
    const confirm = vi.fn()
    const result = await evaluateToolPermission(
      'mcp__officer__discord_action',
      { action: 'message_send', params: { channel_id: '5', content: 'hi' } },
      { confirm }
    )
    expect(result.behavior).toBe('allow')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('requires confirm for destructive discord actions', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const input = { action: 'member_ban', params: { member_id: '7' } }
    const result = await evaluateToolPermission('mcp__officer__discord_action', input, { confirm })
    expect(result).toEqual({ behavior: 'deny', message: 'The user declined this action.' })
    expect(confirm).toHaveBeenCalledWith('discord_action', input)
  })

  it('requires confirm for rss delete but not rss list', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const listResult = await evaluateToolPermission(
      'mcp__officer__axitools_rss',
      { action: 'list' },
      { confirm }
    )
    expect(listResult.behavior).toBe('allow')
    expect(confirm).not.toHaveBeenCalled()
    await evaluateToolPermission(
      'mcp__officer__axitools_rss',
      { action: 'delete', name: 'news' },
      { confirm }
    )
    expect(confirm).toHaveBeenCalledWith('axitools_rss', { action: 'delete', name: 'news' })
  })

  it('allows destructive discord actions when the user confirms', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const result = await evaluateToolPermission(
      'mcp__officer__discord_action',
      { action: 'channel_delete', params: { channel_id: '5' } },
      { confirm }
    )
    expect(result.behavior).toBe('allow')
  })
})

// ---------------------------------------------------------------------------
// Fix 1: AgentService turn serialization
// ---------------------------------------------------------------------------

// A module-level deferred that the mocked query generator awaits.
// vi.mock is hoisted to the top of the file so we can't use local variables
// inside it; the deferred must live at module scope.
let _releaseTurn: (() => void) | null = null
const _turnGate = { held: null as Promise<void> | null }

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()
  return {
    ...mod,
    query: vi.fn(async function* () {
      if (_turnGate.held) await _turnGate.held
      // yield nothing — turn finishes cleanly after gate opens
    }),
    createSdkMcpServer: vi.fn(() => ({}))
  }
})

describe('AgentService turn serialization', () => {
  it('emits a done error when a second turn is started while one is already running', async () => {
    // Reset module-scope deferred for this test
    _turnGate.held = new Promise<void>((resolve) => { _releaseTurn = resolve })

    const { AgentService } = await import('./agent')
    vi.spyOn(await import('./tools'), 'buildOfficerTools').mockReturnValue([])

    const mockDeps = {
      toolDeps: () => ({
        axitools: {} as never,
        gw2: {} as never,
        discordGuildId: () => '1',
        gw2GuildId: () => 'g1',
        axiforge: {} as never,
        axiforgeLauncher: { ensureRunning: async () => {} },
        axibridge: () => ({}) as never,
        loadSkill: () => null
      }),
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
      confirm: vi.fn().mockResolvedValue(true),
      loadSession: () => ({}),
      saveSession: vi.fn(),
      skills: () => [],
      meta: () => []
    }

    const agent = new AgentService(mockDeps)

    const events1: import('./agent').AgentEvent[] = []
    const events2: import('./agent').AgentEvent[] = []

    // Start turn 1 on conversation "c1" — it blocks until _releaseTurn()
    const turn1 = agent.runTurn('c1', 'first prompt', (e) => events1.push(e))

    // A second turn on the SAME conversation must be rejected.
    const turn2 = agent.runTurn('c1', 'second prompt', (e) => events2.push(e))

    await Promise.resolve()
    await Promise.resolve()

    expect(events2).toHaveLength(1)
    expect(events2[0]).toMatchObject({
      kind: 'done',
      error: expect.stringContaining('already in progress')
    })

    _releaseTurn!()
    _turnGate.held = null
    await turn1
    await turn2
  })

  it('allows concurrent turns on different conversations', async () => {
    _turnGate.held = new Promise<void>((resolve) => { _releaseTurn = resolve })

    const { AgentService } = await import('./agent')
    vi.spyOn(await import('./tools'), 'buildOfficerTools').mockReturnValue([])

    const deps = {
      toolDeps: () => ({
        axitools: {} as never,
        gw2: {} as never,
        discordGuildId: () => '1',
        gw2GuildId: () => 'g1',
        axiforge: {} as never,
        axiforgeLauncher: { ensureRunning: async () => {} },
        axibridge: () => ({}) as never,
        loadSkill: () => null
      }),
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
      confirm: vi.fn().mockResolvedValue(true),
      loadSession: () => ({}),
      saveSession: vi.fn(),
      skills: () => [],
      meta: () => []
    }
    const agent = new AgentService(deps)

    const eventsB: import('./agent').AgentEvent[] = []
    const turnA = agent.runTurn('cA', 'a', () => {})
    const turnB = agent.runTurn('cB', 'b', (e) => eventsB.push(e))

    await Promise.resolve()
    await Promise.resolve()

    // cB was NOT rejected — no early "already in progress" done event.
    expect(eventsB).toHaveLength(0)

    _releaseTurn!()
    _turnGate.held = null
    await turnA
    await turnB
  })
})

describe('AgentService persistence', () => {
  it('persists the conversation session after a turn completes', async () => {
    const { AgentService } = await import('./agent')
    vi.spyOn(await import('./tools'), 'buildOfficerTools').mockReturnValue([])

    const saveSession = vi.fn()
    const deps = {
      toolDeps: () => ({
        axitools: {} as never,
        gw2: {} as never,
        discordGuildId: () => '1',
        gw2GuildId: () => 'g1',
        axiforge: {} as never,
        axiforgeLauncher: { ensureRunning: async () => {} },
        axibridge: () => ({}) as never,
        loadSkill: () => null
      }),
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
      confirm: vi.fn().mockResolvedValue(true),
      loadSession: () => ({}),
      saveSession,
      skills: () => [],
      meta: () => []
    }
    const agent = new AgentService(deps)
    await agent.runTurn('c9', 'hello', () => {})
    expect(saveSession).toHaveBeenCalledWith('c9', 'claude', expect.any(Object))
  })
})
