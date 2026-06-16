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

/** Ollama native /api/chat stream: newline-delimited JSON objects. */
function ndjsonBody(objects: unknown[]): Response {
  const payload = objects.map((o) => JSON.stringify(o)).join('\n') + '\n'
  return new Response(payload, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

function showBody(capabilities: string[]): Response {
  return new Response(JSON.stringify({ capabilities }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

/** Routes the adapter's local requests by path: /api/show (capabilities),
 *  /api/chat (native rounds), and /v1/... (OpenAI-compat fallback). */
function routedFetch(routes: { caps?: string[]; chat?: Response[]; v1?: Response[] }) {
  let chatI = 0
  let v1I = 0
  const pick = (arr: Response[] | undefined, i: number): Response =>
    arr && arr.length ? arr[Math.min(i, arr.length - 1)] : new Response('', { status: 200 })
  return vi.fn(async (url: unknown, _init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/show')) return showBody(routes.caps ?? [])
    if (u.includes('/api/chat')) return pick(routes.chat, chatI++)
    return pick(routes.v1, v1I++)
  })
}

const localConfig: ProviderConfig = {
  provider: 'local',
  model: 'qwen3:8b',
  oauthToken: null,
  apiKey: null,
  endpoint: 'http://localhost:11434'
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

  it('rolls back history when a fetch rejects, so the next turn starts clean', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(
        sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
      )
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    // First turn should reject
    await expect(collect(adapter, turnInput())).rejects.toThrow('network error')
    // Second turn succeeds; history must only have system + user (no dirty messages from failed turn)
    await collect(adapter, turnInput())
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
  })

  it('aborts mid-loop when signal is already aborted and rolls back history', async () => {
    const ac = new AbortController()
    ac.abort()
    // fetchFn returns a tool_calls round — the abort check fires before gateAndRunTool
    const fetchFn = vi.fn().mockResolvedValueOnce(
      sseBody([
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_x', function: { name: 'echo_tool', arguments: '{"message":"x"}' } }]
              },
              finish_reason: 'tool_calls'
            }
          ]
        }
      ])
    )
    const freshFetch = vi
      .fn()
      .mockResolvedValueOnce(sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    // The aborted-signal turn should reject
    await expect(collect(adapter, turnInput({ signal: ac.signal }))).rejects.toThrow('Turn cancelled')
    // Swap in a clean fetchFn; the adapter should have rolled back history
    const adapter2 = new OpenAIChatAdapter(() => openaiConfig, freshFetch as unknown as typeof fetch)
    // Copy history state by re-using same adapter — reset it would defeat the point;
    // instead verify via a new collect on the same adapter instance with a live signal.
    ;(adapter as unknown as { fetchFn: typeof fetch }).fetchFn = freshFetch as unknown as typeof fetch
    await collect(adapter, turnInput())
    const body = JSON.parse((freshFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
    void adapter2
  })

  it('uses Ollama native /api/chat with num_ctx for the local provider', async () => {
    const fetchFn = routedFetch({
      caps: ['completion', 'tools', 'thinking'],
      chat: [ndjsonBody([{ message: { role: 'assistant', content: 'ok' }, done: true }])]
    })
    const adapter = new OpenAIChatAdapter(() => localConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toContainEqual({ kind: 'text-delta', text: 'ok' })
    const chatCall = fetchFn.mock.calls.find((c) => String(c[0]).endsWith('/api/chat'))!
    expect(chatCall[0]).toBe('http://localhost:11434/api/chat')
    const body = JSON.parse((chatCall[1] as RequestInit).body as string)
    expect(body.options.num_ctx).toBe(8192)
    expect(body.tools[0].function.name).toBe('echo_tool')
    // qwen-style model advertises thinking → we turn it off.
    expect(body.think).toBe(false)
  })

  it('omits the think flag for models without the thinking capability', async () => {
    const fetchFn = routedFetch({
      caps: ['completion', 'tools'],
      chat: [ndjsonBody([{ message: { role: 'assistant', content: 'ok' }, done: true }])]
    })
    const adapter = new OpenAIChatAdapter(() => localConfig, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput())
    const chatCall = fetchFn.mock.calls.find((c) => String(c[0]).endsWith('/api/chat'))!
    const body = JSON.parse((chatCall[1] as RequestInit).body as string)
    expect('think' in body).toBe(false)
  })

  it('parses a native tool call (arguments as an object) and loops back', async () => {
    const fetchFn = routedFetch({
      caps: ['completion', 'tools', 'thinking'],
      chat: [
        ndjsonBody([
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { index: 0, name: 'echo_tool', arguments: { message: 'hi' } } }]
            },
            done: false
          },
          { message: { role: 'assistant', content: '' }, done: true }
        ]),
        ndjsonBody([{ message: { role: 'assistant', content: 'done!' }, done: true }])
      ]
    })
    const adapter = new OpenAIChatAdapter(() => localConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toContainEqual({
      kind: 'tool-start',
      id: 'call_r0_0',
      name: 'echo_tool',
      input: { message: 'hi' }
    })
    expect(events).toContainEqual({ kind: 'tool-result', id: 'call_r0_0', isError: false, text: 'echo:hi' })
    // Native follow-up request translates the assistant tool_calls + tool reply.
    const chatCalls = fetchFn.mock.calls.filter((c) => String(c[0]).endsWith('/api/chat'))
    const second = JSON.parse((chatCalls[1][1] as RequestInit).body as string)
    const roles = second.messages.map((m: { role: string }) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
    const asst = second.messages[2]
    expect(asst.tool_calls[0].function.arguments).toEqual({ message: 'hi' })
    expect(second.messages[3].tool_call_id).toBeUndefined()
  })

  it('falls back to the OpenAI-compatible path when /api/chat 404s (non-Ollama local)', async () => {
    const fetchFn = routedFetch({
      caps: [],
      chat: [new Response('not found', { status: 404 })],
      v1: [
        sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
        sseBody([{ choices: [{ delta: { content: 'two' }, finish_reason: 'stop' }] }])
      ]
    })
    const adapter = new OpenAIChatAdapter(() => localConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toContainEqual({ kind: 'text-delta', text: 'ok' })
    expect(fetchFn.mock.calls.some((c) => String(c[0]).endsWith('/api/chat'))).toBe(true)
    expect(fetchFn.mock.calls.some((c) => String(c[0]).endsWith('/v1/chat/completions'))).toBe(true)
    // A second turn skips the native attempt entirely (fallback is sticky).
    await collect(adapter, turnInput({ prompt: 'again' }))
    const lastUrl = String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0])
    expect(lastUrl).toBe('http://localhost:11434/v1/chat/completions')
  })
})

describe('OpenAIChatAdapter session', () => {
  const sessionConfig = (): ProviderConfig => ({
    provider: 'openai',
    model: null,
    oauthToken: null,
    apiKey: 'k',
    endpoint: null
  })

  it('round-trips message history', () => {
    const a = new OpenAIChatAdapter(sessionConfig)
    const history = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' }
    ]
    a.restoreSession({ history })
    expect(a.serializeSession()).toEqual({ history })
  })

  it('serializes empty history before any turn', () => {
    expect(new OpenAIChatAdapter(sessionConfig).serializeSession()).toEqual({ history: [] })
  })

  it('reset clears the restored history', () => {
    const a = new OpenAIChatAdapter(sessionConfig)
    a.restoreSession({ history: [{ role: 'user', content: 'hi' }] })
    a.reset()
    expect(a.serializeSession()).toEqual({ history: [] })
  })
})
