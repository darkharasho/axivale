// src/main/meta/__evals__/agent/types.ts
import type { ProviderName } from '../../../providers/types'

export interface ToolCallMatcher {
  name: string
  /** Recursive subset match against the tool-start input (omit args you don't care about). */
  args?: Record<string, unknown>
}

export interface AgentEvalCase {
  name: string
  prompt: string
  provider?: ProviderName
  model?: string
  mustCall?: ToolCallMatcher[]
  mustNotCall?: ToolCallMatcher[]
  rubric: string
}

export interface ToolCallRecord {
  name: string
  input: Record<string, unknown>
  isError: boolean
  resultText: string
}

export interface TurnTrace {
  answer: string
  toolCalls: ToolCallRecord[]
  error: string | null
}

export interface JudgeInput {
  prompt: string
  answer: string
  toolCalls: ToolCallRecord[]
  rubric: string
}

export interface JudgeVerdict {
  pass: boolean
  score: number
  reasoning: string
}
