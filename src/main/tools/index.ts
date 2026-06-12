import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { ToolDeps } from './shared'
import { buildAxitoolsTools } from './axitools'
import { buildDiscordTools, DESTRUCTIVE_DISCORD_ACTIONS } from './discord'
import { buildGw2Tools } from './gw2'

export type { ToolDeps } from './shared'
export { DESTRUCTIVE_DISCORD_ACTIONS }

/** Tools that mutate data irreversibly — the UI asks the user to confirm before running these. */
export const DESTRUCTIVE_TOOLS = ['axitools_builds_delete', 'axitools_comp_presets_delete']

/**
 * Tools whose risk depends on their `action` input: never pre-allowed, and
 * the listed verbs require user confirmation.
 */
export const ACTION_GATED_TOOLS: Record<string, string[]> = {
  discord_action: DESTRUCTIVE_DISCORD_ACTIONS,
  axitools_rss: ['delete'],
  axitools_streams: ['delete'],
  axitools_guild_roles: ['delete']
}

/**
 * Builds the officer MCP toolset.
 *
 * The SDK's `tool()` returns a plain `SdkMcpToolDefinition` object exposing
 * `name`, `description`, `inputSchema`, and `handler`, so the same array is
 * both unit-testable (tests call `t.handler(args, extra)` directly) and
 * directly consumable by `createSdkMcpServer({ tools: buildOfficerTools(deps) })`
 * in Task 10. No separate adapter is needed.
 *
 * The element type matches the SDK's own `Options['mcpServers']` tools array
 * (`Array<SdkMcpToolDefinition<any>>`) — handler arg types vary per tool, so a
 * non-`any` schema parameter would not be assignable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOfficerTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [...buildAxitoolsTools(deps), ...buildDiscordTools(deps), ...buildGw2Tools(deps)]
}
