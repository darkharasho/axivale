import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import type { AgentEvent, ProviderAdapter, ProviderConfig, SessionState, TurnInput } from './types'
import { EventQueue, OFFICER_SERVER_PATH, startOfficerBridge, unpacked } from './officerBridge'
import { translateCodexEvent, type CodexThreadEvent } from './codexEvents'

const requireModule = createRequire(import.meta.url)

/**
 * Append a line to logs/codex.log. Codex writes officer-MCP connection failures
 * to its stderr, which we otherwise discard on a clean exit — so when the proxy
 * fails to start (e.g. on Windows) the model silently runs with zero tools and
 * the cause is invisible. Lazy electron require keeps this module test-safe.
 */
function codexLog(msg: string): void {
  try {
    const dir = (requireModule('electron') as { app: { getPath(n: string): string } }).app.getPath('logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'codex.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // best-effort; logging must never throw
  }
}

/** Platform package that ships the codex binary, by Rust target triple. */
const PLATFORM_PACKAGE: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
}

function targetTriple(): string {
  const { platform, arch } = process
  if (platform === 'linux' || platform === 'android')
    return arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'
  if (platform === 'darwin')
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  if (platform === 'win32')
    return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  throw new Error(`Codex: unsupported platform ${platform} (${arch})`)
}

/**
 * Locates the codex CLI binary shipped by the @openai/codex-<platform> package,
 * plus any helper dirs it wants on PATH. Mirrors @openai/codex-sdk's
 * findCodexPath, but resolved here so we can spawn the binary OURSELVES with the
 * bypass flag (the SDK exposes no raw-flag passthrough, and its no-shell spawn
 * of a wrapper script can't run on Windows). Paths are asar-unpacked for
 * packaged builds.
 */
function resolveCodexBinary(): { bin: string; pathDirs: string[] } {
  const triple = targetTriple()
  const pkg = PLATFORM_PACKAGE[triple]
  const codexPkgJson = requireModule.resolve('@openai/codex/package.json')
  const platPkgJson = createRequire(codexPkgJson).resolve(`${pkg}/package.json`)
  const vendor = join(dirname(platPkgJson), 'vendor', triple)
  const binName = process.platform === 'win32' ? 'codex.exe' : 'codex'

  // Current layout: vendor/<triple>/bin/codex + codex-path/. Legacy fallback:
  // vendor/<triple>/codex/codex + path/.
  const primary = unpacked(join(vendor, 'bin', binName))
  if (existsSync(primary)) {
    const pd = unpacked(join(vendor, 'codex-path'))
    return { bin: primary, pathDirs: existsSync(pd) ? [pd] : [] }
  }
  const legacy = unpacked(join(vendor, 'codex', binName))
  if (existsSync(legacy)) {
    const pd = unpacked(join(vendor, 'path'))
    return { bin: legacy, pathDirs: existsSync(pd) ? [pd] : [] }
  }
  throw new Error(`Codex: binary not found for ${triple} (looked in ${vendor})`)
}

/** Serialize a nested config object into codex `-c key.path=value` overrides
 *  (subset of the SDK's serializer; strings via JSON.stringify give valid TOML
 *  basic strings, incl. escaped Windows backslashes). */
function configOverrides(obj: Record<string, unknown>): string[] {
  const out: string[] = []
  const walk = (val: unknown, prefix: string): void => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      for (const [k, child] of Object.entries(val as Record<string, unknown>)) {
        if (child === undefined) continue
        walk(child, prefix ? `${prefix}.${k}` : k)
      }
      return
    }
    out.push(`${prefix}=${toToml(val)}`)
  }
  walk(obj, '')
  return out
}

function toToml(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(toToml).join(', ')}]`
  throw new Error(`Codex: unserializable config value ${String(v)}`)
}

const CODEX_BINARY = resolveCodexBinary()

/**
 * Drives the ChatGPT subscription by spawning `codex exec` directly (no API key
 * — uses the machine's `codex login`). We control the args, so we inject
 * `--dangerously-bypass-approvals-and-sandbox` (the only way Codex runs MCP tool
 * calls non-interactively — openai/codex#24135; config auto-approval does not
 * work). Officer tools reach Codex via an MCP server (codexOfficerServer) that
 * proxies every call back here over a local socket, preserving the confirm gate
 * + display capture. Built-in shell/web tools are disabled for containment.
 */
export class CodexAdapter implements ProviderAdapter {
  private threadId: string | null = null

  constructor(private readonly config: () => ProviderConfig) {}

  reset(): void {
    this.threadId = null
  }

  serializeSession(): SessionState {
    return this.threadId ? { codexThreadId: this.threadId } : {}
  }

  restoreSession(state: SessionState): void {
    this.threadId = state.codexThreadId ?? null
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const queue = new EventQueue()
    const tmp = mkdtempSync(join(tmpdir(), 'axivale-codex-'))
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\axivale-codex-${requireModule('node:crypto').randomBytes(8).toString('hex')}`
        : join(tmp, 'officer.sock')

    const bridge = await startOfficerBridge(input, queue, socketPath)
    const { model } = this.config()

    // Codex launches the officer proxy with exactly this env. Pass the platform
    // essentials through so the child starts even if Codex REPLACES (rather than
    // merges) the environment — on Windows a process without SystemRoot/Path
    // fails to initialize, which silently leaves Codex with zero officer tools
    // (the model then takes "0 actions" and claims tools are unavailable).
    const officerEnv: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' }
    const passKeys =
      process.platform === 'win32'
        ? ['SystemRoot', 'windir', 'Path', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ProgramData', 'ComSpec', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']
        : ['PATH', 'HOME', 'TMPDIR', 'LANG']
    for (const k of passKeys) {
      const v = process.env[k]
      if (v !== undefined && officerEnv[k] === undefined) officerEnv[k] = v
    }

    // On Windows, set ELECTRON_RUN_AS_NODE inside a .cmd wrapper rather than
    // relying on codex to propagate the mcp_servers.<name>.env override. Without
    // the var the spawn launches AxiVale as a GUI, the proxy never starts, the
    // MCP handshake closes, codex exits clean and the model claims tools are
    // unavailable. Wrapper lives in the per-turn tmp dir (auto cleaned up).
    let proxyCommand: string
    let proxyArgs: string[]
    if (process.platform === 'win32') {
      const wrapper = join(tmp, 'officer-proxy.cmd')
      const q = (s: string): string => `"${s.replace(/"/g, '""')}"`
      writeFileSync(
        wrapper,
        '@echo off\r\n' +
          'set ELECTRON_RUN_AS_NODE=1\r\n' +
          `${q(process.execPath)} ${q(OFFICER_SERVER_PATH)} ${q(socketPath)} ${q(bridge.token)}\r\n`
      )
      proxyCommand = process.env.ComSpec ?? 'cmd.exe'
      proxyArgs = ['/c', wrapper]
    } else {
      proxyCommand = process.execPath
      proxyArgs = [OFFICER_SERVER_PATH, socketPath, bridge.token]
    }

    const overrides = configOverrides({
      // Officer tools only — disable Codex's own coding/web tools (the bypass
      // flag turns the sandbox off, so containment is by tool-removal + the
      // empty temp cwd, not by the sandbox).
      features: { shell_tool: false },
      web_search: 'disabled',
      mcp_servers: {
        officer: {
          command: proxyCommand,
          args: proxyArgs,
          // Spawn Electron's bundled node as a plain node for the proxy.
          // (Windows sets ELECTRON_RUN_AS_NODE in the .cmd wrapper above.)
          env: officerEnv
        }
      }
    })

    codexLog(
      `turn start: model=${model ?? 'default'} resume=${this.threadId ? 'yes' : 'no'} ` +
        `bin=${CODEX_BINARY.bin} officerServer=${OFFICER_SERVER_PATH} socket=${socketPath} ` +
        `officerEnvKeys=[${Object.keys(officerEnv).join(',')}]`
    )

    const args = [
      'exec',
      '--experimental-json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--cd',
      tmp,
      ...overrides.flatMap((o) => ['-c', o]),
      ...(model ? ['--model', model] : []),
      ...(this.threadId ? ['resume', this.threadId] : [])
    ]

    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    if (CODEX_BINARY.pathDirs.length) {
      const key = process.platform === 'win32' ? 'Path' : 'PATH'
      env[key] = [...CODEX_BINARY.pathDirs, env[key] ?? ''].filter(Boolean).join(delimiter)
    }

    // First turn carries the system prompt as a preamble (the prompt is fed on
    // stdin); resumed threads already have it in their history.
    const prompt = this.threadId ? input.prompt : `${input.systemPrompt}\n\n---\n\n${input.prompt}`

    const child = spawn(CODEX_BINARY.bin, args, { env, signal: input.signal })
    child.stdin.write(prompt)
    child.stdin.end()

    let sawDone = false
    let stderr = ''
    let buf = ''
    const handleLine = (line: string): void => {
      if (!line.trim()) return
      let ev: CodexThreadEvent
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      if (ev.type === 'thread.started') this.threadId = (ev as { thread_id: string }).thread_id
      for (const e of translateCodexEvent(ev)) {
        if (e.kind === 'done') sawDone = true
        queue.push(e.kind === 'done' ? { ...e, sessionId: this.threadId } : e)
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('close', (code) => {
      if (buf.trim()) handleLine(buf)
      // Surface Codex's stderr — officer-MCP connection errors land here and are
      // otherwise lost when Codex exits 0 with the proxy never connected.
      codexLog(stderr.trim() ? `exit ${code}; stderr:\n${stderr.trim()}` : `exit ${code} (no stderr)`)
      if (!sawDone) {
        queue.push({
          kind: 'done',
          sessionId: this.threadId,
          error: input.signal.aborted
            ? null
            : `Codex CLI exited (${code}). ${stderr.split('\n').filter(Boolean).slice(-3).join(' ')}`.trim()
        })
      }
      queue.close()
    })
    child.on('error', (err) => {
      queue.push({ kind: 'done', sessionId: this.threadId, error: err.message })
      queue.close()
    })

    try {
      yield* queue.drain()
    } finally {
      bridge.close()
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        // best-effort temp cleanup
      }
    }
  }
}
