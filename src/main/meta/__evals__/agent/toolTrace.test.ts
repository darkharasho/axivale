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
