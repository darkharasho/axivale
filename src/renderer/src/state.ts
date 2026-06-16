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
 *
 * Duplicated from src/main/providers/types.ts by design — the renderer
 * never imports from src/main.
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
  | { kind: 'code'; data: { title?: string; text: string } }
  | {
      kind: 'comp-sketch'
      data: {
        title?: string
        subtitle?: string
        // Each subgroup is a party of slots; drives the icon grid. Optional —
        // an aggregate comp may have only per-build counts and no fixed slots.
        subgroups?: Array<Array<{ spec: string; role: string }>>
        // The per-build detail list under the grid.
        builds: Array<{ spec: string; role: string; count?: number; weapons?: string; note?: string }>
      }
    }

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  resultText?: string
  isError?: boolean
  display?: DisplayPayload
}

export interface Turn {
  id: number
  userText: string
  agentText: string
  tools: ToolCall[]
  done: boolean
  error: string | null
  filedAt: string
  /** Skill explicitly applied to this turn (auto-matched skills are detected from the load_skill tool call). */
  skill?: string
}

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string; display?: DisplayPayload }
  | { kind: 'done'; sessionId: string | null; error: string | null }

export function applyEvent(turn: Turn, event: AgentEvent): Turn {
  switch (event.kind) {
    case 'text-delta':
      return { ...turn, agentText: turn.agentText + event.text }
    case 'tool-start':
      return { ...turn, tools: [...turn.tools, { id: event.id, name: event.name, input: event.input }] }
    case 'tool-result':
      return {
        ...turn,
        tools: turn.tools.map((t) =>
          t.id === event.id
            ? { ...t, resultText: event.text, isError: event.isError, display: event.display }
            : t
        )
      }
    case 'done':
      return { ...turn, done: true, error: event.error }
  }
}
