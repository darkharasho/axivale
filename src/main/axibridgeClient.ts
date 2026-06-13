import type { RepoRef } from './axibridgeRepos'
import { repoKey } from './axibridgeRepos'
import { parseRollupSourcesFile, type RollupSourcesFile } from '@axiapps/bridge-metrics'

export type AxibridgeErrorCode = 'not-found' | 'rate-limited' | 'network' | 'schema'

export class AxibridgeError extends Error {
  constructor(
    message: string,
    readonly code: AxibridgeErrorCode
  ) {
    super(message)
  }
}

export interface ReportIndexEntry {
  id: string
  title: string
  commanders: string[]
  dateStart: string | null
  dateEnd: string | null
  dateLabel?: string
  summary?: { avgSquadSize: number | null; avgEnemySize: number | null }
}

/** URL builders are injectable so tests run against a local stub server. */
export interface UrlBuilders {
  rawBase: (repo: RepoRef, branch: string) => string
  pagesBase: (repo: RepoRef) => string
}

const DEFAULT_URLS: UrlBuilders = {
  rawBase: (repo, branch) =>
    `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}`,
  pagesBase: (repo) => `https://${repo.owner}.github.io/${repo.repo}`
}

const BRANCHES = ['main', 'gh-pages']

export class AxibridgeClient {
  constructor(
    private readonly pat: () => string | null,
    private readonly urls: UrlBuilders = DEFAULT_URLS
  ) {}

  /** Authorization/User-Agent headers for raw GitHub requests (PAT when set). */
  authHeaders(): Record<string, string> {
    const token = this.pat()
    return token
      ? { 'User-Agent': 'AxiVale', Authorization: `Bearer ${token}` }
      : { 'User-Agent': 'AxiVale' }
  }

  /** True when the URL targets the repo's GitHub Pages site (no PAT there). */
  isPagesUrl(repo: RepoRef, url: string): boolean {
    return url.startsWith(this.urls.pagesBase(repo))
  }

  /** Candidate URLs in priority order: raw (per branch), then Pages. */
  candidateUrls(repo: RepoRef, relPath: string): string[] {
    return [
      ...BRANCHES.map((branch) => `${this.urls.rawBase(repo, branch)}/${relPath}`),
      `${this.urls.pagesBase(repo)}/${relPath}`
    ]
  }

  /** Fetch a JSON file, trying raw first and the Pages site as fallback.
   *  Returns null when every source 404s (caller decides if that is an error). */
  private async fetchJsonOrNull(repo: RepoRef, relPath: string): Promise<unknown | null> {
    let lastNetworkError: string | null = null
    for (const url of this.candidateUrls(repo, relPath)) {
      let resp: Response
      try {
        // Pages URLs never get the PAT — it is only meaningful to GitHub itself.
        const isPages = this.isPagesUrl(repo, url)
        resp = await fetch(url, { headers: isPages ? { 'User-Agent': 'AxiVale' } : this.authHeaders() })
      } catch {
        lastNetworkError = url
        continue
      }
      if (resp.status === 404) continue
      if (resp.status === 403 || resp.status === 429) {
        throw new AxibridgeError(
          `GitHub rate-limited the request for ${repoKey(repo)} — add a GitHub PAT in Settings to raise the limit.`,
          'rate-limited'
        )
      }
      if (!resp.ok) continue
      try {
        return await resp.json()
      } catch {
        throw new AxibridgeError(`Invalid JSON at ${url}`, 'schema')
      }
    }
    if (lastNetworkError) {
      throw new AxibridgeError(
        `Could not reach ${repoKey(repo)} — check your network connection.`,
        'network'
      )
    }
    return null
  }

  async fetchIndex(repo: RepoRef): Promise<ReportIndexEntry[]> {
    const data = await this.fetchJsonOrNull(repo, 'reports/index.json')
    if (data === null) {
      throw new AxibridgeError(
        `Repo ${repoKey(repo)} is unreachable or has no reports/index.json — check the repo name in Settings. Other linked repos are unaffected.`,
        'not-found'
      )
    }
    // Old repos publish a plain array; newer ones { colorPalette, entries }.
    const entries = Array.isArray(data)
      ? data
      : Array.isArray((data as { entries?: unknown[] })?.entries)
        ? (data as { entries: unknown[] }).entries
        : []
    return entries
      .map((e) => e as Record<string, unknown>)
      .filter((e) => typeof e?.id === 'string')
      .map((e) => ({
        id: String(e.id),
        title: String(e.title ?? e.id),
        commanders: Array.isArray(e.commanders) ? e.commanders.map(String) : [],
        dateStart: typeof e.dateStart === 'string' ? e.dateStart : null,
        dateEnd: typeof e.dateEnd === 'string' ? e.dateEnd : null,
        dateLabel: typeof e.dateLabel === 'string' ? e.dateLabel : undefined,
        summary: (e.summary as ReportIndexEntry['summary']) ?? undefined
      }))
  }

  /** Null when the repo has no rollup.json (older repos) — caller computes locally. */
  async fetchRollup(repo: RepoRef): Promise<RollupSourcesFile | null> {
    const data = await this.fetchJsonOrNull(repo, 'reports/rollup.json')
    if (data === null) return null
    return parseRollupSourcesFile(data)
  }

  async fetchReport(repo: RepoRef, reportId: string): Promise<unknown> {
    const data = await this.fetchJsonOrNull(repo, `reports/${reportId}/report.json`)
    if (data === null) {
      throw new AxibridgeError(`Report ${reportId} not found in ${repoKey(repo)}.`, 'not-found')
    }
    return data
  }
}
