import type { AgentEvent } from './types'

/**
 * Minimal shape of the NDJSON events the Gemini CLI emits with
 * `-o stream-json`. Only the fields we translate are modelled.
 */
export type GeminiStreamEvent =
  | { type: 'init'; session_id: string; model: string }
  | { type: 'message'; role: 'user' | 'assistant'; content: string; delta?: boolean }
  | { type: 'tool_use'; tool_name: string; tool_id: string; parameters: unknown }
  | { type: 'tool_result'; tool_id: string; status: string; output: string }
  | { type: 'result'; status: string; error?: string; stats?: unknown }
  | { type: string; [k: string]: unknown }

/**
 * Translates one Gemini CLI stream-json event into renderer-facing events.
 *
 * Pure — the adapter captures the session id (from `init`) and stamps it onto
 * the `done` event. Gemini's own `tool_use`/`tool_result` events are dropped:
 * the officer IPC bridge is the single source of truth for tool UI (it carries
 * our confirm gate + display payloads), and suppressing them also hides
 * Gemini's internal tools (e.g. update_topic) from the transcript.
 */
export function translateGeminiEvent(ev: GeminiStreamEvent): AgentEvent[] {
  switch (ev.type) {
    case 'message': {
      const m = ev as { role?: string; content?: string }
      if (m.role !== 'assistant') return []
      return [{ kind: 'text-delta', text: m.content ?? '' }]
    }
    case 'result': {
      const r = ev as { status?: string; error?: string }
      return [
        {
          kind: 'done',
          sessionId: null,
          error: r.status === 'success' ? null : r.error ?? `Gemini turn ${r.status ?? 'failed'}`
        }
      ]
    }
    default:
      return []
  }
}
