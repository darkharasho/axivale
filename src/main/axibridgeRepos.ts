/** Linked AxiBridge report repos: parsing + settings (de)serialization. */

export interface RepoRef {
  owner: string
  repo: string
}

export const repoKey = (ref: RepoRef): string => `${ref.owner}/${ref.repo}`

/**
 * Accepts "owner/repo", a github.com repo URL, or a GitHub Pages URL
 * (https://owner.github.io/repo/...). Returns null for anything else.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  const pages = trimmed.match(/^https?:\/\/([a-z0-9-]+)\.github\.io\/([^/?#]+)/i)
  if (pages) return { owner: pages[1], repo: pages[2] }
  const githubUrl = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?$/i)
  if (githubUrl) return { owner: githubUrl[1], repo: githubUrl[2] }
  const plain = trimmed.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/)
  if (plain) return { owner: plain[1], repo: plain[2] }
  return null
}

/** Parse the axibridgeRepos setting (JSON array). Tolerates null/garbage. */
export function listLinkedRepos(raw: string | null): RepoRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is RepoRef => typeof r?.owner === 'string' && typeof r?.repo === 'string')
      .map((r) => ({ owner: r.owner, repo: r.repo }))
  } catch {
    return []
  }
}

export function serializeLinkedRepos(repos: RepoRef[]): string {
  return JSON.stringify(repos.map((r) => ({ owner: r.owner, repo: r.repo })))
}
