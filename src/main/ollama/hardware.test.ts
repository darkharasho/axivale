import { describe, it, expect } from 'vitest'
import { recommendModel, detectHardware } from './hardware'

const GB = 1024 ** 3

describe('recommendModel', () => {
  it('recommends llama3.2:3b for <8GB RAM', () => {
    const r = recommendModel(6 * GB)
    expect(r.recommended).toBe('llama3.2:3b')
    expect(r.options).toEqual(['llama3.2:3b', 'qwen3:8b'])
  })

  it('recommends qwen3:8b for 8-16GB RAM', () => {
    const r = recommendModel(12 * GB)
    expect(r.recommended).toBe('qwen3:8b')
    expect(r.options).toEqual(['llama3.2:3b', 'qwen3:8b'])
  })

  it('recommends qwen3:8b and offers qwen3:14b for >=16GB RAM', () => {
    const r = recommendModel(32 * GB)
    expect(r.recommended).toBe('qwen3:8b')
    expect(r.options).toEqual(['llama3.2:3b', 'qwen3:8b', 'qwen3:14b'])
  })

  it('treats exactly 8GB as the mid tier', () => {
    expect(recommendModel(8 * GB).recommended).toBe('qwen3:8b')
  })
})

describe('detectHardware', () => {
  it('returns a rounded RAM figure and a recommendation', () => {
    const info = detectHardware()
    expect(info.totalRamGb).toBeGreaterThan(0)
    expect(info.modelOptions).toContain(info.recommendedModel)
  })
})
