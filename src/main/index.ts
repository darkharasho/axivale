import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import {
  SettingsStore,
  electronCipher,
  type KeyService,
  type SecretKey,
  type SettingKey
} from './secrets'
import { AxitoolsClient } from './axitoolsClient'
import { parseAxivaleKey } from './axivaleKey'
import { Gw2Client } from './gw2Client'
import { AxiforgeClient, forgeDataDir } from './axiforgeClient'
import { AxiAppLauncher, defaultIo } from './axiAppLauncher'
import { AxibridgeClient } from './axibridgeClient'
import { AxibridgeCache, DEFAULT_CACHE_CAP_BYTES, META_TTL_MS } from './axibridgeCache'
import { AxibridgeService } from './axibridgeService'
import { listLinkedRepos, serializeLinkedRepos, parseRepoRef } from './axibridgeRepos'
import { summarizeResilient } from './axibridgeSummarize'
import { ForgeCatalogCache, type ForgeUpgradeCatalog } from './forgeCatalog'
import {
  GITHUB_DEVICE_CLIENT_ID,
  beginDeviceAuth,
  pollForToken,
  fetchGithubLogin
} from './githubAuth'
import { discoverReportRepos } from './githubRepos'
import { ShareStore } from './shareStore'
import { SharePublisher } from './sharePublisher'
import { createGithubShareClient } from './shareGithub'
import { loadViewerBundle } from './shareViewerBundle'
import { buildSharePayload } from './shareSanitize'
import { makeShareId } from './shareId'
import { AgentService } from './agent'
import { ConversationStore, type Conversation } from './conversationStore'
import { SkillStore } from './skillStore'
import { MetaStore } from './metaStore'
import { MetaCache } from './meta/cache'
import { BrowserWindowFetcher } from './meta/fetcher'
import { MetaRefresher } from './meta/refresh'
import { TransformersEmbedder } from './meta/rag/embedder'
import { LanceMetaIndex } from './meta/rag/index'
import { runClaudeOnce } from './meta/model'
import type { SessionState } from './providers/types'
import { setupUpdater } from './updater'
import type { ProviderConfig, ProviderName } from './providers/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null

// Pending destructive-tool confirmations, keyed by request id.
// Module-scoped so the window's closed handler can drain them.
const pendingConfirms = new Map<string, (allowed: boolean) => void>()

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Load the last saved window bounds, but only if they still land on a connected
 * display — otherwise a window remembered on a now-disconnected monitor would
 * open off-screen. Mirrors AxiForge's restore logic.
 */
function loadWindowBounds(store: SettingsStore): WindowBounds | null {
  const raw = store.getSetting('windowBounds')
  if (!raw) return null
  let b: Partial<WindowBounds>
  try {
    b = JSON.parse(raw) as Partial<WindowBounds>
  } catch {
    return null
  }
  if (
    typeof b.x !== 'number' ||
    typeof b.y !== 'number' ||
    typeof b.width !== 'number' ||
    typeof b.height !== 'number'
  ) {
    return null
  }
  const bounds = b as WindowBounds
  const onScreen = screen.getAllDisplays().some(({ bounds: d }) =>
    bounds.x < d.x + d.width &&
    bounds.x + bounds.width > d.x &&
    bounds.y < d.y + d.height &&
    bounds.y + bounds.height > d.y
  )
  return onScreen ? bounds : null
}

function createWindow(store: SettingsStore): void {
  const saved = loadWindowBounds(store)
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 840,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 940,
    minHeight: 640,
    frame: false,
    backgroundColor: '#16171a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required for ESM (.mjs) preload in Electron 20+
    }
  })

  // Persist position + size so the window reopens where the user left it.
  // Save debounced on move/resize (not only on close) so the bounds survive even
  // a hard kill of the dev process — `close` doesn't fire when the dev server is
  // Ctrl-C'd. getNormalBounds() returns the restored (un-maximized) frame, so
  // maximizing doesn't overwrite the size we want to restore to.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        store.setSetting('windowBounds', JSON.stringify(win.getNormalBounds()))
      }
    }, 400)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)
  win.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    if (!win.isDestroyed()) {
      store.setSetting('windowBounds', JSON.stringify(win.getNormalBounds()))
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open links in the user's default browser, never inside the app window.
  // setWindowOpenHandler covers target=_blank / window.open; will-navigate
  // covers plain <a href> clicks. The renderer's own URL/file is allowed
  // through so HMR and in-app routing still work.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const appUrl = process.env.ELECTRON_RENDERER_URL
    if (appUrl && url.startsWith(appUrl)) return // dev HMR / in-app nav
    if (url.startsWith('file://')) return // packaged renderer
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // Resolve all pending confirms with false so agent turns don't hang.
    for (const resolve of pendingConfirms.values()) resolve(false)
    pendingConfirms.clear()
  })
}

app.whenReady().then(async () => {
  const store = new SettingsStore(join(app.getPath('userData'), 'settings.json'), await electronCipher())

  const conversations = new ConversationStore(join(app.getPath('userData'), 'conversations.json'))

  const shares = new ShareStore(join(app.getPath('userData'), 'shares.json'))

  const skills = new SkillStore(join(app.getPath('userData'), 'skills.json'))
  const meta = new MetaStore(join(app.getPath('userData'), 'meta.json'))
  const metaCache = new MetaCache(join(app.getPath('userData'), 'meta-cache'))
  const metaEmbedder = new TransformersEmbedder(join(app.getPath('userData'), 'meta-models'))
  const metaIndex = new LanceMetaIndex(join(app.getPath('userData'), 'meta-lance'), metaEmbedder)
  const metaFetcher = new BrowserWindowFetcher()
  const metaRefresher = new MetaRefresher({
    store: meta,
    fetcher: metaFetcher,
    cache: metaCache,
    index: metaIndex,
    model: (prompt) =>
      runClaudeOnce(prompt, {
        oauthToken: store.getSecret('claudeOauthToken'),
        model: 'claude-haiku-4-5-20251001'
      }),
    now: Date.now,
    emit: (e) => {
      const win = mainWindow
      if (win && !win.isDestroyed()) win.webContents.send('meta:progress', e)
    }
  })
  let metaTimer: ReturnType<typeof setInterval> | null = null
  let metaStartTimer: ReturnType<typeof setTimeout> | null = null
  // Dev runs publish to a separate repo so testing never touches a user's real
  // public share site. app.isPackaged is false under `npm run dev`.
  const SHARE_REPO = app.isPackaged ? 'axivale-shares' : 'axivale-shares-dev'
  // Built viewer ships in out/share-viewer; __dirname is out/main at runtime.
  const viewerDir = join(__dirname, '../share-viewer')
  const sharePublisher = new SharePublisher({
    client: () => createGithubShareClient(store.getActiveKey('github') ?? ''),
    viewer: () => loadViewerBundle(viewerDir),
    repo: SHARE_REPO
  })

  const buildAxitools = (): AxitoolsClient => {
    const parsed = parseAxivaleKey(store.getActiveKey('axivale') ?? '')
    if (!parsed) return new AxitoolsClient('', '')
    return new AxitoolsClient(parsed.baseUrl, parsed.token)
  }
  const buildGw2 = (): Gw2Client => new Gw2Client(store.getActiveKey('gw2') ?? '')

  // One client + launcher for the app's lifetime: the launcher serializes
  // concurrent ensureRunning() calls, and the client's catalog cache persists
  // across AxiForge restarts.
  // In dev, AxiForge runs via `npm run dev` (APP_PROFILE=dev → "-dev" userData),
  // and there is no installed binary to detect — so read the dev profile's
  // discovery file and auto-launch the sibling repo's dev server instead.
  const isDev = !app.isPackaged
  const axiforgeDataDir = forgeDataDir(process.platform, isDev ? 'dev' : undefined)
  const axiforge = new AxiforgeClient({
    dataDir: axiforgeDataDir,
    catalogCachePath: join(app.getPath('userData'), 'axiforge-catalog-cache.json')
  })
  const siblingForgeDir = join(app.getAppPath(), '..', 'axiforge')
  const forgeDevLaunch =
    isDev && existsSync(join(siblingForgeDir, 'package.json')) ? { cwd: siblingForgeDir } : null
  const axiforgeLauncher = new AxiAppLauncher(
    axiforge,
    axiforgeDataDir,
    defaultIo,
    { timeoutMs: 15_000, pollMs: 500 },
    forgeDevLaunch
  )

  // On quit, release a headless AxiForge we spawned so it doesn't linger and get
  // focus-launched by AxiOM later. Defer the quit once to let the (best-effort,
  // short-timeout) release call complete; AxiForge ignores it if it has a window.
  let releasingForge = false
  app.on('before-quit', (e) => {
    if (releasingForge) return
    releasingForge = true
    e.preventDefault()
    if (metaTimer) clearInterval(metaTimer)
    if (metaStartTimer) clearTimeout(metaStartTimer)
    metaFetcher.destroy()
    void axiforgeLauncher.releaseIfSpawned().finally(() => app.quit())
  })

  // AxiBridge analytics: one client/cache/service for the app's lifetime; the
  // service reads linked repos and the GitHub PAT fresh from settings on every
  // call, so connecting a repo in Settings takes effect without a restart.
  const axibridgeClient = new AxibridgeClient(() => store.getActiveKey('github'))
  const axibridgeCache = new AxibridgeCache({
    dir: join(app.getPath('userData'), 'axibridge-cache'),
    capBytes: Number(store.getSetting('axibridgeCacheCapBytes')) || DEFAULT_CACHE_CAP_BYTES,
    ttlMs: META_TTL_MS
  })
  const axibridge = new AxibridgeService({
    repos: () => listLinkedRepos(store.getSetting('axibridgeRepos')),
    client: axibridgeClient,
    cache: axibridgeCache,
    // Pass the worker path explicitly: summarizeResilient lives in a module that
    // electron-vite code-splits into out/main/chunks/, so its own import.meta.url
    // resolves to the wrong dir. __dirname here is out/main, where the worker emits.
    summarize: (jobs) => summarizeResilient(jobs, join(__dirname, 'axibridgeWorker.js')),
    onProgress: (message) => {
      const win = mainWindow
      if (win && !win.isDestroyed()) win.webContents.send('axibridge:progress', message)
    }
  })

  const PROVIDER_MODEL_SETTING: Record<ProviderName, SettingKey> = {
    claude: 'model',
    gemini: 'geminiModel',
    openai: 'openaiModel',
    local: 'localModel'
  }
  const providerConfig = (): ProviderConfig => {
    const raw = store.getSetting('provider')
    const provider: ProviderName =
      raw === 'gemini' || raw === 'openai' || raw === 'local' ? raw : 'claude'
    return {
      provider,
      model: store.getSetting(PROVIDER_MODEL_SETTING[provider]),
      oauthToken: store.getSecret('claudeOauthToken'),
      apiKey:
        provider === 'gemini' || provider === 'openai' ? store.getActiveKey(provider) : null,
      endpoint: store.getSetting('localEndpoint')
    }
  }

  const agent = new AgentService({
    toolDeps: () => ({
      axitools: buildAxitools(),
      gw2: buildGw2(),
      // Kept as a string: Discord snowflakes exceed Number.MAX_SAFE_INTEGER.
      discordGuildId: () => store.getSetting('guildId') ?? '',
      gw2GuildId: () => store.getSetting('gw2GuildId') ?? '',
      axiforge,
      axiforgeLauncher,
      axibridge: () => axibridge,
      loadSkill: (name: string) => {
        const s = skills.getByName(name)
        return s && s.enabled ? s.instructions : null
      },
      metaIndex: () => metaIndex
    }),
    skills: () => skills.list().filter((s) => s.enabled),
    meta: () => meta.list(),
    config: providerConfig,
    loadSession: (conversationId: string): SessionState =>
      conversations.get(conversationId)?.session ?? {},
    saveSession: (conversationId, provider, session) =>
      conversations.saveSession(conversationId, provider, session),
    confirm: (toolName, input) =>
      new Promise<boolean>((resolve) => {
        const win = mainWindow
        if (!win || win.isDestroyed()) {
          resolve(false)
          return
        }
        const id = randomUUID()
        pendingConfirms.set(id, resolve)
        win.webContents.send('agent:confirm-request', { id, toolName, input })
      })
  })

  ipcMain.on('window:control', (event, action: 'minimize' | 'maximize-toggle' | 'close') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize-toggle') win.isMaximized() ? win.unmaximize() : win.maximize()
    else if (action === 'close') win.close()
  })

  ipcMain.on('agent:confirm-response', (_event, { id, allowed }: { id: string; allowed: boolean }) => {
    const resolve = pendingConfirms.get(id)
    if (resolve) {
      pendingConfirms.delete(id)
      resolve(allowed)
    }
  })

  ipcMain.handle('settings:get', (_event, key: SettingKey) => store.getSetting(key))
  ipcMain.handle('settings:set', (_event, key: SettingKey, value: string) => {
    store.setSetting(key, value)
  })
  ipcMain.handle('secrets:set', (_event, key: SecretKey, value: string) => {
    store.setSecret(key, value)
  })
  ipcMain.handle('secrets:has', (_event, key: SecretKey) => store.getSecret(key) !== null)

  // Keyrings: the renderer only ever sees labels, never key material.
  ipcMain.handle('keys:list', (_event, service: KeyService) => store.listKeyLabels(service))
  ipcMain.handle('keys:add', (_event, service: KeyService, label: string, key: string) => {
    store.addKey(service, label, key)
    store.setActiveKey(service, label)
  })
  ipcMain.handle('keys:remove', (_event, service: KeyService, label: string) => {
    store.removeKey(service, label)
  })
  ipcMain.handle('keys:set-active', (_event, service: KeyService, label: string) => {
    store.setActiveKey(service, label)
  })

  ipcMain.handle('gw2:validate-key', async () => {
    try {
      const info = await buildGw2().accountInfo()
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('axiforge:status', () => axiforge.status())
  // Manually start AxiForge (headless, or its dev server in dev) on demand —
  // the same path a write would trigger, exposed so the user can spin it up
  // from Settings instead of waiting for the first edit.
  ipcMain.handle('axiforge:launch', async () => {
    try {
      await axiforgeLauncher.ensureRunning()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // AxiBridge linked report repos: list/add/remove persist to the axibridgeRepos
  // setting; the service reads them fresh, so changes take effect without restart.
  ipcMain.handle('axibridge:repos-list', () => listLinkedRepos(store.getSetting('axibridgeRepos')))
  ipcMain.handle('axibridge:repos-add', (_event, input: string) => {
    const ref = parseRepoRef(input)
    if (!ref) {
      return { ok: false, error: 'Enter owner/repo or a GitHub Pages URL (https://owner.github.io/repo).' }
    }
    const repos = listLinkedRepos(store.getSetting('axibridgeRepos')).filter(
      (r) => !(r.owner === ref.owner && r.repo === ref.repo)
    )
    repos.push(ref)
    store.setSetting('axibridgeRepos', serializeLinkedRepos(repos))
    return { ok: true, repos }
  })
  ipcMain.handle('axibridge:repos-remove', (_event, owner: string, repo: string) => {
    const repos = listLinkedRepos(store.getSetting('axibridgeRepos')).filter(
      (r) => !(r.owner === owner && r.repo === repo)
    )
    store.setSetting('axibridgeRepos', serializeLinkedRepos(repos))
    return repos
  })
  ipcMain.handle('axibridge:status', async () => {
    try {
      return { ok: true, ...(await axibridge.reposStatus()) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // GitHub OAuth device flow — "Sign in with GitHub" (replaces manual PAT entry).
  // begin returns the user code + opens the verification page; complete polls to
  // completion, resolves the login, and files the token in the github keyring.
  ipcMain.handle('github:auth-begin', async () => {
    const begin = await beginDeviceAuth(GITHUB_DEVICE_CLIENT_ID)
    await shell.openExternal(begin.verificationUri)
    return {
      userCode: begin.userCode,
      verificationUri: begin.verificationUri,
      deviceCode: begin.deviceCode,
      interval: begin.interval,
      expiresIn: begin.expiresIn
    }
  })
  ipcMain.handle(
    'github:auth-complete',
    async (_event, deviceCode: string, interval: number, expiresIn: number) => {
      try {
        const token = await pollForToken(GITHUB_DEVICE_CLIENT_ID, deviceCode, {
          intervalSeconds: interval,
          expiresInSeconds: expiresIn
        })
        const login = await fetchGithubLogin(token)
        store.addKey('github', login, token)
        store.setActiveKey('github', login)
        return { ok: true, login }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Auto-discovery: scan the signed-in GitHub account for report repos (those
  // with reports/index.json). Returns the found list; the renderer links them
  // via the existing repos-add handler so manual linking stays the one writer.
  ipcMain.handle('github:discover-repos', async () => {
    try {
      const repos = await discoverReportRepos(store.getActiveKey('github') ?? '')
      return { ok: true, repos }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('share:createConversation', async (_event, conversationId: string) => {
    try {
      const conv = conversations.get(conversationId)
      if (!conv) return { ok: false as const, error: 'Conversation not found.' }
      const id = makeShareId()
      const doc = buildSharePayload(conv, {
        id,
        createdAt: new Date().toISOString(),
        appVersion: app.getVersion()
      })
      const { url, live } = await sharePublisher.publishDoc(doc)
      shares.add({
        id,
        kind: 'conversation',
        title: doc.title,
        url,
        sourceConversationId: conversationId,
        createdAt: doc.createdAt
      })
      return { ok: true as const, url, live }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Share failed.' }
    }
  })

  ipcMain.handle('share:createResponse', async (_event, conversationId: string, turnId: number) => {
    try {
      const conv = conversations.get(conversationId)
      if (!conv) return { ok: false as const, error: 'Conversation not found.' }
      const id = makeShareId()
      const doc = buildSharePayload(conv, {
        id,
        createdAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        turnId
      })
      const { url, live } = await sharePublisher.publishDoc(doc)
      shares.add({
        id,
        kind: 'response',
        title: doc.title,
        url,
        sourceConversationId: conversationId,
        createdAt: doc.createdAt
      })
      return { ok: true as const, url, live }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Share failed.' }
    }
  })

  ipcMain.handle('share:list', () => shares.list())

  ipcMain.handle('share:delete', async (_event, id: string) => {
    try {
      await sharePublisher.deleteDoc(id)
      shares.remove(id)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Delete failed.' }
    }
  })

  ipcMain.handle('share:status', () => sharePublisher.status())

  // Inline build/comp cards need rune/relic names+icons even when AxiForge is
  // closed — a disk cache on top of the client's catalog fetch covers that.
  const forgeCatalog = new ForgeCatalogCache(
    join(app.getPath('userData'), 'cache'),
    () => axiforge.catalogUpgrades() as Promise<ForgeUpgradeCatalog>
  )
  ipcMain.handle('axiforge:catalog-upgrades', () => forgeCatalog.getUpgrades())

  ipcMain.handle('axitools:status', async () => {
    if (!parseAxivaleKey(store.getActiveKey('axivale') ?? '')) {
      return { ok: false, error: 'No AxiVale key on file — generate one in Discord with /config apikey generate.' }
    }
    try {
      const guilds = await buildAxitools().listGuilds()
      // The key is scoped to one Discord server; remember it as the active guild.
      if (guilds.length > 0) store.setSetting('guildId', String(guilds[0].id))
      return { ok: true, guilds }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Probe the local model server: Ollama's /api/tags first, then the
  // OpenAI-compatible /v1/models (LM Studio, llama.cpp server).
  ipcMain.handle('local:status', async () => {
    const base = (store.getSetting('localEndpoint') || 'http://localhost:11434').replace(/\/+$/, '')
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        return { ok: true, models: (data.models ?? []).map((m) => m.name) }
      }
    } catch {
      // not Ollama — try the OpenAI-compatible listing below
    }
    try {
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> }
        return { ok: true, models: (data.data ?? []).map((m) => m.id) }
      }
      return { ok: false, error: `Local server responded ${res.status}` }
    } catch {
      return {
        ok: false,
        error:
          'No local model server found. Install Ollama from ollama.com, then run: ollama pull qwen3:8b'
      }
    }
  })

  // Credential readiness for the selected provider — drives the first-run nudge.
  ipcMain.handle('provider:status', () => {
    const cfg = providerConfig()
    switch (cfg.provider) {
      case 'gemini':
        return {
          provider: cfg.provider,
          ready: cfg.apiKey !== null,
          note: cfg.apiKey ? null : 'Add a Gemini API key in Settings to file dispatches.'
        }
      case 'openai':
        return {
          provider: cfg.provider,
          ready: cfg.apiKey !== null,
          note: cfg.apiKey ? null : 'Add an OpenAI API key in Settings to file dispatches.'
        }
      case 'local':
        return {
          provider: cfg.provider,
          ready: true,
          note: 'Local models are slower and less reliable on multi-step tasks.'
        }
      default:
        return {
          provider: cfg.provider,
          ready: true,
          note: cfg.oauthToken
            ? null
            : "Using this machine's Claude Code login — file a token in Settings if dispatches fail."
        }
    }
  })

  // Panel bridge: whitelisted AxitoolsClient methods, active guild injected.
  // The renderer never chooses the guild — it always acts on the bound server.
  const PANEL_METHODS = new Set([
    'listBuilds',
    'createBuild',
    'updateBuild',
    'deleteBuild',
    'listCompPresets',
    'putCompPreset',
    'deleteCompPreset',
    'listCompSchedules',
    'putCompSchedule',
    'deleteCompSchedule',
    'compConfigGet',
    'compConfigPatch',
    'rssList',
    'rssSet',
    'rssDelete',
    'streamsList',
    'streamSet',
    'streamDelete',
    'allianceGet',
    'allianceSet',
    'guildRolesGet',
    'guildRoleSet',
    'guildRoleDelete',
    'guildRolesAllowlist',
    'configGet',
    'configPatch',
    'membersLinked',
    'discordOverview'
  ])
  ipcMain.handle('axitools:call', async (_event, method: string, ...args: unknown[]) => {
    if (!PANEL_METHODS.has(method)) throw new Error(`Unknown axitools method: ${method}`)
    const guildId = store.getSetting('guildId')
    if (!guildId) throw new Error('No server connected — add an AxiVale key in Settings.')
    const client = buildAxitools() as unknown as Record<
      string,
      (...a: unknown[]) => Promise<unknown>
    >
    return client[method](guildId, ...args)
  })

  ipcMain.handle('agent:send', async (event, conversationId: string, prompt: string, forcedSkillId?: string) => {
    await agent.runTurn(conversationId, prompt, (agentEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('agent:event', { ...agentEvent, conversationId })
      }
    }, { forcedSkillId })
  })

  ipcMain.handle('skills:list', () => skills.list())
  ipcMain.handle('skills:create', (_e, seed: { name: string; whenToUse: string; instructions: string }) =>
    skills.create(seed)
  )
  ipcMain.handle(
    'skills:update',
    (_e, id: string, patch: Partial<{ name: string; whenToUse: string; instructions: string; enabled: boolean }>) =>
      skills.update(id, patch)
  )
  ipcMain.handle('skills:delete', (_e, id: string) => skills.remove(id))

  ipcMain.handle('meta:list', () => meta.list())
  ipcMain.handle('meta:add-mode', (_e, seed: { mode: string; sources: { label: string; url: string }[]; notes?: string }) =>
    meta.addMode(seed)
  )
  ipcMain.handle(
    'meta:update-mode',
    (_e, id: string, patch: Partial<{ mode: string; sources: { label: string; url: string }[]; notes: string }>) =>
      meta.updateMode(id, patch)
  )
  ipcMain.handle('meta:remove-mode', (_e, id: string) => meta.removeMode(id))

  function drainConfirms(): void {
    for (const resolve of pendingConfirms.values()) resolve(false)
    pendingConfirms.clear()
  }

  ipcMain.handle('agent:reset', (_event, conversationId: string) => {
    drainConfirms()
    agent.resetSession(conversationId)
  })

  ipcMain.handle('agent:cancel', (_event, conversationId: string) => {
    drainConfirms()
    agent.cancelTurn(conversationId)
  })

  ipcMain.handle('conversations:list', () => conversations.list())
  ipcMain.handle('conversations:get', (_event, id: string) => conversations.get(id))
  ipcMain.handle('conversations:create', (_event, seed?: Partial<Conversation>) =>
    conversations.create(seed)
  )
  ipcMain.handle('conversations:save-turns', (_event, id: string, turns: Conversation['turns']) => {
    conversations.saveTurns(id, turns)
  })
  ipcMain.handle('conversations:rename', (_event, id: string, title: string | null) => {
    conversations.rename(id, title)
  })
  ipcMain.handle('conversations:delete', (_event, id: string) => {
    conversations.remove(id)
    agent.resetSession(id)
  })
  ipcMain.handle('conversations:set-active', (_event, id: string) => {
    conversations.setActive(id)
  })
  ipcMain.handle('conversations:mark-seen', (_event, id: string, count: number) => {
    conversations.markSeen(id, count)
  })

  setupUpdater(() => mainWindow)

  createWindow(store)
  metaStartTimer = setTimeout(() => void metaRefresher.refreshStale(), 5_000)
  metaTimer = setInterval(() => void metaRefresher.refreshStale(), 6 * 60 * 60 * 1000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(store)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
