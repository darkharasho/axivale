import type { AgentEvent, ProviderAdapter, ProviderConfig, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool } from './toolSchema'
import { sseData } from './sse'

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/** Hard ceiling on model→tools round-trips per turn; weak models can loop forever. */
const MAX_TOOL_ROUNDS = 25

/**
 * Adapter for the OpenAI Chat Completions API and any OpenAI-compatible
 * local server (Ollama, LM Studio, llama.cpp server).
 */
export class OpenAIChatAdapter implements ProviderAdapter {
  /** Grows unbounded across turns; re-sent whole each request (fine at chat scale). reset() clears. */
  private history: ChatMessage[] = []

  constructor(
    private readonly config: () => ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  reset(): void {
    this.history = []
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
    const tools = toToolSpecs(input.tools).map((s) => ({
      type: 'function' as const,
      function: { name: s.name, description: s.description, parameters: s.parameters }
    }))
    if (this.history.length === 0) this.history.push({ role: 'system', content: input.systemPrompt })
    this.history.push({ role: 'user', content: input.prompt })
    const { url, headers, model, label } = this.target()

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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
      const calls = new Map<number, { id: string; name: string; args: string }>()
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
        const outcome = parseError
          ? { text: parseError, isError: true }
          : await gateAndRunTool(input.tools, call.name, parsed, input.confirm)
        yield { kind: 'tool-result', id: call.id, isError: outcome.isError, text: outcome.text }
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
}
