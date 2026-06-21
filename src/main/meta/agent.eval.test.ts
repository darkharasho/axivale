// src/main/meta/agent.eval.test.ts
import { describe, it, expect } from 'vitest'
import { AGENT_EVAL_CASES } from './__evals__/agent/cases'
import { runAgentTurn } from './__evals__/agent/runAgentTurn'
import { gradeToolTrace } from './__evals__/agent/toolTrace'
import { judgeAnswer } from './__evals__/agent/judge'
import { evalMode } from './__evals__/harness'
import type { AgentEvalCase } from './__evals__/agent/types'
import type { TurnTrace } from './__evals__/agent/types'
import type { ToolTraceResult } from './__evals__/agent/toolTrace'
import type { JudgeVerdict } from './__evals__/agent/types'

const live = evalMode() === 'live'

function formatFailure(c: AgentEvalCase, tt: ToolTraceResult, v: JudgeVerdict, trace: TurnTrace): string {
  const lines = [`case "${c.name}" failed:`]
  if (!tt.passed) lines.push(`  tool-trace: ${tt.failures.join('; ')}`)
  if (!v.pass) lines.push(`  judge (score ${v.score}): ${v.reasoning}`)
  lines.push(`  calls: ${trace.toolCalls.map((t) => t.name).join(', ') || '(none)'}`)
  if (trace.error) lines.push(`  turn error: ${trace.error}`)
  return lines.join('\n')
}

describe('agent live evals', () => {
  // Live-only: these drive real turns + a real judge against the operator's
  // AxiBridge data. Skipped in normal CI (replay mode); run via `npm run eval`.
  for (const c of AGENT_EVAL_CASES) {
    it.runIf(live)(
      c.name,
      async () => {
        const trace = await runAgentTurn(c)
        const tt = gradeToolTrace(trace, c)
        const verdict: JudgeVerdict = trace.error
          ? { pass: false, score: 0, reasoning: `turn errored: ${trace.error}` }
          : await judgeAnswer({ prompt: c.prompt, answer: trace.answer, toolCalls: trace.toolCalls, rubric: c.rubric })
        expect(tt.passed && verdict.pass, formatFailure(c, tt, verdict, trace)).toBe(true)
      },
      120_000
    )
  }
})
