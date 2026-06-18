import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AxibridgeCache } from './axibridgeCache'

const repo = { owner: 'darkharasho', repo: 'eww-reports' }
let dir: string
let now: number

const makeCache = (capBytes = 2 * 1024 * 1024 * 1024) =>
  new AxibridgeCache({ dir, capBytes, ttlMs: 5 * 60_000, now: () => now })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axibridge-cache-'))
  now = 1_750_000_000_000
})

describe('AxibridgeCache', () => {
  it('treats reports as immutable: a cached report never expires', () => {
    const cache = makeCache()
    cache.putReport(repo, 'r1', JSON.stringify({ meta: { id: 'r1' } }))
    now += 365 * 24 * 3_600_000
    expect(cache.readReport(repo, 'r1')).not.toBeNull()
  })
  it('expires index/rollup after the TTL', () => {
    const cache = makeCache()
    cache.putMeta(repo, 'index', JSON.stringify([{ id: 'r1' }]))
    expect(cache.readMeta(repo, 'index')).not.toBeNull()
    now += 5 * 60_000 + 1
    expect(cache.readMeta(repo, 'index')).toBeNull()
  })
  it('evicts least-recently-used reports past the cap, never summaries', () => {
    const cache = makeCache(250) // tiny cap for the test
    cache.putReport(repo, 'old', 'x'.repeat(200))
    cache.putSummary(repo, 'old', '{"id":"old"}')
    now += 1000
    cache.putReport(repo, 'new', 'y'.repeat(200)) // pushes total past cap
    expect(cache.readReport(repo, 'old')).toBeNull() // evicted (LRU)
    expect(cache.readReport(repo, 'new')).not.toBeNull()
    expect(cache.readSummary(repo, 'old')).toBe('{"id":"old"}') // summaries survive
  })
  it('reading a report refreshes its LRU position', () => {
    const cache = makeCache(450)
    cache.putReport(repo, 'a', 'x'.repeat(200))
    now += 1000
    cache.putReport(repo, 'b', 'y'.repeat(200))
    now += 1000
    cache.readReport(repo, 'a') // a is now most recent
    now += 1000
    cache.putReport(repo, 'c', 'z'.repeat(200))
    expect(cache.readReport(repo, 'b')).toBeNull()
    expect(cache.readReport(repo, 'a')).not.toBeNull()
  })
  it('reports per-repo stats for the Settings health line', () => {
    const cache = makeCache()
    cache.putReport(repo, 'r1', '{}')
    cache.putMeta(repo, 'index', '[]')
    const stats = cache.repoStats(repo)
    expect(stats.cachedReports).toBe(1)
    expect(stats.lastIndexFetch).toBe(now)
  })
  it('readMetaStale returns body + fetchedAt past TTL, null when absent', () => {
    const cache = makeCache()
    cache.putMeta(repo, 'index', '[{"id":"run-1"}]')
    const writtenAt = now
    now += 10 * 60_000 // advance well past the 5-min TTL
    expect(cache.readMeta(repo, 'index')).toBeNull() // TTL'd out
    const stale = cache.readMetaStale(repo, 'index')
    expect(stale?.body).toBe('[{"id":"run-1"}]')
    expect(stale?.fetchedAt).toBe(writtenAt)
    expect(cache.readMetaStale(repo, 'rollup')).toBeNull() // never written
  })
})
