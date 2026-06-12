import { describe, it, expect } from 'vitest'
import { translateSdkMessage } from './agent'

describe('translateSdkMessage', () => {
  it('extracts text deltas from partial stream events', () => {
    const events = translateSdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    } as never)
    expect(events).toEqual([{ kind: 'text-delta', text: 'Hello' }])
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
