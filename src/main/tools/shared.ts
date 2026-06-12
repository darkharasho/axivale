import type { AxitoolsClient } from '../axitoolsClient'
import type { Gw2Client } from '../gw2Client'

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  /** active Discord guild id from settings as a string — snowflakes overflow JS numbers ('' = unset) */
  discordGuildId: () => string
  /** active GW2 guild id from settings ('' = unset) */
  gw2GuildId: () => string
}

export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
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

export function requireDiscordGuild(deps: ToolDeps): string {
  const id = deps.discordGuildId()
  if (id === '') throw new Error('Discord guild not connected — save an AxiVale key in Settings (05)')
  return id
}
