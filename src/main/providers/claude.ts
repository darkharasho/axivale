import { query, createSdkMcpServer, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { existsSync } from 'fs'
import { join, dirname, sep } from 'path'
import { createRequire } from 'module'
import {
  MCP_PREFIX,
  type AgentEvent,
  type ProviderAdapter,
  type ProviderConfig,
  type SessionState,
  type TurnInput
} from './types'
import { evaluateToolPermission } from './permission'
import { DisplayCorrelator } from './displayBus'
import { DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS } from '../tools'

/**
 * Extracts a session_id from an SDK message as early as possible.
 * Returns the id from a system/init message or a result message; null otherwise.
 * Pure function — keeps runTurn's capture logic small and unit-testable.
 */
export function sessionIdFromMessage(msg: SDKMessage): string | null {
  if (msg.type === 'system' && (msg as { subtype?: string }).subtype === 'init') {
    const id = (msg as { session_id?: string }).session_id
    return id ?? null
  }
  if (msg.type === 'result') {
    const id = (msg as { session_id?: string }).session_id
    return id ?? null
  }
  return null
}

/**
 * Translates one SDK message into zero or more renderer-facing events.
 * Pure function — unit-tested in agentEvents.test.ts.
 */
export function translateSdkMessage(msg: SDKMessage): AgentEvent[] {
  switch (msg.type) {
    case 'stream_event': {
      const event = msg.event
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        return [{ kind: 'text-delta', text: event.delta.text }]
      }
      // Text blocks before and after tool calls live in separate assistant
      // messages; separate them so sentences don't concatenate mid-word.
      // Leading breaks are trimmed by the renderer, repeats collapse in markdown.
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        return [{ kind: 'text-delta', text: '\n\n' }]
      }
      return []
    }
    case 'assistant': {
      const events: AgentEvent[] = []
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          events.push({
            kind: 'tool-start',
            id: block.id,
            name: block.name.startsWith(MCP_PREFIX) ? block.name.slice(MCP_PREFIX.length) : block.name,
            input: (block.input ?? {}) as Record<string, unknown>
          })
        }
      }
      return events
    }
    case 'user': {
      const content = msg.message.content
      if (typeof content === 'string') return []
      const events: AgentEvent[] = []
      for (const block of content) {
        if (block.type === 'tool_result') {
          const text =
            typeof block.content === 'string'
              ? block.content
              : (block.content ?? [])
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join('')
          events.push({
            kind: 'tool-result',
            id: block.tool_use_id,
            isError: block.is_error === true,
            text
          })
        }
      }
      return events
    }
    case 'result': {
      return [
        {
          kind: 'done',
          sessionId: msg.session_id ?? null,
          error: msg.subtype === 'success' ? null : `Agent error: ${msg.subtype}`
        }
      ]
    }
    default:
      return []
  }
}

const requireModule = createRequire(import.meta.url)

/**
 * Locates the SDK's native `claude` binary (shipped in the platform-specific
 * @anthropic-ai/claude-agent-sdk-<platform>-<arch> optional dependency).
 *
 * In a packaged Electron app the module resolves inside app.asar, which is a
 * file, not a directory — spawning from it fails with ENOTDIR. The binary is
 * asar-unpacked by electron-builder (see "asarUnpack" in package.json), so
 * rewrite the path to the real on-disk copy. Returns null when the package
 * isn't present; the SDK then falls back to its own default resolution.
 */
function resolveClaudeExecutable(): string | null {
  const platformPkg = `claude-agent-sdk-${process.platform}-${process.arch}`
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude'
  try {
    // sdk.mjs sits at the package root, so its dirname is the package dir.
    const sdkDir = dirname(requireModule.resolve('@anthropic-ai/claude-agent-sdk'))
    const candidates = [
      // Packaged layout: platform package nested under the SDK's node_modules.
      join(sdkDir, 'node_modules', '@anthropic-ai', platformPkg, binary),
      // Dev layout: platform package hoisted as a sibling.
      join(dirname(sdkDir), platformPkg, binary)
    ]
    for (const path of candidates) {
      const real = path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
      if (existsSync(real)) return real
    }
    return null
  } catch {
    return null
  }
}

// Resolved once — the install location can't change while the app runs.
const CLAUDE_EXECUTABLE = resolveClaudeExecutable()

/** The original Claude Agent SDK path, behind the ProviderAdapter interface. */
export class ClaudeAdapter implements ProviderAdapter {
  private sessionId: string | null = null

  constructor(private readonly config: () => ProviderConfig) {}

  reset(): void {
    this.sessionId = null
  }

  serializeSession(): SessionState {
    return this.sessionId ? { claudeSessionId: this.sessionId } : {}
  }

  restoreSession(state: SessionState): void {
    this.sessionId = state.claudeSessionId ?? null
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const correlator = new DisplayCorrelator()
    const server = createSdkMcpServer({
      name: 'officer',
      version: '1.0.0',
      tools: correlator.wrapTools(input.tools)
    })
    // Destructive tools are deliberately NOT pre-allowed: allowedTools entries
    // are auto-approved without ever reaching canUseTool, so destructive ones
    // must go through the permission flow to hit our confirm gate.
    // Action-gated tools always route through canUseTool, which confirms
    // only their destructive verbs.
    const allowedTools = input.tools
      .map((t) => `${MCP_PREFIX}${t.name}`)
      .filter((name) => {
        const bare = name.slice(MCP_PREFIX.length)
        return !DESTRUCTIVE_TOOLS.includes(bare) && !(bare in ACTION_GATED_TOOLS)
      })
    const { oauthToken, model } = this.config()
    // Options.env REPLACES the subprocess environment entirely, so spread process.env.
    const env: Record<string, string | undefined> = { ...process.env }
    if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

    // Bridge the turn's AbortSignal to the controller the SDK expects.
    const abortController = new AbortController()
    if (input.signal.aborted) abortController.abort()
    const onAbort = (): void => abortController.abort()
    input.signal.addEventListener('abort', onAbort)
    try {
      const q = query({
        prompt: input.prompt,
        options: {
          mcpServers: { officer: server },
          // Officer MCP tools only. An empty built-in set stops the model from
          // ever attempting harness tools like AskUserQuestion (which has no UI
          // here and would stall the turn) or Bash/Read/Write.
          tools: [],
          allowedTools,
          systemPrompt: input.systemPrompt,
          includePartialMessages: true,
          env,
          abortController,
          ...(CLAUDE_EXECUTABLE ? { pathToClaudeCodeExecutable: CLAUDE_EXECUTABLE } : {}),
          ...(model ? { model } : {}),
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          canUseTool: async (toolName, toolInput) =>
            evaluateToolPermission(toolName, toolInput as Record<string, unknown>, {
              confirm: input.confirm
            })
        }
      })
      for await (const msg of q) {
        // Capture session_id as early as possible (system/init or result) so
        // that an aborted turn still updates sessionId for the next resume.
        const earlyId = sessionIdFromMessage(msg)
        if (earlyId) this.sessionId = earlyId
        for (const event of translateSdkMessage(msg)) {
          yield correlator.observe(event)
        }
      }
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}
