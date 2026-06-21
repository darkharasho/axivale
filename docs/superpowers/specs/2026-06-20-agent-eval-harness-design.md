# Live-turn LLM-judge eval harness — design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Problem

Verifying agent behavior changes (like the new AxiBridge `find`/`section` tools, or
the "stop guessing boons" guidance) currently means manually relaunching the app and
typing prompts — slow, subjective, and not repeatable. We want an automated harness
that drives **real agent turns** against configurable prompts and grades them, using
deterministic tool-trace assertions plus an LLM-as-judge on the answer.

This makes prompt/tool regressions catchable: "did the agent call
`axibridge_section{section:boons}` and report real numbers, instead of inferring boons
from comp roles?" becomes a test.

## Existing foundation (reused, not rebuilt)

- **Eval harness** at `src/main/meta/__evals__/`: `evalMode(): 'replay'|'live'|'record'`
  reads `EVAL_LIVE`/`EVAL_RECORD`; `*.eval.test.ts` files are discovered; `npm run eval`
  = `EVAL_LIVE=1 vitest run src/main/meta/*.eval.test.ts`. CI runs `npm test` in replay
  mode (offline, free).
- **`resolveLiveConfig(env?)`** (`__evals__/liveModel.ts`): resolves provider/model/token
  from `~/.config/axivale/settings.json` + env (`EVAL_PROVIDER`, `EVAL_MODEL`,
  `CLAUDE_CODE_OAUTH_TOKEN`).
- **`runClaudeOnce(prompt, cfg)`** (`src/main/meta/model.ts`): one-shot model call via the
  Agent SDK `query()`. Used by the judge.
- **`AgentService.runTurn(conversationId, promptText, onEvent, opts?)`** (`src/main/agent.ts`):
  Electron-free. Streams `AgentEvent`s:
  - `{ kind: 'text-delta'; text }`
  - `{ kind: 'tool-start'; id; name; input }`
  - `{ kind: 'tool-result'; id; isError; text; display? }`
  - `{ kind: 'done'; sessionId; error }`
- **`AgentDeps`** (constructor): `toolDeps()`, `config()`, `confirm(name,input)`,
  `loadSession(id)`, `saveSession(id,provider,session)`, `skills()`, `meta()`,
  `pinnedMemory()`.
- **`buildOfficerTools(deps: ToolDeps)`** (`src/main/tools/index.ts`): assembles every tool
  group, including `buildAxibridgeTools(deps.axibridge)`. The agent sees the full set
  (cloud providers) so tool-selection is realistic.

No Electron import sits on the `runTurn` critical path — the harness drives it directly.

## Scope decisions (from brainstorming)

1. **Tool environment = real AxiBridge only, stub the rest.** Wire a genuine
   `AxibridgeService` (real cached reports / linked repos); stub the other tool groups so
   their handlers exist (agent sees all tools) but return an empty/"not wired in eval"
   result. Other domains can be wired in later.
2. **Grade on both artifacts, independently.** Deterministic tool-trace assertions AND an
   LLM judge on the final answer; a case passes iff **both** pass.
3. **Authored as a TS case array, run via the existing harness.** No separate CLI.
4. **Live-only.** Agent cases run only under `EVAL_LIVE=1`; skipped in normal CI (agent
   turns are nondeterministic and turn-recording is deferred). The harness's *pure* units
   are tested in normal CI.

Deferred (explicitly out of scope here): recording/replaying whole turns for offline CI
(brainstorm option C); wiring real non-axibridge services; a YAML/CLI front-end.

## Architecture

```
AgentEvalCase {prompt, mustCall, mustNotCall, rubric}
  → runAgentTurn(case)        // real runTurn, headless, real axibridge + stubbed rest
  → TurnTrace {answer, toolCalls[], error}
  → gradeToolTrace(trace,case) // gate 1: deterministic matchers
  → judgeAnswer({prompt,answer,toolCalls,rubric}) // gate 2: LLM judge → {pass,score,reasoning}
  → assert(toolTrace.passed && judge.pass)
```

New files, all under `src/main/meta/__evals__/agent/`:

### 1. `cases.ts` — the configurable input
```ts
import type { ProviderName } from '../../../providers/types'

export interface ToolCallMatcher {
  name: string
  args?: Record<string, unknown>   // recursive subset match against the tool-start input
}
export interface AgentEvalCase {
  name: string
  prompt: string
  provider?: ProviderName           // default: resolveLiveConfig().provider
  model?: string                    // default: resolveLiveConfig().model
  mustCall?: ToolCallMatcher[]      // each matcher must match ≥1 tool-start
  mustNotCall?: ToolCallMatcher[]   // none may match
  rubric: string                    // judge instructions / answer pass criteria
}
export const AGENT_EVAL_CASES: AgentEvalCase[]
```
Adding a case = appending one object.

### 2. `runAgentTurn.ts` — headless turn runner
```ts
export interface TurnTrace {
  answer: string                    // concatenated text-delta
  toolCalls: Array<{ name: string; input: Record<string, unknown>; isError: boolean; resultText: string }>
  error: string | null              // from the done event
}
export async function runAgentTurn(c: AgentEvalCase): Promise<TurnTrace>
```
Builds an `AgentService` with:
- `config()` → a `ProviderConfig` derived from `resolveLiveConfig(process.env)`, overridden
  by the case's `provider`/`model`.
- `toolDeps()` → a `ToolDeps` where `axibridge` is a real `AxibridgeService` (constructed
  from settings-derived repos + cache + client, the same way `index.ts` builds it, minus
  Electron) and every other field is a stub. Stubs satisfy the `ToolDeps` type and return
  empty/error results; **no stub may throw on construction**.
- `confirm()` → returns `false` (deny). All harness-exercised tools are read-only, so this
  never blocks them; it just guarantees no destructive tool can run in an eval.
- `loadSession`/`saveSession` → in-memory `Map`.
- `skills()`/`meta()`/`pinnedMemory()` → empty arrays.

Subscribes to `runTurn`'s `onEvent`, folding events into `TurnTrace`: append `text-delta`
to `answer`; pair `tool-start`/`tool-result` by `id` into `toolCalls`; capture `done.error`.
Resolves when `done` fires.

**ToolDeps stub crux (resolve in planning):** the exact `ToolDeps` shape must be read from
`src/main/tools/index.ts` / `tools/shared.ts`; the plan enumerates every field and its
minimal stub. The real `AxibridgeService` construction is lifted from `index.ts` into a
small reusable `buildEvalAxibridge()` so the harness and app stay in sync.

### 3. `toolTrace.ts` — gate 1
```ts
export interface ToolTraceResult { passed: boolean; failures: string[] }
export function gradeToolTrace(trace: TurnTrace, c: AgentEvalCase): ToolTraceResult
```
- `mustCall`: each matcher must match ≥1 `toolCalls` entry — `name` equal, and matcher
  `args` a recursive **subset** of the call `input`. String comparisons case-insensitive
  (so `boon:"Protection"` matches `"protection"`). Numbers/bools strict-equal. Nested
  objects recurse; arrays compared element-wise as a subset is out of scope (matchers use
  scalar/object args).
- `mustNotCall`: no entry may match (same matcher semantics).
- `failures` lists each miss in human terms, including the tool names actually seen.

### 4. `judge.ts` — gate 2
```ts
export interface JudgeVerdict { pass: boolean; score: number; reasoning: string }
export interface JudgeInput { prompt: string; answer: string; toolCalls: TurnTrace['toolCalls']; rubric: string }
export async function judgeAnswer(input: JudgeInput, cfg?: { model?: string }): Promise<JudgeVerdict>
```
Fixed grading prompt, rubric-parameterized: gives the judge the user prompt, the final
answer, and a compact tool-trace rendering (name + args + result truncated to ~400 chars
each), and demands **only** JSON `{ "pass": boolean, "score": 0..1, "reasoning": string }`.
Calls `runClaudeOnce` with model = `cfg.model ?? EVAL_JUDGE_MODEL ?? 'claude-sonnet-4-6'`.
Strips code fences / surrounding prose, `JSON.parse`; on failure, one reparse retry, then
**throws** `JudgeUnparseableError` (the test turns this into a case failure — never a silent
pass).

### 5. `agent.eval.test.ts` — runner
Discovered by the existing `src/main/meta/*.eval.test.ts` glob. For each case:
```ts
it.runIf(evalMode() === 'live')(c.name, async () => {
  const trace = await runAgentTurn(c)
  const tt = gradeToolTrace(trace, c)
  const verdict = trace.error ? { pass: false, score: 0, reasoning: `turn errored: ${trace.error}` }
                              : await judgeAnswer({ prompt: c.prompt, answer: trace.answer, toolCalls: trace.toolCalls, rubric: c.rubric })
  expect(tt.passed && verdict.pass, formatFailure(c, tt, verdict, trace)).toBe(true)
}, 120_000)
```
`formatFailure` emits both gates' detail (which `mustCall` missed, the judge reasoning +
score, and the calls actually seen) so a red case immediately says *tool-selection failure*
vs *reasoning failure*. Timeout is generous; live turns are slow.

## Data flow

```
npm run eval  (EVAL_LIVE=1)
  → agent.eval.test.ts iterates AGENT_EVAL_CASES
      → runAgentTurn: real AgentService.runTurn → AgentEvent stream → TurnTrace
      → gradeToolTrace (no model call)
      → judgeAnswer (judge model call)
      → expect(both gates pass)
npm test  (replay) → agent cases skipped; toolTrace.test.ts + judge.test.ts run normally
```

## Seed cases (boon regression — the motivating use)

1. **Wasted Protection** — prompt "Who wasted the most Protection last run?";
   `mustCall: [axibridge_section{ section:"boons", boon:"Protection" }]`;
   rubric: "names accounts with real per-player Protection waste/generation from the tool;
   invents no community benchmarks."
2. **Boon-coverage regression** — prompt "Was our boon coverage good last fight?";
   `mustCall: [axibridge_section{ section:"boons" }]`;
   rubric: "grounds the verdict in uptime/generation numbers returned by the tool, not in
   comp-role inference."
3. **Stun-break routing** — prompt "Where would I find stun breaks?";
   `mustCall: [axibridge_find{}]`;
   rubric: "points the user to the strips section."
4. **Mitigation** — prompt "Who blocked and evaded the most last run?";
   `mustCall: [axibridge_section{ section:"damage_mitigation" }]`;
   rubric: "reports blocked/evaded counts per account."

## Error handling

- **Turn errors** (`done.error`): case fails; judge skipped; reasoning = the error string.
- **Judge unparseable** (after one retry): case fails loudly via `JudgeUnparseableError`.
- **Missing credentials / no linked repo / empty AxiBridge cache:** `runAgentTurn` surfaces
  the error as `trace.error` (turn fails) — the eval reports it rather than hanging. A live
  eval depends on the operator's real AxiBridge data; that is expected and documented.
- **Stub tool invoked by the agent:** returns a benign "not available in eval" result, never
  throws — so a stray tool choice doesn't crash the turn (and the judge can see it happened).
- **Live external flakiness:** inherent to live mode; not masked.

## Testing

Normal CI (offline, always runs):
- `toolTrace.test.ts`: subset match passes/fails; case-insensitive string match; numeric
  strict match; `mustNotCall` hit; nested-object subset; failure messages name the missed
  tool.
- `judge.test.ts`: parses clean JSON; parses code-fence/prose-wrapped JSON; unparseable →
  retry → `JudgeUnparseableError`. Judge model is stubbed (inject a fake `runClaudeOnce`)
  so no live call.

Live (`EVAL_LIVE=1`, manual / pre-merge): `agent.eval.test.ts` runs the seed cases against
real AxiBridge data and a real judge.

Type safety: `npm run typecheck` must pass.

## Files

- `src/main/meta/__evals__/agent/cases.ts` — case type + `AGENT_EVAL_CASES`.
- `src/main/meta/__evals__/agent/runAgentTurn.ts` — headless turn runner + `TurnTrace`.
- `src/main/meta/__evals__/agent/toolTrace.ts` — `gradeToolTrace`.
- `src/main/meta/__evals__/agent/judge.ts` — `judgeAnswer` + `JudgeUnparseableError`.
- `src/main/meta/agent.eval.test.ts` — live runner (discovered by the eval glob).
- `src/main/meta/__evals__/agent/toolTrace.test.ts` — pure unit tests (CI).
- `src/main/meta/__evals__/agent/judge.test.ts` — pure unit tests (CI).
- Possibly `src/main/evalAxibridge.ts` (or a helper exported from existing service wiring) —
  `buildEvalAxibridge()` lifting the real `AxibridgeService` construction out of `index.ts`
  for reuse; refactor `index.ts` to call it so app and harness build it identically.

## Out of scope

- Recording/replaying whole turns for offline CI (future option C).
- Real non-axibridge service wiring.
- YAML/CLI front-end.
- Scoring trends / dashboards — vitest pass/fail + the per-case failure message is the
  reporting surface for now.
