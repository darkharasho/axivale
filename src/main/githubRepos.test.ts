import { describe, it, expect, vi } from 'vitest'
import { discoverReportRepos } from './githubRepos'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** /user/repos page payload from a list of owner/name pairs. */
function reposPage(repos: Array<{ owner: string; name: string }>): unknown {
  return repos.map((r) => ({ name: r.name, owner: { login: r.owner } }))
}

describe('discoverReportRepos', () => {
  it('throws a friendly error when no token is given', async () => {
    await expect(discoverReportRepos('')).rejects.toThrow(/sign in/i)
  })

  it('returns only repos whose reports/index.json check is 200', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/user/repos')) {
        return jsonResponse(
          reposPage([
            { owner: 'alice', name: 'has-reports' },
            { owner: 'alice', name: 'no-reports' }
          ])
        )
      }
      if (url.includes('/repos/alice/has-reports/contents/reports/index.json')) {
        return jsonResponse({}, 200)
      }
      if (url.includes('/repos/alice/no-reports/contents/reports/index.json')) {
        return jsonResponse({}, 404)
      }
      throw new Error(`unexpected url ${url}`)
    })
    const repos = await discoverReportRepos('TOKEN', {
      fetchFn: fetchFn as unknown as typeof fetch
    })
    expect(repos).toEqual([{ owner: 'alice', repo: 'has-reports' }])
  })

  it('sends the documented auth + API headers on /user/repos', async () => {
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/user/repos')) return jsonResponse(reposPage([]))
      return jsonResponse({}, 404)
    })
    await discoverReportRepos('TOK', { fetchFn: fetchFn as unknown as typeof fetch })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://api.github.com/user/repos')
    expect(url).toContain('per_page=100')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer TOK')
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(headers['User-Agent']).toBe('AxiVale')
  })

  it('tolerates a 404 and a thrown error on individual repo checks', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/user/repos')) {
        return jsonResponse(
          reposPage([
            { owner: 'a', name: 'ok' },
            { owner: 'a', name: 'missing' },
            { owner: 'a', name: 'boom' }
          ])
        )
      }
      if (url.includes('/repos/a/ok/contents/')) return jsonResponse({}, 200)
      if (url.includes('/repos/a/missing/contents/')) return jsonResponse({}, 404)
      if (url.includes('/repos/a/boom/contents/')) throw new Error('network')
      throw new Error(`unexpected url ${url}`)
    })
    const repos = await discoverReportRepos('TOKEN', {
      fetchFn: fetchFn as unknown as typeof fetch
    })
    expect(repos).toEqual([{ owner: 'a', repo: 'ok' }])
  })

  it('throws a friendly error on a 401 from /user/repos', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 401))
    await expect(
      discoverReportRepos('TOKEN', { fetchFn: fetchFn as unknown as typeof fetch })
    ).rejects.toThrow(/expired|repo access|sign in again/i)
  })

  it('throws on other non-ok responses from /user/repos', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 500))
    await expect(
      discoverReportRepos('TOKEN', { fetchFn: fetchFn as unknown as typeof fetch })
    ).rejects.toThrow(/500/)
  })

  it('caps the number of repos checked at 100', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ owner: 'a', name: `r${i}` }))
    let checks = 0
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/user/repos')) return jsonResponse(reposPage(many))
      checks += 1
      return jsonResponse({}, 404)
    })
    await discoverReportRepos('TOKEN', { fetchFn: fetchFn as unknown as typeof fetch })
    expect(checks).toBeLessThanOrEqual(100)
  })

  it('respects the concurrency cap', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ owner: 'a', name: `r${i}` }))
    let inFlight = 0
    let maxInFlight = 0
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/user/repos')) return jsonResponse(reposPage(many))
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight -= 1
      return jsonResponse({}, 404)
    })
    await discoverReportRepos('TOKEN', {
      fetchFn: fetchFn as unknown as typeof fetch,
      concurrency: 8
    })
    expect(maxInFlight).toBeLessThanOrEqual(8)
  })
})
