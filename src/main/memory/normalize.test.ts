import { describe, it, expect } from 'vitest'
import { normalizeMemoryBody, cosine } from './normalize'

describe('normalizeMemoryBody', () => {
  it('lowercases, collapses whitespace, strips leading bullets and trailing dates', () => {
    expect(normalizeMemoryBody('- Prefers   WvW  small-scale')).toBe('prefers wvw small-scale')
    expect(normalizeMemoryBody('Raids Tue/Thu (2026-06-16)')).toBe('raids tue/thu')
    expect(normalizeMemoryBody('* Mains Firebrand.')).toBe('mains firebrand')
  })
})

describe('cosine', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })
  it('returns 0 on zero or mismatched-length vectors', () => {
    expect(cosine([0, 0], [1, 0])).toBe(0)
    expect(cosine([1], [1, 0])).toBe(0)
  })
})
