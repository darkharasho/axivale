# Built-in Ollama Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click in-app flow that installs a self-managed Ollama into `userData`, recommends a model that fits the machine's RAM, downloads it with visible progress, and switches AxiVale to the local provider — with no sudo/admin on Windows, macOS, or Linux.

**Architecture:** Mirror the proven `axibridge` `EiManager` pattern: download a per-OS standalone Ollama build into `userData/ollama/`, extract it with the system `tar`, and spawn `ollama serve` as a child process we own. Only install/extract is OS-specific; hardware detection, model pull (`POST /api/pull`), and provider wiring are platform-agnostic over HTTP.

**Tech Stack:** Electron main (Node `https`/`child_process`/`os`/`fs`), TypeScript, Vitest (colocated `*.test.ts`, run with `--maxWorkers=2`), React renderer (`Settings.tsx`), IPC via `contextBridge`.

---

## File Structure

- Create: `src/main/ollama/hardware.ts` — pure RAM→model recommendation.
- Create: `src/main/ollama/hardware.test.ts`
- Create: `src/main/ollama/assets.ts` — pure platform/arch→asset descriptor.
- Create: `src/main/ollama/assets.test.ts`
- Create: `src/main/ollama/pullProgress.ts` — pure NDJSON line→progress parser.
- Create: `src/main/ollama/pullProgress.test.ts`
- Create: `src/main/ollama/extract.ts` — spawn `tar` to extract an archive.
- Create: `src/main/ollama/extract.test.ts`
- Create: `src/main/ollama/ollamaManager.ts` — `OllamaManager` (install/status/serve/pull/uninstall).
- Create: `src/main/ollama/ollamaManager.test.ts`
- Modify: `src/main/index.ts` — construct `OllamaManager`, register `ollama:*` IPC handlers, stop server on quit.
- Modify: `src/preload/index.ts` — expose `ollama*` bridge methods.
- Modify: `src/renderer/src/global.d.ts` (or the existing `officer` window type decl) — add `ollama*` signatures.
- Modify: `src/renderer/src/components/Settings.tsx` (~660–685) — replace the static "Install Ollama from ollama.com" nudge with the setup wizard.

---

## Task 1: Hardware detection → model recommendation (pure)

**Files:**
- Create: `src/main/ollama/hardware.ts`
- Test: `src/main/ollama/hardware.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/ollama/hardware.test.ts
import { describe, it, expect } from 'vitest'
import { recommendModel, detectHardware } from './hardware'

const GB = 1024 ** 3

describe('recommendModel', () => {
  it('recommends llama3.2:3b for <8GB RAM', () => {
    const r = recommendModel(6 * GB)
    expect(r.recommended).toBe('llama3.2:3b')
    expect(r.options).toEqual(['llama3.2:3b', 'qwen3:8b'])
  })

  it('recommends qwen3:8b for 8-16GB RAM', () => {
    const r = recommendModel(12 * GB)
    expect(r.recommended).toBe('qwen3:8b')
    expect(r.options).toEqual(['llama3.2:3b', 'qwen3:8b'])
  })

  it('recommends qwen3:8b and offers qwen3:14b for >=16GB RAM', () => {
    const r = recommendModel(32 * GB)
    expect(r.recommended).toBe('qwen3:8b')
    expect(r.options).toEqual(['llama3.2:3b', 'qwen3:8b', 'qwen3:14b'])
  })

  it('treats exactly 8GB as the mid tier', () => {
    expect(recommendModel(8 * GB).recommended).toBe('qwen3:8b')
  })
})

describe('detectHardware', () => {
  it('returns a rounded RAM figure and a recommendation', () => {
    const info = detectHardware()
    expect(info.totalRamGb).toBeGreaterThan(0)
    expect(info.modelOptions).toContain(info.recommendedModel)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ollama/hardware.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./hardware`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/ollama/hardware.ts
import os from 'os'

export interface HardwareInfo {
  totalRamGb: number
  recommendedModel: string
  modelOptions: string[]
}

const GB = 1024 ** 3

export function recommendModel(totalBytes: number): { recommended: string; options: string[] } {
  const gb = totalBytes / GB
  if (gb < 8) return { recommended: 'llama3.2:3b', options: ['llama3.2:3b', 'qwen3:8b'] }
  if (gb < 16) return { recommended: 'qwen3:8b', options: ['llama3.2:3b', 'qwen3:8b'] }
  return { recommended: 'qwen3:8b', options: ['llama3.2:3b', 'qwen3:8b', 'qwen3:14b'] }
}

export function detectHardware(): HardwareInfo {
  const totalBytes = os.totalmem()
  const { recommended, options } = recommendModel(totalBytes)
  return {
    totalRamGb: Math.round(totalBytes / GB),
    recommendedModel: recommended,
    modelOptions: options
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ollama/hardware.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/hardware.ts src/main/ollama/hardware.test.ts
git commit -m "feat(ollama): hardware detection and model recommendation"
```

---

## Task 2: Asset resolution per platform/arch (pure)

**Files:**
- Create: `src/main/ollama/assets.ts`
- Test: `src/main/ollama/assets.test.ts`

> NOTE: The asset URLs follow Ollama's published standalone-build naming. The test asserts the platform/arch→filename mapping (stable contract); if Ollama renames an asset, only the URL constant changes and the test still pins the shape. **Verify the live URLs once during implementation** before the manual smoke test.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/ollama/assets.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAsset } from './assets'

describe('resolveAsset', () => {
  it('resolves linux x64 to the tgz tarball and bin/ollama', () => {
    const a = resolveAsset('linux', 'x64')
    expect(a.url).toContain('ollama-linux-amd64.tgz')
    expect(a.archive).toBe('tgz')
    expect(a.binRelPath).toBe('bin/ollama')
  })

  it('resolves linux arm64', () => {
    expect(resolveAsset('linux', 'arm64').url).toContain('ollama-linux-arm64.tgz')
  })

  it('resolves win32 to the zip and ollama.exe', () => {
    const a = resolveAsset('win32', 'x64')
    expect(a.url).toContain('ollama-windows-amd64.zip')
    expect(a.archive).toBe('zip')
    expect(a.binRelPath).toBe('ollama.exe')
  })

  it('resolves darwin to the app zip', () => {
    const a = resolveAsset('darwin', 'arm64')
    expect(a.archive).toBe('zip')
    expect(a.binRelPath).toContain('ollama')
  })

  it('throws on an unsupported platform', () => {
    expect(() => resolveAsset('aix', 'x64')).toThrow(/unsupported/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ollama/assets.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./assets`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/ollama/assets.ts
export interface OllamaAsset {
  url: string
  archive: 'tgz' | 'zip'
  /** Path of the ollama executable relative to the extraction root. */
  binRelPath: string
}

const BASE = 'https://ollama.com/download'

function linuxArch(arch: string): string {
  if (arch === 'arm64') return 'arm64'
  return 'amd64' // x64
}

export function resolveAsset(platform: string, arch: string): OllamaAsset {
  switch (platform) {
    case 'linux':
      return {
        url: `${BASE}/ollama-linux-${linuxArch(arch)}.tgz`,
        archive: 'tgz',
        binRelPath: 'bin/ollama'
      }
    case 'win32':
      return {
        url: `${BASE}/ollama-windows-amd64.zip`,
        archive: 'zip',
        binRelPath: 'ollama.exe'
      }
    case 'darwin':
      return {
        url: `${BASE}/Ollama-darwin.zip`,
        archive: 'zip',
        // The app zip contains Ollama.app; the CLI server binary lives inside it.
        binRelPath: 'Ollama.app/Contents/Resources/ollama'
      }
    default:
      throw new Error(`Unsupported platform for Ollama install: ${platform}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ollama/assets.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/assets.ts src/main/ollama/assets.test.ts
git commit -m "feat(ollama): per-platform standalone asset resolution"
```

---

## Task 3: Pull-progress parser (pure)

`POST /api/pull` streams NDJSON lines like `{"status":"pulling ...","completed":123,"total":456}`. This parses one line into a progress update.

**Files:**
- Create: `src/main/ollama/pullProgress.ts`
- Test: `src/main/ollama/pullProgress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/ollama/pullProgress.test.ts
import { describe, it, expect } from 'vitest'
import { parsePullLine } from './pullProgress'

describe('parsePullLine', () => {
  it('computes percent from completed/total', () => {
    const r = parsePullLine('{"status":"pulling manifest","completed":50,"total":200}')
    expect(r).toEqual({ status: 'pulling manifest', percent: 25 })
  })

  it('returns percent undefined when total is missing or zero', () => {
    expect(parsePullLine('{"status":"verifying"}')).toEqual({ status: 'verifying', percent: undefined })
    expect(parsePullLine('{"status":"x","completed":5,"total":0}')).toEqual({ status: 'x', percent: undefined })
  })

  it('returns null for blank or non-JSON lines', () => {
    expect(parsePullLine('')).toBeNull()
    expect(parsePullLine('   ')).toBeNull()
    expect(parsePullLine('not json')).toBeNull()
  })

  it('surfaces an error field', () => {
    const r = parsePullLine('{"error":"pull model manifest: file does not exist"}')
    expect(r?.error).toMatch(/file does not exist/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ollama/pullProgress.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./pullProgress`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/ollama/pullProgress.ts
export interface PullProgress {
  status: string
  percent?: number
  error?: string
}

export function parsePullLine(line: string): PullProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: { status?: string; completed?: number; total?: number; error?: string }
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }
  const percent =
    typeof obj.completed === 'number' && typeof obj.total === 'number' && obj.total > 0
      ? Math.round((obj.completed / obj.total) * 100)
      : undefined
  return { status: obj.status ?? '', percent, error: obj.error }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ollama/pullProgress.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/pullProgress.ts src/main/ollama/pullProgress.test.ts
git commit -m "feat(ollama): NDJSON pull-progress parser"
```

---

## Task 4: Archive extraction via system `tar`

Modern `tar` (GNU on Linux, bsdtar on macOS/Windows 10+) extracts both `.tgz` and `.zip`. Linux only ever receives `.tgz`; Windows/macOS receive `.zip` and their bundled `tar` handles it.

**Files:**
- Create: `src/main/ollama/extract.ts`
- Test: `src/main/ollama/extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/ollama/extract.test.ts
import { describe, it, expect, vi } from 'vitest'

const spawnMock = vi.fn()
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

import { tarArgs, extractArchive } from './extract'

function fakeProc(exitCode: number) {
  return {
    stderr: { on: vi.fn() },
    on: (event: string, cb: (arg?: number) => void) => {
      if (event === 'close') cb(exitCode)
    }
  }
}

describe('tarArgs', () => {
  it('uses -xzf for tgz', () => {
    expect(tarArgs('tgz', '/a.tgz', '/dest')).toEqual(['-xzf', '/a.tgz', '-C', '/dest'])
  })
  it('uses -xf for zip', () => {
    expect(tarArgs('zip', '/a.zip', '/dest')).toEqual(['-xf', '/a.zip', '-C', '/dest'])
  })
})

describe('extractArchive', () => {
  it('resolves when tar exits 0', async () => {
    spawnMock.mockReturnValueOnce(fakeProc(0))
    await expect(extractArchive('tgz', '/a.tgz', '/dest')).resolves.toBeUndefined()
    expect(spawnMock).toHaveBeenCalledWith('tar', ['-xzf', '/a.tgz', '-C', '/dest'], expect.anything())
  })

  it('rejects when tar exits non-zero', async () => {
    spawnMock.mockReturnValueOnce(fakeProc(2))
    await expect(extractArchive('zip', '/a.zip', '/dest')).rejects.toThrow(/exited with code 2/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ollama/extract.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./extract`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/ollama/extract.ts
import { spawn } from 'child_process'

export function tarArgs(archive: 'tgz' | 'zip', src: string, destDir: string): string[] {
  const flag = archive === 'tgz' ? '-xzf' : '-xf'
  return [flag, src, '-C', destDir]
}

export function extractArchive(archive: 'tgz' | 'zip', src: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', tarArgs(archive, src, destDir), { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with code ${code}: ${stderr.trim()}`))
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ollama/extract.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/extract.ts src/main/ollama/extract.test.ts
git commit -m "feat(ollama): tar-based archive extraction helper"
```

---

## Task 5: `OllamaManager` — install, status, serve, pull, uninstall

Assembles Tasks 1–4 with a redirect-following `downloadFile` (copied from the proven `EiManager` pattern), a spawned `ollama serve`, and HTTP calls. Network/process/fs are injected or mocked in tests.

**Files:**
- Create: `src/main/ollama/ollamaManager.ts`
- Test: `src/main/ollama/ollamaManager.test.ts`

- [ ] **Step 1: Write the failing test** (status logic + pull streaming, with deps injected)

```ts
// src/main/ollama/ollamaManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaManager } from './ollamaManager'

// fs + extract + download are injected via the constructor's deps for testability.
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
    expect(deps.extract).toHaveBeenCalledWith('tgz', expect.stringContaining('.tgz'), expect.stringContaining('/ud/ollama'))
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ollama/ollamaManager.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./ollamaManager`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/ollama/ollamaManager.ts
import path from 'path'
import { resolveAsset } from './assets'
import { parsePullLine, PullProgress } from './pullProgress'

export interface OllamaStatus {
  installed: boolean
  serverRunning: boolean
  version: string | null
  model: string | null
}

export interface ServeHandle {
  kill: () => void
  on: (event: string, cb: (...a: unknown[]) => void) => void
}

export interface OllamaDeps {
  existsSync: (p: string) => boolean
  mkdirSync: (p: string, opts: { recursive: boolean }) => void
  rmSync: (p: string, opts: { recursive: boolean; force: boolean }) => void
  chmodSync: (p: string, mode: number) => void
  download: (url: string, dest: string, onPct: (pct: number) => void) => Promise<void>
  extract: (archive: 'tgz' | 'zip', src: string, destDir: string) => Promise<void>
  spawnServe: (binPath: string, endpoint: string) => ServeHandle
  httpGet: (url: string) => Promise<{ models?: { name: string }[] }>
  httpPullStream: (model: string, onLine: (line: string) => void, endpoint: string) => Promise<void>
  platform: string
  arch: string
}

export type StageProgress = { stage: string; percent?: number }

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'

export class OllamaManager {
  private baseDir: string
  private binPath: string
  private serve: ServeHandle | null = null
  private endpoint = DEFAULT_ENDPOINT

  constructor(userDataPath: string, private deps: OllamaDeps) {
    this.baseDir = path.join(userDataPath, 'ollama')
    const asset = resolveAsset(deps.platform, deps.arch)
    this.binPath = path.join(this.baseDir, asset.binRelPath)
  }

  getEndpoint(): string {
    return this.endpoint
  }

  isInstalled(): boolean {
    return this.deps.existsSync(this.binPath)
  }

  async getStatus(): Promise<OllamaStatus> {
    const installed = this.isInstalled()
    let serverRunning = false
    let model: string | null = null
    try {
      const tags = await this.deps.httpGet(`${this.endpoint}/api/tags`)
      serverRunning = true
      model = tags.models && tags.models.length > 0 ? tags.models[0].name : null
    } catch {
      serverRunning = false
    }
    return { installed, serverRunning, version: null, model }
  }

  async install(onProgress: (p: StageProgress) => void): Promise<void> {
    if (this.isInstalled()) return
    const asset = resolveAsset(this.deps.platform, this.deps.arch)
    this.deps.mkdirSync(this.baseDir, { recursive: true })
    const archivePath = path.join(this.baseDir, `ollama.${asset.archive === 'tgz' ? 'tgz' : 'zip'}`)
    onProgress({ stage: 'Downloading Ollama', percent: 0 })
    await this.deps.download(asset.url, archivePath, (pct) =>
      onProgress({ stage: 'Downloading Ollama', percent: pct })
    )
    onProgress({ stage: 'Extracting Ollama' })
    await this.deps.extract(asset.archive, archivePath, this.baseDir)
    if (this.deps.platform !== 'win32') {
      this.deps.chmodSync(this.binPath, 0o755)
    }
    onProgress({ stage: 'Installed' })
  }

  async ensureServerRunning(): Promise<void> {
    const status = await this.getStatus()
    if (status.serverRunning) return
    this.serve = this.deps.spawnServe(this.binPath, this.endpoint)
    // Poll /api/tags until it answers, up to ~30s.
    for (let i = 0; i < 60; i++) {
      try {
        await this.deps.httpGet(`${this.endpoint}/api/tags`)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    throw new Error('Ollama server did not become ready within 30s')
  }

  async pullModel(model: string, onProgress: (p: PullProgress) => void): Promise<void> {
    let pullError: string | null = null
    await this.deps.httpPullStream(
      model,
      (line) => {
        const p = parsePullLine(line)
        if (!p) return
        if (p.error) pullError = p.error
        onProgress(p)
      },
      this.endpoint
    )
    if (pullError) throw new Error(pullError)
  }

  stopServer(): void {
    if (this.serve) {
      try {
        this.serve.kill()
      } catch {
        /* ignore */
      }
      this.serve = null
    }
  }

  uninstall(): void {
    this.stopServer()
    if (this.deps.existsSync(this.baseDir)) {
      this.deps.rmSync(this.baseDir, { recursive: true, force: true })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ollama/ollamaManager.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama/ollamaManager.ts src/main/ollama/ollamaManager.test.ts
git commit -m "feat(ollama): OllamaManager install/status/serve/pull lifecycle"
```

---

## Task 6: Real dependency wiring + IPC handlers in `index.ts`

Build the production `OllamaDeps` (real `fs`, the `extractArchive` helper, an `EiManager`-style redirect-following `downloadFile`, a `spawnServe` using `child_process.spawn` with `OLLAMA_HOST`, and `httpGet`/`httpPullStream` over Node `http`), construct the manager, register `ollama:*` handlers, and stop the server on quit.

**Files:**
- Create: `src/main/ollama/realDeps.ts` (the production `OllamaDeps` factory)
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create the production deps factory**

```ts
// src/main/ollama/realDeps.ts
import fs from 'fs'
import http from 'http'
import https from 'https'
import { spawn } from 'child_process'
import { URL } from 'url'
import { extractArchive } from './extract'
import type { OllamaDeps, ServeHandle } from './ollamaManager'

function download(url: string, dest: string, onPct: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      const lib = u.startsWith('https') ? https : http
      lib
        .get(u, { headers: { 'User-Agent': 'AxiVale' } }, (res) => {
          const code = res.statusCode || 0
          if ([301, 302, 307, 308].includes(code) && res.headers.location) {
            follow(res.headers.location)
            return
          }
          if (code >= 400) {
            reject(new Error(`HTTP ${code} downloading ${u}`))
            return
          }
          const total = parseInt(res.headers['content-length'] || '0', 10)
          let received = 0
          const file = fs.createWriteStream(dest)
          res.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total > 0) onPct(Math.round((received / total) * 100))
          })
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', (err) => {
            fs.unlink(dest, () => {})
            reject(err)
          })
        })
        .on('error', reject)
    }
    follow(url)
  })
}

function httpGetJson(url: string): Promise<{ models?: { name: string }[] }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => {
        data += c
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
  })
}

function httpPullStream(model: string, onLine: (line: string) => void, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${endpoint}/api/pull`)
    const body = JSON.stringify({ name: model, stream: true })
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let buf = ''
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString()
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            onLine(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
          }
        })
        res.on('end', () => {
          if (buf.trim()) onLine(buf)
          resolve()
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function spawnServe(binPath: string, endpoint: string): ServeHandle {
  const u = new URL(endpoint)
  const proc = spawn(binPath, ['serve'], {
    env: { ...process.env, OLLAMA_HOST: `${u.hostname}:${u.port}` },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  return proc as unknown as ServeHandle
}

export function createOllamaDeps(): OllamaDeps {
  return {
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync as OllamaDeps['mkdirSync'],
    rmSync: fs.rmSync as OllamaDeps['rmSync'],
    chmodSync: fs.chmodSync,
    download,
    extract: extractArchive,
    spawnServe,
    httpGet: httpGetJson,
    httpPullStream,
    platform: process.platform,
    arch: process.arch
  }
}
```

- [ ] **Step 2: Construct the manager in `index.ts`**

Add near the other `userData` constructions (after `src/main/index.ts:189`):

```ts
import { OllamaManager } from './ollama/ollamaManager'
import { createOllamaDeps } from './ollama/realDeps'

const ollama = new OllamaManager(app.getPath('userData'), createOllamaDeps())
```

- [ ] **Step 3: Register IPC handlers** (alongside the other `ipcMain.handle` calls near `src/main/index.ts:407`)

```ts
import { detectHardware } from './ollama/hardware'

ipcMain.handle('ollama:detect-hardware', () => detectHardware())

ipcMain.handle('ollama:get-status', () => ollama.getStatus())

ipcMain.handle('ollama:install', async (event) => {
  const send = (channel: string, payload: unknown): void =>
    BrowserWindow.fromWebContents(event.sender)?.webContents.send(channel, payload)
  await ollama.install((p) => send('ollama:progress', { kind: 'install', ...p }))
  await ollama.ensureServerRunning()
  return ollama.getStatus()
})

ipcMain.handle('ollama:pull-model', async (event, model: string) => {
  const send = (channel: string, payload: unknown): void =>
    BrowserWindow.fromWebContents(event.sender)?.webContents.send(channel, payload)
  await ollama.ensureServerRunning()
  await ollama.pullModel(model, (p) => send('ollama:progress', { kind: 'pull', ...p }))
  // Switch the app to the local provider on success.
  store.setSetting('provider', 'local')
  store.setSetting('localModel', model)
  store.setSetting('localEndpoint', ollama.getEndpoint())
  return ollama.getStatus()
})

ipcMain.handle('ollama:uninstall', () => {
  ollama.uninstall()
  return ollama.getStatus()
})
```

- [ ] **Step 4: Stop the server on quit**

Find the existing `app.on('before-quit', …)` (or `window-all-closed`) handler in `src/main/index.ts` and add inside it:

```ts
ollama.stopServer()
```

If no `before-quit` handler exists, add one near the other `app.on(...)` registrations:

```ts
app.on('before-quit', () => {
  ollama.stopServer()
})
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ollama/realDeps.ts src/main/index.ts
git commit -m "feat(ollama): wire OllamaManager deps and ipc handlers"
```

---

## Task 7: Preload bridge + renderer types

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts` (the `Window['officer']` declaration; if the type lives elsewhere, match that file)

- [ ] **Step 1: Add bridge methods** to the `officer` object in `src/preload/index.ts`

```ts
  ollamaDetectHardware: () => ipcRenderer.invoke('ollama:detect-hardware'),
  ollamaGetStatus: () => ipcRenderer.invoke('ollama:get-status'),
  ollamaInstall: () => ipcRenderer.invoke('ollama:install'),
  ollamaPullModel: (model: string) => ipcRenderer.invoke('ollama:pull-model', model),
  ollamaUninstall: () => ipcRenderer.invoke('ollama:uninstall'),
  onOllamaProgress: (cb: (p: { kind: string; stage?: string; status?: string; percent?: number }) => void) => {
    const handler = (_e: unknown, payload: { kind: string; stage?: string; status?: string; percent?: number }) =>
      cb(payload)
    ipcRenderer.on('ollama:progress', handler)
    return () => ipcRenderer.removeListener('ollama:progress', handler)
  },
```

- [ ] **Step 2: Add the matching type signatures** to the `officer` interface in `src/renderer/src/global.d.ts`

```ts
    ollamaDetectHardware: () => Promise<{ totalRamGb: number; recommendedModel: string; modelOptions: string[] }>
    ollamaGetStatus: () => Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
    ollamaInstall: () => Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
    ollamaPullModel: (model: string) => Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
    ollamaUninstall: () => Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
    onOllamaProgress: (
      cb: (p: { kind: string; stage?: string; status?: string; percent?: number }) => void
    ) => () => void
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat(ollama): expose ollama bridge to renderer"
```

---

## Task 8: Setup wizard UI in `Settings.tsx`

Replace the static "Install Ollama from ollama.com…" nudge (`src/renderer/src/components/Settings.tsx` ~679) with a wizard. Keep the existing model picker (`localModels`/`pickProviderModel`) for when models are already present; show the wizard when none are.

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`

- [ ] **Step 1: Add wizard state and progress subscription** (near the other `useState` hooks in the component)

```tsx
  const [ollamaBusy, setOllamaBusy] = useState(false)
  const [ollamaStage, setOllamaStage] = useState<string>('')
  const [ollamaPct, setOllamaPct] = useState<number | null>(null)
  const [ollamaErr, setOllamaErr] = useState<string | null>(null)
  const [hw, setHw] = useState<{ totalRamGb: number; recommendedModel: string; modelOptions: string[] } | null>(null)
  const [chosenModel, setChosenModel] = useState<string>('')

  useEffect(() => {
    const off = window.officer.onOllamaProgress((p) => {
      setOllamaStage(p.stage || p.status || '')
      setOllamaPct(typeof p.percent === 'number' ? p.percent : null)
    })
    return off
  }, [])

  const startOllamaSetup = async (): Promise<void> => {
    setOllamaErr(null)
    setOllamaBusy(true)
    try {
      const info = hw ?? (await window.officer.ollamaDetectHardware())
      setHw(info)
      const model = chosenModel || info.recommendedModel
      await window.officer.ollamaInstall()
      await window.officer.ollamaPullModel(model)
    } catch (e) {
      setOllamaErr(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setOllamaBusy(false)
      setOllamaPct(null)
    }
  }
```

- [ ] **Step 2: Detect hardware when the local section is shown** (add to the existing local-provider effect, or a new effect)

```tsx
  useEffect(() => {
    window.officer.ollamaDetectHardware().then((info) => {
      setHw(info)
      setChosenModel((cur) => cur || info.recommendedModel)
    })
  }, [])
```

- [ ] **Step 3: Replace the static nudge** `<p className="shelp">…ollama pull qwen3:8b…</p>` (around `Settings.tsx:679`) with the wizard. Keep the surrounding `localModels.length > 0` picker block above it untouched.

```tsx
            {localModels.length === 0 && (
              <div className="ollama-setup">
                {hw && (
                  <p className="shelp">
                    Detected {hw.totalRamGb} GB RAM — recommended <strong>{hw.recommendedModel}</strong>.
                  </p>
                )}
                {hw && (
                  <>
                    <label className="slabel">Model</label>
                    <div className="picker">
                      {hw.modelOptions.map((m) => (
                        <button
                          key={m}
                          className={`pi${chosenModel === m ? ' sel' : ''}`}
                          disabled={ollamaBusy}
                          onClick={() => setChosenModel(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button className="sbtn" disabled={ollamaBusy} onClick={startOllamaSetup}>
                  {ollamaBusy ? 'Setting up…' : 'Set up local AI (one click)'}
                </button>
                {ollamaBusy && (
                  <div className="ollama-progress">
                    <div className="sstatus">{ollamaStage}</div>
                    {ollamaPct !== null && (
                      <progress max={100} value={ollamaPct} />
                    )}
                  </div>
                )}
                {ollamaErr && (
                  <div className="sstatus err">
                    {ollamaErr}{' '}
                    <button className="linklike" onClick={startOllamaSetup}>Retry</button>
                  </div>
                )}
                <p className="shelp">
                  Installs a private, self-contained Ollama just for AxiVale — no admin rights,
                  nothing else on your system is touched. Or install it yourself from
                  ollama.com and run <code>ollama pull qwen3:8b</code>. Local models are slower
                  and less reliable on multi-step tasks than the cloud providers.
                </p>
              </div>
            )}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual smoke test** (cannot be automated — real download + server + cross-OS)

Run: `npm run dev`
1. Open Settings → AI provider → Local.
2. Confirm "Detected N GB RAM — recommended …" appears with a model picker and the one-click button.
3. Click "Set up local AI". Confirm: download progress bar advances → "Extracting" → model pull progress advances → on success the model picker (`localModels`) shows the pulled model and the provider switches to Local.
4. Send a test message to confirm the local model responds.

> Verify-during-impl per the spec: live asset URLs, and on macOS whether the extracted binary runs or trips Gatekeeper quarantine (may need an `xattr -d com.apple.quarantine` step added to `install()` for darwin).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Settings.tsx
git commit -m "feat(ollama): in-app setup wizard replacing manual nudge"
```

---

## Self-Review Notes

- **Spec coverage:** managed-binary-in-userData (Tasks 2,4,5,6); no-sudo all-OS (Task 4 uses system `tar`, Task 5 spawns own server); hardware tiers (Task 1); per-OS asset (Task 2); server lifecycle (Task 5 `ensureServerRunning`/`stopServer`, Task 6 quit hook); model pull progress (Tasks 3,5,6); provider switch on success (Task 6 Step 3); wizard with retry + manual fallback (Task 8); macOS Gatekeeper + asset-URL verification called out in Tasks 2 & 8.
- **Type consistency:** `OllamaStatus`/`OllamaDeps`/`ServeHandle`/`StageProgress`/`PullProgress` defined in Tasks 3 & 5 and reused verbatim in Tasks 6–7; bridge method names match between preload (Task 7 Step 1) and renderer types (Task 7 Step 2) and usage (Task 8).
- **Out of scope (YAGNI):** no model training, no bundling the binary into the installer, no multi-model library — matching the spec.
