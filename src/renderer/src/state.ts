export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  resultText?: string
  isError?: boolean
}

export interface Turn {
  id: number
  userText: string
  agentText: string
  tools: ToolCall[]
  done: boolean
  error: string | null
  filedAt: string
}

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
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
          t.id === event.id ? { ...t, resultText: event.text, isError: event.isError } : t
        )
      }
    case 'done':
      return { ...turn, done: true, error: event.error }
  }
}
