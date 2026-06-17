import { app, ipcMain, type BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * Minimal file logger for the update lifecycle. electron-updater's default
 * logger is `console`, whose output is lost in a packaged app — so a silently
 * failed check or download leaves no trace. This writes to logs/updater.log
 * (Console.app-readable) so we can always see what a check actually did.
 */
function makeUpdaterLog(): { info: typeof log; warn: typeof log; error: typeof log; debug: typeof log } {
  let file: string | null = null
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'updater.log')
  } catch {
    file = null
  }
  function log(...args: unknown[]): void {
    const line = args
      .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    const stamped = `${new Date().toISOString()} ${line}\n`
    if (file) {
      try {
        appendFileSync(file, stamped)
      } catch {
        /* logging must never throw */
      }
    }
  }
  return { info: log, warn: log, error: log, debug: log }
}

/** Update lifecycle pushed to the renderer for a non-intrusive banner. */
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

/**
 * Wire GitHub-Releases auto-updates. Active only in the packaged app — in dev
 * there's no update feed and autoUpdater would error. Downloads in the
 * background; the renderer shows a "restart to update" prompt when ready.
 */
export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  const send = (status: UpdateStatus): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('updates:status', status)
  }

  // Manual check + install are always registered so the renderer can call
  // them; in dev they simply report "none".
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { state: 'none' } as UpdateStatus
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return null
  })

  ipcMain.handle('updates:install', () => {
    if (app.isPackaged) autoUpdater.quitAndInstall()
  })

  ipcMain.handle('app:version', () => app.getVersion())

  if (!app.isPackaged) return

  const ulog = makeUpdaterLog()
  autoUpdater.logger = ulog
  ulog.info(`updater armed — current version ${app.getVersion()}`)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    ulog.info('checking for update')
    send({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    ulog.info(`update available: ${info.version}`)
    send({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    ulog.info(`no update available (latest seen: ${info?.version ?? 'unknown'})`)
    send({ state: 'none' })
  })
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    ulog.info(`update downloaded: ${info.version} — installs on quit`)
    send({ state: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    ulog.error('updater error:', err)
    send({ state: 'error', message: err.message })
  })

  // Check shortly after launch, then hourly.
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 4000)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000)
}
