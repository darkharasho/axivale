import { describe, it, expect } from 'vitest'
import { applyEvent, type Turn } from './state'

function baseTurn(): Turn {
  return {
    id: 1,
    userText: 'orders',
    agentText: '',
    tools: [],
    done: false,
    error: null,
    filedAt: '9:42 pm'
  }
}

describe('applyEvent', () => {
  it('appends text on text-delta', () => {
    let t = baseTurn()
    t = applyEvent(t, { kind: 'text-delta', text: 'Hello' })
    t = applyEvent(t, { kind: 'text-delta', text: ', world' })
    expect(t.agentText).toBe('Hello, world')
  })

  it('adds a tool on tool-start', () => {
    const t = applyEvent(baseTurn(), {
      kind: 'tool-start',
      id: 'a',
      name: 'gw2_guild_log',
      input: { count: 3 }
    })
    expect(t.tools).toHaveLength(1)
    expect(t.tools[0]).toMatchObject({ id: 'a', name: 'gw2_guild_log', input: { count: 3 } })
    expect(t.tools[0].resultText).toBeUndefined()
  })

  it('attaches result to the matching tool on tool-result', () => {
    let t = applyEvent(baseTurn(), { kind: 'tool-start', id: 'a', name: 'x', input: {} })
    t = applyEvent(t, { kind: 'tool-start', id: 'b', name: 'y', input: {} })
    t = applyEvent(t, { kind: 'tool-result', id: 'b', isError: true, text: 'boom' })
    expect(t.tools[0].resultText).toBeUndefined()
    expect(t.tools[1].resultText).toBe('boom')
    expect(t.tools[1].isError).toBe(true)
  })

  it('copies display onto the matching tool on tool-result', () => {
    const display = {
      kind: 'table' as const,
      data: { columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Firebrand' }] }
    }
    let t = applyEvent(baseTurn(), { kind: 'tool-start', id: 'a', name: 'x', input: {} })
    t = applyEvent(t, { kind: 'tool-result', id: 'a', isError: false, text: '{}', display })
    expect(t.tools[0].display).toEqual(display)
  })

  it('leaves display undefined when the event has none', () => {
    let t = applyEvent(baseTurn(), { kind: 'tool-start', id: 'a', name: 'x', input: {} })
    t = applyEvent(t, { kind: 'tool-result', id: 'a', isError: false, text: '{}' })
    expect(t.tools[0].display).toBeUndefined()
  })

  it('marks done and records error on done', () => {
    const ok = applyEvent(baseTurn(), { kind: 'done', sessionId: 's1', error: null })
    expect(ok.done).toBe(true)
    expect(ok.error).toBeNull()

    const bad = applyEvent(baseTurn(), { kind: 'done', sessionId: null, error: 'nope' })
    expect(bad.done).toBe(true)
    expect(bad.error).toBe('nope')
  })
})
