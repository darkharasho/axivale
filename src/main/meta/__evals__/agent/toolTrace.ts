// src/main/meta/__evals__/agent/toolTrace.ts
import type { TurnTrace, AgentEvalCase, ToolCallMatcher, ToolCallRecord } from './types'

export interface ToolTraceResult {
  passed: boolean
  failures: string[]
}

/**
 * True when every key in `want` is present in `got` with a matching value.
 * Strings compare case-insensitively; plain objects recurse; numbers/booleans
 * compare strictly. Array-valued matcher args fall to the strict branch and so
 * only match by reference — array matchers are intentionally NOT supported.
 */
function subsetMatch(want: Record<string, unknown>, got: Record<string, unknown>): boolean {
  for (const [k, wv] of Object.entries(want)) {
    const gv = got[k]
    if (typeof wv === 'string') {
      if (typeof gv !== 'string' || gv.toLowerCase() !== wv.toLowerCase()) return false
    } else if (wv !== null && typeof wv === 'object' && !Array.isArray(wv)) {
      if (gv === null || typeof gv !== 'object' || Array.isArray(gv)) return false
      if (!subsetMatch(wv as Record<string, unknown>, gv as Record<string, unknown>)) return false
    } else {
      if (gv !== wv) return false
    }
  }
  return true
}

function matches(m: ToolCallMatcher, call: ToolCallRecord): boolean {
  if (call.name !== m.name) return false
  if (!m.args) return true
  return subsetMatch(m.args, call.input)
}

function describeMatcher(m: ToolCallMatcher): string {
  return m.args ? `${m.name}(${JSON.stringify(m.args)})` : m.name
}

export function gradeToolTrace(trace: TurnTrace, c: AgentEvalCase): ToolTraceResult {
  const failures: string[] = []
  const seen = trace.toolCalls.map((t) => t.name).join(', ') || '(none)'

  for (const m of c.mustCall ?? []) {
    if (!trace.toolCalls.some((call) => matches(m, call))) {
      failures.push(`expected a call to ${describeMatcher(m)} but it was not found; calls seen: ${seen}`)
    }
  }
  for (const m of c.mustNotCall ?? []) {
    if (trace.toolCalls.some((call) => matches(m, call))) {
      failures.push(`should not have called ${describeMatcher(m)} but it was called`)
    }
  }
  return { passed: failures.length === 0, failures }
}
