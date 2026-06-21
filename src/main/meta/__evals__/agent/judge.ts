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
