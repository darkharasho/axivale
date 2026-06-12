import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { OpenAIChatAdapter } from './openaiCompat'
import type { AgentEvent, ProviderConfig, TurnInput } from './types'

const echo = tool('echo_tool', 'Echoes.', { message: z.string() }, async (args: { message: string }) => ({
  content: [{ type: 'text' as const, text: `echo:${args.message}` }]
}))

function sseBody(events: unknown[]): Response {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
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

const openaiConfig: ProviderConfig = {
  provider: 'openai',
  model: 'test-model',
  oauthToken: null,
  apiKey: 'sk-test',
  endpoint: null
}

async function collect(adapter: OpenAIChatAdapter, input: TurnInput): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const e of adapter.runTurn(input)) events.push(e)
  return events
}

describe('OpenAIChatAdapter', () => {
  it('streams text deltas and finishes with a clean done', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }
      ])
    )
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toEqual([
      { kind: 'text-delta', text: 'Hel' },
      { kind: 'text-delta', text: 'lo' },
      { kind: 'done', sessionId: null, error: null }
    ])
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('test-model')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test.' })
    expect(body.tools[0].function.name).toBe('echo_tool')
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
  })

  it('executes a tool call and loops back with the result', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_1', function: { name: 'echo_tool', arguments: '{"mess' } }
                  ]
                }
              }
            ]
          },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: 'age":"hi"}' } }] },
                finish_reason: 'tool_calls'
              }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ choices: [{ delta: { content: 'done!' }, finish_reason: 'stop' }] }]))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toContainEqual({
      kind: 'tool-start',
      id: 'call_1',
      name: 'echo_tool',
      input: { message: 'hi' }
    })
    expect(events).toContainEqual({ kind: 'tool-result', id: 'call_1', isError: false, text: 'echo:hi' })
    expect(events[events.length - 1]).toEqual({ kind: 'done', sessionId: null, error: null })
    // second request carries the assistant tool_calls message + tool result
    const second = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    const roles = second.messages.map((m: { role: string }) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
  })

  it('keeps history across turns and clears it on reset', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    )
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput({ prompt: 'first' }))
    await collect(adapter, turnInput({ prompt: 'second' }))
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user'
    ])
    adapter.reset()
    await collect(adapter, turnInput({ prompt: 'third' }))
    const fresh = JSON.parse((fetchFn.mock.calls[2][1] as RequestInit).body as string)
    expect(fresh.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
  })

  it('throws a labeled error on a non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    await expect(collect(adapter, turnInput())).rejects.toThrow(/OpenAI request failed \(401\)/)
  })

  it('feeds malformed tool-call JSON back as an error result instead of crashing', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'c1', function: { name: 'echo_tool', arguments: '{oops' } }]
                },
                finish_reason: 'tool_calls'
              }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ choices: [{ delta: { content: 'sorry' }, finish_reason: 'stop' }] }]))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    const result = events.find((e) => e.kind === 'tool-result')
    expect(result).toMatchObject({ isError: true })
  })

  it('uses the local endpoint without auth when provider is local', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    )
    const localConfig: ProviderConfig = {
      provider: 'local',
      model: 'qwen3:8b',
      oauthToken: null,
      apiKey: null,
      endpoint: 'http://localhost:11434'
    }
    const adapter = new OpenAIChatAdapter(() => localConfig, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput())
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })
})
