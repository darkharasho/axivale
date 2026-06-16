import { describe, it, expect } from 'vitest'
import { parsePullLine } from './pullProgress'

describe('parsePullLine', () => {
  it('computes percent from completed/total', () => {
    const r = parsePullLine('{"status":"pulling manifest","completed":50,"total":200}')
    expect(r).toEqual({ status: 'pulling manifest', percent: 25 })
  })

  it('returns percent undefined when total is missing or zero', () => {
    expect(parsePullLine('{"status":"verifying"}')).toEqual({ status: 'verifying', percent: undefined })
    expect(parsePullLine('{"status":"x","completed":5,"total":0}')).toEqual({ status: 'x', percent: undefined })
  })

  it('returns null for blank or non-JSON lines', () => {
    expect(parsePullLine('')).toBeNull()
    expect(parsePullLine('   ')).toBeNull()
    expect(parsePullLine('not json')).toBeNull()
  })

  it('surfaces an error field', () => {
    const r = parsePullLine('{"error":"pull model manifest: file does not exist"}')
    expect(r?.error).toMatch(/file does not exist/)
  })
})
