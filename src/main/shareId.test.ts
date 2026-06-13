// src/main/shareId.test.ts
import { describe, it, expect } from 'vitest'
import { makeShareId } from './shareId'

describe('makeShareId', () => {
  it('defaults to a 20-char base62 string', () => {
    const id = makeShareId()
    expect(id).toHaveLength(20)
    expect(id).toMatch(/^[0-9A-Za-z]+$/)
  })

  it('honors a custom length', () => {
    expect(makeShareId(8)).toHaveLength(8)
  })

  it('is effectively unique across many draws', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => makeShareId()))
    expect(seen.size).toBe(1000)
  })
})
