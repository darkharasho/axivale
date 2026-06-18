/**
 * Officer MCP proxy — a standalone stdio MCP server that Codex spawns and talks
 * to. It owns NO tool logic: it advertises the officer tool schemas and forwards
 * every call back to the AxiVale main process over a local socket, where the
 * real tool runs WITH the destructive-action confirm gate and display capture.
 *
 * Spawned by CodexAdapter as: `<node> codexOfficerServer.js <socketPath> <token>`.
 * Uses the low-level MCP Server so our JSON-Schema tool specs pass through
 * verbatim (the high-level helper expects Zod shapes, which we don't have here).
 */
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const [, , socketPath, token] = process.argv
if (!socketPath || !token) {
  process.stderr.write('officer server: missing socket path / token\n')
  process.exit(1)
}

/** Newline-delimited JSON RPC to the main process, keyed by request id. */
class BridgeClient {
  private sock: net.Socket
  private buf = ''
  private pending = new Map<string, (v: unknown) => void>()
  private ready: Promise<void>

  constructor(path: string, private readonly token: string) {
    this.sock = net.createConnection(path)
    this.ready = new Promise((resolve, reject) => {
      this.sock.once('connect', resolve)
      this.sock.once('error', reject)
    })
    this.sock.setEncoding('utf8')
    this.sock.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { id: string; result?: unknown; error?: string }
          const resolve = this.pending.get(msg.id)
          if (resolve) {
            this.pending.delete(msg.id)
            resolve(msg.error ? { __error: msg.error } : msg.result)
          }
        } catch {
          // ignore malformed line
        }
      }
    })
  }

  async request(method: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    await this.ready
    const id = randomUUID()
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.sock.write(JSON.stringify({ id, token: this.token, method, ...payload }) + '\n')
    })
  }
}

async function main(): Promise<void> {
  const bridge = new BridgeClient(socketPath, token)
  const specs = ((await bridge.request('list')) as ToolSpec[]) ?? []

  const server = new Server({ name: 'officer', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: specs.map((s) => ({
      name: s.name,
      description: s.description,
      // JSON Schema passed straight through; main built it via toToolSpecs.
      inputSchema: (s.parameters as { type?: string }).type
        ? s.parameters
        : { type: 'object', properties: {} }
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const res = (await bridge.request('call', { name, args })) as
      | { text: string; isError: boolean }
      | { __error: string }
    if ('__error' in res) {
      return { content: [{ type: 'text', text: `officer bridge error: ${res.__error}` }], isError: true }
    }
    return { content: [{ type: 'text', text: res.text }], isError: res.isError === true }
  })

  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  process.stderr.write(`officer server fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
