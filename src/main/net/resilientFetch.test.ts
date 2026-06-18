// src/main/net/resilientFetch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resilientFetch, FetchTimeoutError } from './resilientFetch'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const noSleep = (): Promise<void> => Promise.resolve()

describe('resilientFetch', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns the response on success without retrying', async () => {
    const resp = new Response('ok', { status: 200 })
    mockFetch.mockResolvedValueOnce(resp)
    const out = await resilientFetch('https://x/y')
    expect(out).toBe(resp)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry an HTTP error response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const out = await resilientFetch('https://x/y', { retries: 3, sleep: noSleep })
    expect(out.status).toBe(500)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('normalizes a timeout abort to FetchTimeoutError', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'))
    await expect(resilientFetch('https://x/y')).rejects.toBeInstanceOf(FetchTimeoutError)
  })

  it('retries thrown network errors with backoff, then succeeds', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    mockFetch
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const out = await resilientFetch('https://x/y', { retries: 2, sleep, backoffBaseMs: 500 })
    expect(out.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
  })

  it('rethrows the last error after exhausting retries', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new TypeError('network'))
    await expect(resilientFetch('https://x/y', { retries: 2, sleep: noSleep })).rejects.toThrow('network')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry when the caller-supplied signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(
      resilientFetch('https://x/y', { signal: controller.signal, retries: 3, sleep: noSleep })
    ).rejects.toThrow()
    expect(mockFetch).toHaveBeenCalledTimes(1) // caller-abort short-circuits retries
  })
})
