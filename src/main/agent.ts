import { query, createSdkMcpServer, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  buildOfficerTools,
  DESTRUCTIVE_TOOLS,
  ACTION_GATED_TOOLS,
  type ToolDeps
} from './tools'

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; error: string | null }

const MCP_PREFIX = 'mcp__officer__'

const AXIVALE_SYSTEM_PROMPT = `You are AxiVale — a virtual guild officer for a Guild Wars 2 guild.
You manage builds and squad compositions through the AxiTools Discord bot, and
inspect the guild roster and activity log through the official GW2 API.

Rules:
- You have ONLY the officer tools — no shell, no files, no jq/grep/scripts.
  Never claim you'll process data with external programs; read tool results
  directly, and prefer tool parameters that narrow or slim the result over
  fetching everything.
- Before editing a comp preset, list presets first and modify the returned
  config object — presets are saved whole, never patched blind.
- After any change, state exactly what changed (old value → new value).
- If a tool reports the AxiTools bot is unreachable or a GW2 API key problem,
  report it plainly and do not retry more than once.
- Profession names matter: distinguish base professions (Necromancer) from
  elite specs (Scourge, Reaper, Harbinger).
- AxiTools is only for Discord-side data (builds, comps, schedules). For game
  data — items, prices, WvW matches, achievements, anything else — query the
  official GW2 API directly with the gw2_api tool; never claim you need
  AxiTools for it.
- You can manage the connected Discord server directly: discord_overview for
  the lay of the land (channels, roles, members, ids), discord_messages to
  read a channel, discord_action to act (channels, roles, members, messages,
  threads, events). Look up ids via discord_overview first — never guess them.
  Destructive actions prompt the user to confirm; just call the tool and let
  the confirmation flow happen.
- To message members who haven't linked a key: discord_overview with
  include_members for everyone, axitools_members for who IS linked, diff the
  member ids yourself, then ONE members_dm call with the full list — never
  loop member_dm per person. Always show the user the recipient count and
  message text in your reply; the confirm dialog covers the actual send.
  Some members have DMs closed — report the failed list honestly.
- AxiTools also gives you: axitools_audit (server + GW2 guild history),
  axitools_rss and axitools_streams (feed/stream announcement subscriptions),
  axitools_alliance (WvW alliance matchup settings), axitools_guild_roles
  (GW2-guild→role mappings), axitools_config (bot channel/role wiring), and
  axitools_members (who has linked which GW2 accounts, their guilds and
  characters — never the keys themselves). axitools_members only covers keys
  registered in THIS server; to know whether accounts have keys at all, run
  their names through axitools_key_holders before claiming anyone lacks one.
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

export interface AgentDeps {
  toolDeps: () => ToolDeps
  oauthToken: () => string | null
  /** Claude model alias or id from settings; null/'' = SDK default */
  model: () => string | null
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

/** The result type returned by canUseTool callbacks. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/**
 * Pure function that decides whether a tool call is allowed.
 * Extracted so it can be unit-tested without running a full agent turn.
 *
 * Built-in SDK tools (e.g. Bash) are not in allowedTools and would otherwise
 * fall through to allow — the non-officer prefix check blocks them explicitly.
 */
export async function evaluateToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  deps: { confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean> }
): Promise<PermissionResult> {
  // Only officer MCP tools are permitted in this app.
  if (!toolName.startsWith(MCP_PREFIX)) {
    return { behavior: 'deny', message: 'Only officer tools are available in this app.' }
  }

  const bare = toolName.slice(MCP_PREFIX.length)
  // Action-gated tools' risk depends on the verb, not the tool name.
  const gatedVerbs = ACTION_GATED_TOOLS[bare]
  const destructive = gatedVerbs
    ? gatedVerbs.includes(String(input.action ?? ''))
    : DESTRUCTIVE_TOOLS.includes(bare)
  if (destructive) {
    const allowed = await deps.confirm(bare, input)
    if (!allowed) {
      return { behavior: 'deny', message: 'The user declined this action.' }
    }
  }

  return { behavior: 'allow', updatedInput: input }
}

export class AgentService {
  private sessionId: string | null = null
  private running = false
  private abort: AbortController | null = null

  constructor(private readonly deps: AgentDeps) {}

  resetSession(): void {
    this.sessionId = null
  }

  /** Abort the in-flight turn, if any. The runTurn loop ends cleanly. */
  cancelTurn(): void {
    this.abort?.abort()
  }

  async runTurn(promptText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    if (this.running) {
      onEvent({
        kind: 'done',
        sessionId: this.sessionId,
        error: 'A turn is already in progress — wait for it to finish.'
      })
      return
    }

    this.running = true
    const abort = new AbortController()
    this.abort = abort
    try {
      const tools = buildOfficerTools(this.deps.toolDeps())
      const server = createSdkMcpServer({ name: 'officer', version: '1.0.0', tools })
      // Destructive tools are deliberately NOT pre-allowed: allowedTools entries
      // are auto-approved without ever reaching canUseTool, so destructive ones
      // must go through the permission flow to hit our confirm gate.
      // Action-gated tools always route through canUseTool, which confirms
      // only their destructive verbs.
      const allowedTools = tools
        .map((t) => `${MCP_PREFIX}${t.name}`)
        .filter((name) => {
          const bare = name.slice(MCP_PREFIX.length)
          return !DESTRUCTIVE_TOOLS.includes(bare) && !(bare in ACTION_GATED_TOOLS)
        })
      const token = this.deps.oauthToken()
      // Options.env REPLACES the subprocess environment entirely, so spread process.env.
      const env: Record<string, string | undefined> = { ...process.env }
      if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token

      const model = this.deps.model()
      const q = query({
        prompt: promptText,
        options: {
          mcpServers: { officer: server },
          allowedTools,
          systemPrompt: AXIVALE_SYSTEM_PROMPT,
          includePartialMessages: true,
          env,
          abortController: abort,
          ...(model ? { model } : {}),
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          canUseTool: async (toolName, input) =>
            evaluateToolPermission(toolName, input as Record<string, unknown>, this.deps)
        }
      })
      for await (const msg of q) {
        for (const event of translateSdkMessage(msg)) {
          if (event.kind === 'done' && event.sessionId) this.sessionId = event.sessionId
          onEvent(event)
        }
      }
    } catch (err) {
      // A user-initiated cancel ends the turn cleanly, not as an error.
      onEvent({
        kind: 'done',
        sessionId: this.sessionId,
        error: abort.signal.aborted ? null : err instanceof Error ? err.message : String(err)
      })
    } finally {
      this.running = false
      this.abort = null
    }
  }
}
