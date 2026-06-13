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

describe('SharePublisher.publishDoc', () => {
  it('first run: creates repo, pushes viewer + marker, enables Pages, writes the doc', async () => {
    const client = stubClient()
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    const res = await pub.publishDoc(DOC)

    expect(client.ensureRepo).toHaveBeenCalledWith('axivale-shares')
    // viewer files + marker pushed
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
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub.publishDoc(DOC)
    const written = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
    expect(written).not.toContain('index.html')
    expect(written).toContain('shares/abc.json')
  })

  it('passes the existing sha when overwriting a share doc', async () => {
    const client = stubClient({
      getFileContent: vi.fn(async () => 'v1'),
      getFileSha: vi.fn(async (_r, p) => (p === 'shares/abc.json' ? 'oldsha' : null))
    })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub.publishDoc(DOC)
    const docCall = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === 'shares/abc.json')
    expect(docCall![4]).toBe('oldsha')
  })

  it('response shares get the right url', async () => {
    const client = stubClient({ getFileContent: vi.fn(async () => 'v1') })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    const res = await pub.publishDoc({ ...DOC, id: 'xyz', kind: 'response' })
    expect(res.url).toBe('https://alice.github.io/axivale-shares/#/s/xyz')
  })
})

describe('SharePublisher.deleteDoc', () => {
  it('deletes the doc file using its sha; no-op when already gone', async () => {
    const client = stubClient({ getFileSha: vi.fn(async () => 'sha1') })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub.deleteDoc('abc')
    expect(client.deleteFile).toHaveBeenCalledWith('axivale-shares', 'shares/abc.json', expect.any(String), 'sha1')

    const gone = stubClient({ getFileSha: vi.fn(async () => null) })
    const pub2 = new SharePublisher({ client: () => gone, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub2.deleteDoc('abc')
    expect(gone.deleteFile).not.toHaveBeenCalled()
  })
})
