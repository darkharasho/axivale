import { query, createSdkMcpServer, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, type ToolDeps } from './tools'

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; error: string | null }

const MCP_PREFIX = 'mcp__officer__'

const OFFICER_SYSTEM_PROMPT = `You are The Officer — a virtual guild officer for a Guild Wars 2 guild.
You manage builds and squad compositions through the AxiTools Discord bot, and
inspect the guild roster and activity log through the official GW2 API.

Rules:
- Before editing a comp preset, list presets first and modify the returned
  config object — presets are saved whole, never patched blind.
- After any change, state exactly what changed (old value → new value).
- If a tool reports the AxiTools bot is unreachable or a GW2 API key problem,
  report it plainly and do not retry more than once.
- Profession names matter: distinguish base professions (Necromancer) from
  elite specs (Scourge, Reaper, Harbinger).
- Keep replies concise; lead with the outcome. The UI renders your reply as a
  newspaper article, so a strong first sentence works as the headline.`

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

export interface AgentDeps {
  toolDeps: () => ToolDeps
  oauthToken: () => string | null
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

export class AgentService {
  private sessionId: string | null = null

  constructor(private readonly deps: AgentDeps) {}

  resetSession(): void {
    this.sessionId = null
  }

  async runTurn(promptText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    const tools = buildOfficerTools(this.deps.toolDeps())
    const server = createSdkMcpServer({ name: 'officer', version: '1.0.0', tools })
    // Destructive tools are deliberately NOT pre-allowed: allowedTools entries
    // are auto-approved without ever reaching canUseTool, so destructive ones
    // must go through the permission flow to hit our confirm gate.
    const allowedTools = tools
      .map((t) => `${MCP_PREFIX}${t.name}`)
      .filter((name) => !DESTRUCTIVE_TOOLS.includes(name.slice(MCP_PREFIX.length)))
    const token = this.deps.oauthToken()
    // Options.env REPLACES the subprocess environment entirely, so spread process.env.
    const env: Record<string, string | undefined> = { ...process.env }
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token

    try {
      const q = query({
        prompt: promptText,
        options: {
          mcpServers: { officer: server },
          allowedTools,
          systemPrompt: OFFICER_SYSTEM_PROMPT,
          includePartialMessages: true,
          env,
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          canUseTool: async (toolName, input) => {
            const bare = toolName.startsWith(MCP_PREFIX) ? toolName.slice(MCP_PREFIX.length) : toolName
            if (DESTRUCTIVE_TOOLS.includes(bare)) {
              const allowed = await this.deps.confirm(bare, input)
              if (!allowed) {
                return { behavior: 'deny', message: 'The user declined this action.' }
              }
            }
            return { behavior: 'allow', updatedInput: input }
          }
        }
      })
      for await (const msg of q) {
        for (const event of translateSdkMessage(msg)) {
          if (event.kind === 'done' && event.sessionId) this.sessionId = event.sessionId
          onEvent(event)
        }
      }
    } catch (err) {
      onEvent({
        kind: 'done',
        sessionId: this.sessionId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
