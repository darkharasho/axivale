import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

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

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => send({ state: 'error', message: err.message }))

  // Check shortly after launch, then hourly.
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 4000)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000)
}
