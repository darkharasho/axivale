import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'

export class AxiforgeError extends Error {}
export class AxiforgeNotRunningError extends AxiforgeError {
  constructor(message = 'AxiForge is not running on this machine.') {
    super(message)
  }
}

/** Contents of AxiForge's <userData>/data/local-api.json, written on every launch. */
export interface AxiforgeDiscovery {
  port: number
  token: string
  exePath: string
  version: string
  pid: number
}

export interface ForgeFolder {
  id: string
  name: string
}

/** Builds/comps are AxiForge-owned documents — known listing fields typed, the rest passed through. */
export interface ForgeBuild {
  [key: string]: unknown
  id: string
  title: string
  profession: string
  tags?: string[]
  folderId?: string | null
  updatedAt?: string
}

export interface ForgeComp {
  [key: string]: unknown
  id: string
  name?: string
  title?: string
  folderId?: string | null
  updatedAt?: string
}

export interface ForgeImportOptions {
  name?: string
  folderId?: string
  gameMode?: string
}

export type AxiforgeStatus =
  | { state: 'connected'; version: string }
  | { state: 'file-only' }
  | { state: 'offline' }

/**
 * AxiForge's <userData>/data dir per platform. The Electron app name is
 * "axiforge-desktop" (package.json name; no top-level productName), so that is
 * the userData directory name on every platform.
 */
export function forgeDataDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'axiforge-desktop', 'data')
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'axiforge-desktop', 'data')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'axiforge-desktop', 'data')
}

export interface AxiforgeClientOptions {
  /** AxiForge's data dir: holds local-api.json, builds.json, comps.json, folders.json. */
  dataDir: string
  /** AxiVale-side file persisting catalog responses across AxiForge restarts. */
  catalogCachePath: string
}

interface CatalogCacheFile {
  entries: Record<string, unknown>
  savedAt: string
}

export class AxiforgeClient {
  constructor(private readonly opts: AxiforgeClientOptions) {}

  // --- discovery + transport ----------------------------------------------

  async readDiscovery(): Promise<AxiforgeDiscovery> {
    let raw: string
    try {
      raw = await readFile(join(this.opts.dataDir, 'local-api.json'), 'utf8')
    } catch {
      throw new AxiforgeNotRunningError()
    }
    try {
      const parsed = JSON.parse(raw) as AxiforgeDiscovery
      if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') {
        throw new Error('malformed')
      }
      return parsed
    } catch {
      throw new AxiforgeNotRunningError()
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const disc = await this.readDiscovery()
    let resp: Response
    try {
      resp = await fetch(`http://127.0.0.1:${disc.port}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${disc.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      // Connection refused with a discovery file present = the app crashed
      // without cleanup (stale file). Treat exactly like "closed".
      throw new AxiforgeNotRunningError()
    }
    if (resp.status === 204) return undefined as T
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new AxiforgeError(
        (data as { error?: string }).error ?? `AxiForge API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  // --- read-only file fallback (never writes; concurrent reads are safe) ---

  private async readJsonFile<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.opts.dataDir, name), 'utf8')) as T
    } catch {
      return null
    }
  }

  private async withFileFallback<T>(api: () => Promise<T>, file: () => Promise<T>): Promise<T> {
    try {
      return await api()
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
      return file()
    }
  }

  // --- builds ----------------------------------------------------------------

  listBuilds(): Promise<ForgeBuild[]> {
    return this.withFileFallback(
      () => this.request('GET', '/builds'),
      async () => (await this.readJsonFile<ForgeBuild[]>('builds.json')) ?? []
    )
  }

  getBuild(id: string): Promise<ForgeBuild> {
    return this.withFileFallback(
      () => this.request('GET', `/builds/${encodeURIComponent(id)}`),
      async () => {
        const build = ((await this.readJsonFile<ForgeBuild[]>('builds.json')) ?? []).find(
          (b) => b.id === id
        )
        if (!build) throw new AxiforgeError(`No AxiForge build with id "${id}".`)
        return build
      }
    )
  }

  saveBuild(build: Record<string, unknown>): Promise<ForgeBuild> {
    return this.request('POST', '/builds', build)
  }

  deleteBuild(id: string): Promise<void> {
    return this.request('DELETE', `/builds/${encodeURIComponent(id)}`)
  }

  publishBuild(id: string): Promise<unknown> {
    return this.request('POST', `/builds/${encodeURIComponent(id)}/publish`)
  }

  buildChatLink(id: string): Promise<{ chatLink: string }> {
    return this.request('POST', `/builds/${encodeURIComponent(id)}/chat-link`)
  }

  // --- comps -------------------------------------------------------------------

  listComps(): Promise<ForgeComp[]> {
    return this.withFileFallback(
      () => this.request('GET', '/comps'),
      async () => (await this.readJsonFile<ForgeComp[]>('comps.json')) ?? []
    )
  }

  getComp(id: string): Promise<ForgeComp> {
    return this.withFileFallback(
      () => this.request('GET', `/comps/${encodeURIComponent(id)}`),
      async () => {
        const comp = ((await this.readJsonFile<ForgeComp[]>('comps.json')) ?? []).find(
          (c) => c.id === id
        )
        if (!comp) throw new AxiforgeError(`No AxiForge comp with id "${id}".`)
        return comp
      }
    )
  }

  saveComp(comp: Record<string, unknown>): Promise<ForgeComp> {
    return this.request('POST', '/comps', comp)
  }

  deleteComp(id: string): Promise<void> {
    return this.request('DELETE', `/comps/${encodeURIComponent(id)}`)
  }

  publishComp(id: string, boonCoverageHtml?: string): Promise<unknown> {
    return this.request(
      'POST',
      `/comps/${encodeURIComponent(id)}/publish`,
      boonCoverageHtml !== undefined ? { boonCoverageHtml } : undefined
    )
  }

  compPlaintext(id: string): Promise<{ text: string }> {
    return this.request('GET', `/comps/${encodeURIComponent(id)}/plaintext`)
  }

  // --- folders / imports --------------------------------------------------------

  listFolders(): Promise<ForgeFolder[]> {
    return this.withFileFallback(
      () => this.request('GET', '/folders'),
      async () => (await this.readJsonFile<ForgeFolder[]>('folders.json')) ?? []
    )
  }

  importChatLink(link: string, opts: ForgeImportOptions = {}): Promise<ForgeBuild> {
    return this.request('POST', '/import/chat-link', { link, ...opts })
  }

  importGw2skills(url: string, opts: ForgeImportOptions = {}): Promise<ForgeBuild> {
    return this.request('POST', '/import/gw2skills', { url, ...opts })
  }

  // --- catalog (persistent cache so cards/grounding work offline) ----------------

  private async readCatalogCache(): Promise<CatalogCacheFile> {
    try {
      return JSON.parse(await readFile(this.opts.catalogCachePath, 'utf8')) as CatalogCacheFile
    } catch {
      return { entries: {}, savedAt: '' }
    }
  }

  private async cachedCatalog<T>(cacheKey: string, path: string): Promise<T> {
    try {
      const data = await this.request<T>('GET', path)
      const cache = await this.readCatalogCache()
      cache.entries[cacheKey] = data
      cache.savedAt = new Date().toISOString()
      await mkdir(dirname(this.opts.catalogCachePath), { recursive: true })
      await writeFile(this.opts.catalogCachePath, JSON.stringify(cache))
      return data
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
      const cache = await this.readCatalogCache()
      if (cacheKey in cache.entries) return cache.entries[cacheKey] as T
      throw new AxiforgeNotRunningError(
        'AxiForge is not running and no cached catalog data exists yet — open AxiForge once to prime the cache.'
      )
    }
  }

  catalogProfessions(): Promise<unknown> {
    return this.cachedCatalog('professions', '/catalog/professions')
  }

  catalogProfession(id: string, gameMode?: string): Promise<unknown> {
    const qs = gameMode ? `?gameMode=${encodeURIComponent(gameMode)}` : ''
    return this.cachedCatalog(
      `profession:${id}:${gameMode ?? ''}`,
      `/catalog/professions/${encodeURIComponent(id)}${qs}`
    )
  }

  catalogUpgrades(): Promise<unknown> {
    return this.cachedCatalog('upgrades', '/catalog/upgrades')
  }

  // --- health / status ------------------------------------------------------------

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('GET', '/health')
  }

  /** Settings-indicator state: live API > readable files > nothing. */
  async status(): Promise<AxiforgeStatus> {
    try {
      const h = await this.health()
      return { state: 'connected', version: h.version }
    } catch {
      try {
        await access(join(this.opts.dataDir, 'builds.json'))
        return { state: 'file-only' }
      } catch {
        return { state: 'offline' }
      }
    }
  }
}
