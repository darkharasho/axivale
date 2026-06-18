import { describe, it, expect } from 'vitest'
import { translateGeminiEvent } from './geminiEvents'

describe('translateGeminiEvent', () => {
  it('turns a streaming assistant message into a text-delta', () => {
    expect(
      translateGeminiEvent({ type: 'message', role: 'assistant', content: 'PONG', delta: true })
    ).toEqual([{ kind: 'text-delta', text: 'PONG' }])
  })

  it('also emits a non-delta assistant message as text (some turns send whole)', () => {
    expect(translateGeminiEvent({ type: 'message', role: 'assistant', content: 'Hi' })).toEqual([
      { kind: 'text-delta', text: 'Hi' }
    ])
  })

  it('ignores the echoed user message', () => {
    expect(translateGeminiEvent({ type: 'message', role: 'user', content: 'do thing' })).toEqual([])
  })

  it('maps a successful result to a clean done (sessionId filled by adapter)', () => {
    expect(translateGeminiEvent({ type: 'result', status: 'success', stats: {} })).toEqual([
      { kind: 'done', sessionId: null, error: null }
    ])
  })

  it('maps a non-success result to a done carrying an error', () => {
    expect(translateGeminiEvent({ type: 'result', status: 'error', error: 'quota exceeded' })).toEqual([
      { kind: 'done', sessionId: null, error: 'quota exceeded' }
    ])
  })

  it('suppresses tool_use and tool_result (the IPC bridge owns tool UI)', () => {
    expect(
      translateGeminiEvent({ type: 'tool_use', tool_name: 'mcp_officer_officer_ping', tool_id: 't1', parameters: {} })
    ).toEqual([])
    expect(
      translateGeminiEvent({ type: 'tool_result', tool_id: 't1', status: 'success', output: 'OK' })
    ).toEqual([])
  })

  it('ignores init and unknown event types', () => {
    expect(translateGeminiEvent({ type: 'init', session_id: 'x', model: 'auto' })).toEqual([])
    expect(translateGeminiEvent({ type: 'something_new' })).toEqual([])
  })
})
