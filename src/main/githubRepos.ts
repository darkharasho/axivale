// Auto-discover the signed-in user's AxiBridge report repos.
//
// A "report repo" is any repo the user can see that contains reports/index.json
// (the file AxiBridge publishes). After GitHub sign-in we scan the user's most
// recently-pushed repos and probe each for that file, so linking is automatic
// instead of a manual owner/repo step.
//
// Pure + injectable: fetch is a parameter so this is unit-testable with no real
// network. Mirrors the header conventions of githubAuth.ts.

import type { RepoRef } from './axibridgeRepos'

const GITHUB_API = 'https://api.github.com'
const UA = 'AxiVale'

export type FetchFn = typeof fetch

export interface DiscoverOptions {
  fetchFn?: FetchFn
  /** Max simultaneous reports/index.json probes. */
  concurrency?: number
  /** Hard cap on repos probed (keeps the scan bounded). */
  maxRepos?: number
}

const DEFAULT_CONCURRENCY = 8
const MAX_REPOS = 100

function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

interface GithubRepo {
  name?: string
  owner?: { login?: string }
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Discover the user's report repos (those containing reports/index.json).
 *
 * Fetches up to one page (100) of the user's most-recently-pushed repos across
 * owner/collaborator/org affiliations, then probes each for reports/index.json
 * with bounded concurrency. Per-repo probe failures are treated as "not a report
 * repo" and never abort the scan. Only the initial /user/repos failure surfaces.
 */
export async function discoverReportRepos(
  token: string,
  opts: DiscoverOptions = {}
): Promise<RepoRef[]> {
  if (!token) {
    throw new Error('Sign in with GitHub first to find your report repos.')
  }
  const fetchFn = opts.fetchFn ?? fetch
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  const maxRepos = opts.maxRepos ?? MAX_REPOS

  const listUrl = `${GITHUB_API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`
  const res = await fetchFn(listUrl, { headers: apiHeaders(token) })
  if (res.status === 401) {
    throw new Error('GitHub sign-in expired or lacks repo access — sign in again.')
  }
  if (!res.ok) {
    throw new Error(`GitHub could not list your repos (${res.status}).`)
  }

  const data = (await res.json()) as unknown
  const refs: RepoRef[] = (Array.isArray(data) ? (data as GithubRepo[]) : [])
    .map((r) => ({ owner: r.owner?.login, repo: r.name }))
    .filter((r): r is RepoRef => typeof r.owner === 'string' && typeof r.repo === 'string')
    .slice(0, maxRepos)

  const flags = await mapLimit(refs, concurrency, async (ref) => {
    try {
      const probe = await fetchFn(
        `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/contents/reports/index.json`,
        { headers: apiHeaders(token) }
      )
      return probe.status === 200
    } catch {
      return false // network/abort on one repo shouldn't sink the whole scan
    }
  })

  return refs.filter((_, i) => flags[i])
}
