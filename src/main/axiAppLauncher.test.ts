import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AxiAppLauncher, resolveAxiforgeExe, type LauncherIo } from './axiAppLauncher'
import { AxiforgeNotRunningError, AxiforgeError } from './axiforgeClient'

let dataDir: string

function fakeIo(overrides: Partial<LauncherIo> = {}): LauncherIo {
  return {
    platform: 'linux',
    spawn: vi.fn().mockReturnValue({ on: vi.fn(), unref: vi.fn() }),
    execSync: vi.fn().mockReturnValue(''),
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockImplementation(() => {
      throw new Error('ENOENT')
    }),
    statSync: vi.fn(),
    hasSystemdRun: () => false,
    ...overrides
  } as LauncherIo
}

/** Client stub: health() fails `failures` times with NotRunning, then succeeds. */
function flakyClient(failures: number): { health: () => Promise<{ ok: boolean; version: string }> } {
  let calls = 0
  return {
    health: async () => {
      calls += 1
      if (calls <= failures) throw new AxiforgeNotRunningError()
      return { ok: true, version: '1.4.0' }
    }
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'axiforge-launch-'))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

describe('resolveAxiforgeExe', () => {
  it('prefers exePath from the discovery file when it exists on disk', () => {
    writeFileSync(
      join(dataDir, 'local-api.json'),
      JSON.stringify({ port: 1, token: 't', exePath: '/opt/AxiForge/axiforge', version: '1', pid: 1 })
    )
    const io = fakeIo({ existsSync: vi.fn().mockImplementation((p: string) => p === '/opt/AxiForge/axiforge') })
    expect(resolveAxiforgeExe(dataDir, io)).toBe('/opt/AxiForge/axiforge')
  })

  it('falls back to an AppImage filename scan on linux', () => {
    const io = fakeIo({
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage', 'other.txt'] : []
      )
    })
    expect(resolveAxiforgeExe(dataDir, io)).toMatch(/AppImages\/AxiForge-1\.4\.0\.AppImage$/)
  })

  it('on windows, resolves DisplayIcon exe from the registry query', () => {
    const io = fakeIo({
      platform: 'win32',
      execSync: vi
        .fn()
        .mockReturnValue('{"InstallLocation":"C:\\\\Apps\\\\AxiForge","DisplayIcon":"C:\\\\Apps\\\\AxiForge\\\\AxiForge.exe,0"}'),
      existsSync: vi.fn().mockImplementation((p: string) => p === 'C:\\Apps\\AxiForge\\AxiForge.exe')
    })
    expect(resolveAxiforgeExe(dataDir, io)).toBe('C:\\Apps\\AxiForge\\AxiForge.exe')
  })

  it('returns null when nothing is found', () => {
    expect(resolveAxiforgeExe(dataDir, fakeIo())).toBeNull()
  })
})

describe('AxiAppLauncher.ensureRunning', () => {
  it('is a no-op when /health already responds', async () => {
    const io = fakeIo()
    const launcher = new AxiAppLauncher(flakyClient(0), dataDir, io, { timeoutMs: 1000, pollMs: 10 })
    await launcher.ensureRunning()
    expect(io.spawn).not.toHaveBeenCalled()
  })

  it('spawns detached with --headless and a sanitized env, then polls to success', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173'
    process.env.NODE_OPTIONS = '--max-old-space-size=4096'
    const io = fakeIo({
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage'] : []
      )
    })
    const launcher = new AxiAppLauncher(flakyClient(3), dataDir, io, { timeoutMs: 5000, pollMs: 10 })
    await launcher.ensureRunning()
    const [cmd, args, opts] = (io.spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(cmd).toMatch(/AxiForge-1\.4\.0\.AppImage$/)
    expect(args).toEqual(['--headless'])
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(opts.env.VITE_DEV_SERVER_URL).toBeUndefined()
    expect(opts.env.NODE_OPTIONS).toBeUndefined()
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    delete process.env.VITE_DEV_SERVER_URL
    delete process.env.NODE_OPTIONS
  })

  it('wraps the spawn in systemd-run --user --scope when available on linux', async () => {
    const io = fakeIo({
      hasSystemdRun: () => true,
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage'] : []
      )
    })
    const launcher = new AxiAppLauncher(flakyClient(1), dataDir, io, { timeoutMs: 5000, pollMs: 10 })
    await launcher.ensureRunning()
    const [cmd, args] = (io.spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(cmd).toBe('systemd-run')
    expect(args.slice(0, 3)).toEqual(['--user', '--scope', '--'])
    expect(args[args.length - 1]).toBe('--headless')
  })

  it('errors with an install hint when no executable is found', async () => {
    const launcher = new AxiAppLauncher(flakyClient(99), dataDir, fakeIo(), { timeoutMs: 100, pollMs: 10 })
    const err = await launcher.ensureRunning().catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err.message).toMatch(/install/i)
  })

  it('errors when the API never comes up within the timeout', async () => {
    const io = fakeIo({
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage'] : []
      )
    })
    const launcher = new AxiAppLauncher(flakyClient(Infinity), dataDir, io, { timeoutMs: 50, pollMs: 10 })
    const err = await launcher.ensureRunning().catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err.message).toMatch(/did not come up/i)
  })
})
