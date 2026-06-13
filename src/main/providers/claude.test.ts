import { describe, it, expect } from 'vitest'
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
