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

// Per-result budget the judge sees. Section results are 40-row tables; at ~400
// chars the judge only saw the first row or two and wrongly flagged correct
// top-of-list answers as fabricated. 4000 covers a full per-player section so
// the judge can actually verify the cited accounts/numbers.
const JUDGE_RESULT_CHARS = 4000

function renderTrace(calls: ToolCallRecord[]): string {
  if (calls.length === 0) return '(no tools called)'
  return calls
    .map((c) => {
      const text = c.resultText.length > JUDGE_RESULT_CHARS
        ? `${c.resultText.slice(0, JUDGE_RESULT_CHARS)}… [truncated ${c.resultText.length - JUDGE_RESULT_CHARS} chars]`
        : c.resultText
      return `- ${c.name}(${JSON.stringify(c.input)})${c.isError ? ' [ERROR]' : ''} -> ${text}`
    })
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
    // The judge's own GW2 knowledge lags the game. A real run was scored 0.05
    // partly because the judge asserted "Paragon is not a real Guild Wars 2
    // profession" -- it is; it postdates the judge's training. Grade against the
    // tool results shown above, never against recalled game trivia.
    'IMPORTANT: GW2 ships expansions and elite specs after your training cutoff. Names like ' +
      'Amalgam, Luminary, Paragon, and Ritualist are REAL elite specs. Never score an answer ' +
      'as hallucinated because a profession, spec, or skill name is unfamiliar to you -- judge ' +
      'only against the tool results above. Where a tool result is marked [truncated N chars], ' +
      'you cannot see all of it: do not call a cited name or number fabricated merely because ' +
      'it is absent from the portion you were shown.',
    '',
    'Respond with ONLY a JSON object, no prose, no code fences:',
    '{"pass": <boolean>, "score": <number 0..1>, "reasoning": "<one or two sentences>"}'
  ].join('\n')
}

/** Extract a JSON object from a model response (first `{` to last `}`). */
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
