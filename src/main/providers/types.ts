import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'

export interface ChartSeriesSpec {
  key: string
  label: string
  color?: string
}

/**
 * Typed rich-render payload attached to tool results by main-process tool
 * handlers. Provider-agnostic: the model only ever sees the compact JSON
 * text; the renderer receives this alongside it. Shapes are shared with the
 * AxiBridge integration — change them only in lockstep with that plan.
 */
export type DisplayPayload =
  | { kind: 'build-card'; data: { build: Record<string, unknown> } }
  | {
      kind: 'comp-card'
      data: {
        comp: Record<string, unknown>
        builds: Record<string, Record<string, unknown>>
      }
    }
  | {
      kind: 'chart'
      data: {
        type: 'line' | 'bar' | 'area'
        title: string
        xKey: string
        series: ChartSeriesSpec[]
        rows: Array<Record<string, string | number>>
      }
    }
  | {
      kind: 'table'
      data: {
        title?: string
        columns: Array<{ key: string; label: string }>
        rows: Array<Record<string, string | number>>
      }
    }

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string; display?: DisplayPayload }
  | { kind: 'done'; sessionId: string | null; error: string | null }

export const MCP_PREFIX = 'mcp__officer__'

export type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'

/** Snapshot of everything an adapter needs from settings — read fresh each turn. */
export interface ProviderConfig {
  provider: ProviderName
  /** Model id/alias from settings; null/'' = provider default. */
  model: string | null
  /** Claude Code OAuth token (claude provider only). */
  oauthToken: string | null
  /** Active API key (gemini/openai providers only). */
  apiKey: string | null
  /** Local server base url, e.g. http://localhost:11434 (local provider only). */
  endpoint: string | null
}

export interface TurnInput {
  prompt: string
  systemPrompt: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Array<SdkMcpToolDefinition<any>>
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  signal: AbortSignal
}

export interface ProviderAdapter {
  /** Streams renderer events for one user turn. Throws on provider errors;
   *  AgentService catches and emits the final done event. */
  runTurn(input: TurnInput): AsyncGenerator<AgentEvent>
  /** Clears conversation state (new conversation). */
  reset(): void
}
