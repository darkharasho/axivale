// src/main/shareGithub.ts
//
// Thin GitHub REST wrapper for publishing shares. Injectable fetch (no real
// network in tests). All operations target repos owned by the authenticated
// user; the login is resolved once and cached. Mirrors header conventions in
// githubRepos.ts.

import type { GithubShareClient } from './sharePublisher'

const GITHUB_API = 'https://api.github.com'
const UA = 'AxiVale'

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

export function createGithubShareClient(
  token: string,
  fetchFn: typeof fetch = fetch
): GithubShareClient {
  if (!token) throw new Error('Sign in with GitHub first to share.')

  let cachedLogin = ''
  async function login(): Promise<string> {
    if (cachedLogin) return cachedLogin
    const res = await fetchFn(`${GITHUB_API}/user`, { headers: headers(token) })
    if (res.status === 401) throw new Error('GitHub sign-in expired — sign in again.')
    if (!res.ok) throw new Error(`GitHub could not identify your account (${res.status}).`)
    const data = (await res.json()) as { login?: string }
    if (!data.login) throw new Error('GitHub did not return your login.')
    cachedLogin = data.login
    return cachedLogin
  }

  async function ensureRepo(repo: string): Promise<void> {
    const owner = await login()
    const probe = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: headers(token) })
    if (probe.ok) return
    if (probe.status !== 404) throw new Error(`GitHub could not check your repo (${probe.status}).`)
    const res = await fetchFn(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repo,
        private: false,
        auto_init: true,
        description: 'AxiVale shared dispatches'
      })
    })
    if (!res.ok) throw new Error(`GitHub could not create the share repo (${res.status}).`)
  }

  async function getFileSha(repo: string, path: string): Promise<string | null> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers: headers(token)
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub could not read ${path} (${res.status}).`)
    const data = (await res.json()) as { sha?: string }
    return data.sha ?? null
  }

  async function getFileContent(repo: string, path: string): Promise<string | null> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers: headers(token)
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub could not read ${path} (${res.status}).`)
    const data = (await res.json()) as { content?: string }
    if (!data.content) return null
    return Buffer.from(data.content, 'base64').toString('utf8')
  }

  async function putFile(
    repo: string,
    path: string,
    base64: string,
    message: string,
    sha?: string
  ): Promise<void> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64, ...(sha ? { sha } : {}) })
    })
    if (!res.ok) throw new Error(`GitHub could not write ${path} (${res.status}).`)
  }

  async function deleteFile(
    repo: string,
    path: string,
    message: string,
    sha: string
  ): Promise<void> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha })
    })
    if (!res.ok) throw new Error(`GitHub could not delete ${path} (${res.status}).`)
  }

  async function enablePages(repo: string): Promise<void> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/pages`, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { branch: 'main', path: '/' } })
    })
    if (res.ok || res.status === 409) return // 409 = already enabled
    throw new Error(`GitHub could not enable Pages (${res.status}).`)
  }

  async function pagesUrl(repo: string): Promise<string | null> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/pages`, {
      headers: headers(token)
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub could not read Pages config (${res.status}).`)
    const data = (await res.json()) as { html_url?: string }
    return data.html_url ?? null
  }

  return { login, ensureRepo, getFileSha, getFileContent, putFile, deleteFile, enablePages, pagesUrl }
}
