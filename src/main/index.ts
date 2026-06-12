import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
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
import { AgentService } from './agent'
import { setupUpdater } from './updater'
import type { ProviderConfig, ProviderName } from './providers/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null

// Pending destructive-tool confirmations, keyed by request id.
// Module-scoped so the window's closed handler can drain them.
const pendingConfirms = new Map<string, (allowed: boolean) => void>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    frame: false,
    backgroundColor: '#16171a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required for ESM (.mjs) preload in Electron 20+
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

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

  const buildAxitools = (): AxitoolsClient => {
    const parsed = parseAxivaleKey(store.getActiveKey('axivale') ?? '')
    if (!parsed) return new AxitoolsClient('', '')
    return new AxitoolsClient(parsed.baseUrl, parsed.token)
  }
  const buildGw2 = (): Gw2Client => new Gw2Client(store.getActiveKey('gw2') ?? '')

  const PROVIDER_MODEL_SETTING: Record<ProviderName, SettingKey> = {
    claude: 'model',
    gemini: 'geminiModel',
    openai: 'openaiModel',
    local: 'localModel'
  }
  const providerConfig = (): ProviderConfig => {
    const provider = (store.getSetting('provider') ?? 'claude') as ProviderName
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
      gw2GuildId: () => store.getSetting('gw2GuildId') ?? ''
    }),
    config: providerConfig,
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
      const res = await fetch(`${base}/api/tags`)
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        return { ok: true, models: (data.models ?? []).map((m) => m.name) }
      }
    } catch {
      // not Ollama — try the OpenAI-compatible listing below
    }
    try {
      const res = await fetch(`${base}/v1/models`)
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

  ipcMain.handle('agent:send', async (event, prompt: string) => {
    await agent.runTurn(prompt, (agentEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('agent:event', agentEvent)
    })
  })

  ipcMain.handle('agent:reset', () => {
    agent.resetSession()
  })

  ipcMain.handle('agent:cancel', () => {
    agent.cancelTurn()
  })

  setupUpdater(() => mainWindow)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
