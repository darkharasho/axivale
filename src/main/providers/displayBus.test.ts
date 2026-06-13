import { describe, it, expect } from 'vitest'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { DisplayCorrelator } from './displayBus'
import type { AgentEvent, DisplayPayload } from './types'

const display: DisplayPayload = { kind: 'build-card', data: { build: { id: 'b1' } } }

function richTool(name: string) {
  return tool(name, 'rich', {}, async () => ({
    content: [{ type: 'text' as const, text: '{"id":"b1"}' }],
    display
  }))
}

describe('DisplayCorrelator', () => {
  it('re-attaches displays to tool-result events by tool-use id', async () => {
    const c = new DisplayCorrelator()
    const [wrapped] = c.wrapTools([richTool('axiforge_builds_get')])
    await wrapped.handler({}, {})

    const start: AgentEvent = {
      kind: 'tool-start', id: 'toolu_1', name: 'axiforge_builds_get', input: {}
    }
    expect(c.observe(start)).toBe(start)
    const result = c.observe({
      kind: 'tool-result', id: 'toolu_1', isError: false, text: '{"id":"b1"}'
    })
    expect(result).toEqual({
      kind: 'tool-result', id: 'toolu_1', isError: false, text: '{"id":"b1"}', display
    })
  })

  it('matches displays FIFO per tool name across interleaved calls', async () => {
    const c = new DisplayCorrelator()
    const [wrapped] = c.wrapTools([richTool('t')])
    await wrapped.handler({}, {})
    await wrapped.handler({}, {})
    c.observe({ kind: 'tool-start', id: 'a', name: 't', input: {} })
    c.observe({ kind: 'tool-start', id: 'b', name: 't', input: {} })
    const ra = c.observe({ kind: 'tool-result', id: 'a', isError: false, text: '1' })
    const rb = c.observe({ kind: 'tool-result', id: 'b', isError: false, text: '2' })
    expect(ra.kind === 'tool-result' && ra.display).toEqual(display)
    expect(rb.kind === 'tool-result' && rb.display).toEqual(display)
  })

  it('does not queue displays for error results and passes other events through', async () => {
    const c = new DisplayCorrelator()
    const [wrapped] = c.wrapTools([
      tool('err', 'fails', {}, async () => ({
        isError: true, content: [{ type: 'text' as const, text: 'nope' }], display
      }))
    ])
    await wrapped.handler({}, {})
    c.observe({ kind: 'tool-start', id: 'x', name: 'err', input: {} })
    const r = c.observe({ kind: 'tool-result', id: 'x', isError: true, text: 'nope' })
    expect(r.kind === 'tool-result' && r.display).toBeUndefined()
    const delta: AgentEvent = { kind: 'text-delta', text: 'hi' }
    expect(c.observe(delta)).toBe(delta)
  })
})
