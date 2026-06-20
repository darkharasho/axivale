import net from 'node:net'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, sep } from 'node:path'
import type { AgentEvent, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool } from './toolSchema'

const requireModule = createRequire(import.meta.url)

/**
 * Append a line to logs/officer-bridge.log. Without this, a silent failure
 * of the MCP officer proxy (e.g. it never connects back on Windows) is
 * indistinguishable from "model chose not to call any tool" — both yield a
 * clean codex exit with no stderr. Recording connects/list/call here makes
 * the proxy's health observable. Lazy electron require keeps this test-safe.
 */
function bridgeLog(msg: string): void {
  try {
    const dir = (requireModule('electron') as { app: { getPath(n: string): string } }).app.getPath('logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'officer-bridge.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // best-effort; logging must never throw
  }
}

/**
 * Rewrite an app.asar path to its app.asar.unpacked twin. In a packaged build,
 * `import.meta.url` / require.resolve point inside app.asar, but files we need to
 * spawn (the officer proxy, the codex binary) are asar-unpacked to disk. A child
 * `node`/binary can't read from app.asar, so paths handed to spawn must be
 * rewritten. No-op in dev (no "app.asar" segment). Mirrors claude.ts.
 */
export function unpacked(p: string): string {
  return p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

/**
 * On-disk path to the officer MCP proxy, emitted as a sibling build entry. The
 * proxy is provider-agnostic (named codexOfficerServer for historical reasons);
 * both the Codex and Gemini-CLI adapters spawn it and point it at a bridge
 * socket. Unpacked so the spawned node can read it in a packaged app.
 */
export const OFFICER_SERVER_PATH = unpacked(fileURLToPath(new URL('./codexOfficerServer.mjs', import.meta.url)))

/**
 * Minimal async queue merging two event producers — the provider's own event
 * stream and the officer IPC bridge (tool-start/result) — into one ordered
 * AsyncGenerator that an adapter's runTurn can yield.
 */
export class EventQueue {
  private items: AgentEvent[] = []
  private waiters: Array<(r: IteratorResult<AgentEvent>) => void> = []
  private closed = false

  push(e: AgentEvent): void {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w({ value: e, done: false })
    else this.items.push(e)
  }

  close(): void {
    this.closed = true
    let w: ((r: IteratorResult<AgentEvent>) => void) | undefined
    while ((w = this.waiters.shift())) w({ value: undefined as unknown as AgentEvent, done: true })
  }

  async *drain(): AsyncGenerator<AgentEvent> {
    for (;;) {
      if (this.items.length) {
        yield this.items.shift() as AgentEvent
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<AgentEvent>>((resolve) => this.waiters.push(resolve))
      if (next.done) return
      yield next.value
    }
  }
}

export interface OfficerBridge {
  token: string
  close(): void
}

/**
 * Opens a local socket the officer MCP proxy connects to. Answers `list` with
 * the turn's tool specs and `call` by running the real officer tool in-process
 * via gateAndRunTool — so the destructive-action confirm gate and display
 * capture happen here, then flow to the renderer through `queue` as
 * tool-start/tool-result events. The bridge is the single source of truth for
 * tool UI; providers suppress their own tool-call events.
 *
 * Token-gated: the proxy must echo the returned token on every request.
 */
export async function startOfficerBridge(
  input: Pick<TurnInput, 'tools' | 'confirm'>,
  queue: EventQueue,
  socketPath: string
): Promise<OfficerBridge> {
  const { randomBytes } = await import('node:crypto')
  const token = randomBytes(16).toString('hex')

  bridgeLog(`listen socket=${socketPath} tools=${input.tools.length}`)

  const server = net.createServer((sock) => {
    bridgeLog('proxy connected')
    sock.on('close', () => bridgeLog('proxy disconnected'))
    sock.on('error', (err) => bridgeLog(`proxy socket error: ${err.message}`))
    sock.setEncoding('utf8')
    let buf = ''
    sock.on('data', async (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg: { id: string; token?: string; method: string; name?: string; args?: Record<string, unknown> }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.token !== token) {
          bridgeLog(`unauthorized request (method=${msg.method})`)
          sock.write(JSON.stringify({ id: msg.id, error: 'unauthorized' }) + '\n')
          continue
        }
        if (msg.method === 'list') {
          const specs = toToolSpecs(input.tools)
          bridgeLog(`list -> ${specs.length} tools`)
          sock.write(JSON.stringify({ id: msg.id, result: specs }) + '\n')
        } else if (msg.method === 'call' && msg.name) {
          bridgeLog(`call ${msg.name}`)
          const name = msg.name
          const args = msg.args ?? {}
          queue.push({ kind: 'tool-start', id: msg.id, name, input: args })
          const outcome = await gateAndRunTool(input.tools, name, args, input.confirm)
          queue.push({
            kind: 'tool-result',
            id: msg.id,
            isError: outcome.isError,
            text: outcome.text,
            ...(outcome.display ? { display: outcome.display } : {})
          })
          sock.write(
            JSON.stringify({ id: msg.id, result: { text: outcome.text, isError: outcome.isError } }) + '\n'
          )
        }
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err) => {
      bridgeLog(`listen failed: ${err.message}`)
      reject(err)
    })
    server.listen(socketPath, resolve)
  })

  return { token, close: () => server.close() }
}
