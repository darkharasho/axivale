// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useEntityDictionary } from './useEntityDictionary'

afterEach(() => {
  vi.restoreAllMocks()
  // Remove window.officer between tests
  Object.defineProperty(window, 'officer', {
    value: undefined,
    writable: true,
    configurable: true
  })
})

describe('useEntityDictionary', () => {
  it('returns EMPTY and does NOT throw when window.officer is undefined', () => {
    Object.defineProperty(window, 'officer', {
      value: undefined,
      writable: true,
      configurable: true
    })

    let result: ReturnType<typeof renderHook<ReturnType<typeof useEntityDictionary>, unknown>>
    expect(() => {
      result = renderHook(() => useEntityDictionary())
    }).not.toThrow()

    expect(result!.result.current).toEqual({ entries: [] })
  })

  it('eventually returns the resolved dictionary when entityDictionary resolves', async () => {
    const mockDict = { entries: [{ name: 'Fireball', type: 'skill' as const }] }
    Object.defineProperty(window, 'officer', {
      value: { entityDictionary: vi.fn().mockResolvedValue(mockDict) },
      writable: true,
      configurable: true
    })

    const { result } = renderHook(() => useEntityDictionary())

    // Initially EMPTY
    expect(result.current).toEqual({ entries: [] })

    // After the promise resolves, dict should update
    await waitFor(() => {
      expect(result.current).toEqual(mockDict)
    })
  })

  it('stays EMPTY and does NOT throw when entityDictionary rejects', async () => {
    Object.defineProperty(window, 'officer', {
      value: { entityDictionary: vi.fn().mockRejectedValue(new Error('IPC error')) },
      writable: true,
      configurable: true
    })

    let result: ReturnType<typeof renderHook<ReturnType<typeof useEntityDictionary>, unknown>>
    expect(() => {
      result = renderHook(() => useEntityDictionary())
    }).not.toThrow()

    // Give time for the promise to reject
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(result!.result.current).toEqual({ entries: [] })
  })
})
