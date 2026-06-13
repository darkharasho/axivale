// src/main/shareGithub.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createGithubShareClient } from './shareGithub'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('createGithubShareClient', () => {
  it('login resolves the authenticated user and caches it', async () => {
    const fetchFn = vi.fn(async () => json({ login: 'alice' }))
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    expect(await gh.login()).toBe('alice')
    expect(await gh.login()).toBe('alice')
    expect(fetchFn).toHaveBeenCalledTimes(1) // cached
  })

  it('ensureRepo creates the repo only when it does not exist', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/user') && !init) return json({ login: 'alice' })
      if (url.includes('/repos/alice/axivale-shares') && (!init || init.method === undefined))
        return json({ message: 'Not Found' }, 404)
      if (url.endsWith('/user/repos') && init?.method === 'POST') return json({}, 201)
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await gh.ensureRepo('axivale-shares')
    const createCall = fetchFn.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'POST')
    expect(createCall).toBeTruthy()
    expect(JSON.parse((createCall![1] as RequestInit).body as string)).toMatchObject({
      name: 'axivale-shares',
      private: false,
      auto_init: true
    })
  })

  it('ensureRepo is a no-op when the repo already exists', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      if (url.includes('/repos/alice/axivale-shares')) return json({ name: 'axivale-shares' }, 200)
      throw new Error(`unexpected ${url}`)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await gh.ensureRepo('axivale-shares')
    expect(fetchFn.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(false)
  })

  it('getFileSha returns the sha or null on 404', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      if (url.includes('/contents/exists')) return json({ sha: 'deadbeef' })
      return json({ message: 'Not Found' }, 404)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    expect(await gh.getFileSha('axivale-shares', 'exists')).toBe('deadbeef')
    expect(await gh.getFileSha('axivale-shares', 'missing')).toBeNull()
  })

  it('putFile PUTs base64 content with sha when updating', async () => {
    const fetchFn = vi.fn(async () => json({}, 200))
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await gh.ensureRepoOwnerForTest?.('alice') // no-op if undefined
    await gh.putFile('axivale-shares', 'shares/x.json', 'YmFzZTY0', 'add x', 'oldsha')
    const call = fetchFn.mock.calls.at(-1)!
    expect((call[1] as RequestInit).method).toBe('PUT')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body).toMatchObject({ content: 'YmFzZTY0', message: 'add x', sha: 'oldsha' })
  })

  it('enablePages swallows 409 already-enabled', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      return json({ message: 'already exists' }, 409)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await expect(gh.enablePages('axivale-shares')).resolves.toBeUndefined()
  })

  it('pagesUrl returns html_url or null', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      if (url.includes('/pages')) return json({ html_url: 'https://alice.github.io/axivale-shares/' })
      throw new Error('x')
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    expect(await gh.pagesUrl('axivale-shares')).toBe('https://alice.github.io/axivale-shares/')
  })
})
