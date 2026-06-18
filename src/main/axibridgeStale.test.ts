import { describe, it, expect } from 'vitest'
import { staleSinceIso, relativeAge, foldStale, emptyStaleAgg } from './axibridgeStale'

describe('staleSinceIso', () => {
  it('converts epoch ms to ISO, guards null and <= 0', () => {
    expect(staleSinceIso(1_750_000_000_000)).toBe('2025-06-15T15:06:40.000Z')
    expect(staleSinceIso(null)).toBeNull()
    expect(staleSinceIso(0)).toBeNull()
    expect(staleSinceIso(-5)).toBeNull()
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-06-17T12:00:00.000Z')
  it('buckets just-now / minutes / hours / days', () => {
    expect(relativeAge('2026-06-17T11:59:30.000Z', now)).toBe('just now')
    expect(relativeAge('2026-06-17T11:40:00.000Z', now)).toBe('20m ago')
    expect(relativeAge('2026-06-17T09:00:00.000Z', now)).toBe('3h ago')
    expect(relativeAge('2026-06-15T12:00:00.000Z', now)).toBe('2d ago')
  })
  it('returns null for null or unparseable input', () => {
    expect(relativeAge(null, now)).toBeNull()
    expect(relativeAge('not-a-date', now)).toBeNull()
  })
})

describe('foldStale', () => {
  it('ORs stale and keeps the oldest positive fetchedAt', () => {
    let agg = emptyStaleAgg
    agg = foldStale(agg, false, 100) // fresh repo: ignored
    expect(agg).toEqual({ stale: false, oldest: null })
    agg = foldStale(agg, true, 5000)
    agg = foldStale(agg, true, 2000) // older wins
    agg = foldStale(agg, true, 9000)
    expect(agg).toEqual({ stale: true, oldest: 2000 })
  })
  it('marks stale even when a stale repo has no usable timestamp', () => {
    let agg = foldStale(emptyStaleAgg, true, 0)
    expect(agg).toEqual({ stale: true, oldest: null })
    agg = foldStale(agg, true, 4000)
    expect(agg).toEqual({ stale: true, oldest: 4000 }) // known age still surfaces
  })
})
