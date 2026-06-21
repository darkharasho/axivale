// src/main/meta/__evals__/agent/runAgentTurn.test.ts
import { describe, it, expect } from 'vitest'
import { foldTurn, type TurnRunner } from './runAgentTurn'
import type { AgentEvent } from '../../../providers/types'

/** A fake runner that replays a scripted event sequence. */
function scripted(events: AgentEvent[]): TurnRunner {
  return {
    async runTurn(_id, _prompt, onEvent) {
      for (const e of events) onEvent(e)
    }
  }
}

describe('foldTurn', () => {
  it('folds text deltas and paired tool events into a TurnTrace', async () => {
    const runner = scripted([
      { kind: 'text-delta', text: 'Hello ' },
      { kind: 'tool-start', id: '1', name: 'axibridge_section', input: { section: 'boons' } },
      { kind: 'tool-result', id: '1', isError: false, text: '{"rows":[]}' },
      { kind: 'text-delta', text: 'world' },
      { kind: 'done', sessionId: 's', error: null }
    ])
    const trace = await foldTurn(runner, 'p')
    expect(trace.answer).toBe('Hello world')
    expect(trace.error).toBeNull()
    expect(trace.toolCalls).toEqual([
      { name: 'axibridge_section', input: { section: 'boons' }, isError: false, resultText: '{"rows":[]}' }
    ])
  })

  it('captures a done error and an error tool-result', async () => {
    const runner = scripted([
      { kind: 'tool-start', id: '1', name: 'x', input: {} },
      { kind: 'tool-result', id: '1', isError: true, text: 'boom' },
      { kind: 'done', sessionId: null, error: 'turn failed' }
    ])
    const trace = await foldTurn(runner, 'p')
    expect(trace.error).toBe('turn failed')
    expect(trace.toolCalls[0].isError).toBe(true)
    expect(trace.toolCalls[0].resultText).toBe('boom')
  })
})
