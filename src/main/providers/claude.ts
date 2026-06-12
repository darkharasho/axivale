import { query, createSdkMcpServer, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  MCP_PREFIX,
  type AgentEvent,
  type ProviderAdapter,
  type ProviderConfig,
  type TurnInput
} from './types'
import { evaluateToolPermission } from './permission'
import { DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS } from '../tools'

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

/** The original Claude Agent SDK path, behind the ProviderAdapter interface. */
export class ClaudeAdapter implements ProviderAdapter {
  private sessionId: string | null = null

  constructor(private readonly config: () => ProviderConfig) {}

  reset(): void {
    this.sessionId = null
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const server = createSdkMcpServer({ name: 'officer', version: '1.0.0', tools: input.tools })
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
          allowedTools,
          systemPrompt: input.systemPrompt,
          includePartialMessages: true,
          env,
          abortController,
          ...(model ? { model } : {}),
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          canUseTool: async (toolName, toolInput) =>
            evaluateToolPermission(toolName, toolInput as Record<string, unknown>, {
              confirm: input.confirm
            })
        }
      })
      for await (const msg of q) {
        for (const event of translateSdkMessage(msg)) {
          if (event.kind === 'done' && event.sessionId) this.sessionId = event.sessionId
          yield event
        }
      }
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}
