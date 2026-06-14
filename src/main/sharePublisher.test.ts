// src/main/sharePublisher.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SharePublisher, type GithubShareClient, type ViewerBundle } from './sharePublisher'
import type { ShareDoc } from './shareTypes'

function stubClient(over: Partial<GithubShareClient> = {}): GithubShareClient {
  return {
    login: vi.fn(async () => 'alice'),
    ensureRepo: vi.fn(async () => {}),
    getFileSha: vi.fn(async () => null),
    getFileContent: vi.fn(async () => null),
    putFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    enablePages: vi.fn(async () => {}),
    pagesUrl: vi.fn(async () => 'https://alice.github.io/axivale-shares/'),
    ...over
  }
}

const VIEWER: ViewerBundle = {
  version: 'v1',
  files: [
    { path: 'index.html', base64: 'aHRtbA==' },
    { path: 'assets/app.js', base64: 'anM=' }
  ]
}

const DOC: ShareDoc = {
  v: 1,
  id: 'abc',
  kind: 'conversation',
  title: 'Hello',
  createdAt: '2026-06-13T00:00:00Z',
  app: { name: 'AxiVale', version: '0.3.2' },
  turns: []
}

/** A fetch stub that returns `status` for every request. */
function fetchReturning(status: number): typeof fetch {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
}

/** Build a publisher with the liveness poll stubbed live-by-default and no real delays. */
function makePub(client: GithubShareClient, over: Partial<ConstructorParameters<typeof SharePublisher>[0]> = {}) {
  return new SharePublisher({
    client: () => client,
    viewer: () => VIEWER,
    repo: 'axivale-shares',
    fetchFn: fetchReturning(200),
    delayFn: async () => {},
    pollIntervalMs: 1,
    pollTimeoutMs: 50,
    ...over
  })
}

describe('SharePublisher.publishDoc', () => {
  it('first run: creates repo, pushes viewer + marker, enables Pages, writes the doc', async () => {
    const client = stubClient()
    const res = await makePub(client).publishDoc(DOC)

    expect(client.ensureRepo).toHaveBeenCalledWith('axivale-shares')
    const written = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
    expect(written).toContain('index.html')
    expect(written).toContain('assets/app.js')
    expect(written).toContain('viewer-version')
    expect(written).toContain('shares/abc.json')
    expect(client.enablePages).toHaveBeenCalledWith('axivale-shares')
    expect(res.url).toBe('https://alice.github.io/axivale-shares/#/s/abc')
  })

  it('skips viewer push when the marker already matches', async () => {
    const client = stubClient({ getFileContent: vi.fn(async (_r, p) => (p === 'viewer-version' ? 'v1' : null)) })
    await makePub(client).publishDoc(DOC)
    const written = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
    expect(written).not.toContain('index.html')
    expect(written).toContain('shares/abc.json')
  })

  it('passes the existing sha when overwriting a share doc', async () => {
    const client = stubClient({
      getFileContent: vi.fn(async () => 'v1'),
      getFileSha: vi.fn(async (_r, p) => (p === 'shares/abc.json' ? 'oldsha' : null))
    })
    await makePub(client).publishDoc(DOC)
    const docCall = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === 'shares/abc.json')
    expect(docCall![4]).toBe('oldsha')
  })

  it('response shares get the right url', async () => {
    const client = stubClient({ getFileContent: vi.fn(async () => 'v1') })
    const res = await makePub(client).publishDoc({ ...DOC, id: 'xyz', kind: 'response' })
    expect(res.url).toBe('https://alice.github.io/axivale-shares/#/s/xyz')
  })

  it('reports live:true after polling the Pages site and the raw share JSON', async () => {
    const client = stubClient({ getFileContent: vi.fn(async () => 'v1') })
    const fetchFn = fetchReturning(200)
    const res = await makePub(client, { fetchFn }).publishDoc(DOC)
    expect(res.live).toBe(true)
    const urls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.startsWith('https://alice.github.io/axivale-shares/?'))).toBe(true)
    expect(
      urls.some((u) =>
        u.startsWith('https://raw.githubusercontent.com/alice/axivale-shares/main/shares/abc.json')
      )
    ).toBe(true)
  })

  it('waits for a pending build: 404s then 200 → live:true', async () => {
    const client = stubClient({ getFileContent: vi.fn(async () => 'v1') })
    let n = 0
    const fetchFn = vi.fn(async () => new Response('', { status: n++ < 2 ? 404 : 200 })) as unknown as typeof fetch
    const res = await makePub(client, { fetchFn }).publishDoc(DOC)
    expect(res.live).toBe(true)
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('reports live:false when the page never serves before timeout', async () => {
    const client = stubClient({ getFileContent: vi.fn(async () => 'v1') })
    const res = await makePub(client, { fetchFn: fetchReturning(404), pollTimeoutMs: 5, pollIntervalMs: 1 }).publishDoc(DOC)
    expect(res.live).toBe(false)
  })
})

describe('SharePublisher.deleteDoc', () => {
  it('deletes the doc file using its sha; no-op when already gone', async () => {
    const client = stubClient({ getFileSha: vi.fn(async () => 'sha1') })
    await makePub(client).deleteDoc('abc')
    expect(client.deleteFile).toHaveBeenCalledWith('axivale-shares', 'shares/abc.json', expect.any(String), 'sha1')

    const gone = stubClient({ getFileSha: vi.fn(async () => null) })
    await makePub(gone).deleteDoc('abc')
    expect(gone.deleteFile).not.toHaveBeenCalled()
  })
})
