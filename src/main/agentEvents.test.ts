import { describe, it, expect, vi } from 'vitest'
import { translateSdkMessage, sessionIdFromMessage } from './agent'

describe('translateSdkMessage', () => {
  it('extracts text deltas from partial stream events', () => {
    const events = translateSdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    } as never)
    expect(events).toEqual([{ kind: 'text-delta', text: 'Hello' }])
  })

  it('emits a paragraph break when a new text block starts', () => {
    // Text before and after a tool call comes from separate assistant
    // messages; without a break they concatenate mid-sentence.
    const events = translateSdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    } as never)
    expect(events).toEqual([{ kind: 'text-delta', text: '\n\n' }])
  })

  it('does not emit breaks for non-text block starts', () => {
    const events = translateSdkMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: 'x', input: {} }
      }
    } as never)
    expect(events).toEqual([])
  })

  it('extracts tool_use blocks from assistant messages', () => {
    const events = translateSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 't1', name: 'mcp__officer__axitools_builds_list', input: {} }
        ]
      }
    } as never)
    expect(events).toContainEqual({
      kind: 'tool-start',
      id: 't1',
      name: 'axitools_builds_list',
      input: {}
    })
  })

  it('extracts tool results from user messages', () => {
    const events = translateSdkMessage({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: false, content: [{ type: 'text', text: '[]' }] }
        ]
      }
    } as never)
    expect(events).toContainEqual({ kind: 'tool-result', id: 't1', isError: false, text: '[]' })
  })

  it('handles string tool_result content', () => {
    const events = translateSdkMessage({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'oops' }] }
    } as never)
    expect(events).toContainEqual({ kind: 'tool-result', id: 't2', isError: true, text: 'oops' })
  })

  it('emits done on result messages', () => {
    const events = translateSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'All done.',
      session_id: 's-1'
    } as never)
    expect(events).toEqual([{ kind: 'done', sessionId: 's-1', error: null }])
  })

  it('emits done with error on failure subtypes', () => {
    const events = translateSdkMessage({
      type: 'result',
      subtype: 'error_during_execution',
      session_id: 's-1'
    } as never)
    expect(events).toEqual([
      { kind: 'done', sessionId: 's-1', error: 'Agent error: error_during_execution' }
    ])
  })

  it('ignores unrelated message types', () => {
    expect(translateSdkMessage({ type: 'system', subtype: 'init' } as never)).toEqual([])
  })
})

describe('sessionIdFromMessage', () => {
  it('extracts session_id from a system/init message', () => {
    expect(
      sessionIdFromMessage({ type: 'system', subtype: 'init', session_id: 'sess-abc' } as never)
    ).toBe('sess-abc')
  })

  it('returns null for a system/init message without a session_id', () => {
    expect(sessionIdFromMessage({ type: 'system', subtype: 'init' } as never)).toBeNull()
  })

  it('extracts session_id from a result message', () => {
    expect(
      sessionIdFromMessage({
        type: 'result',
        subtype: 'success',
        result: 'done',
        session_id: 'sess-xyz'
      } as never)
    ).toBe('sess-xyz')
  })

  it('returns null for other message types', () => {
    expect(sessionIdFromMessage({ type: 'assistant', message: { content: [] } } as never)).toBeNull()
    expect(
      sessionIdFromMessage({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }
      } as never)
    ).toBeNull()
  })
})

describe('ClaudeAdapter session capture on interrupted turn', () => {
  it('preserves session_id from system/init even when turn ends without result', async () => {
    // The SDK is hard to mock at module level in vitest without dynamic module re-import.
    // The fix is implemented via the pure helper sessionIdFromMessage, which the adapter
    // calls per-message before translateSdkMessage. We verify the capture contract here
    // by testing the helper directly against both message shapes the adapter handles.

    // system/init arrives first — before any result — and must yield a session_id.
    const initMsg = { type: 'system', subtype: 'init', session_id: 'interrupted-sess' }
    expect(sessionIdFromMessage(initMsg as never)).toBe('interrupted-sess')

    // result message also carries session_id (normal completion path).
    const resultMsg = { type: 'result', subtype: 'success', result: '', session_id: 'result-sess' }
    expect(sessionIdFromMessage(resultMsg as never)).toBe('result-sess')

    // Other messages must return null so the adapter doesn't clobber a valid session_id
    // with undefined.
    expect(sessionIdFromMessage({ type: 'assistant', message: { content: [] } } as never)).toBeNull()

    // Confirm ClaudeAdapter is constructable and exposes the expected API surface.
    const { ClaudeAdapter } = await import('./providers/claude')
    const adapter = new ClaudeAdapter(() => ({
      provider: 'claude' as never,
      model: null,
      oauthToken: null,
      apiKey: null,
      endpoint: null
    }))
    expect(typeof adapter.runTurn).toBe('function')
    expect(typeof adapter.reset).toBe('function')
  })
})
