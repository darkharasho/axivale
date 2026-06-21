# Live-turn LLM-judge agent eval harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive real, headless agent turns against configurable prompt cases and grade each with deterministic tool-trace assertions plus an LLM-as-judge on the answer.

**Architecture:** A new eval group under `src/main/meta/__evals__/agent/` reusing the existing eval harness (`EVAL_LIVE` gating, `resolveLiveConfig`, `runClaudeOnce`). `runAgentTurn` builds a headless `AgentService` with a real `AxibridgeService` and stubbed other tool groups, runs `AgentService.runTurn`, and folds the `AgentEvent` stream into a `TurnTrace`. Two gates grade each case: `gradeToolTrace` (deterministic matchers) and `judgeAnswer` (LLM judge → JSON verdict). Live cases run only under `npm run eval`; the pure pieces have ordinary CI unit tests.

**Tech Stack:** TypeScript (Node ESM), vitest, `@anthropic-ai/claude-agent-sdk` (`query()` via `runClaudeOnce`). Reuses `AgentService` (`src/main/agent.ts`), `ToolDeps` (`src/main/tools/shared.ts`), `AxibridgeService`, and `resolveLiveConfig` (`src/main/meta/__evals__/liveModel.ts`).

## Global Constraints

- Run vitest with `--maxWorkers=2` (machine memory). Single file: `npx vitest run <file> --maxWorkers=2`.
- Do NOT run `npm install` — a dev-linked dependency would be clobbered.
- Verification must include `npm run typecheck` (vitest/esbuild does not type-check).
- Agent (live) cases run ONLY when `evalMode() === 'live'` (i.e. `EVAL_LIVE=1` / `npm run eval`). They must be SKIPPED in normal `npm test`, never failing CI.
- Pure units (`toolTrace`, `judge` parsing, turn-folding) MUST have unit tests that run in normal CI with NO live model call (inject fakes).
- A case passes iff `toolTrace.passed && judge.pass`. Judge output unparseable after one retry → case FAILS (never a silent pass).
- The harness's non-axibridge tool stubs must not throw at construction; tool calls into them may return an error result (caught by the tools' own `safe()` wrapper), which is acceptable.
- The existing eval glob is `src/main/meta/*.eval.test.ts` — the new live runner must live at `src/main/meta/agent.eval.test.ts` so `npm run eval` discovers it.

---

## File Structure

- `src/main/meta/__evals__/agent/types.ts` — **new.** Pure shared interfaces (`ToolCallMatcher`, `AgentEvalCase`, `ToolCallRecord`, `TurnTrace`, `JudgeInput`, `JudgeVerdict`). Zero runtime imports, so the pure unit tests never load the agent.
- `src/main/meta/__evals__/agent/cases.ts` — **new.** `AGENT_EVAL_CASES: AgentEvalCase[]` (the configurable input + seed cases).
- `src/main/meta/__evals__/agent/toolTrace.ts` — **new.** `gradeToolTrace`.
- `src/main/meta/__evals__/agent/judge.ts` — **new.** `judgeAnswer`, `JudgeUnparseableError`, `defaultJudgeModel`.
- `src/main/meta/__evals__/agent/runAgentTurn.ts` — **new.** `buildEvalAxibridge`, `buildEvalAgentService`, `foldTurn`, `runAgentTurn`, `TurnRunner`.
- `src/main/meta/__evals__/agent/toolTrace.test.ts` — **new.** CI unit tests.
- `src/main/meta/__evals__/agent/judge.test.ts` — **new.** CI unit tests (fake model).
- `src/main/meta/__evals__/agent/runAgentTurn.test.ts` — **new.** CI unit test of `foldTurn` (fake runner).
- `src/main/meta/agent.eval.test.ts` — **new.** Live runner discovered by the eval glob.

---

## Task 1: Shared types + seed cases

**Files:**
- Create: `src/main/meta/__evals__/agent/types.ts`
- Create: `src/main/meta/__evals__/agent/cases.ts`
- Test: `src/main/meta/__evals__/agent/cases.test.ts`

**Interfaces:**
- Consumes: `ProviderName` from `src/main/providers/types`.
- Produces:
  - `interface ToolCallMatcher { name: string; args?: Record<string, unknown> }`
  - `interface AgentEvalCase { name: string; prompt: string; provider?: ProviderName; model?: string; mustCall?: ToolCallMatcher[]; mustNotCall?: ToolCallMatcher[]; rubric: string }`
  - `interface ToolCallRecord { name: string; input: Record<string, unknown>; isError: boolean; resultText: string }`
  - `interface TurnTrace { answer: string; toolCalls: ToolCallRecord[]; error: string | null }`
  - `interface JudgeInput { prompt: string; answer: string; toolCalls: ToolCallRecord[]; rubric: string }`
  - `interface JudgeVerdict { pass: boolean; score: number; reasoning: string }`
  - `const AGENT_EVAL_CASES: AgentEvalCase[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/__evals__/agent/cases.test.ts
import { describe, it, expect } from 'vitest'
import { AGENT_EVAL_CASES } from './cases'

describe('AGENT_EVAL_CASES', () => {
  it('every case has a name, prompt, and rubric, with unique names', () => {
    expect(AGENT_EVAL_CASES.length).toBeGreaterThan(0)
    const names = new Set<string>()
    for (const c of AGENT_EVAL_CASES) {
      expect(c.name, 'case name').toBeTruthy()
      expect(c.prompt, `prompt for ${c.name}`).toBeTruthy()
      expect(c.rubric, `rubric for ${c.name}`).toBeTruthy()
      expect(names.has(c.name), `duplicate case name ${c.name}`).toBe(false)
      names.add(c.name)
    }
  })

  it('the boon regression cases assert the section tool is called', () => {
    const boon = AGENT_EVAL_CASES.find((c) => c.name === 'wasted-protection')
    expect(boon?.mustCall?.some((m) => m.name === 'axibridge_section')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/agent/cases.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./cases`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

```ts
// src/main/meta/__evals__/agent/cases.ts
import type { AgentEvalCase } from './types'

/**
 * Live agent eval cases. Each runs a real turn (EVAL_LIVE=1) against the
 * operator's real AxiBridge data, then grades the tool trace + the answer.
 * Add a case by appending an object.
 */
export const AGENT_EVAL_CASES: AgentEvalCase[] = [
  {
    name: 'wasted-protection',
    prompt: 'Who wasted the most Protection last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'boons', boon: 'Protection' } }],
    rubric:
      'PASS only if the answer names specific accounts with their Protection generation/waste numbers taken from the tool result. FAIL if it invents community benchmarks or answers from class/role assumptions instead of the returned numbers.'
  },
  {
    name: 'boon-coverage-grounded',
    prompt: 'Was our boon coverage good last fight?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'boons' } }],
    rubric:
      'PASS only if the verdict is grounded in boon uptime/generation numbers from the tool result. FAIL if the judgement is inferred from the squad composition / roles without citing the returned boon figures.'
  },
  {
    name: 'stun-break-routing',
    prompt: 'Where would I find stun breaks?',
    mustCall: [{ name: 'axibridge_find' }],
    rubric: 'PASS if the answer points the user to the strips section (where stun-breaks live). FAIL otherwise.'
  },
  {
    name: 'mitigation-blocks-evades',
    prompt: 'Who blocked and evaded the most last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'damage_mitigation' } }],
    rubric: 'PASS if the answer reports per-account blocked and evaded counts from the tool result. FAIL otherwise.'
  }
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/agent/cases.test.ts --maxWorkers=2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/__evals__/agent/types.ts src/main/meta/__evals__/agent/cases.ts src/main/meta/__evals__/agent/cases.test.ts
git commit -m "feat(eval): agent eval case types + seed boon cases"
```

---

## Task 2: Tool-trace grading (gate 1)

**Files:**
- Create: `src/main/meta/__evals__/agent/toolTrace.ts`
- Test: `src/main/meta/__evals__/agent/toolTrace.test.ts`

**Interfaces:**
- Consumes: `TurnTrace`, `AgentEvalCase`, `ToolCallMatcher` from `./types`.
- Produces:
  - `interface ToolTraceResult { passed: boolean; failures: string[] }`
  - `function gradeToolTrace(trace: TurnTrace, c: AgentEvalCase): ToolTraceResult`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/__evals__/agent/toolTrace.test.ts
import { describe, it, expect } from 'vitest'
import { gradeToolTrace } from './toolTrace'
import type { TurnTrace, AgentEvalCase } from './types'

const trace = (calls: Array<{ name: string; input: Record<string, unknown> }>): TurnTrace => ({
  answer: 'x',
  toolCalls: calls.map((c) => ({ ...c, isError: false, resultText: '{}' })),
  error: null
})

describe('gradeToolTrace', () => {
  it('passes when a mustCall matcher subset-matches a call (case-insensitive strings)', () => {
    const c = { name: 't', prompt: 'p', rubric: 'r', mustCall: [{ name: 'axibridge_section', args: { section: 'boons', boon: 'Protection' } }] } as AgentEvalCase
    const res = gradeToolTrace(trace([{ name: 'axibridge_section', input: { section: 'boons', boon: 'protection', granularity: 'player' } }]), c)
    expect(res.passed).toBe(true)
    expect(res.failures).toEqual([])
  })

  it('fails a mustCall when the section arg differs, and names what was seen', () => {
    const c = { name: 't', prompt: 'p', rubric: 'r', mustCall: [{ name: 'axibridge_section', args: { section: 'boons' } }] } as AgentEvalCase
    const res = gradeToolTrace(trace([{ name: 'axibridge_section', input: { section: 'strips' } }]), c)
    expect(res.passed).toBe(false)
    expect(res.failures[0]).toMatch(/axibridge_section/)
    expect(res.failures[0]).toMatch(/section/)
  })

  it('fails when a mustNotCall matcher matches', () => {
    const c = { name: 't', prompt: 'p', rubric: 'r', mustNotCall: [{ name: 'axibridge_run_summary' }] } as AgentEvalCase
    const res = gradeToolTrace(trace([{ name: 'axibridge_run_summary', input: {} }]), c)
    expect(res.passed).toBe(false)
    expect(res.failures[0]).toMatch(/should not have called/i)
  })

  it('matches numbers strictly and nested objects recursively', () => {
    const c = { name: 't', prompt: 'p', rubric: 'r', mustCall: [{ name: 'x', args: { a: 1, nested: { b: 'Q' } } }] } as AgentEvalCase
    expect(gradeToolTrace(trace([{ name: 'x', input: { a: 1, nested: { b: 'q', c: 9 }, extra: true } }]), c).passed).toBe(true)
    expect(gradeToolTrace(trace([{ name: 'x', input: { a: 2, nested: { b: 'q' } } }]), c).passed).toBe(false)
  })

  it('passes a case with no matchers', () => {
    const c = { name: 't', prompt: 'p', rubric: 'r' } as AgentEvalCase
    expect(gradeToolTrace(trace([]), c).passed).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/agent/toolTrace.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./toolTrace`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/meta/__evals__/agent/toolTrace.ts
import type { TurnTrace, AgentEvalCase, ToolCallMatcher, ToolCallRecord } from './types'

export interface ToolTraceResult {
  passed: boolean
  failures: string[]
}

/** True when every key in `want` is present in `got` with a matching value. */
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

function describe(m: ToolCallMatcher): string {
  return m.args ? `${m.name}(${JSON.stringify(m.args)})` : m.name
}

export function gradeToolTrace(trace: TurnTrace, c: AgentEvalCase): ToolTraceResult {
  const failures: string[] = []
  const seen = trace.toolCalls.map((t) => t.name).join(', ') || '(none)'

  for (const m of c.mustCall ?? []) {
    if (!trace.toolCalls.some((call) => matches(m, call))) {
      failures.push(`expected a call to ${describe(m)} but it was not found; calls seen: ${seen}`)
    }
  }
  for (const m of c.mustNotCall ?? []) {
    if (trace.toolCalls.some((call) => matches(m, call))) {
      failures.push(`should not have called ${describe(m)} but it was called`)
    }
  }
  return { passed: failures.length === 0, failures }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/agent/toolTrace.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/__evals__/agent/toolTrace.ts src/main/meta/__evals__/agent/toolTrace.test.ts
git commit -m "feat(eval): deterministic tool-trace grading (gate 1)"
```

---

## Task 3: LLM-as-judge (gate 2)

**Files:**
- Create: `src/main/meta/__evals__/agent/judge.ts`
- Test: `src/main/meta/__evals__/agent/judge.test.ts`

**Interfaces:**
- Consumes: `JudgeInput`, `JudgeVerdict` from `./types`; `resolveLiveConfig` from `../liveModel`; `runClaudeOnce` from `../../model`.
- Produces:
  - `type JudgeModel = (prompt: string) => Promise<string>`
  - `class JudgeUnparseableError extends Error`
  - `function defaultJudgeModel(env?: NodeJS.ProcessEnv): JudgeModel`
  - `function judgeAnswer(input: JudgeInput, model?: JudgeModel): Promise<JudgeVerdict>`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/meta/__evals__/agent/judge.test.ts
import { describe, it, expect } from 'vitest'
import { judgeAnswer, JudgeUnparseableError } from './judge'
import type { JudgeInput } from './types'

const input: JudgeInput = { prompt: 'p', answer: 'a', toolCalls: [], rubric: 'r' }

describe('judgeAnswer', () => {
  it('parses a clean JSON verdict', async () => {
    const v = await judgeAnswer(input, async () => '{"pass": true, "score": 0.9, "reasoning": "good"}')
    expect(v).toEqual({ pass: true, score: 0.9, reasoning: 'good' })
  })

  it('parses JSON wrapped in code fences / prose', async () => {
    const model = async () => 'Here is my verdict:\n```json\n{"pass": false, "score": 0.2, "reasoning": "guessed"}\n```\n'
    const v = await judgeAnswer(input, model)
    expect(v.pass).toBe(false)
    expect(v.score).toBe(0.2)
  })

  it('retries once then throws JudgeUnparseableError on garbage', async () => {
    let calls = 0
    const model = async () => { calls++; return 'not json at all' }
    await expect(judgeAnswer(input, model)).rejects.toBeInstanceOf(JudgeUnparseableError)
    expect(calls).toBe(2) // initial + one retry
  })

  it('coerces a missing score to 0 and non-boolean pass to false', async () => {
    const v = await judgeAnswer(input, async () => '{"pass": "yes", "reasoning": "x"}')
    expect(v.pass).toBe(false)
    expect(v.score).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/agent/judge.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./judge`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/meta/__evals__/agent/judge.ts
import type { JudgeInput, JudgeVerdict, ToolCallRecord } from './types'
import { resolveLiveConfig } from '../liveModel'
import { runClaudeOnce } from '../../model'

export type JudgeModel = (prompt: string) => Promise<string>

export class JudgeUnparseableError extends Error {
  constructor(public readonly raw: string) {
    super(`Judge returned unparseable output: ${raw.slice(0, 200)}`)
    this.name = 'JudgeUnparseableError'
  }
}

/** Real judge model: pinned via EVAL_JUDGE_MODEL, else claude-sonnet-4-6. */
export function defaultJudgeModel(env: NodeJS.ProcessEnv = process.env): JudgeModel {
  const cfg = resolveLiveConfig(env)
  const model = env.EVAL_JUDGE_MODEL ?? 'claude-sonnet-4-6'
  return (prompt: string) => runClaudeOnce(prompt, { oauthToken: cfg.oauthToken, model })
}

function renderTrace(calls: ToolCallRecord[]): string {
  if (calls.length === 0) return '(no tools called)'
  return calls
    .map((c) => `- ${c.name}(${JSON.stringify(c.input)})${c.isError ? ' [ERROR]' : ''} -> ${c.resultText.slice(0, 400)}`)
    .join('\n')
}

function buildPrompt(input: JudgeInput): string {
  return [
    'You are grading an AI assistant\'s answer for a WvW analytics app. Be strict.',
    '',
    `USER PROMPT:\n${input.prompt}`,
    '',
    `TOOLS THE ASSISTANT CALLED:\n${renderTrace(input.toolCalls)}`,
    '',
    `ASSISTANT ANSWER:\n${input.answer}`,
    '',
    `GRADING RUBRIC:\n${input.rubric}`,
    '',
    'Respond with ONLY a JSON object, no prose, no code fences:',
    '{"pass": <boolean>, "score": <number 0..1>, "reasoning": "<one or two sentences>"}'
  ].join('\n')
}

/** Extract the first balanced {...} JSON object from a model response. */
function extractJson(raw: string): JudgeVerdict | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    return {
      pass: obj.pass === true,
      score: typeof obj.score === 'number' ? obj.score : 0,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : ''
    }
  } catch {
    return null
  }
}

export async function judgeAnswer(input: JudgeInput, model: JudgeModel = defaultJudgeModel()): Promise<JudgeVerdict> {
  const prompt = buildPrompt(input)
  const first = await model(prompt)
  const parsed = extractJson(first)
  if (parsed) return parsed
  const retry = await model(prompt)
  const reparsed = extractJson(retry)
  if (reparsed) return reparsed
  throw new JudgeUnparseableError(retry)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/agent/judge.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/__evals__/agent/judge.ts src/main/meta/__evals__/agent/judge.test.ts
git commit -m "feat(eval): LLM-as-judge with strict JSON parsing (gate 2)"
```

---

## Task 4: Headless turn runner + turn-folding

**Files:**
- Create: `src/main/meta/__evals__/agent/runAgentTurn.ts`
- Test: `src/main/meta/__evals__/agent/runAgentTurn.test.ts`

**Interfaces:**
- Consumes: `AgentEvalCase`, `TurnTrace`, `ToolCallRecord` from `./types`; `resolveLiveConfig` from `../liveModel`; `AgentService` + `AgentDeps` from `../../../agent`; `ToolDeps` from `../../../tools/shared`; `AgentEvent`, `ProviderName`, `ProviderConfig`, `SessionState` from `../../../providers/types`; `AxibridgeService` from `../../../axibridgeService`; `AxibridgeClient` from `../../../axibridgeClient`; `AxibridgeCache`, `DEFAULT_CACHE_CAP_BYTES`, `META_TTL_MS` from `../../../axibridgeCache`; `listLinkedRepos` from `../../../axibridgeRepos`; `summarizeResilient` from `../../../axibridgeSummarize`.
- Produces:
  - `interface TurnRunner { runTurn(conversationId: string, prompt: string, onEvent: (e: AgentEvent) => void, opts?: { forcedSkillId?: string }): Promise<void> }`
  - `function foldTurn(runner: TurnRunner, prompt: string): Promise<TurnTrace>`
  - `function buildEvalAxibridge(env?: NodeJS.ProcessEnv): AxibridgeService`
  - `function buildEvalAgentService(c: AgentEvalCase, env?: NodeJS.ProcessEnv): AgentService`
  - `function runAgentTurn(c: AgentEvalCase, runner?: TurnRunner): Promise<TurnTrace>`

- [ ] **Step 1: Write the failing test** (folding only — no live model)

```ts
// src/main/meta/__evals__/agent/runAgentTurn.test.ts
import { describe, it, expect } from 'vitest'
import { foldTurn, type TurnRunner } from './runAgentTurn'
import type { AgentEvent } from '../../../providers/types'

/** A fake runner that replays a scripted event sequence. */
function scripted(events: AgentEvent[]): TurnRunner {
  return {
    async runTurn(_id, _prompt, onEvent) {
      for (const e of events) onEvent(e)
    }
  }
}

describe('foldTurn', () => {
  it('folds text deltas and paired tool events into a TurnTrace', async () => {
    const runner = scripted([
      { kind: 'text-delta', text: 'Hello ' },
      { kind: 'tool-start', id: '1', name: 'axibridge_section', input: { section: 'boons' } },
      { kind: 'tool-result', id: '1', isError: false, text: '{"rows":[]}' },
      { kind: 'text-delta', text: 'world' },
      { kind: 'done', sessionId: 's', error: null }
    ])
    const trace = await foldTurn(runner, 'p')
    expect(trace.answer).toBe('Hello world')
    expect(trace.error).toBeNull()
    expect(trace.toolCalls).toEqual([
      { name: 'axibridge_section', input: { section: 'boons' }, isError: false, resultText: '{"rows":[]}' }
    ])
  })

  it('captures a done error and an error tool-result', async () => {
    const runner = scripted([
      { kind: 'tool-start', id: '1', name: 'x', input: {} },
      { kind: 'tool-result', id: '1', isError: true, text: 'boom' },
      { kind: 'done', sessionId: null, error: 'turn failed' }
    ])
    const trace = await foldTurn(runner, 'p')
    expect(trace.error).toBe('turn failed')
    expect(trace.toolCalls[0].isError).toBe(true)
    expect(trace.toolCalls[0].resultText).toBe('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/agent/runAgentTurn.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `./runAgentTurn`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/meta/__evals__/agent/runAgentTurn.ts
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { AgentEvalCase, TurnTrace, ToolCallRecord } from './types'
import { resolveLiveConfig } from '../liveModel'
import { AgentService, type AgentDeps } from '../../../agent'
import type { ToolDeps } from '../../../tools/shared'
import type { AgentEvent, ProviderName, ProviderConfig, SessionState } from '../../../providers/types'
import { AxibridgeService } from '../../../axibridgeService'
import { AxibridgeClient } from '../../../axibridgeClient'
import { AxibridgeCache, DEFAULT_CACHE_CAP_BYTES, META_TTL_MS } from '../../../axibridgeCache'
import { listLinkedRepos } from '../../../axibridgeRepos'
import { summarizeResilient } from '../../../axibridgeSummarize'

export interface TurnRunner {
  runTurn(
    conversationId: string,
    prompt: string,
    onEvent: (e: AgentEvent) => void,
    opts?: { forcedSkillId?: string }
  ): Promise<void>
}

/** Subscribe to a turn's events and fold them into a TurnTrace. */
export async function foldTurn(runner: TurnRunner, prompt: string): Promise<TurnTrace> {
  let answer = ''
  let error: string | null = null
  const starts = new Map<string, { name: string; input: Record<string, unknown> }>()
  const toolCalls: ToolCallRecord[] = []

  await runner.runTurn('eval', prompt, (e) => {
    if (e.kind === 'text-delta') answer += e.text
    else if (e.kind === 'tool-start') starts.set(e.id, { name: e.name, input: e.input })
    else if (e.kind === 'tool-result') {
      const s = starts.get(e.id)
      toolCalls.push({
        name: s?.name ?? '(unknown)',
        input: s?.input ?? {},
        isError: e.isError,
        resultText: e.text
      })
    } else if (e.kind === 'done') error = e.error
  })

  return { answer, toolCalls, error }
}

function settingsDir(env: NodeJS.ProcessEnv): string {
  const p = env.AXIVALE_SETTINGS ?? join(homedir(), '.config', 'axivale', 'settings.json')
  return dirname(p)
}

function appSettings(env: NodeJS.ProcessEnv): Record<string, string> {
  const p = env.AXIVALE_SETTINGS ?? join(homedir(), '.config', 'axivale', 'settings.json')
  if (!existsSync(p)) return {}
  try {
    return ((JSON.parse(readFileSync(p, 'utf8')) as { settings?: Record<string, string> }).settings) ?? {}
  } catch {
    return {}
  }
}

/**
 * Build a real AxibridgeService for headless evals. Mirrors index.ts:488-505
 * but reads settings from disk (no Electron) and the GitHub PAT from
 * GITHUB_PAT (Electron safeStorage is unreadable here). The cache dir is the
 * app's real one, so cached reports are reused; summarizeResilient falls back
 * to inline summarizing when the worker bundle is absent (it is, in evals).
 */
export function buildEvalAxibridge(env: NodeJS.ProcessEnv = process.env): AxibridgeService {
  const s = appSettings(env)
  const client = new AxibridgeClient(() => env.GITHUB_PAT ?? null)
  const cache = new AxibridgeCache({
    dir: join(settingsDir(env), 'axibridge-cache'),
    capBytes: DEFAULT_CACHE_CAP_BYTES,
    ttlMs: META_TTL_MS
  })
  return new AxibridgeService({
    repos: () => listLinkedRepos(s.axibridgeRepos ?? null),
    client,
    cache,
    summarize: (jobs) => summarizeResilient(jobs),
    onProgress: () => {}
  })
}

/** ToolDeps with a real AxiBridge service and benign stubs for every other group. */
function buildEvalToolDeps(env: NodeJS.ProcessEnv): ToolDeps {
  const axibridge = buildEvalAxibridge(env)
  const emptyIndex = {} as ToolDeps['metaIndex'] extends () => infer R ? R : never
  return {
    axitools: {} as ToolDeps['axitools'],
    axivaleServers: () => [],
    resolveAxitoolsServer: async () => {
      throw new Error('not wired in eval')
    },
    gw2: {} as ToolDeps['gw2'],
    discordGuildId: () => '',
    gw2GuildId: () => '',
    axiforge: {} as ToolDeps['axiforge'],
    axiforgeLauncher: { ensureRunning: async () => {} },
    axibridge: () => axibridge,
    loadSkill: () => null,
    rosterAnnotations: () => [],
    rosterLinks: () => [],
    metaIndex: () => emptyIndex,
    wikiIndex: () => emptyIndex,
    generalIndex: () => emptyIndex,
    memory: () => ({}) as ToolDeps['memory'] extends () => infer R ? R : never,
    resolveEntityKey: async () => null,
    discordWebhookTie: () => ({ comp: [], build: [] }),
    wikiFacts: {} as ToolDeps['wikiFacts'],
    fetchBuildPage: async () => null,
    fetchBuildPageRaw: async () => null
  }
}

function buildConfig(c: AgentEvalCase, env: NodeJS.ProcessEnv): ProviderConfig {
  const live = resolveLiveConfig(env)
  return {
    provider: (c.provider ?? live.provider) as ProviderName,
    model: c.model ?? live.model,
    oauthToken: live.oauthToken,
    apiKey: env.EVAL_API_KEY ?? null,
    endpoint: env.EVAL_ENDPOINT ?? null
  }
}

/** A headless AgentService: real axibridge, stubbed rest, in-memory session, deny-confirm. */
export function buildEvalAgentService(c: AgentEvalCase, env: NodeJS.ProcessEnv = process.env): AgentService {
  const toolDeps = buildEvalToolDeps(env)
  const sessions = new Map<string, SessionState>()
  const deps: AgentDeps = {
    toolDeps: () => toolDeps,
    config: () => buildConfig(c, env),
    confirm: async () => false,
    loadSession: (id) => sessions.get(id) ?? {},
    saveSession: (id, _provider, session) => {
      sessions.set(id, session)
    },
    skills: () => [],
    meta: () => [],
    pinnedMemory: () => []
  }
  return new AgentService(deps)
}

/** Run one case as a real turn (or via an injected runner) and return its trace. */
export async function runAgentTurn(c: AgentEvalCase, runner?: TurnRunner): Promise<TurnTrace> {
  const r = runner ?? buildEvalAgentService(c)
  return foldTurn(r, c.prompt)
}
```

> Note on the `emptyIndex` / `memory` casts: `ToolDeps` requires real class
> instances for `metaIndex`/`wikiIndex`/`generalIndex`/`memory`. The agent never
> calls these in the seed cases; if it ever did, the tool's own `safe()` wrapper
> turns the resulting `undefined is not a function` into an error result rather
> than crashing the turn. If the conditional-type casts above are awkward for the
> compiler, replace them with `as never` (e.g. `metaIndex: () => ({} as never)`)
> — the intent is a typed empty stub, not a working index.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/agent/runAgentTurn.test.ts --maxWorkers=2`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If the conditional-type stubs error, switch them to `as never` per the note.)

- [ ] **Step 6: Commit**

```bash
git add src/main/meta/__evals__/agent/runAgentTurn.ts src/main/meta/__evals__/agent/runAgentTurn.test.ts
git commit -m "feat(eval): headless turn runner + event folding"
```

---

## Task 5: Live runner test file

**Files:**
- Create: `src/main/meta/agent.eval.test.ts`

**Interfaces:**
- Consumes: `AGENT_EVAL_CASES` from `./__evals__/agent/cases`; `runAgentTurn` from `./__evals__/agent/runAgentTurn`; `gradeToolTrace` from `./__evals__/agent/toolTrace`; `judgeAnswer` from `./__evals__/agent/judge`; `evalMode` from `./__evals__/harness`.
- Produces: nothing (test-only).

- [ ] **Step 1: Verify it skips in replay mode (default)**

Create the file:

```ts
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
```

- [ ] **Step 2: Run in replay mode to confirm SKIP (not fail)**

Run: `npx vitest run src/main/meta/agent.eval.test.ts --maxWorkers=2`
Expected: the suite reports the cases as **skipped** (0 failures). `it.runIf(false)` skips.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Confirm full suite stays green**

Run: `npx vitest run --maxWorkers=2`
Expected: all pass; the new live cases skipped, the three pure unit-test files (cases/toolTrace/judge/runAgentTurn) pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/agent.eval.test.ts
git commit -m "feat(eval): live agent eval runner (npm run eval), skipped in CI"
```

---

## Task 6: Live smoke + docs

**Files:**
- Modify: `package.json` (only if a dedicated script is wanted — see Step 2)

- [ ] **Step 1: Live run against real data**

Ensure your AxiBridge repo is linked in the app and reports are cached (open the app once if needed). Then:

Run: `EVAL_LIVE=1 npx vitest run src/main/meta/agent.eval.test.ts --maxWorkers=2`
(Or `npm run eval` to run all evals.) Requires `CLAUDE_CODE_OAUTH_TOKEN` in the env if the app token can't be read.
Expected: the four seed cases execute real turns; report pass/fail with per-case reasoning. Investigate any failure using the printed tool-trace + judge reasoning.

- [ ] **Step 2: (Optional) add a focused npm script**

If you want a one-word entry point for just the agent evals, add to `package.json` scripts:

```json
"eval:agent": "EVAL_LIVE=1 vitest run src/main/meta/agent.eval.test.ts"
```

Then commit:

```bash
git add package.json
git commit -m "chore(eval): eval:agent script for live agent evals"
```

- [ ] **Step 3: Record outcome**

Note the live results (which cases passed, any judge reasoning worth keeping) in the session. The boon regression cases passing is the proof the AxiBridge section work is doing its job end-to-end.

---

## Self-Review

**Spec coverage:**
- Reuse existing harness (`evalMode`, `resolveLiveConfig`, `runClaudeOnce`, `*.eval.test.ts` glob) → Tasks 3/5. ✓
- `cases.ts` configurable array + types → Task 1. ✓
- `runAgentTurn.ts` headless `AgentService`, real axibridge + stubbed rest, event folding → Task 4. ✓
- `toolTrace.ts` gate 1 (subset match, case-insensitive strings, mustNotCall) → Task 2. ✓
- `judge.ts` gate 2 (fixed prompt, JSON-only, retry-then-throw, `EVAL_JUDGE_MODEL` default sonnet) → Task 3. ✓
- `agent.eval.test.ts` live-only runner, both gates required, failure message split by gate → Task 5. ✓
- Live-only gating / CI-skip + pure-unit CI tests → Tasks 2/3/4 (CI) + Task 5 (skip proof). ✓
- Seed cases (boon regression) → Task 1. ✓
- Error handling: turn error → judge skipped, case fails (Task 5); judge unparseable → throws (Task 3); stub tool → error result not crash (Task 4 note); missing creds/repo → surfaces as trace.error (Task 4/6). ✓
- `buildEvalAxibridge` mirroring index.ts construction → Task 4. ✓ (Spec's optional index.ts refactor dropped per YAGNI — the headless construction genuinely differs from the Electron one; documented as mirroring index.ts:488-505.)
- Out of scope (turn record/replay, real non-axibridge services, YAML/CLI, dashboards) → respected. ✓

**Placeholder scan:** No TBD/TODO. Every code step is complete. The conditional-type stubs in Task 4 carry an explicit `as never` fallback so the implementer is never stuck. Task 6 is genuine manual verification, not a code placeholder.

**Type consistency:** `TurnTrace`/`ToolCallRecord`/`AgentEvalCase`/`JudgeVerdict`/`JudgeInput` defined once in `types.ts` (Task 1) and imported everywhere. `gradeToolTrace(trace, c) → ToolTraceResult`, `judgeAnswer(input, model?) → Promise<JudgeVerdict>`, `runAgentTurn(c, runner?) → Promise<TurnTrace>`, `foldTurn(runner, prompt) → Promise<TurnTrace>` signatures match across Tasks 2–5. `AgentEvent` kinds (`text-delta`/`tool-start`/`tool-result`/`done`) match `providers/types.ts`. `ToolDeps` field list matches `tools/shared.ts` exactly (Task 4).
