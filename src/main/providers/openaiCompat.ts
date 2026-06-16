import type { AgentEvent, ProviderAdapter, ProviderConfig, SessionState, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool, type ToolOutcome } from './toolSchema'
import { sseData } from './sse'

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: unknown } }
type CallSlot = { id: string; name: string; args: string }

/** Hard ceiling on model→tools round-trips per turn; weak models can loop forever. */
const MAX_TOOL_ROUNDS = 25

/**
 * Context window we ask Ollama for. Ollama's default num_ctx of 4096 silently
 * truncates the local payload (lean system prompt + curated tool schemas),
 * dropping tool definitions so the model answers with no tools. 8192 holds the
 * lean local payload plus several tool rounds, while keeping the KV cache small
 * enough to leave VRAM for model layers on the GPU (larger windows force more
 * of the model onto CPU and slow generation badly).
 */
const OLLAMA_NUM_CTX = 8192

/** Translate our OpenAI-shaped history into Ollama's native /api/chat messages.
 *  Native wants tool-call arguments as objects and tool replies without an id
 *  (it matches them positionally). */
function toNativeMessages(history: ChatMessage[]): unknown[] {
  return history.map((m) => {
    if (m.role === 'assistant') {
      const out: { role: 'assistant'; content: string; tool_calls?: unknown[] } = {
        role: 'assistant',
        content: m.content ?? ''
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        out.tool_calls = m.tool_calls.map((tc) => ({
          function: { name: tc.function.name, arguments: safeParseObject(tc.function.arguments) }
        }))
      }
      return out
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content }
    return { role: m.role, content: m.content }
  })
}

function safeParseObject(s: string): Record<string, unknown> {
  try {
    return s.trim() ? (JSON.parse(s) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Yields newline-delimited JSON lines from a streaming body (Ollama native). */
async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) yield line
      }
    }
    const tail = buf.trim()
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}

/**
 * Adapter for the OpenAI Chat Completions API and any OpenAI-compatible
 * local server. For the local provider it prefers Ollama's native /api/chat
 * (so it can set num_ctx); a 404 there means a non-Ollama server (LM Studio,
 * llama.cpp) and it permanently falls back to the OpenAI-compatible path.
 */
export class OpenAIChatAdapter implements ProviderAdapter {
  /** Grows unbounded across turns; re-sent whole each request (fine at chat scale). reset() clears. */
  private history: ChatMessage[] = []
  /** For local: try Ollama native first; flipped off on a 404 from /api/chat. */
  private localNative = true
  /** Per-model: does it expose the "thinking" capability? (cached /api/show probe) */
  private thinks = new Map<string, boolean>()

  constructor(
    private readonly config: () => ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  reset(): void {
    this.history = []
  }

  serializeSession(): SessionState {
    return { history: [...this.history] }
  }

  restoreSession(state: SessionState): void {
    this.history = Array.isArray(state.history) ? (state.history as ChatMessage[]) : []
  }

  private target(): { url: string; headers: Record<string, string>; model: string; label: string } {
    const cfg = this.config()
    if (cfg.provider === 'local') {
      const base = (cfg.endpoint || 'http://localhost:11434').replace(/\/+$/, '')
      return {
        url: `${base}/v1/chat/completions`,
        headers: {},
        model: cfg.model || 'qwen3:8b',
        label: 'Local model'
      }
    }
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      model: cfg.model || 'gpt-5.4',
      label: 'OpenAI'
    }
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    // Snapshot history length so we can roll back on any throw, keeping history consistent.
    const historyMark = this.history.length
    try {
      yield* this._runTurnInner(input)
    } catch (err) {
      // Truncate any messages appended during the failed turn before rethrowing.
      this.history.length = historyMark
      throw err
    }
  }

  private async *_runTurnInner(input: TurnInput): AsyncGenerator<AgentEvent> {
    const tools: ToolSpec[] = toToolSpecs(input.tools).map((s) => ({
      type: 'function' as const,
      function: { name: s.name, description: s.description, parameters: s.parameters }
    }))
    if (this.history.length === 0) this.history.push({ role: 'system', content: input.systemPrompt })
    this.history.push({ role: 'user', content: input.prompt })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const useNative = this.config().provider === 'local' && this.localNative
      const { text, calls } = useNative
        ? yield* this.streamOllamaNative(input, tools)
        : yield* this.streamOpenAI(input, tools)

      if (calls.size === 0) {
        this.history.push({ role: 'assistant', content: text })
        yield { kind: 'done', sessionId: null, error: null }
        return
      }

      const ordered = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, c], i) => ({ ...c, id: c.id || `call_r${round}_${i}` }))
      this.history.push({
        role: 'assistant',
        content: text || null,
        tool_calls: ordered.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.args }
        }))
      })

      for (const call of ordered) {
        // Honour abort before starting each tool; history rollback in runTurn keeps things consistent.
        if (input.signal.aborted) throw new Error('Turn cancelled')
        let parsed: Record<string, unknown> = {}
        let parseError: string | null = null
        if (call.args.trim()) {
          try {
            parsed = JSON.parse(call.args) as Record<string, unknown>
          } catch (err) {
            parseError = `Invalid JSON in tool arguments: ${err instanceof Error ? err.message : String(err)}`
          }
        }
        yield { kind: 'tool-start', id: call.id, name: call.name, input: parsed }
        const outcome: ToolOutcome = parseError
          ? { text: parseError, isError: true }
          : await gateAndRunTool(input.tools, call.name, parsed, input.confirm)
        yield {
          kind: 'tool-result',
          id: call.id,
          isError: outcome.isError,
          text: outcome.text,
          ...(outcome.display ? { display: outcome.display } : {})
        }
        this.history.push({ role: 'tool', tool_call_id: call.id, content: outcome.text })
      }
      // Paragraph break so post-tool prose doesn't concatenate mid-word
      // (mirrors the Claude translator's content_block_start behavior).
      yield { kind: 'text-delta', text: '\n\n' }
    }
    yield {
      kind: 'done',
      sessionId: null,
      error: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds — the model may be stuck in a loop.`
    }
  }

  /** One model round over the OpenAI Chat Completions SSE protocol. */
  private async *streamOpenAI(
    input: TurnInput,
    tools: ToolSpec[]
  ): AsyncGenerator<AgentEvent, { text: string; calls: Map<number, CallSlot> }> {
    const { url, headers, model, label } = this.target()
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      signal: input.signal,
      body: JSON.stringify({ model, stream: true, messages: this.history, tools })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`${label} request failed (${res.status}): ${detail.slice(0, 300)}`)
    }
    if (!res.body) throw new Error(`${label} returned no response body`)

    let text = ''
    const calls = new Map<number, CallSlot>()
    for await (const data of sseData(res.body)) {
      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
          }
        }>
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      // Only choices[0] is read; n>1 is never requested so other choices are absent.
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        yield { kind: 'text-delta', text: delta.content }
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = calls.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
        calls.set(tc.index, slot)
      }
    }
    return { text, calls }
  }

  /** Whether an Ollama model advertises the "thinking" capability (cached).
   *  Defaults to false on any probe failure so we never send an unsupported
   *  `think` field. */
  private async supportsThinking(base: string, model: string): Promise<boolean> {
    const cached = this.thinks.get(model)
    if (cached !== undefined) return cached
    let result = false
    try {
      const res = await this.fetchFn(`${base}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model })
      })
      if (res.ok) {
        const data = (await res.json()) as { capabilities?: unknown }
        result = Array.isArray(data.capabilities) && data.capabilities.includes('thinking')
      }
    } catch {
      result = false
    }
    this.thinks.set(model, result)
    return result
  }

  /** One model round over Ollama's native /api/chat (NDJSON), with num_ctx set
   *  so the full tool payload isn't truncated. Falls back to the OpenAI path on
   *  a 404 (server isn't Ollama). */
  private async *streamOllamaNative(
    input: TurnInput,
    tools: ToolSpec[]
  ): AsyncGenerator<AgentEvent, { text: string; calls: Map<number, CallSlot> }> {
    const cfg = this.config()
    const base = (cfg.endpoint || 'http://localhost:11434').replace(/\/+$/, '')
    const model = cfg.model || 'qwen3:8b'
    // Thinking models (qwen3, deepseek-r1, …) otherwise spend the whole turn on
    // hidden reasoning and return empty content — disable it so they answer (or
    // call a tool) directly. Only valid on models that advertise the capability.
    const thinkOff = (await this.supportsThinking(base, model)) ? { think: false } : {}
    const res = await this.fetchFn(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        model,
        stream: true,
        messages: toNativeMessages(this.history),
        tools,
        options: { num_ctx: OLLAMA_NUM_CTX },
        ...thinkOff
      })
    })
    if (res.status === 404) {
      // Not an Ollama server (LM Studio, llama.cpp, …) — switch to the
      // OpenAI-compatible path for this and all later rounds.
      this.localNative = false
      return yield* this.streamOpenAI(input, tools)
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Local model request failed (${res.status}): ${detail.slice(0, 300)}`)
    }
    if (!res.body) throw new Error('Local model returned no response body')

    let text = ''
    const calls = new Map<number, CallSlot>()
    for await (const line of ndjsonLines(res.body)) {
      let obj: {
        message?: {
          content?: string
          tool_calls?: Array<{
            id?: string
            function?: { index?: number; name?: string; arguments?: unknown }
          }>
        }
        done?: boolean
      }
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const msg = obj.message
      if (typeof msg?.content === 'string' && msg.content) {
        text += msg.content
        yield { kind: 'text-delta', text: msg.content }
      }
      for (const tc of msg?.tool_calls ?? []) {
        const idx = typeof tc.function?.index === 'number' ? tc.function.index : calls.size
        const slot = calls.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) slot.id = tc.id
        // Native sends each tool call whole (name + arguments object), not deltas.
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments !== undefined) {
          slot.args =
            typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments)
        }
        calls.set(idx, slot)
      }
      if (obj.done) break
    }
    return { text, calls }
  }
}
