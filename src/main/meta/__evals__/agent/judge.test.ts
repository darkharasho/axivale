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
