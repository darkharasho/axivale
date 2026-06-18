import type { AgentEvent } from './types'

/**
 * Minimal shape of the events emitted by @openai/codex-sdk's `runStreamed`.
 * We only model the fields we translate; the SDK's full ThreadEvent union is
 * wider. Kept local so this module is pure and unit-testable without the SDK.
 */
export type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: unknown }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.updated'; item: CodexItem }
  | { type: 'item.completed'; item: CodexItem }
  | { type: 'error'; message: string }
  | { type: string; [k: string]: unknown }

type CodexItem =
  | { id: string; type: 'agent_message'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | { id: string; type: 'mcp_tool_call'; server: string; tool: string; status: string }
  | { id: string; type: string; [k: string]: unknown }

/**
 * Translates one Codex thread event into zero or more renderer-facing events.
 *
 * Pure function — the adapter handles the stateful bits (capturing thread_id,
 * stamping the real session id onto the `done` event, and interleaving the
 * tool-start/tool-result events that come from the officer IPC bridge rather
 * than from Codex itself). Codex's own `mcp_tool_call` items are intentionally
 * dropped: the bridge is the single source of truth for tool UI, since only it
 * carries our `confirm` gate and `display` payloads.
 */
export function translateCodexEvent(ev: CodexThreadEvent): AgentEvent[] {
  switch (ev.type) {
    case 'item.completed': {
      const item = (ev as { item: CodexItem }).item
      // Assistant prose. Prefix a paragraph break so segments before/after tool
      // calls don't concatenate mid-word (mirrors the Claude/OpenAI adapters);
      // the renderer trims a leading break.
      if (item.type === 'agent_message') {
        return [{ kind: 'text-delta', text: '\n\n' + ((item as { text?: string }).text ?? '') }]
      }
      return []
    }
    case 'turn.completed':
      return [{ kind: 'done', sessionId: null, error: null }]
    case 'turn.failed':
      return [
        { kind: 'done', sessionId: null, error: (ev as { error?: { message?: string } }).error?.message ?? 'Codex turn failed' }
      ]
    case 'error':
      return [{ kind: 'done', sessionId: null, error: (ev as { message?: string }).message ?? 'Codex error' }]
    default:
      return []
  }
}
