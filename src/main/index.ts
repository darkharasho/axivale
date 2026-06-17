import { app, BrowserWindow, Notification, ipcMain, screen, shell } from 'electron'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
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
import { RosterStore } from './rosterStore'
import { LinkStore } from './linkStore'
import {
  reconcileRoster,
  accountAnchor,
  type DiscordMemberRaw,
  type LinkedMemberRaw,
  type InGameMemberRaw
} from './rosterReconcile'
import { MetaStore } from './metaStore'
import { MetaCache } from './meta/cache'
import { BrowserWindowFetcher } from './meta/fetcher'
import { MetaRefresher } from './meta/refresh'
import type { LearnProgress } from './meta/progress'
import { TransformersEmbedder } from './meta/rag/embedder'
import { LanceMetaIndex } from './meta/rag/index'
import { MemoryStore } from './memoryStore'
import { LanceMemoryIndex } from './memory/index'
import { MemoryService } from './memory/service'
import { rankIdentities, mergeManualLinks, loggedPlayerMembers, type ResolveMemberLite } from './identityResolve'
import { runClaudeOnce } from './meta/model'
import { fetchEliteSpecMap } from './meta/specMap'
import { WikiFactsClient } from './meta/wikiFacts'
import { WikiClient } from '@axiapps/gw2-data/wiki'
import { WikiRefIngester } from './meta/wiki/ingest'
import { fetchCategoryMembers } from './meta/wiki/skillCrawl'
import { liveWikiSearch, cleanWikiHtml } from './meta/wiki/liveSearch'
import { deriveCompFromRepos } from './meta/deriveComp'
import type { SessionState } from './providers/types'
import { setupUpdater } from './updater'
import { OllamaManager } from './ollama/ollamaManager'
import { createOllamaDeps } from './ollama/realDeps'
import { detectHardware } from './ollama/hardware'
import type { ProviderConfig, ProviderName } from './providers/types'
import { EntityService } from './entities/service'
import { fetchGw2Entities } from './entities/dictionary'
import { fetchEntityDetail } from './entities/gw2Detail'
import { Gw2ApiClient } from '@axiapps/gw2-data'

const gw2Api = new Gw2ApiClient()

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

  // --- Notifications + app-icon unread badge --------------------------------
  // A desktop notification fires when a backgrounded turn finishes; the badge
  // mirrors the count of conversations with unread responses (pushed from the
  // renderer). Both default on and are gated by the Notifications settings.
  let unreadBadgeCount = 0
  // Linux unread badge via the Unity LauncherEntry D-Bus signal. Electron's
  // app.setBadgeCount only emits this under the Unity desktop, so on KDE Plasma
  // (and most other DEs) it's a silent no-op — we emit the signal ourselves with
  // gdbus (ships with glib). KDE matches the badge to the installed desktop file
  // named after the app (axivale.desktop), so the count lands on its task/launcher.
  let badgeEmitWarned = false
  const emitLinuxBadge = (count: number): void => {
    const desktop = `${app.getName()}.desktop`
    // KDE keys the badge off the app_uri argument, not the object path; a stable
    // per-app path keeps repeat signals updating the same entry.
    let h = 0
    for (let i = 0; i < desktop.length; i++) h = (h * 31 + desktop.charCodeAt(i)) | 0
    const objectPath = `/com/canonical/unity/launcherentry/${Math.abs(h)}`
    const payload = `{'count': <int64 ${count}>, 'count-visible': <${count > 0 ? 'true' : 'false'}>}`
    execFile(
      'gdbus',
      [
        'emit',
        '--session',
        '--object-path',
        objectPath,
        '--signal',
        'com.canonical.Unity.LauncherEntry.Update',
        `application://${desktop}`,
        payload
      ],
      (err) => {
        if (err && !badgeEmitWarned) {
          badgeEmitWarned = true
          console.warn('[badge] could not emit Unity LauncherEntry signal:', err.message)
        }
      }
    )
  }
  const applyBadge = (): void => {
    const on = store.getSetting('notifyBadge') !== 'false'
    const count = on ? unreadBadgeCount : 0
    // macOS dock + Unity launcher.
    app.setBadgeCount(count)
    // KDE Plasma / GNOME-with-extension / others that honor the Unity signal.
    if (process.platform === 'linux') emitLinuxBadge(count)
  }
  const notifyTurnDone = (conversationId: string): void => {
    if (store.getSetting('notifySystem') === 'false') return
    if (!Notification.isSupported()) return
    // Only alert when the user isn't already looking at the app.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return
    const title = conversations.get(conversationId)?.title?.trim() || 'AxiVale'
    const note = new Notification({ title, body: 'Response ready' })
    note.on('click', () => {
      const win = mainWindow
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
    note.show()
  }

  const shares = new ShareStore(join(app.getPath('userData'), 'shares.json'))

  const skills = new SkillStore(join(app.getPath('userData'), 'skills.json'))
  const meta = new MetaStore(join(app.getPath('userData'), 'meta.json'))
  const rosterAnnotations = new RosterStore(join(app.getPath('userData'), 'rosterAnnotations.json'))
  const rosterLinks = new LinkStore(join(app.getPath('userData'), 'rosterLinks.json'))
  const metaCache = new MetaCache(join(app.getPath('userData'), 'meta-cache'))
  const metaEmbedder = new TransformersEmbedder(join(app.getPath('userData'), 'meta-models'))
  const metaIndex = new LanceMetaIndex(join(app.getPath('userData'), 'meta-lance'), metaEmbedder)
  const wikiFacts = new WikiFactsClient()
  const wikiIndex = new LanceMetaIndex(join(app.getPath('userData'), 'wiki-lance'), metaEmbedder, 'wiki_chunks')
  const generalIndex = new LanceMetaIndex(join(app.getPath('userData'), 'general-lance'), metaEmbedder, 'general_chunks')
  // Durable self-authored memory: JSON records + a derived LanceDB recall/dedup
  // index reusing the single meta embedder (no second model load).
  const memoryStore = new MemoryStore(join(app.getPath('userData'), 'memory.json'))
  const memoryIndex = new LanceMemoryIndex(join(app.getPath('userData'), 'memory-lance'), metaEmbedder)
  const ollama = new OllamaManager(app.getPath('userData'), createOllamaDeps())
  const sendLearnProgress = (e: LearnProgress): void => {
    const win = mainWindow
    if (win && !win.isDestroyed()) win.webContents.send('learn:progress', e)
  }
  // Aborted on quit so the (full-coverage) wiki crawl stops cleanly mid-run and
  // resumes from where it left off on the next launch (already-indexed pages skip).
  const wikiAbort = new AbortController()
  const wikiIngester = new WikiRefIngester({
    wiki: new WikiClient(),
    index: wikiIndex,
    emit: sendLearnProgress,
    // Per-page crawl of skill/trait/upgrade categories, compressed (rule-based).
    // A User-Agent is required — the GW2 wiki API returns an HTML error page to
    // UA-less requests, which would silently break the whole per-page crawl.
    categoryMembers: (category) =>
      fetchCategoryMembers(category, (url) =>
        fetch(url, { headers: { 'User-Agent': 'AxiVale/0.4 (https://github.com/darkharasho)' } })
      ),
    signal: wikiAbort.signal,
    // Don't re-crawl the wiki on every launch — only once a week (a clean,
    // completed run records the timestamp; an aborted one re-runs next launch).
    lastRunAt: () => {
      const v = store.getSetting('wikiIngestedAt')
      return v ? Number(v) : null
    },
    markRun: (ts) => store.setSetting('wikiIngestedAt', String(ts))
  })
  let wikiTimer: ReturnType<typeof setInterval> | null = null
  const metaFetcher = new BrowserWindowFetcher()
  const metaRefresher = new MetaRefresher({
    store: meta,
    fetcher: metaFetcher,
    cache: metaCache,
    index: metaIndex,
    wikiIndex,
    generalIndex,
    model: (prompt) =>
      runClaudeOnce(prompt, {
        oauthToken: store.getSecret('claudeOauthToken'),
        // Sonnet (not Haiku): faithfully copies unfamiliar latest-expansion spec
        // names from the source instead of "correcting" them from stale knowledge.
        model: 'claude-sonnet-4-6'
      }),
    now: Date.now,
    eliteSpecs: () => fetchEliteSpecMap(),
    emit: (e) => {
      // Detailed events drive the Meta settings panel (per-mode busy + source).
      const win = mainWindow
      if (win && !win.isDestroyed()) win.webContents.send('meta:progress', e)
      // The same run also feeds the coarse learning banner as phase 'meta'
      // (the wiki ingest feeds it as phase 'wiki').
      if (e.type === 'refresh-start')
        sendLearnProgress({ phase: 'meta', kind: 'start', total: e.total, label: 'Learning the current meta…' })
      else if (e.type === 'source-done') sendLearnProgress({ phase: 'meta', kind: 'advance' })
      else if (e.type === 'idle') sendLearnProgress({ phase: 'meta', kind: 'done' })
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

  // Resolve a loose name to a single roster identity key (member_id or acct:<name>),
  // returning null when nothing matches or the top two candidates tie (ambiguous).
  // Mirrors the resolve_identity tool's member gathering so memory anchors the same way.
  async function resolveEntityKey(name: string): Promise<{ key: string; name: string } | null> {
    const gid = store.getSetting('guildId') ?? ''
    // Linked-roster + Discord-display lookups need a guild; logged AxiBridge
    // players do not — so resolve against logged players even when no guild is set.
    let raw: ResolveMemberLite[] = []
    const displayById = new Map<string, string>()
    if (gid !== '') {
      try {
        raw = (await buildAxitools().membersLinked(gid)) as ResolveMemberLite[]
      } catch {
        raw = []
      }
      try {
        const ov = (await buildAxitools().discordOverview(gid, true)) as {
          members?: Array<{ id: string; display_name?: string }>
        }
        for (const d of ov.members ?? []) if (d.display_name) displayById.set(d.id, d.display_name)
      } catch {
        /* best-effort — fall back to existing display_name/account/annotations */
      }
    }
    const anns = rosterAnnotations.list()
    const acctMembers: ResolveMemberLite[] = anns
      .filter((a) => a.memberId.startsWith('acct:'))
      .map((a) => ({ member_id: a.memberId, accounts: [{ account_name: a.memberId.slice(5) }] }))
    const members = [...mergeManualLinks(raw, rosterLinks.list()), ...acctMembers].map((m) => ({
      ...m,
      display_name: displayById.get(m.member_id) ?? m.display_name
    }))
    // Append recurring logged players (BreakN.5496 etc.) the linked roster lacks.
    let logged: ResolveMemberLite[] = []
    try {
      const att = await axibridge.attendance({})
      logged = loggedPlayerMembers(
        (att.attendance ?? []).map((r) => ({ account: r.account, runs: r.runs })),
        members
      )
    } catch {
      /* best-effort — no AxiBridge data, resolve against the roster alone */
    }
    const pool = [...members, ...logged]
    if (pool.length === 0) return null
    const ranked = rankIdentities(name, pool, anns, 2)
    if (ranked.length === 0) return null
    if (ranked.length > 1 && ranked[1].score >= ranked[0].score) return null // ambiguous tie
    const top = ranked[0]
    const label = top.nickname || top.display_name || top.member_name || top.account_names[0] || name
    return { key: top.member_id, name: label }
  }

  // Best-effort display name for a stored identity key (for recall provenance).
  function entityDisplay(key: string): string | undefined {
    if (key.startsWith('acct:')) return key.slice(5)
    const a = rosterAnnotations.list().find((x) => x.memberId === key)
    return a?.nickname || a?.aliases?.[0] || undefined
  }

  const memoryService = new MemoryService(memoryStore, memoryIndex, { entityName: entityDisplay })

  // Auto-connect AxiTools on startup: resolve (and persist) guildId from the
  // active key so the roster reconcile and the guild-role picker work right after
  // a restart, without a manual reconnect.
  void (async () => {
    try {
      if (!parseAxivaleKey(store.getActiveKey('axivale') ?? '')) return
      const guilds = await buildAxitools().listGuilds()
      if (guilds.length > 0) store.setSetting('guildId', String(guilds[0].id))
    } catch {
      /* offline at boot — the renderer retries via axitools:status */
    }
  })()

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
    // A cold headless AppImage + Electron boot (esp. on Linux) can take well over
    // 15s before its local API is up; 45s avoids a premature "didn't come up" error.
    { timeoutMs: 45_000, pollMs: 500 },
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
    if (wikiTimer) clearInterval(wikiTimer)
    if (metaStartTimer) clearTimeout(metaStartTimer)
    wikiAbort.abort() // stop the wiki crawl mid-run; it resumes next launch
    metaFetcher.destroy()
    ollama.stopServer()
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
      metaIndex: () => metaIndex,
      wikiIndex: () => wikiIndex,
      generalIndex: () => generalIndex,
      wikiLiveSearch: (q: string) => {
        const ua = { 'User-Agent': 'AxiVale/0.4 (https://github.com/darkharasho)' }
        return liveWikiSearch(q, {
          fetchJson: (url) => fetch(url, { headers: ua }).then((r) => r.json()),
          // Rendered HTML (action=parse), cleaned — preserves template-built collection/
          // recipe/achievement tables that raw wikitext strips away. See liveSearch.ts.
          getPageText: async (title) => {
            const url =
              'https://wiki.guildwars2.com/api.php?action=parse&prop=text&format=json&redirects=1&page=' +
              encodeURIComponent(title)
            try {
              const json = await fetch(url, { headers: ua }).then((r) => r.json())
              const html = json?.parse?.text?.['*']
              return html ? cleanWikiHtml(html) : null
            } catch {
              return null
            }
          }
        })
      },
      wikiFacts,
      fetchBuildPage: (url: string) => metaFetcher.fetchBuildPage(url),
      fetchBuildPageRaw: (url: string) => metaFetcher.fetchBuildPageRaw(url),
      rosterAnnotations: () => rosterAnnotations.list(),
      rosterLinks: () => rosterLinks.list(),
      memory: () => memoryService,
      resolveEntityKey
    }),
    skills: () => skills.list().filter((s) => s.enabled),
    meta: () => meta.list(),
    pinnedMemory: () => memoryStore.list().facts.filter((f) => f.pinned),
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
    // Reflect a badge toggle immediately using the last count the renderer pushed.
    if (key === 'notifyBadge') applyBadge()
  })
  ipcMain.handle('notifications:set-badge', (_event, count: number) => {
    unreadBadgeCount = Math.max(0, Math.floor(count) || 0)
    applyBadge()
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
      // Bake referenced skill/trait/item entities into the doc so the offline
      // share viewer can render their chips+icons (it has no Electron/API). Never
      // let dictionary build failure (e.g. offline) block sharing.
      const dictionary = await entityService.dictionary().catch(() => ({ entries: [] }))
      const doc = buildSharePayload(conv, {
        id,
        createdAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        dictionary: dictionary.entries
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
      const dictionary = await entityService.dictionary().catch(() => ({ entries: [] }))
      const doc = buildSharePayload(conv, {
        id,
        createdAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        turnId,
        dictionary: dictionary.entries
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

  const entityService = new EntityService({
    getCatalog: () => forgeCatalog.getUpgrades(),
    fetchEntities: (e) => fetchGw2Entities(e, (url) => fetch(url) as unknown as Promise<{ ok: boolean; json(): Promise<unknown> }>),
    fetchEntityDetail: (endpoint, id) => fetchEntityDetail(gw2Api, endpoint, id)
  })
  ipcMain.handle('entity:resolve', (_event, input: { type: 'skill' | 'trait' | 'item'; name: string }) =>
    entityService.resolve(input)
  )
  ipcMain.handle('entity:dictionary', () => entityService.dictionary())

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

  ipcMain.handle('ollama:detect-hardware', () => detectHardware())

  ipcMain.handle('ollama:get-status', () => ollama.getStatus())

  ipcMain.handle('ollama:install', async (event) => {
    const send = (channel: string, payload: unknown): void => {
      BrowserWindow.fromWebContents(event.sender)?.webContents.send(channel, payload)
    }
    await ollama.install((p) => send('ollama:progress', { kind: 'install', ...p }))
    await ollama.ensureServerRunning()
    return ollama.getStatus()
  })

  ipcMain.handle('ollama:pull-model', async (event, model: string) => {
    const send = (channel: string, payload: unknown): void => {
      BrowserWindow.fromWebContents(event.sender)?.webContents.send(channel, payload)
    }
    await ollama.ensureServerRunning()
    await ollama.pullModel(model, (p) => send('ollama:progress', { kind: 'pull', ...p }))
    store.setSetting('provider', 'local')
    store.setSetting('localModel', model)
    store.setSetting('localEndpoint', ollama.getEndpoint())
    return ollama.getStatus()
  })

  ipcMain.handle('ollama:uninstall', () => {
    ollama.uninstall()
    return ollama.getStatus()
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
    // Local tier: make sure an Ollama server is up before the turn hits it
    // (start the managed one if the user's isn't running), so a stopped server
    // surfaces as a clear message instead of a raw "fetch failed".
    if (providerConfig().provider === 'local') {
      try {
        await ollama.ensureServerRunning()
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:event', {
            kind: 'done',
            sessionId: null,
            error: `Local model server isn't running and couldn't be started (${detail}). Open Settings → AI provider → Local to set it up.`,
            conversationId
          })
        }
        return
      }
    }
    await agent.runTurn(conversationId, prompt, (agentEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('agent:event', { ...agentEvent, conversationId })
      }
      if (agentEvent.kind === 'done' && !agentEvent.error) notifyTurnDone(conversationId)
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

  ipcMain.handle('roster:annotations:list', () => rosterAnnotations.list())
  ipcMain.handle(
    'roster:annotations:upsert',
    (
      _e,
      memberId: string,
      patch: Partial<{ nickname: string; aliases: string[]; notes: string; tags: string[]; mainAccount: string }>
    ) => rosterAnnotations.upsert(memberId, patch)
  )
  ipcMain.handle('roster:annotations:delete', (_e, memberId: string) =>
    rosterAnnotations.remove(memberId)
  )

  ipcMain.handle('roster:links:list', () => rosterLinks.list())
  ipcMain.handle('roster:links:set', (_e, accountName: string, memberId: string) => {
    const link = rosterLinks.set(accountName, memberId)
    // Carry any annotation made on the unlinked account over to the member, so
    // notes persist once the account is tied to a Discord user.
    const acctKey = accountAnchor(accountName)
    const acctAnn = rosterAnnotations.get(acctKey)
    if (acctAnn && !rosterAnnotations.get(memberId)) {
      rosterAnnotations.upsert(memberId, {
        nickname: acctAnn.nickname,
        aliases: acctAnn.aliases,
        notes: acctAnn.notes,
        tags: acctAnn.tags
      })
      rosterAnnotations.remove(acctKey)
    }
    return link
  })
  ipcMain.handle('roster:links:delete', (_e, accountName: string) => rosterLinks.remove(accountName))

  ipcMain.handle('roster:reconcile', async () => {
    const guildId = store.getSetting('guildId')
    if (!guildId) throw new Error('No server connected — add an AxiVale key in Settings.')
    const client = buildAxitools()

    // membersLinked is the roster floor. Tolerate either a bare array or a wrapped
    // shape ({ members: [...] } / { linked: [...] }) so a server shape change can't
    // silently blank the roster.
    const rawLinked = await client.membersLinked(guildId)
    const linked: LinkedMemberRaw[] = Array.isArray(rawLinked)
      ? (rawLinked as LinkedMemberRaw[])
      : (((rawLinked as { members?: unknown; linked?: unknown })?.members ??
          (rawLinked as { linked?: unknown })?.linked ??
          []) as LinkedMemberRaw[])

    // Discord overview (roles/display names) is an overlay — best-effort so a
    // failure or empty member list never blanks the linked roster.
    let discordMembers: DiscordMemberRaw[] = []
    try {
      const overview = (await client.discordOverview(guildId, true)) as {
        members?: DiscordMemberRaw[]
      }
      discordMembers = overview.members ?? []
    } catch {
      discordMembers = []
    }

    // In-game GW2 guild roster is the preferred base: it needs a gw2 key + guild id
    // and can fail independently. A miss falls back to the linked roster.
    let inGameRoster: InGameMemberRaw[] = []
    let haveInGame = false
    try {
      const gw2GuildId = store.getSetting('gw2GuildId')
      if (gw2GuildId && store.getActiveKey('gw2')) {
        const roster = await buildGw2().guildMembers(gw2GuildId)
        inGameRoster = roster
          .filter((m) => Boolean(m.name))
          .map((m) => ({ name: m.name, rank: m.rank, joined: m.joined }))
        haveInGame = true
      }
    } catch {
      haveInGame = false
    }

    // Guild-member role is stored per server (each has its own roles).
    let memberRoleId: string | null = null
    try {
      const map = JSON.parse(store.getSetting('discordMemberRoleByGuild') || '{}') as Record<
        string,
        string
      >
      memberRoleId = map[guildId] || null
    } catch {
      memberRoleId = null
    }

    return reconcileRoster({
      discordMembers,
      linked: Array.isArray(linked) ? linked : [],
      inGameRoster,
      manualLinks: rosterLinks.list(),
      annotations: rosterAnnotations.list(),
      memberRoleId,
      haveInGame
    })
  })

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

  ipcMain.handle('meta:update-playbook', (_e, id: string, patch: { principles?: string; overrides?: string; blessed?: boolean }) => {
    meta.updatePlaybook(id, patch)
    return meta.get(id)
  })

  ipcMain.handle('meta:derive-comp', async (_e, modeId: string) => {
    const repos = listLinkedRepos(store.getSetting('axibridgeRepos'))
    if (repos.length === 0) return { ok: false, error: 'No linked AxiBridge repos. Add one in Settings.' }
    try {
      const derived = await deriveCompFromRepos(axibridgeClient, repos, { now: Date.now(), days: 30 })
      if (!derived) return { ok: false, error: 'No fight reports in the last 30 days.' }
      meta.recordDerivedComp(modeId, derived)
      return { ok: true, mode: meta.get(modeId) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unexpected error during comp derivation.' }
    }
  })
  ipcMain.handle('meta:force-refresh', () => {
    meta.markAllStale()
    void metaRefresher.refreshStale()
  })
  // Re-crawl a single source (by URL or substring) and re-distill from cache for
  // the rest — fast iteration without the full multi-source crawl.
  ipcMain.handle('meta:refresh-source', (_e, only: string) => {
    void metaRefresher.refreshStale({ only })
  })
  ipcMain.handle('meta:index-stats', async () => {
    try {
      return await metaIndex.stats()
    } catch {
      return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }
    }
  })
  ipcMain.handle('meta:index-sample', async (_e, opts: { mode?: string; limit: number }) => {
    try {
      return await metaIndex.sample(opts)
    } catch {
      return []
    }
  })
  ipcMain.handle('meta:index-search', async (_e, query: string, mode?: string) => {
    try {
      return await metaIndex.search(query, { mode, k: 8 })
    } catch {
      return []
    }
  })
  // Same trio against the wiki reference corpus (wiki_chunks); 'mode' here is the
  // wiki page category (skills, traits, stats, …).
  ipcMain.handle('wiki:index-stats', async () => {
    try {
      return await wikiIndex.stats()
    } catch {
      return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }
    }
  })
  ipcMain.handle('wiki:index-sample', async (_e, opts: { mode?: string; limit: number }) => {
    try {
      return await wikiIndex.sample(opts)
    } catch {
      return []
    }
  })
  ipcMain.handle('wiki:index-search', async (_e, query: string, mode?: string) => {
    try {
      return await wikiIndex.search(query, { mode, k: 8 })
    } catch {
      return []
    }
  })

  ipcMain.handle('general:index-stats', async () => {
    try { return await generalIndex.stats() } catch { return { total: 0, byMode: {}, bySource: {}, lastIndexedAt: null } }
  })
  ipcMain.handle('general:index-sample', async (_e, opts: { mode?: string; limit: number }) => {
    try { return await generalIndex.sample(opts) } catch { return [] }
  })
  ipcMain.handle('general:index-search', async (_e, query: string) => {
    try { return await generalIndex.search(query, { k: 8 }) } catch { return [] }
  })

  // Durable memory: records are authoritative (JSON store); the LanceDB index is
  // derived. Mutating handlers fire memory:progress so the panel/rollup refresh.
  const emitMemoryProgress = (): void => {
    const win = mainWindow
    if (win && !win.isDestroyed()) win.webContents.send('memory:progress', { type: 'changed' })
  }

  ipcMain.handle('memory:list', (_e, opts?: { includeArchived?: boolean }) => memoryService.list(opts))
  ipcMain.handle('memory:search', async (_e, query: string, entity?: string | null, kinds?: string[]) => {
    try {
      return await memoryService.recall({ query, entity: entity ?? null, kinds: kinds as never, limit: 20 })
    } catch {
      return { facts: [], artifacts: [] }
    }
  })
  ipcMain.handle(
    'memory:create',
    async (_e, input: { kind: string; body: string; title?: string; entity?: string | null; tags?: string[] }) => {
      const r = await memoryService.createManual(input as never)
      emitMemoryProgress()
      return r
    }
  )
  ipcMain.handle('memory:update', async (_e, kind: 'fact' | 'artifact', id: string, patch: Record<string, unknown>) => {
    if (kind === 'fact') await memoryService.updateFact(id, patch as never)
    else await memoryService.updateArtifact(id, patch as never)
    emitMemoryProgress()
  })
  ipcMain.handle('memory:delete', async (_e, kind: 'fact' | 'artifact', id: string) => {
    if (kind === 'fact') await memoryService.deleteFact(id)
    else await memoryService.deleteArtifact(id)
    emitMemoryProgress()
  })
  ipcMain.handle('memory:pin', (_e, id: string, pinned: boolean) => {
    memoryService.setPinned(id, pinned)
    emitMemoryProgress()
  })
  ipcMain.handle('memory:reindex', async () => {
    await memoryService.reindexAll()
    emitMemoryProgress()
  })
  ipcMain.handle('memory:index-stats', () => memoryService.indexStats())
  ipcMain.handle('memory:facts-for-entity', (_e, entity: string) => memoryService.factsForEntity(entity))

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
  // Boot reconcile: recompute pins from records, then rebuild the derived index so
  // it matches the store after upgrades (best-effort — re-derives lazily on writes).
  memoryStore.rerank()
  void memoryService.reindexAll().catch(() => {
    /* index rebuilds lazily on next write */
  })
  metaStartTimer = setTimeout(() => void metaRefresher.refreshStale(), 5_000)
  metaTimer = setInterval(() => void metaRefresher.refreshStale(), 6 * 60 * 60 * 1000)
  setTimeout(() => void wikiIngester.ingest(), 8_000)
  wikiTimer = setInterval(() => void wikiIngester.ingest(), 7 * 24 * 60 * 60 * 1000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(store)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
