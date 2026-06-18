import { describe, it, expect } from 'vitest'
import { translateCodexEvent } from './codexEvents'

// Minimal ThreadEvent fixtures mirroring @openai/codex-sdk's emitted shapes.
const agentMessage = (text: string) => ({
  type: 'item.completed' as const,
  item: { id: 'm1', type: 'agent_message' as const, text }
})

describe('translateCodexEvent', () => {
  it('turns a completed agent_message into a text-delta with a leading paragraph break', () => {
    expect(translateCodexEvent(agentMessage('Hello world'))).toEqual([
      { kind: 'text-delta', text: '\n\nHello world' }
    ])
  })

  it('emits an empty text-delta safely for an empty agent_message', () => {
    expect(translateCodexEvent(agentMessage(''))).toEqual([{ kind: 'text-delta', text: '\n\n' }])
  })

  it('maps turn.completed to a clean done (sessionId filled by the adapter)', () => {
    expect(translateCodexEvent({ type: 'turn.completed', usage: null })).toEqual([
      { kind: 'done', sessionId: null, error: null }
    ])
  })

  it('maps turn.failed to a done carrying the error message', () => {
    expect(
      translateCodexEvent({ type: 'turn.failed', error: { message: 'model exploded' } })
    ).toEqual([{ kind: 'done', sessionId: null, error: 'model exploded' }])
  })

  it('maps a fatal error event to a done carrying the message', () => {
    expect(translateCodexEvent({ type: 'error', message: 'stream died' })).toEqual([
      { kind: 'done', sessionId: null, error: 'stream died' }
    ])
  })

  it('suppresses mcp_tool_call items (the IPC bridge is the source of truth for tool UI)', () => {
    expect(
      translateCodexEvent({
        type: 'item.completed',
        item: {
          id: 't1',
          type: 'mcp_tool_call',
          server: 'officer',
          tool: 'meta_search',
          status: 'completed'
        }
      })
    ).toEqual([])
  })

  it('ignores reasoning, thread.started, turn.started, and in-progress item updates', () => {
    expect(translateCodexEvent({ type: 'thread.started', thread_id: 'x' })).toEqual([])
    expect(translateCodexEvent({ type: 'turn.started' })).toEqual([])
    expect(
      translateCodexEvent({ type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'partial' } })
    ).toEqual([])
    expect(
      translateCodexEvent({ type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'thinking' } })
    ).toEqual([])
  })
})
