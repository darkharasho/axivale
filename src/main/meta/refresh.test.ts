// src/main/meta/refresh.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MetaStore } from '../metaStore'
import { MetaRefresher, type MetaProgress } from './refresh'
import type { RawCache } from './cache'
import type { MetaFetcher, FetchResult } from './fetcher'
import { FakeMetaIndex } from './rag/testFake'
import type { MetaIndex } from './rag/index'

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

  it('scoped refresh fetches only the targeted source and reuses cached siblings for consensus', async () => {
    const s = store()
    const m = s.list().find((x) => x.mode === 'WvW')!
    const mb = m.sources.find((x) => x.url.includes('metabattle.com'))!
    const gm = m.sources.find((x) => x.url.includes('gw2mists.com'))!
    const cache = fakeCache()
    cache.put(mb.url, 'cached metabattle builds') // sibling cached from a prior full crawl
    const f = fetcher({ [gm.url]: { ok: true, text: 'fresh gw2mists tiers', pages: [] } })
    const model = vi.fn().mockResolvedValue('redistilled')
    await new MetaRefresher({ store: s, fetcher: f, cache, model, now: () => Date.now() }).refreshStale({
      only: 'gw2mists'
    })
    // only the targeted source is re-crawled; the sibling is NOT re-fetched
    expect(f.fetch).toHaveBeenCalledWith(gm.url)
    expect(f.fetch).not.toHaveBeenCalledWith(mb.url)
    // distill still sees BOTH (fresh target + cached sibling) so consensus survives
    const prompt = model.mock.calls[0][0] as string
    expect(prompt).toContain('fresh gw2mists tiers')
    expect(prompt).toContain('cached metabattle builds')
    expect(s.get(m.id)!.notes).toBe('redistilled')
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

  it('passes the elite-spec map to the distiller', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const model = vi.fn().mockResolvedValue('notes')
    const eliteSpecs = vi.fn().mockResolvedValue({ Luminary: 'Guardian' })
    await new MetaRefresher({
      store: s,
      fetcher: fetcher(Object.fromEntries(pve.sources.map((x) => [x.url, { ok: true, text: 'r', pages: [] }]))),
      cache: fakeCache(),
      model,
      now: () => Date.now(),
      eliteSpecs
    }).refreshStale()
    expect(eliteSpecs).toHaveBeenCalledTimes(1)
    expect(model.mock.calls[0][0]).toContain('Luminary = Guardian')
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
    expect(events[0]).toBe('refresh-start')
    expect(events).toContain('mode-start')
    expect(events).toContain('source-start')
    expect(events).toContain('source-done')
    expect(events).toContain('mode-done')
    expect(events[events.length - 1]).toBe('idle')
  })

  it('refresh-start total equals the configured-source count across stale modes', async () => {
    const s = store()
    // mark all-but-one mode fresh so exactly one is stale
    s.list().forEach((x) => {
      if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh')
    })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const events: MetaProgress[] = []
    await new MetaRefresher({
      store: s,
      fetcher: fetcher(Object.fromEntries(pve.sources.map((x) => [x.url, { ok: true, text: 'r', pages: [] }]))),
      cache: fakeCache(),
      model: vi.fn().mockResolvedValue('notes'),
      now: () => Date.now(),
      emit: (e) => events.push(e)
    }).refreshStale()
    const start = events.find((e) => e.type === 'refresh-start')
    expect(start).toBeTruthy()
    // PvE seeds three configured sources (Snowcrows, MetaBattle, Hardstuck).
    expect(start).toEqual({ type: 'refresh-start', total: pve.sources.length })
  })
})

describe('MetaRefresher comp distillation', () => {
  it('combines build notes and comp notes when mode has both rule and build sources', async () => {
    const s = store()
    // Make only WvW stale; mark all other modes fresh
    s.list().forEach((x) => { if (x.mode !== 'WvW') s.recordDistill(x.id, 'fresh') })
    const wvw = s.list().find((x) => x.mode === 'WvW')!
    // Use one RULE url (wiki → resolveContent returns 'rules')
    // and one BUILD url (metabattle → resolveContent returns 'builds')
    const ruleUrl = 'https://wiki.guildwars2.com/wiki/Boon'
    const buildUrl = 'https://metabattle.com/wiki/WvW'
    expect(wvw.sources.map((s) => s.url)).toContain(ruleUrl)
    expect(wvw.sources.map((s) => s.url)).toContain(buildUrl)
    const model = async (prompt: string): Promise<string> => {
      if (prompt.includes('Squad Composition')) return '## Squad Composition\n- rule line'
      return '| Build | Role |\n|---|---|\n| Firebrand | Primary Support |'
    }
    await new MetaRefresher({
      store: s,
      fetcher: fetcher(
        Object.fromEntries(
          wvw.sources.map((src) => [
            src.url,
            src.url === ruleUrl || src.url === buildUrl
              ? { ok: true, text: `raw for ${src.url}`, pages: [] }
              : { ok: false, error: 'unconfigured' }
          ])
        )
      ),
      cache: fakeCache(),
      model,
      now: () => Date.now()
    }).refreshStale()
    const after = s.get(wvw.id)!
    expect(after.notes).toContain('Squad Composition')
    expect(after.notes).toContain('| Build | Role |')
  })
})

describe('MetaRefresher corpus routing', () => {
  it('routes guide pages to generalIndex and build pages to meta index', async () => {
    function fakeIndex(): MetaIndex & { pages: string[] } {
      const pages: string[] = []
      return {
        pages,
        indexedHash: async () => null,
        replacePage: async (url) => { pages.push(url) },
        search: async () => [],
        stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
        sample: async () => []
      } as MetaIndex & { pages: string[] }
    }

    const metaIdx = fakeIndex()
    const generalIdx = fakeIndex()
    const r = new MetaRefresher({
      // minimal deps; only ingest() is exercised here
      store: {} as never, fetcher: {} as never, cache: {} as never,
      model: (async () => null) as never, now: () => 0,
      index: metaIdx, generalIndex: generalIdx
    })
    // @ts-expect-error exercise private ingest directly
    await r.ingest('PvE', 'https://snowcrows.com/guides', [
      { url: 'https://snowcrows.com/guides/fractals/cm', title: 'CM', text: 'a'.repeat(400) },
      { url: 'https://snowcrows.com/builds/raids', title: 'Raids', text: 'b'.repeat(400) }
    ])
    expect(generalIdx.pages).toContain('https://snowcrows.com/guides/fractals/cm')
    expect(metaIdx.pages).toContain('https://snowcrows.com/builds/raids')
  })
})

describe('MetaRefresher ingestion', () => {
  it('indexes each fetched page via replacePage', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const url = pve.sources[0].url
    const idx = new FakeMetaIndex()
    await new MetaRefresher({
      store: s,
      fetcher: {
        fetch: async () => ({ ok: true, text: 'raw', pages: [{ url: 'https://snowcrows.com/builds/a', title: 'A', text: 'build a detail' }] })
      },
      cache: fakeCache(),
      model: () => Promise.resolve('notes'),
      now: () => Date.now(),
      index: idx
    }).refreshStale()
    expect(idx.replaced).toContain('https://snowcrows.com/builds/a')
    void url
  })

  it('skips replacePage when the page contentHash is unchanged', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const idx = new FakeMetaIndex()
    const page = { url: 'https://snowcrows.com/builds/a', title: 'A', text: 'same text' }
    const baseDeps = {
      store: s,
      fetcher: { fetch: async (): Promise<FetchResult> => ({ ok: true, text: 'raw', pages: [page] }) },
      cache: fakeCache(),
      model: () => Promise.resolve('notes'),
      index: idx
    }
    await new MetaRefresher({ ...baseDeps, now: () => Date.now() }).refreshStale()
    // re-run later (force staleness via a future now); same text => no second replace
    await new MetaRefresher({ ...baseDeps, now: () => Date.now() + 8 * 86_400_000 }).refreshStale()
    expect(idx.replaced.filter((u) => u === page.url)).toHaveLength(1)
  })

  it('isolates an index failure — summaries still update', async () => {
    const s = store()
    s.list().forEach((x) => { if (x.mode !== 'PvE') s.recordDistill(x.id, 'fresh') })
    const pve = s.list().find((x) => x.mode === 'PvE')!
    const failingIndex = {
      indexedHash: async () => null,
      replacePage: async () => { throw new Error('disk full') },
      search: async () => [],
      stats: async () => ({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
      sample: async () => []
    }
    await new MetaRefresher({
      store: s,
      fetcher: { fetch: async () => ({ ok: true, text: 'raw', pages: [{ url: 'p', title: 't', text: 'x' }] }) },
      cache: fakeCache(),
      model: () => Promise.resolve('distilled'),
      now: () => Date.now(),
      index: failingIndex
    }).refreshStale()
    expect(s.get(pve.id)!.notes).toBe('distilled')
  })
})
