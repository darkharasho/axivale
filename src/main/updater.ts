import { app, ipcMain, type BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import electronUpdater from 'electron-updater'

/**
 * electron-updater installs an AppImage update by `unlink`ing process.env.APPIMAGE
 * (the running file) and then moving the new version in beside it. If that file was
 * moved or deleted out from under the running app — common when AppImages are kept
 * by an external manager that replaces them — the unlink throws ENOENT and the
 * whole install aborts ("ENOENT … unlink …"), even though the new version
 * downloaded fine. Recreating an empty placeholder at that path lets the unlink
 * succeed so the install can finish (the new versioned AppImage is written beside
 * it). Best-effort and Linux-only; a no-op when the file already exists, so it
 * never affects the normal in-place update. Exported for tests.
 */
export function recreateMissingAppImage(
  appImagePath: string | undefined,
  platform: NodeJS.Platform = process.platform,
  fsImpl: { existsSync: typeof existsSync; writeFileSync: typeof writeFileSync } = {
    existsSync,
    writeFileSync
  }
): 'skipped' | 'present' | 'recreated' | 'failed' {
  if (platform !== 'linux' || !appImagePath) return 'skipped'
  if (fsImpl.existsSync(appImagePath)) return 'present'
  try {
    fsImpl.writeFileSync(appImagePath, '')
    return 'recreated'
  } catch {
    return 'failed'
  }
}

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

  // Accessed lazily (not at module load): electron-updater's `autoUpdater` getter
  // instantiates the platform updater, which reads electron's app — unavailable
  // until the app is ready (and absent under unit tests of the pure helper above).
  const { autoUpdater } = electronUpdater

  const ulog = makeUpdaterLog()

  // Guard the in-place AppImage swap against a missing APPIMAGE (see
  // recreateMissingAppImage). Run before any install — explicit and on-quit.
  const guardAppImageInstall = (): void => {
    const result = recreateMissingAppImage(process.env.APPIMAGE)
    if (result === 'recreated') {
      ulog.warn(
        `APPIMAGE ${process.env.APPIMAGE} was missing (moved/removed externally) — recreated a placeholder so the in-place update can complete`
      )
    } else if (result === 'failed') {
      ulog.error(
        `APPIMAGE ${process.env.APPIMAGE} is missing and could not be recreated — the install may fail`
      )
    }
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
    if (!app.isPackaged) return
    guardAppImageInstall()
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('app:version', () => app.getVersion())

  if (!app.isPackaged) return

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
    // Ready the install path now so autoInstallOnAppQuit also survives a missing
    // APPIMAGE, not just the explicit "Restart & update" button.
    guardAppImageInstall()
    send({ state: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    ulog.error('updater error:', err)
    const raw = err?.message ?? String(err)
    // The new version downloads fine; only the in-place AppImage swap can ENOENT
    // when the running file was moved/removed externally. Say something the user
    // can act on instead of a raw unlink stack.
    const message = /ENOENT|APPIMAGE|unlink/i.test(raw)
      ? 'Update downloaded, but the app could not replace its AppImage automatically — the running file may have been moved or removed. Reinstall the latest AppImage from the Releases page.'
      : raw
    send({ state: 'error', message })
  })

  // Check shortly after launch, then hourly.
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 4000)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000)
}
