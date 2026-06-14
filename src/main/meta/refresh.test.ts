// src/main/meta/refresh.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from '../metaStore'
import { MetaRefresher } from './refresh'
import type { RawCache } from './cache'
import type { MetaFetcher, FetchResult } from './fetcher'

function store(): MetaStore {
  return new MetaStore(join(mkdtempSync(join(tmpdir(), 'refresh-')), 'meta.json'))
}
function fakeCache(): RawCache & { puts: Record<string, string> } {
  const puts: Record<string, string> = {}
  return { puts, put: (u, t) => void (puts[u] = t), get: (u) => puts[u] ?? null }
}
function fetcher(map: Record<string, FetchResult>): MetaFetcher {
  return { fetch: vi.fn(async (url: string) => map[url] ?? { ok: false, error: 'unconfigured' }) }
}
const DAY = 86_400_000

describe('MetaRefresher', () => {
  it('skips modes refreshed within the stale window', async () => {
    const s = store()
    s.list().forEach((x) => s.recordDistill(x.id, 'fresh notes'))
    const m = s.list()[0]
    const f = fetcher({})
    await new MetaRefresher({
      store: s, fetcher: f, cache: fakeCache(), model: vi.fn(),
      now: () => Date.now(), staleMs: 7 * DAY
    }).refreshStale()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(s.get(m.id)!.notes).toBe('fresh notes')
  })

  it('fetches, caches, and distills a stale mode; records provenance', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'PvE')!
    const url = m.sources[0].url
    const cache = fakeCache()
    const model = vi.fn().mockResolvedValue('distilled pve meta')
    await new MetaRefresher({
      store: s, fetcher: fetcher({ [url]: { ok: true, text: 'raw pve', pages: [] } }),
      cache, model, now: () => Date.now()
    }).refreshStale()
    expect(cache.puts[url]).toBe('raw pve')
    const after = s.get(m.id)!
    expect(after.sources[0].status).toBe('ok')
    expect(after.notes).toBe('distilled pve meta')
    expect(after.refreshedAt).toBeTruthy()
  })

  it('isolates a failing source: keeps siblings, marks error, still distills', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'WvW')!
    const [a, b] = m.sources
    const model = vi.fn().mockResolvedValue('partial meta')
    await new MetaRefresher({
      store: s,
      fetcher: fetcher({ [a.url]: { ok: true, text: 'good', pages: [] }, [b.url]: { ok: false, error: 'timeout' } }),
      cache: fakeCache(), model, now: () => Date.now()
    }).refreshStale()
    const after = s.get(m.id)!
    expect(after.sources[0].status).toBe('ok')
    expect(after.sources[1].status).toBe('error')
    expect(after.sources[1].error).toBe('timeout')
    expect(model.mock.calls[0][0]).toContain('good')
    expect(after.notes).toBe('partial meta')
  })

  it('no-auth path: records fetches but leaves notes intact when the model is empty', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'PvE')!
    const url = m.sources[0].url
    await new MetaRefresher({
      store: s, fetcher: fetcher({ [url]: { ok: true, text: 'raw', pages: [] } }),
      cache: fakeCache(), model: vi.fn().mockResolvedValue(''), now: () => Date.now()
    }).refreshStale()
    const after = s.get(m.id)!
    expect(after.sources[0].status).toBe('ok')
    expect(after.notes).toBe('')
    expect(after.refreshedAt).toBeNull()
  })

  it('keeps old notes when every source fails (never calls the model)', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'PvE')!
    s.recordDistill(m.id, 'old but valid')
    const model = vi.fn()
    await new MetaRefresher({
      store: s, fetcher: fetcher({ [m.sources[0].url]: { ok: false, error: 'down' } }),
      cache: fakeCache(), model, now: () => Date.now() + 365 * DAY, staleMs: 7 * DAY
    }).refreshStale()
    expect(model).not.toHaveBeenCalled()
    expect(s.get(m.id)!.notes).toBe('old but valid')
  })
})

describe('MetaRefresher progress', () => {
  it('emits mode-start, source-start(s), mode-done, then idle for a stale mode', async () => {
    const s = store()
    // make only PvE stale: mark the others fresh
    s.list().forEach((x) => {
      if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh')
    })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const events: string[] = []
    await new MetaRefresher({
      store: s,
      fetcher: fetcher(Object.fromEntries(pve.sources.map((x) => [x.url, { ok: true, text: 'r', pages: [] }]))),
      cache: fakeCache(),
      model: vi.fn().mockResolvedValue('notes'),
      now: () => Date.now(),
      emit: (e) => events.push(e.type)
    }).refreshStale()
    expect(events[0]).toBe('mode-start')
    expect(events).toContain('source-start')
    expect(events).toContain('mode-done')
    expect(events[events.length - 1]).toBe('idle')
  })
})
