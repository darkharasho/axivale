import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { GeminiAdapter, sanitizeForGemini } from './gemini'
import type { AgentEvent, ProviderConfig, TurnInput } from './types'

const echo = tool('echo_tool', 'Echoes.', { message: z.string() }, async (args: { message: string }) => ({
  content: [{ type: 'text' as const, text: `echo:${args.message}` }]
}))

function sseBody(events: unknown[]): Response {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function turnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    prompt: 'hello',
    systemPrompt: 'You are a test.',
    tools: [echo],
    confirm: vi.fn().mockResolvedValue(true),
    signal: new AbortController().signal,
    ...overrides
  }
}

const config: ProviderConfig = {
  provider: 'gemini',
  model: 'gemini-test',
  oauthToken: null,
  apiKey: 'AIza-test',
  endpoint: null
}

async function collect(adapter: GeminiAdapter, input: TurnInput): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const e of adapter.runTurn(input)) events.push(e)
  return events
}

describe('sanitizeForGemini', () => {
  it('keeps supported keywords and drops unsupported ones recursively', () => {
    const cleaned = sanitizeForGemini({
      type: 'object',
      $schema: 'http://x',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'd', additionalProperties: false }
      },
      required: ['name']
    })
    expect(cleaned).toEqual({
      type: 'object',
      properties: { name: { type: 'string', description: 'd' } },
      required: ['name']
    })
  })
})

describe('GeminiAdapter', () => {
  it('streams text and finishes cleanly', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([
        { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'lo' }] } }] }
      ])
    )
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toEqual([
      { kind: 'text-delta', text: 'Hel' },
      { kind: 'text-delta', text: 'lo' },
      { kind: 'done', sessionId: null, error: null }
    ])
    const url = fetchFn.mock.calls[0][0] as string
    expect(url).toContain('gemini-test:streamGenerateContent')
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('AIza-test')
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.systemInstruction.parts[0].text).toBe('You are a test.')
    expect(body.tools[0].functionDeclarations[0].name).toBe('echo_tool')
  })

  it('executes a functionCall and loops back with a functionResponse', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            candidates: [
              { content: { parts: [{ functionCall: { name: 'echo_tool', args: { message: 'hi' } } }] } }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ candidates: [{ content: { parts: [{ text: 'done!' }] } }] }]))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    const start = events.find((e) => e.kind === 'tool-start')
    expect(start).toMatchObject({ name: 'echo_tool', input: { message: 'hi' } })
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool-result', isError: false, text: 'echo:hi' })
    )
    const second = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    const lastContent = second.contents[second.contents.length - 1]
    expect(lastContent.role).toBe('user')
    expect(lastContent.parts[0].functionResponse.name).toBe('echo_tool')
    expect(events[events.length - 1]).toEqual({ kind: 'done', sessionId: null, error: null })
  })

  it('throws a labeled error on a non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    await expect(collect(adapter, turnInput())).rejects.toThrow(/Gemini request failed \(403\)/)
  })

  it('keeps history across turns and clears on reset', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(sseBody([{ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }]))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput({ prompt: 'first' }))
    await collect(adapter, turnInput({ prompt: 'second' }))
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user'])
    adapter.reset()
    await collect(adapter, turnInput({ prompt: 'third' }))
    const fresh = JSON.parse((fetchFn.mock.calls[2][1] as RequestInit).body as string)
    expect(fresh.contents.map((c: { role: string }) => c.role)).toEqual(['user'])
  })

  it('rolls back history when a fetch rejects, so the next turn starts clean', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(
        sseBody([{ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }])
      )
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    // First turn should reject
    await expect(collect(adapter, turnInput())).rejects.toThrow('network error')
    // Second turn succeeds; history must only have the user message (no dirty messages from failed turn)
    await collect(adapter, turnInput())
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user'])
  })

  it('collects two functionCalls from one round into a single user content in the follow-up request', async () => {
    const echo2 = tool('echo_tool_2', 'Echoes.', { message: z.string() }, async (args: { message: string }) => ({
      content: [{ type: 'text' as const, text: `echo2:${args.message}` }]
    }))
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { name: 'echo_tool', args: { message: 'a' } } },
                    { functionCall: { name: 'echo_tool_2', args: { message: 'b' } } }
                  ]
                }
              }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ candidates: [{ content: { parts: [{ text: 'done' }] } }] }]))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput({ tools: [echo, echo2] }))

    // Both tool-start and tool-result events must fire with distinct ids
    const starts = events.filter((e) => e.kind === 'tool-start')
    const results = events.filter((e) => e.kind === 'tool-result')
    expect(starts).toHaveLength(2)
    expect(results).toHaveLength(2)
    expect((starts[0] as Extract<AgentEvent, { kind: 'tool-start' }>).name).toBe('echo_tool')
    expect((starts[1] as Extract<AgentEvent, { kind: 'tool-start' }>).name).toBe('echo_tool_2')
    const id0 = (starts[0] as Extract<AgentEvent, { kind: 'tool-start' }>).id
    const id1 = (starts[1] as Extract<AgentEvent, { kind: 'tool-start' }>).id
    expect(id0).not.toBe(id1)

    // Both functionResponse parts must land in a SINGLE user content in the follow-up body
    const second = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    const lastContent = second.contents[second.contents.length - 1]
    expect(lastContent.role).toBe('user')
    expect(lastContent.parts).toHaveLength(2)
    expect(lastContent.parts[0].functionResponse.name).toBe('echo_tool')
    expect(lastContent.parts[1].functionResponse.name).toBe('echo_tool_2')
  })

  it('yields done with empty-response error and does not corrupt history for the next turn', async () => {
    const fetchFn = vi
      .fn()
      // First turn: chunk with no parts → empty response
      .mockResolvedValueOnce(
        sseBody([{ candidates: [{ content: { parts: [] } }] }])
      )
      // Second turn: normal text response
      .mockResolvedValueOnce(
        sseBody([{ candidates: [{ content: { parts: [{ text: 'hello' }] } }] }])
      )
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)

    // First turn: expect a single done event with the error message
    const firstEvents = await collect(adapter, turnInput({ prompt: 'blocked?' }))
    expect(firstEvents).toHaveLength(1)
    expect(firstEvents[0]).toMatchObject({
      kind: 'done',
      error: expect.stringContaining('empty response')
    })

    // Second turn: history must only contain the new user message (no leftovers from the blocked turn)
    const secondEvents = await collect(adapter, turnInput({ prompt: 'next' }))
    expect(secondEvents).toContainEqual({ kind: 'done', sessionId: null, error: null })
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user'])
  })

  it('rolls back the WHOLE turn when empty response arrives after a tool round', async () => {
    const fetchFn = vi
      .fn()
      // Round 0: returns a functionCall → tool executes
      .mockResolvedValueOnce(
        sseBody([
          {
            candidates: [
              { content: { parts: [{ functionCall: { name: 'echo_tool', args: { message: 'x' } } }] } }
            ]
          }
        ])
      )
      // Round 1: empty parts → empty-response path
      .mockResolvedValueOnce(
        sseBody([{ candidates: [{ content: { parts: [] } }] }])
      )
      // Turn 2: normal text response to verify history is clean
      .mockResolvedValueOnce(
        sseBody([{ candidates: [{ content: { parts: [{ text: 'all good' }] } }] }])
      )
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)

    // Turn 1: tool executes then empty response
    const firstEvents = await collect(adapter, turnInput({ prompt: 'do something' }))
    const doneEvent = firstEvents[firstEvents.length - 1]
    expect(doneEvent).toMatchObject({ kind: 'done', error: expect.stringContaining('empty response') })

    // Turn 2: history must be exactly ['user'] — full rollback, no dangling functionCall
    await collect(adapter, turnInput({ prompt: 'next' }))
    const body = JSON.parse((fetchFn.mock.calls[2][1] as RequestInit).body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user'])
  })

  it('aborts mid-loop when signal is already aborted and rolls back history', async () => {
    const ac = new AbortController()
    ac.abort()
    // fetchFn returns a functionCall round — the abort check fires before gateAndRunTool
    const fetchFn = vi.fn().mockResolvedValueOnce(
      sseBody([
        {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'echo_tool', args: { message: 'x' } } }]
              }
            }
          ]
        }
      ])
    )
    const freshFetch = vi
      .fn()
      .mockResolvedValueOnce(sseBody([{ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }]))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    // The aborted-signal turn should reject
    await expect(collect(adapter, turnInput({ signal: ac.signal }))).rejects.toThrow('Turn cancelled')
    // Swap in a clean fetchFn; the adapter should have rolled back history
    ;(adapter as unknown as { fetchFn: typeof fetch }).fetchFn = freshFetch as unknown as typeof fetch
    await collect(adapter, turnInput())
    const body = JSON.parse((freshFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user'])
  })
})

describe('GeminiAdapter session', () => {
  const sessionConfig = (): ProviderConfig => ({
    provider: 'gemini',
    model: null,
    oauthToken: null,
    apiKey: 'k',
    endpoint: null
  })

  it('round-trips content history', () => {
    const a = new GeminiAdapter(sessionConfig)
    const history = [{ role: 'user', parts: [{ text: 'hi' }] }]
    a.restoreSession({ history })
    expect(a.serializeSession()).toEqual({ history })
  })

  it('serializes empty history before any turn', () => {
    expect(new GeminiAdapter(sessionConfig).serializeSession()).toEqual({ history: [] })
  })

  it('reset clears the restored history', () => {
    const a = new GeminiAdapter(sessionConfig)
    a.restoreSession({ history: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    a.reset()
    expect(a.serializeSession()).toEqual({ history: [] })
  })
})
