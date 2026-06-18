import net from 'node:net'
import type { AgentEvent, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool } from './toolSchema'

/**
 * Path to the officer MCP proxy, emitted as a sibling build entry. The proxy is
 * provider-agnostic (named codexOfficerServer for historical reasons); both the
 * Codex and Gemini-CLI adapters spawn it and point it at a bridge socket.
 */
export const OFFICER_SERVER = new URL('./codexOfficerServer.js', import.meta.url)

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

  const server = net.createServer((sock) => {
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
          sock.write(JSON.stringify({ id: msg.id, error: 'unauthorized' }) + '\n')
          continue
        }
        if (msg.method === 'list') {
          sock.write(JSON.stringify({ id: msg.id, result: toToolSpecs(input.tools) }) + '\n')
        } else if (msg.method === 'call' && msg.name) {
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
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })

  return { token, close: () => server.close() }
}
