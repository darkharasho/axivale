import path from 'path'
import { resolveAsset } from './assets'
import { parsePullLine, PullProgress } from './pullProgress'

export interface OllamaStatus {
  installed: boolean
  serverRunning: boolean
  version: string | null
  model: string | null
}

export interface ServeHandle {
  kill: () => void
  on: (event: string, cb: (...a: unknown[]) => void) => void
}

export interface OllamaDeps {
  existsSync: (p: string) => boolean
  mkdirSync: (p: string, opts: { recursive: boolean }) => void
  rmSync: (p: string, opts: { recursive: boolean; force: boolean }) => void
  chmodSync: (p: string, mode: number) => void
  download: (url: string, dest: string, onPct: (pct: number) => void) => Promise<void>
  extract: (archive: 'tgz' | 'zip', src: string, destDir: string) => Promise<void>
  spawnServe: (binPath: string, endpoint: string) => ServeHandle
  httpGet: (url: string) => Promise<{ models?: { name: string }[] }>
  httpPullStream: (model: string, onLine: (line: string) => void, endpoint: string) => Promise<void>
  platform: string
  arch: string
}

export type StageProgress = { stage: string; percent?: number }

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'

export class OllamaManager {
  private baseDir: string
  private binPath: string
  private serve: ServeHandle | null = null
  private endpoint = DEFAULT_ENDPOINT

  constructor(userDataPath: string, private deps: OllamaDeps) {
    this.baseDir = path.join(userDataPath, 'ollama')
    const asset = resolveAsset(deps.platform, deps.arch)
    this.binPath = path.join(this.baseDir, asset.binRelPath)
  }

  getEndpoint(): string {
    return this.endpoint
  }

  isInstalled(): boolean {
    return this.deps.existsSync(this.binPath)
  }

  async getStatus(): Promise<OllamaStatus> {
    const installed = this.isInstalled()
    let serverRunning = false
    let model: string | null = null
    try {
      const tags = await this.deps.httpGet(`${this.endpoint}/api/tags`)
      serverRunning = true
      model = tags.models && tags.models.length > 0 ? tags.models[0].name : null
    } catch {
      serverRunning = false
    }
    return { installed, serverRunning, version: null, model }
  }

  async install(onProgress: (p: StageProgress) => void): Promise<void> {
    if (this.isInstalled()) return
    const asset = resolveAsset(this.deps.platform, this.deps.arch)
    this.deps.mkdirSync(this.baseDir, { recursive: true })
    const archivePath = path.join(this.baseDir, `ollama.${asset.archive === 'tgz' ? 'tgz' : 'zip'}`)
    onProgress({ stage: 'Downloading Ollama', percent: 0 })
    await this.deps.download(asset.url, archivePath, (pct) =>
      onProgress({ stage: 'Downloading Ollama', percent: pct })
    )
    onProgress({ stage: 'Extracting Ollama' })
    await this.deps.extract(asset.archive, archivePath, this.baseDir)
    if (this.deps.platform !== 'win32') {
      this.deps.chmodSync(this.binPath, 0o755)
    }
    onProgress({ stage: 'Installed' })
  }

  async ensureServerRunning(): Promise<void> {
    const status = await this.getStatus()
    if (status.serverRunning) return
    this.serve = this.deps.spawnServe(this.binPath, this.endpoint)
    // Poll /api/tags until it answers, up to ~30s.
    for (let i = 0; i < 60; i++) {
      try {
        await this.deps.httpGet(`${this.endpoint}/api/tags`)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    throw new Error('Ollama server did not become ready within 30s')
  }

  async pullModel(model: string, onProgress: (p: PullProgress) => void): Promise<void> {
    let pullError: string | null = null
    await this.deps.httpPullStream(
      model,
      (line) => {
        const p = parsePullLine(line)
        if (!p) return
        if (p.error) pullError = p.error
        onProgress(p)
      },
      this.endpoint
    )
    if (pullError) throw new Error(pullError)
  }

  stopServer(): void {
    if (this.serve) {
      try {
        this.serve.kill()
      } catch {
        /* ignore */
      }
      this.serve = null
    }
  }

  uninstall(): void {
    this.stopServer()
    if (this.deps.existsSync(this.baseDir)) {
      this.deps.rmSync(this.baseDir, { recursive: true, force: true })
    }
  }
}
