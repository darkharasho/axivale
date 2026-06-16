import { describe, it, expect, vi } from 'vitest'

// Capture the options handed to the SDK's query() so we can assert the tool surface.
const captured: { options?: Record<string, unknown> } = {}
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => {
    captured.options = args.options
    return (async function* () {})()
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSdkMcpServer: (def: any) => ({ name: def.name })
}))

import { ClaudeAdapter } from './claude'
import type { ProviderConfig } from './types'

const config = (): ProviderConfig => ({
  provider: 'claude',
  model: null,
  oauthToken: null,
  apiKey: null,
  endpoint: null
})

describe('ClaudeAdapter session', () => {
  it('round-trips the session id', () => {
    const a = new ClaudeAdapter(config)
    a.restoreSession({ claudeSessionId: 'sess-42' })
    expect(a.serializeSession()).toEqual({ claudeSessionId: 'sess-42' })
  })

  it('serializes empty before any turn', () => {
    expect(new ClaudeAdapter(config).serializeSession()).toEqual({})
  })

  it('reset clears the restored session', () => {
    const a = new ClaudeAdapter(config)
    a.restoreSession({ claudeSessionId: 'sess-42' })
    a.reset()
    expect(a.serializeSession()).toEqual({})
  })

  it('ignores history-only state', () => {
    const a = new ClaudeAdapter(config)
    a.restoreSession({ history: [{ role: 'user' }] })
    expect(a.serializeSession()).toEqual({})
  })
})

describe('ClaudeAdapter tool surface', () => {
  it('disables all built-in tools (officer MCP only) so the model never attempts AskUserQuestion/Bash/etc', async () => {
    const a = new ClaudeAdapter(config)
    const turn = a.runTurn({
      prompt: 'hi',
      systemPrompt: 'sys',
      tools: [],
      confirm: async () => true,
      signal: new AbortController().signal
    })
    // Drain the (empty) stream so runTurn actually invokes query().
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of turn) {
      /* no events from the mocked query */
    }
    expect(captured.options?.tools).toEqual([])
  })
})
