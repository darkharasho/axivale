import type { AxitoolsClient } from '../axitoolsClient'
import type { Gw2Client } from '../gw2Client'
import type { AxiforgeClient } from '../axiforgeClient'
import type { AxibridgeService } from '../axibridgeService'
import type { DisplayPayload } from '../providers/types'
import type { MetaIndex } from '../meta/rag/index'
import type { WikiFacts } from '../meta/wikiFacts'
import type { RosterAnnotation } from '../rosterStore'

/** Structural launcher type so tests stub one method instead of the whole class. */
export interface AxiforgeLauncherLike {
  ensureRunning(): Promise<void>
}

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  /** active Discord guild id from settings as a string — snowflakes overflow JS numbers ('' = unset) */
  discordGuildId: () => string
  /** active GW2 guild id from settings ('' = unset) */
  gw2GuildId: () => string
  /** Local AxiForge app client (API with read-only file fallback). */
  axiforge: AxiforgeClient
  /** Spawns headless AxiForge when a write needs it. */
  axiforgeLauncher: AxiforgeLauncherLike
  /** AxiBridge analytics service, resolved per-call so repos/PAT stay fresh from settings. */
  axibridge: () => AxibridgeService
  /** Resolve an enabled skill's instructions by exact name, or null if missing/disabled. */
  loadSkill: (name: string) => string | null
  /** Local, user-maintained roster annotations (nickname/aliases/notes/tags), keyed
   *  by Discord member_id — lets the agent resolve loose name references. */
  rosterAnnotations: () => RosterAnnotation[]
  /** Hybrid meta corpus search (lazy; resolved per-call). */
  metaIndex: () => MetaIndex
  /** GW2-wiki reference corpus search (lazy). */
  wikiIndex: () => MetaIndex
  /** On-demand GW2 wiki skill/trait facts with PvE/WvW/PvP splits. */
  wikiFacts: WikiFacts
  /** Load a build page (Cloudflare-aware) and return its full HTML, or null. */
  fetchBuildPage: (url: string) => Promise<string | null>
  /**
   * Plain HTTP GET of a build page (no JS), or null. Used for gear scraping: the
   * Cloudflare-aware browser fetch returns the post-JS DOM, where GW2-Armory has
   * already replaced the data-armory-embed placeholders — so its gear is gone.
   */
  fetchBuildPageRaw: (url: string) => Promise<string | null>
}

export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  /** Rich-render payload for the UI; never serialized into model context. */
  display?: DisplayPayload
}

// Compact on purpose: results go into the model's context, where pretty-print
// indentation is pure token waste. The UI re-renders results humanized anyway.
export function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Wraps a handler so thrown errors come back as MCP error results instead of exceptions. */
export function safe<A>(fn: (args: A) => Promise<unknown>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}

/**
 * Like safe(), for handlers that also produce a rich display payload.
 * The model gets JSON.stringify(value); the renderer gets display.
 */
export function safeRich<A>(
  fn: (args: A) => Promise<{ value: unknown; display?: DisplayPayload }>
): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      const { value, display } = await fn(args)
      const result = ok(value)
      return display ? { ...result, display } : result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}

export function requireDiscordGuild(deps: ToolDeps): string {
  const id = deps.discordGuildId()
  if (id === '') throw new Error('Discord guild not connected — save an AxiVale key in Settings (05)')
  return id
}
