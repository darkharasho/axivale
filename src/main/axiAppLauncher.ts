import { spawn as nodeSpawn, execSync as nodeExecSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { AxiforgeError, AxiforgeNotRunningError, type AxiforgeDiscovery } from './axiforgeClient'

/** Injectable system surface so tests never touch the real OS. */
export interface LauncherIo {
  platform: NodeJS.Platform
  spawn: typeof nodeSpawn
  execSync: (cmd: string, opts: { encoding: 'utf8'; timeout: number; windowsHide?: boolean }) => string
  existsSync: typeof existsSync
  readdirSync: (dir: string) => string[]
  statSync: typeof statSync
  hasSystemdRun: () => boolean
}

export const defaultIo: LauncherIo = {
  platform: process.platform,
  spawn: nodeSpawn,
  execSync: (cmd, opts) => nodeExecSync(cmd, opts),
  existsSync,
  readdirSync: (dir) => readdirSync(dir),
  statSync,
  hasSystemdRun: () => {
    try {
      nodeExecSync('command -v systemd-run', { encoding: 'utf8', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }
}

// Ported from axiom electron/ipc-handlers.ts:366-384 — registry lookup, then
// DisplayIcon exe or an InstallLocation directory scan.
function resolveWindows(io: LauncherIo): string | null {
  try {
    const ps = `(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*AxiForge*' } | Select-Object -First 1 InstallLocation, DisplayIcon | ConvertTo-Json -Compress)`
    const raw = io
      .execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true
      })
      .trim()
    if (!raw) return null
    const entry = JSON.parse(raw) as { InstallLocation?: string; DisplayIcon?: string }
    const icon = entry.DisplayIcon?.split(',')[0]?.trim()
    if (icon && icon.toLowerCase().endsWith('.exe') && io.existsSync(icon)) return icon
    const loc = entry.InstallLocation?.trim()
    if (loc && io.existsSync(loc) && io.statSync(loc).isDirectory()) {
      const exes = io.readdirSync(loc).filter((f) => f.endsWith('.exe') && !/uninstall/i.test(f))
      const preferred = exes.find((f) => f.toLowerCase() === 'axiforge.exe') ?? exes[0]
      if (preferred) return join(loc, preferred)
    }
  } catch {
    /* registry query failed — fall through to null */
  }
  return null
}

// Ported from axiom electron/detect.ts:64-79 + ipc-handlers.ts:328-344.
// Gear Lever stores AppImages under ~/AppImages, so this scan covers it;
// its metadata.json / the axiom-version convention only carry versions.
function resolveLinux(io: LauncherIo): string | null {
  const searchDirs = [
    join(homedir(), 'AppImages'),
    join(homedir(), 'Applications'),
    join(homedir(), 'Downloads'),
    join(homedir(), '.local', 'bin'),
    homedir()
  ]
  for (const dir of searchDirs) {
    try {
      const file = io
        .readdirSync(dir)
        .find((f) => f.toLowerCase().endsWith('.appimage') && f.toLowerCase().includes('axiforge'))
      if (file) return join(dir, file)
    } catch {
      /* dir missing — keep scanning */
    }
  }
  return null
}

/** Resolution order per spec: discovery-file exePath first, then platform detection. */
export function resolveAxiforgeExe(dataDir: string, io: LauncherIo = defaultIo): string | null {
  try {
    const disc = JSON.parse(readFileSync(join(dataDir, 'local-api.json'), 'utf8')) as AxiforgeDiscovery
    if (typeof disc.exePath === 'string' && disc.exePath && io.existsSync(disc.exePath)) {
      return disc.exePath
    }
  } catch {
    /* no/stale discovery file — detect instead */
  }
  if (io.platform === 'win32') return resolveWindows(io)
  if (io.platform === 'linux') return resolveLinux(io)
  // darwin: AxiForge is not distributed for macOS yet — detection intentionally omitted.
  return null
}

/** The only client surface the launcher needs — keeps tests trivial. */
export interface HealthCheckable {
  health(): Promise<{ ok: boolean; version: string }>
  /** Optional graceful release of a headless instance we spawned (see releaseIfSpawned). */
  quitIfHeadless?(): Promise<void>
}

/**
 * Dev-mode launch: instead of resolving an installed binary (there is none in a
 * source checkout), run the sibling repo's `npm run dev`. The sibling's dev
 * script sets its own env (APP_PROFILE, VITE_DEV_SERVER_URL), so it self-boots
 * a windowed dev instance that still writes the discovery file we poll for.
 */
export interface DevLaunch {
  /** The sibling repo directory, e.g. <axivale>/../axiforge. */
  cwd: string
  /** Dev boot (vite + electron) is slow; allow longer than the prod timeout. */
  timeoutMs?: number
}

export class AxiAppLauncher {
  private startPromise: Promise<void> | null = null
  /** True once WE spawned a headless instance — gates cleanup so we never quit a user-started AxiForge. */
  private spawnedHeadless = false

  constructor(
    private readonly client: HealthCheckable,
    private readonly dataDir: string,
    private readonly io: LauncherIo = defaultIo,
    private readonly timing: { timeoutMs: number; pollMs: number } = { timeoutMs: 15_000, pollMs: 500 },
    private readonly dev: DevLaunch | null = null
  ) {}

  /** Resolves when the local API answers /health; throws AxiforgeError (friendly) otherwise. */
  async ensureRunning(): Promise<void> {
    try {
      await this.client.health()
      return
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
    }
    this.startPromise ??= this.startAndWait().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  private async startAndWait(): Promise<void> {
    if (this.dev) {
      this.spawnDev(this.dev.cwd)
      await this.waitForHealth(this.dev.timeoutMs ?? 90_000)
      return
    }
    const exe = resolveAxiforgeExe(this.dataDir, this.io)
    if (!exe) {
      throw new AxiforgeError(
        'AxiForge does not appear to be installed on this machine — install it via AxiOM, or open it once so AxiVale can find it.'
      )
    }
    this.spawnHeadless(exe)
    this.spawnedHeadless = true
    await this.waitForHealth()
  }

  /**
   * Release the headless AxiForge we started, so it doesn't linger in the
   * background and get focus-launched by AxiOM later. No-op when we never
   * spawned it (a user-started instance is left alone); AxiForge itself
   * declines if its window was promoted. Safe to call on app quit.
   */
  async releaseIfSpawned(): Promise<void> {
    if (!this.spawnedHeadless) return
    await this.client.quitIfHeadless?.()
    this.spawnedHeadless = false
  }

  private spawnDev(cwd: string): void {
    // `npm run dev:headless` in the sibling checkout — a lean APP_PROFILE=dev
    // electron --headless (no build:site / vite / electronmon), so an on-demand
    // launch comes up in ~1s instead of the full windowed dev chain. On Windows
    // npm is npm.cmd, which needs a shell. The sibling script owns its env.
    const child = this.io.spawn('npm', ['run', 'dev:headless'], {
      detached: true,
      stdio: 'ignore',
      cwd,
      env: process.env,
      shell: this.io.platform === 'win32'
    })
    child.on('error', (err) =>
      console.error('[axiforge-launch] dev spawn error:', err?.message || err)
    )
    child.unref()
  }

  private spawnHeadless(exe: string): void {
    // Strip the parent Electron/dev env so the child boots as a normal app
    // (mirrors axiom ipc-handlers.ts:388-392).
    const env = { ...process.env }
    delete env.VITE_DEV_SERVER_URL
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    delete env.NODE_OPTIONS

    let cmd = exe
    let args = ['--headless']
    if (this.io.platform === 'linux' && this.io.hasSystemdRun()) {
      // Fresh user scope: escapes AxiVale's cgroup, avoiding Electron 37+
      // GPU sandbox failures (axiom ipc-handlers.ts:321-324).
      cmd = 'systemd-run'
      args = ['--user', '--scope', '--', exe, '--headless']
    }
    console.log('[axiforge-launch] spawning headless:', cmd, args.join(' '))
    const child = this.io.spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      cwd: dirname(exe),
      env
    })
    // Spawn errors (ENOENT, EACCES) are logged and surface to callers as the poll timeout below.
    child.on('error', (err) => console.error('[axiforge-launch] spawn error:', err?.message || err))
    child.unref()
  }

  private async waitForHealth(timeoutMs: number = this.timing.timeoutMs): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        await this.client.health()
        return
      } catch (err) {
        if (!(err instanceof AxiforgeNotRunningError)) throw err
      }
      if (Date.now() >= deadline) {
        throw new AxiforgeError(
          'AxiForge was launched but its local API did not come up in time — try opening AxiForge manually, then retry.'
        )
      }
      await new Promise((r) => setTimeout(r, this.timing.pollMs))
    }
  }
}
