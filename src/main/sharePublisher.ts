// src/main/sharePublisher.ts
//
// Orchestrates publishing: ensure repo -> ensure viewer SPA present (push when
// the version marker differs) -> enable Pages -> write/delete shares/<id>.json.
// Depends on the GithubShareClient interface (stubbed in tests) and a
// ViewerBundle value (read from disk in production by shareViewerBundle.ts), so
// it needs neither real network nor real filesystem under test.

import type { ShareDoc } from './shareTypes'

export interface GithubShareClient {
  login(): Promise<string>
  ensureRepo(repo: string): Promise<void>
  getFileSha(repo: string, path: string): Promise<string | null>
  getFileContent(repo: string, path: string): Promise<string | null>
  putFile(repo: string, path: string, base64: string, message: string, sha?: string): Promise<void>
  deleteFile(repo: string, path: string, message: string, sha: string): Promise<void>
  enablePages(repo: string): Promise<void>
  pagesUrl(repo: string): Promise<string | null>
}

/** The built share-viewer static files + a content version marker. */
export interface ViewerBundle {
  version: string
  files: Array<{ path: string; base64: string }>
}

const MARKER = 'viewer-version'

export interface SharePublisherDeps {
  /** Build a client for the current GitHub token; throws if not signed in. */
  client: () => GithubShareClient
  /** Load the built viewer bundle (from disk in production). */
  viewer: () => ViewerBundle
  repo: string
}

export interface ShareStatus {
  signedIn: boolean
  repoReady: boolean
  pagesUrl: string | null
}

export class SharePublisher {
  constructor(private readonly deps: SharePublisherDeps) {}

  private async ensureViewer(client: GithubShareClient): Promise<void> {
    const bundle = this.deps.viewer()
    const current = await client.getFileContent(this.deps.repo, MARKER)
    if (current === bundle.version) return
    for (const file of bundle.files) {
      const sha = (await client.getFileSha(this.deps.repo, file.path)) ?? undefined
      await client.putFile(this.deps.repo, file.path, file.base64, `chore: publish share viewer`, sha)
    }
    const markerSha = (await client.getFileSha(this.deps.repo, MARKER)) ?? undefined
    await client.putFile(
      this.deps.repo,
      MARKER,
      Buffer.from(bundle.version, 'utf8').toString('base64'),
      'chore: record share viewer version',
      markerSha
    )
  }

  async publishDoc(doc: ShareDoc): Promise<{ url: string }> {
    const client = this.deps.client()
    const login = await client.login()
    await client.ensureRepo(this.deps.repo)
    await this.ensureViewer(client)
    await client.enablePages(this.deps.repo)

    const path = `shares/${doc.id}.json`
    const base64 = Buffer.from(JSON.stringify(doc), 'utf8').toString('base64')
    const sha = (await client.getFileSha(this.deps.repo, path)) ?? undefined
    await client.putFile(this.deps.repo, path, base64, `share: ${doc.id}`, sha)

    return { url: `https://${login}.github.io/${this.deps.repo}/#/s/${doc.id}` }
  }

  async deleteDoc(id: string): Promise<void> {
    const client = this.deps.client()
    const path = `shares/${id}.json`
    const sha = await client.getFileSha(this.deps.repo, path)
    if (!sha) return // already gone
    await client.deleteFile(this.deps.repo, path, `share: remove ${id}`, sha)
  }

  async status(): Promise<ShareStatus> {
    let client: GithubShareClient
    try {
      client = this.deps.client()
    } catch {
      return { signedIn: false, repoReady: false, pagesUrl: null }
    }
    try {
      const url = await client.pagesUrl(this.deps.repo)
      return { signedIn: true, repoReady: url !== null, pagesUrl: url }
    } catch {
      return { signedIn: true, repoReady: false, pagesUrl: null }
    }
  }
}
