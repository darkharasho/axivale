import type { AgentEvent, ProviderAdapter, ProviderConfig, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool } from './toolSchema'
import { sseData } from './sse'

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/** Hard ceiling on model→tools round-trips per turn; weak models can loop forever. */
const MAX_TOOL_ROUNDS = 25

/** Keys Gemini's OpenAPI-flavored schema accepts; everything else is dropped. */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'nullable',
  'anyOf',
  'minimum',
  'maximum',
  'minItems',
  'maxItems'
])

export function sanitizeForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        props[name] = sanitizeForGemini(sub as Record<string, unknown>)
      }
      out.properties = props
    } else if ((key === 'items' || key === 'anyOf') && value && typeof value === 'object') {
      out[key] = Array.isArray(value)
        ? value.map((v) => sanitizeForGemini(v as Record<string, unknown>))
        : sanitizeForGemini(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Adapter for the Google Gemini GenerateContent API (SSE streaming).
 * History grows unbounded across turns; re-sent whole each request (fine at chat scale). reset() clears.
 */
export class GeminiAdapter implements ProviderAdapter {
  private history: GeminiContent[] = []
  // callSeq is NOT rolled back on abort/throw — ids just keep incrementing; harmless.
  private callSeq = 0

  constructor(
    private readonly config: () => ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  reset(): void {
    this.history = []
    this.callSeq = 0
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
    const cfg = this.config()
    const model = cfg.model || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
    const tools = [
      {
        functionDeclarations: toToolSpecs(input.tools).map((s) => ({
          name: s.name,
          description: s.description,
          parameters: sanitizeForGemini(s.parameters)
        }))
      }
    ]
    this.history.push({ role: 'user', parts: [{ text: input.prompt }] })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey ?? '' },
        signal: input.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: this.history,
          tools
        })
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Gemini request failed (${res.status}): ${detail.slice(0, 300)}`)
      }
      if (!res.body) throw new Error('Gemini returned no response body')

      const modelParts: GeminiPart[] = []
      const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
      for await (const data of sseData(res.body)) {
        let chunk: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        // Only candidates[0] is read; Gemini candidate count > 1 is never requested.
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) {
            modelParts.push({ text: part.text })
            yield { kind: 'text-delta', text: part.text }
          }
          if (part.functionCall) {
            modelParts.push({ functionCall: part.functionCall })
            calls.push({
              id: `gcall_${this.callSeq++}`, // Gemini calls carry no id; synthesize for the UI
              name: part.functionCall.name,
              args: part.functionCall.args ?? {}
            })
          }
        }
      }
      this.history.push({ role: 'model', parts: modelParts.length > 0 ? modelParts : [{ text: '' }] })

      if (calls.length === 0) {
        yield { kind: 'done', sessionId: null, error: null }
        return
      }

      const responses: GeminiPart[] = []
      for (const call of calls) {
        // Honour abort before starting each tool; history rollback in runTurn keeps things consistent.
        if (input.signal.aborted) throw new Error('Turn cancelled')
        yield { kind: 'tool-start', id: call.id, name: call.name, input: call.args }
        const outcome = await gateAndRunTool(input.tools, call.name, call.args, input.confirm)
        yield { kind: 'tool-result', id: call.id, isError: outcome.isError, text: outcome.text }
        responses.push({
          functionResponse: {
            name: call.name,
            response: outcome.isError ? { error: outcome.text } : { result: outcome.text }
          }
        })
      }
      this.history.push({ role: 'user', parts: responses })
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
