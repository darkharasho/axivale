import { describe, it, expect, vi } from 'vitest'
import { OllamaManager } from './ollamaManager'

function makeDeps(over: Partial<ConstructorParameters<typeof OllamaManager>[1]> = {}) {
  return {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    chmodSync: vi.fn(),
    download: vi.fn().mockResolvedValue(undefined),
    extract: vi.fn().mockResolvedValue(undefined),
    spawnServe: vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn() }),
    httpGet: vi.fn(),
    httpPullStream: vi.fn(),
    platform: 'linux',
    arch: 'x64',
    ...over
  }
}

describe('OllamaManager.getStatus', () => {
  it('reports not installed when the binary is absent', async () => {
    const m = new OllamaManager('/ud', makeDeps())
    const s = await m.getStatus()
    expect(s.installed).toBe(false)
  })

  it('reports installed + serverRunning when binary exists and /api/tags answers', async () => {
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(true),
      httpGet: vi.fn().mockResolvedValue({ models: [{ name: 'qwen3:8b' }] })
    })
    const m = new OllamaManager('/ud', deps)
    const s = await m.getStatus()
    expect(s.installed).toBe(true)
    expect(s.serverRunning).toBe(true)
    expect(s.model).toBe('qwen3:8b')
  })
})

describe('OllamaManager.install', () => {
  it('downloads, extracts, and chmods the binary', async () => {
    const deps = makeDeps()
    const m = new OllamaManager('/ud', deps)
    await m.install(() => {})
    expect(deps.download).toHaveBeenCalledTimes(1)
    expect(deps.extract).toHaveBeenCalledWith(
      'zst',
      expect.stringContaining('.zst'),
      expect.stringContaining('/ud/ollama')
    )
    expect(deps.chmodSync).toHaveBeenCalled()
  })

  it('skips install when already installed', async () => {
    const deps = makeDeps({ existsSync: vi.fn().mockReturnValue(true) })
    const m = new OllamaManager('/ud', deps)
    await m.install(() => {})
    expect(deps.download).not.toHaveBeenCalled()
  })
})

describe('OllamaManager.pullModel', () => {
  it('forwards parsed progress for each NDJSON line', async () => {
    const deps = makeDeps({
      httpPullStream: vi.fn(async (_model: string, onLine: (l: string) => void) => {
        onLine('{"status":"pulling","completed":1,"total":2}')
        onLine('{"status":"success"}')
      })
    })
    const m = new OllamaManager('/ud', deps)
    const seen: number[] = []
    await m.pullModel('qwen3:8b', (p) => { if (p.percent !== undefined) seen.push(p.percent) })
    expect(seen).toContain(50)
  })

  it('throws when a line carries an error', async () => {
    const deps = makeDeps({
      httpPullStream: vi.fn(async (_m: string, onLine: (l: string) => void) => {
        onLine('{"error":"no such model"}')
      })
    })
    const m = new OllamaManager('/ud', deps)
    await expect(m.pullModel('bogus', () => {})).rejects.toThrow(/no such model/)
  })
})

describe('OllamaManager.ensureServerRunning', () => {
  it('fails fast when the server process exits before becoming ready', async () => {
    const deps = makeDeps({
      httpGet: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      spawnServe: vi.fn().mockReturnValue({
        kill: vi.fn(),
        on: (event: string, cb: (arg?: unknown) => void) => {
          if (event === 'exit') cb(1)
        }
      })
    })
    const m = new OllamaManager('/ud', deps)
    await expect(m.ensureServerRunning()).rejects.toThrow(/exited before becoming ready/)
  })
})
