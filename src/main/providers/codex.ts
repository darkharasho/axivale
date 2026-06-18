import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Codex } from '@openai/codex-sdk'
import type { AgentEvent, ProviderAdapter, ProviderConfig, SessionState, TurnInput } from './types'
import { EventQueue, OFFICER_SERVER, startOfficerBridge } from './officerBridge'
import { translateCodexEvent, type CodexThreadEvent } from './codexEvents'

const requireModule = createRequire(import.meta.url)

/** Path to the officer MCP proxy (shared, provider-agnostic). */
const OFFICER_SERVER_PATH = fileURLToPath(OFFICER_SERVER)

/**
 * Resolves the `@openai/codex` JS launcher (`bin/codex.js`), which in turn
 * finds and execs the right platform binary. The bypass wrapper runs it through
 * node so we never hard-code a platform path.
 */
function resolveCodexLauncher(): string {
  return requireModule.resolve('@openai/codex/bin/codex.js')
}

/**
 * Writes the bypass wrapper to a temp file and returns its path. The wrapper
 * injects `--dangerously-bypass-approvals-and-sandbox` right after the `exec`
 * subcommand — the only way Codex executes MCP tool calls non-interactively
 * (openai/codex#24135). @openai/codex-sdk exposes no raw-flag passthrough, so we
 * substitute the binary via codexPathOverride.
 */
function writeBypassWrapper(dir: string, launcher: string): string {
  const isWin = process.platform === 'win32'
  const jsPath = join(dir, 'codex-bypass.mjs')
  const js = `#!/usr/bin/env node
import { spawn } from 'node:child_process'
const launcher = ${JSON.stringify(launcher)}
const out = []
let injected = false
for (const a of process.argv.slice(2)) {
  out.push(a)
  if (!injected && a === 'exec') { out.push('--dangerously-bypass-approvals-and-sandbox'); injected = true }
}
const child = spawn(process.execPath, [launcher, ...out], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
`
  writeFileSync(jsPath, js, { mode: 0o755 })
  if (!isWin) {
    chmodSync(jsPath, 0o755)
    return jsPath
  }
  // Windows can't shebang-exec a .mjs; wrap it in a .cmd that calls node.
  const cmdPath = join(dir, 'codex-bypass.cmd')
  writeFileSync(cmdPath, `@echo off\r\nnode "${jsPath}" %*\r\n`)
  return cmdPath
}

/**
 * Drives the ChatGPT subscription via @openai/codex-sdk (no API key — uses the
 * machine's `codex login`). The officer tools are exposed to Codex as an MCP
 * server (codexOfficerServer) that proxies every call back here over a local
 * socket, where they run with the confirm gate + display capture.
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

    // The officer proxy connects to this bridge and RPCs tool calls back here.
    const bridge = await startOfficerBridge(input, queue, socketPath)
    const token = bridge.token

    const wrapper = writeBypassWrapper(tmp, resolveCodexLauncher())
    const { model } = this.config()

    const codex = new Codex({
      codexPathOverride: wrapper,
      // env REPLACES the CLI's environment, so spread process.env.
      env: { ...process.env } as Record<string, string>,
      config: {
        // Officer tools only — disable Codex's own coding tools since the
        // sandbox is bypassed (see wrapper). Containment is by tool-removal +
        // read-only cwd + system prompt, not by Codex's sandbox.
        features: { shell_tool: false },
        web_search: 'disabled',
        mcp_servers: {
          officer: {
            command: process.execPath,
            args: [OFFICER_SERVER_PATH, socketPath, token],
            // Spawn Electron's bundled node as a plain node for the proxy.
            env: { ELECTRON_RUN_AS_NODE: '1' }
          }
        }
      }
    })

    const thread = this.threadId
      ? codex.resumeThread(this.threadId, threadOpts(tmp, model))
      : codex.startThread(threadOpts(tmp, model))

    // First turn carries the system prompt as a preamble (Codex has no separate
    // system-prompt channel via the SDK); resumed threads already have it.
    const prompt = this.threadId
      ? input.prompt
      : `${input.systemPrompt}\n\n---\n\n${input.prompt}`

    // Pump Codex events into the shared queue; tool events arrive via the bridge.
    const pump = (async () => {
      try {
        const { events } = await thread.runStreamed(prompt, { signal: input.signal })
        for await (const ev of events as AsyncGenerator<CodexThreadEvent>) {
          if (ev.type === 'thread.started') this.threadId = (ev as { thread_id: string }).thread_id
          for (const e of translateCodexEvent(ev)) {
            queue.push(e.kind === 'done' ? { ...e, sessionId: this.threadId } : e)
          }
        }
      } catch (err) {
        queue.push({
          kind: 'done',
          sessionId: this.threadId,
          error: input.signal.aborted ? null : err instanceof Error ? err.message : String(err)
        })
      } finally {
        queue.close()
      }
    })()

    try {
      yield* queue.drain()
    } finally {
      await pump.catch(() => {})
      bridge.close()
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        // best-effort temp cleanup
      }
    }
  }
}

function threadOpts(cwd: string, model: string | null): Record<string, unknown> {
  return {
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    skipGitRepoCheck: true,
    webSearchEnabled: false,
    workingDirectory: cwd,
    ...(model ? { model } : {})
  }
}
