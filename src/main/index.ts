import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { SettingsStore, electronCipher, type SecretKey, type SettingKey } from './secrets'
import { AxitoolsClient } from './axitoolsClient'
import { Gw2Client } from './gw2Client'
import { AgentService } from './agent'

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

  const buildAxitools = (): AxitoolsClient =>
    new AxitoolsClient(
      store.getSetting('axitoolsUrl') ?? 'http://127.0.0.1:8642',
      store.getSecret('axitoolsToken') ?? ''
    )
  const buildGw2 = (): Gw2Client => new Gw2Client(store.getSecret('gw2ApiKey') ?? '')

  const agent = new AgentService({
    toolDeps: () => ({
      axitools: buildAxitools(),
      gw2: buildGw2(),
      discordGuildId: () => Number(store.getSetting('guildId')) || 0,
      gw2GuildId: () => store.getSetting('gw2GuildId') ?? ''
    }),
    oauthToken: () => store.getSecret('claudeOauthToken'),
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

  ipcMain.handle('gw2:validate-key', async () => {
    try {
      const info = await buildGw2().accountInfo()
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('axitools:status', async () => {
    try {
      const guilds = await buildAxitools().listGuilds()
      return { ok: true, guilds }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:send', async (event, prompt: string) => {
    await agent.runTurn(prompt, (agentEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('agent:event', agentEvent)
    })
  })

  ipcMain.handle('agent:reset', () => {
    agent.resetSession()
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
