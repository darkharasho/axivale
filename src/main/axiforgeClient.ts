import { readFile, writeFile, mkdir, access, rename } from 'fs/promises'
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

export interface WebhookRef { id: string; name: string }

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
 *
 * `profile` mirrors AxiForge's APP_PROFILE: its dev script runs with
 * APP_PROFILE=dev, which makes its userData dir "axiforge-desktop-dev". Pass
 * profile='dev' so a dev AxiVale reads the dev AxiForge's discovery file.
 */
export function forgeDataDir(
  platform: NodeJS.Platform = process.platform,
  profile?: string
): string {
  const folder = profile ? `axiforge-desktop-${profile}` : 'axiforge-desktop'
  if (platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), folder, 'data')
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', folder, 'data')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), folder, 'data')
}

export interface AxiforgeClientOptions {
  /** AxiForge's data dir: holds local-api.json, builds.json, comps.json, folders.json. */
  dataDir: string
  /** AxiVale-side file persisting catalog responses across AxiForge restarts. */
  catalogCachePath: string
  /** Timeout in ms for each HTTP request to the AxiForge local API. Default: 3000. */
  requestTimeoutMs?: number
}

const CACHE_SCHEMA_VERSION = 1

interface CatalogCacheFile {
  schemaVersion: number
  entries: Record<string, unknown>
  savedAt: string
}

// Decoding a chat code / gw2skills URL into a full build runs catalog resolution
// (skills/traits/gear) on AxiForge's side and is far slower than a plain CRUD
// call — especially on a cold app — so these get a much longer ceiling than the
// 3s default that would otherwise time them out into a "card failed" error.
const DECODE_TIMEOUT_MS = 25_000
// Publishing pushes the build/comp to GitHub (network git/API round-trip), which
// routinely runs well past the 3s default — and a timeout here is especially
// nasty: request() maps the abort to NotRunning, so the write() wrapper "restarts"
// AxiForge and retries, which times out again ("AxiForge started but the publish
// still failed"). Give it a generous ceiling.
const PUBLISH_TIMEOUT_MS = 60_000
// Sharing to Discord builds the embed and POSTs to a webhook (no git push), so it's
// quicker than publish but can still stall on a slow/rate-limited Discord — give it
// more than the 3s default.
const SHARE_TIMEOUT_MS = 20_000

export class AxiforgeClient {
  private readonly requestTimeoutMs: number

  constructor(private readonly opts: AxiforgeClientOptions) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 3000
  }

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

  private async fetchOnce(
    disc: AxiforgeDiscovery,
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${disc.port}${path}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs ?? this.requestTimeoutMs),
      headers: {
        Authorization: `Bearer ${disc.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const disc = await this.readDiscovery()
    let resp: Response
    try {
      resp = await this.fetchOnce(disc, method, path, body, timeoutMs)
    } catch {
      // TimeoutError / AbortError = request timed out; connection refused with
      // a discovery file present = the app crashed without cleanup (stale
      // file). Either way, treat exactly like "closed".
      throw new AxiforgeNotRunningError()
    }

    // --- 401 self-heal: re-read the discovery file once and retry ----------
    if (resp.status === 401) {
      let freshDisc: AxiforgeDiscovery
      try {
        freshDisc = await this.readDiscovery()
      } catch {
        throw new AxiforgeNotRunningError('AxiForge restarted with a new token — retry failed')
      }
      let retryResp: Response
      try {
        retryResp = await this.fetchOnce(freshDisc, method, path, body, timeoutMs)
      } catch {
        throw new AxiforgeNotRunningError('AxiForge restarted with a new token — retry failed')
      }
      if (retryResp.status === 401) {
        throw new AxiforgeNotRunningError('AxiForge restarted with a new token — retry failed')
      }
      resp = retryResp
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
        const all = await this.readJsonFile<ForgeBuild[]>('builds.json')
        if (all === null) {
          throw new AxiforgeNotRunningError('AxiForge isn\'t running and no local data found')
        }
        const build = all.find((b) => b.id === id)
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
    return this.request('POST', `/builds/${encodeURIComponent(id)}/publish`, undefined, PUBLISH_TIMEOUT_MS)
  }

  /** Post an already-published build to AxiForge's configured Discord webhook as a
   *  rich embed. Resolves { success: true } or throws AxiforgeError with the reason
   *  (webhook unset / build not published). Requires AxiForge ≥ the build that adds
   *  the /share-discord route. */
  shareBuildToDiscord(id: string, webhookIds?: string[]): Promise<{ success: boolean }> {
    return this.request(
      'POST',
      `/builds/${encodeURIComponent(id)}/share-discord`,
      webhookIds ? { webhook_ids: webhookIds } : undefined,
      SHARE_TIMEOUT_MS
    )
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
        const all = await this.readJsonFile<ForgeComp[]>('comps.json')
        if (all === null) {
          throw new AxiforgeNotRunningError('AxiForge isn\'t running and no local data found')
        }
        const comp = all.find((c) => c.id === id)
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
      boonCoverageHtml !== undefined ? { boonCoverageHtml } : undefined,
      PUBLISH_TIMEOUT_MS
    )
  }

  /** Post an already-published comp to AxiForge's configured Discord webhook as a
   *  rich embed (party grid + build legend). Resolves { success: true } or throws
   *  AxiforgeError with the reason (webhook unset / comp not published). Requires
   *  AxiForge ≥ the build that adds the /share-discord route. */
  shareCompToDiscord(id: string, webhookIds?: string[]): Promise<{ success: boolean }> {
    return this.request(
      'POST',
      `/comps/${encodeURIComponent(id)}/share-discord`,
      webhookIds ? { webhook_ids: webhookIds } : undefined,
      SHARE_TIMEOUT_MS
    )
  }

  /** Comp + build webhooks configured in AxiForge, for tying servers to them.
   *  Falls back to reading AxiForge's settings.json directly when AxiForge is
   *  closed, so the webhook-tie panel populates without spawning AxiForge. */
  listDiscordWebhooks(): Promise<{ comp: WebhookRef[]; build: WebhookRef[] }> {
    const toRefs = (v: unknown): WebhookRef[] =>
      Array.isArray(v)
        ? v
            .filter((w): w is { id: string; name?: unknown } =>
              !!w && typeof (w as { id?: unknown }).id === 'string')
            .map((w) => ({ id: w.id, name: typeof w.name === 'string' ? w.name : '' }))
        : []
    // Webhooks live in AxiForge's settings.json under these keys, which is the
    // authoritative local source. Fall back to it on ANY request failure — not
    // just NotRunning — so the panel still populates when AxiForge is closed OR
    // is an older build without the /discord/webhooks route. Only the array
    // forms have stable ids the share route can target; the legacy single build
    // webhook gets a stable id only once AxiForge migrates it, so it's omitted.
    const fromFile = async (): Promise<{ comp: WebhookRef[]; build: WebhookRef[] }> => {
      const settings = await this.readJsonFile<Record<string, unknown>>('settings.json')
      if (!settings) return { comp: [], build: [] }
      return {
        comp: toRefs(settings['discord.compWebhooks']),
        build: toRefs(settings['discord.buildWebhooks'])
      }
    }
    return this.request<{ comp: WebhookRef[]; build: WebhookRef[] }>(
      'GET', '/discord/webhooks', undefined, SHARE_TIMEOUT_MS
    ).catch(fromFile)
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
    return this.request('POST', '/import/chat-link', { link, ...opts }, DECODE_TIMEOUT_MS)
  }

  importGw2skills(url: string, opts: ForgeImportOptions = {}): Promise<ForgeBuild> {
    return this.request('POST', '/import/gw2skills', { url, ...opts }, DECODE_TIMEOUT_MS)
  }

  /**
   * Decode a gw2skills.net editor URL into a structured build WITHOUT saving it
   * (read-only preview/critique). Routes through request() — which converts a
   * closed AxiForge into AxiforgeNotRunningError — because parsing needs
   * AxiForge's live catalog. Returns the assembled build object.
   */
  parseGw2Skills(opts: { url: string; gameMode?: string }): Promise<ForgeBuild> {
    const body: { url: string; gameMode?: string } =
      opts.gameMode !== undefined ? { url: opts.url, gameMode: opts.gameMode } : { url: opts.url }
    return this.request('POST', '/import/gw2skills/parse', body, DECODE_TIMEOUT_MS)
  }

  /**
   * Decode an in-game build template chat code into a structured build WITHOUT
   * saving it (read-only preview). Like parseGw2Skills but for a raw chat code;
   * routes through request() so a closed AxiForge surfaces AxiforgeNotRunningError.
   */
  parseChatLink(opts: { link: string; gameMode?: string }): Promise<ForgeBuild> {
    const body: { link: string; gameMode?: string } =
      opts.gameMode !== undefined ? { link: opts.link, gameMode: opts.gameMode } : { link: opts.link }
    return this.request('POST', '/import/chat-link/parse', body, DECODE_TIMEOUT_MS)
  }

  // --- catalog (persistent cache so cards/grounding work offline) ----------------

  private async readCatalogCache(): Promise<CatalogCacheFile> {
    try {
      const raw = await readFile(this.opts.catalogCachePath, 'utf8')
      const parsed = JSON.parse(raw) as CatalogCacheFile
      if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
        return { schemaVersion: CACHE_SCHEMA_VERSION, entries: {}, savedAt: '' }
      }
      return parsed
    } catch {
      return { schemaVersion: CACHE_SCHEMA_VERSION, entries: {}, savedAt: '' }
    }
  }

  private async writeCatalogCache(cache: CatalogCacheFile): Promise<void> {
    const dest = this.opts.catalogCachePath
    const tmp = `${dest}.${process.pid}.tmp`
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(tmp, JSON.stringify(cache))
    await rename(tmp, dest)
  }

  private async cachedCatalog<T>(cacheKey: string, path: string): Promise<T> {
    try {
      const data = await this.request<T>('GET', path)
      // Best-effort cache persistence — fresh data is always returned
      try {
        const cache = await this.readCatalogCache()
        cache.entries[cacheKey] = data
        cache.savedAt = new Date().toISOString()
        await this.writeCatalogCache(cache)
      } catch (writeErr) {
        console.warn('AxiforgeClient: failed to persist catalog cache:', writeErr)
      }
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

  /**
   * Ask a headless AxiForge we spawned to shut down — but only if it never got
   * a window (AxiForge ignores the request once a window is open). Best-effort:
   * a missing/stale instance just means there's nothing to release.
   */
  async quitIfHeadless(): Promise<void> {
    try {
      await this.request('POST', '/lifecycle/quit-if-headless')
    } catch {
      /* not running / already gone — nothing to release */
    }
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
