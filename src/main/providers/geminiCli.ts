import { spawn } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent, ProviderAdapter, ProviderConfig, SessionState, TurnInput } from './types'
import { EventQueue, OFFICER_SERVER_PATH, startOfficerBridge } from './officerBridge'
import { translateGeminiEvent, type GeminiStreamEvent } from './geminiEvents'

/**
 * Gemini's built-in mutating tools. The CLI runs in YOLO mode (auto-approve) so
 * the sandbox/approval gate is off; we contain it by excluding shell + file
 * writes and by running in an isolated temp working directory. Officer MCP
 * tools and read-only built-ins remain available.
 */
const EXCLUDED_TOOLS = ['run_shell_command', 'write_file', 'replace']

/**
 * Drives the Gemini CLI (`gemini`) headlessly under the machine's Antigravity /
 * Google OAuth — no API key. The officer tools are exposed via a project-scoped
 * `.gemini/settings.json` MCP server that proxies calls back to the main process
 * (confirm gate + display capture). Per-conversation continuity uses a stable
 * working directory keyed by a session UUID: first turn passes `--session-id`,
 * later turns `--resume latest`.
 */
export class GeminiCliAdapter implements ProviderAdapter {
  private sessionId: string | null = null

  constructor(private readonly config: () => ProviderConfig) {}

  reset(): void {
    if (this.sessionId) {
      try {
        rmSync(this.workspace(this.sessionId), { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
    this.sessionId = null
  }

  serializeSession(): SessionState {
    return this.sessionId ? { geminiCliSessionId: this.sessionId } : {}
  }

  restoreSession(state: SessionState): void {
    this.sessionId = state.geminiCliSessionId ?? null
  }

  /** Stable per-conversation workspace — gemini keys sessions by project path. */
  private workspace(sessionId: string): string {
    return join(tmpdir(), `axivale-gemini-${sessionId}`)
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const queue = new EventQueue()
    const firstTurn = !this.sessionId
    if (!this.sessionId) this.sessionId = randomUUID()
    const sessionId = this.sessionId
    const workspace = this.workspace(sessionId)
    mkdirSync(join(workspace, '.gemini'), { recursive: true })

    // The bridge socket is ephemeral (the cwd stays stable for resume).
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\axivale-gem-${randomBytes(8).toString('hex')}`
        : join(tmpdir(), `axivale-gem-${randomBytes(8).toString('hex')}.sock`)

    const bridge = await startOfficerBridge(input, queue, socketPath)

    // Project-scoped MCP registration + built-in tool containment.
    writeFileSync(
      join(workspace, '.gemini', 'settings.json'),
      JSON.stringify(
        {
          mcpServers: {
            officer: {
              command: process.execPath,
              args: [OFFICER_SERVER_PATH, socketPath, bridge.token],
              env: { ELECTRON_RUN_AS_NODE: '1' }
            }
          },
          excludeTools: EXCLUDED_TOOLS
        },
        null,
        2
      )
    )

    const { model } = this.config()
    // First turn carries the system prompt as a preamble; resumed sessions
    // already have it in their history.
    const prompt = firstTurn ? `${input.systemPrompt}\n\n---\n\n${input.prompt}` : input.prompt

    const args = [
      '-p',
      prompt,
      '-o',
      'stream-json',
      '--approval-mode',
      'yolo',
      '--skip-trust',
      '--allowed-mcp-server-names',
      'officer',
      ...(model ? ['--model', model] : []),
      ...(firstTurn ? ['--session-id', sessionId] : ['--resume', 'latest'])
    ]

    const child = spawn('gemini', args, {
      cwd: workspace,
      env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' }
    })

    const onAbort = (): void => {
      child.kill()
    }
    input.signal.addEventListener('abort', onAbort)

    let sawDone = false
    let stderr = ''
    let buf = ''
    const handleLine = (line: string): void => {
      if (!line.trim()) return
      let ev: GeminiStreamEvent
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      for (const e of translateGeminiEvent(ev)) {
        if (e.kind === 'done') sawDone = true
        queue.push(e.kind === 'done' ? { ...e, sessionId } : e)
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
      // If the process ended without a `result` event, surface the failure.
      if (!sawDone) {
        queue.push({
          kind: 'done',
          sessionId,
          error: input.signal.aborted
            ? null
            : `Gemini CLI exited (${code}). ${stderr.split('\n').filter(Boolean).slice(-3).join(' ')}`.trim()
        })
      }
      queue.close()
    })

    try {
      yield* queue.drain()
    } finally {
      input.signal.removeEventListener('abort', onAbort)
      bridge.close()
      if (process.platform !== 'win32') {
        try {
          rmSync(socketPath, { force: true })
        } catch {
          // best-effort socket cleanup
        }
      }
    }
  }
}
