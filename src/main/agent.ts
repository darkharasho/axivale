import { buildOfficerTools, type ToolDeps } from './tools'
import { MCP_PREFIX, type AgentEvent, type ProviderConfig, type ProviderName } from './providers/types'
import { evaluateToolPermission } from './providers/permission'
import { createAdapter } from './providers'
import type { ProviderAdapter } from './providers/types'

export { MCP_PREFIX, evaluateToolPermission }
export type { AgentEvent }
export type { PermissionResult } from './providers/permission'
export { translateSdkMessage, sessionIdFromMessage } from './providers/claude'

export const AXIVALE_SYSTEM_PROMPT = `You are AxiVale — a virtual guild officer for a Guild Wars 2 guild.
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
- AxiForge is the user's local desktop build editor — a different store from
  the AxiTools Discord bot. Use the axiforge_* tools to list, read, create,
  edit, delete, publish, and import its builds and squad comps; use
  axitools_builds_* only for the Discord bot's build list. Never conflate
  axiforge_* and axitools_builds_* data. Reads work even when AxiForge is
  closed; writes start AxiForge headless automatically — just call the tool.
  AxiForge deletes and publishes prompt the user to confirm via dialog; call
  the tool and let the confirmation flow happen.
- NEVER design or edit a build from memory: GW2
  balance patches invalidate your training data.
  Ground every skill, trait, specialization, and gear
  choice in axiforge_catalog and the official API (gw2_api) before saving,
  and say so when the user asks for build advice.
- Keep replies concise; lead with the outcome. The UI renders your reply as a
  newspaper article, so a strong first sentence works as the headline.`

export interface AgentDeps {
  toolDeps: () => ToolDeps
  /** Provider, model, and credentials — read fresh at the start of every turn. */
  config: () => ProviderConfig
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

export class AgentService {
  private adapter: ProviderAdapter | null = null
  private adapterProvider: ProviderName | null = null
  private running = false
  private abort: AbortController | null = null

  constructor(private readonly deps: AgentDeps) {}

  /** Returns the adapter for the configured provider; switching providers starts fresh. */
  private currentAdapter(): ProviderAdapter {
    const provider = this.deps.config().provider
    if (!this.adapter || this.adapterProvider !== provider) {
      this.adapter = createAdapter(provider, this.deps.config)
      this.adapterProvider = provider
    }
    return this.adapter
  }

  resetSession(): void {
    this.adapter?.reset()
    this.adapter = null
    this.adapterProvider = null
  }

  /** Abort the in-flight turn, if any. The runTurn loop ends cleanly. */
  cancelTurn(): void {
    this.abort?.abort()
  }

  async runTurn(promptText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    if (this.running) {
      onEvent({
        kind: 'done',
        sessionId: null,
        error: 'A turn is already in progress — wait for it to finish.'
      })
      return
    }

    this.running = true
    const abort = new AbortController()
    this.abort = abort
    try {
      const tools = buildOfficerTools(this.deps.toolDeps())
      const adapter = this.currentAdapter()
      const turn = adapter.runTurn({
        prompt: promptText,
        systemPrompt: AXIVALE_SYSTEM_PROMPT,
        tools,
        confirm: this.deps.confirm,
        signal: abort.signal
      })
      for await (const event of turn) onEvent(event)
    } catch (err) {
      // A user-initiated cancel ends the turn cleanly, not as an error.
      onEvent({
        kind: 'done',
        sessionId: null,
        error: abort.signal.aborted ? null : err instanceof Error ? err.message : String(err)
      })
    } finally {
      this.running = false
      this.abort = null
    }
  }
}
