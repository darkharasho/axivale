import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { ToolDeps } from './shared'
import { buildAxitoolsTools } from './axitools'
import { buildDiscordTools, DESTRUCTIVE_DISCORD_ACTIONS } from './discord'
import { buildGw2Tools } from './gw2'
import { buildAxiforgeTools, AXIFORGE_DESTRUCTIVE_TOOLS } from './axiforge'
import { buildAxibridgeTools } from './axibridge'
import { buildSkillTools } from './skills'
import { buildMetaSearchTools } from './metaSearch'
import { buildGw2WikiTools } from './gw2Wiki'
import { buildGw2WikiSearchTools } from './gw2WikiSearch'
import { buildGeneralSearchTools } from './generalSearch'
import { buildCompCheckTools } from './compCheck'
import { buildMemoryTools } from './memory'
import { buildAxilogTools } from './axilog'

export type { ToolDeps } from './shared'
export { DESTRUCTIVE_DISCORD_ACTIONS }

/** Tools that mutate data irreversibly (or publish publicly) — the UI asks the user to confirm before running these. */
export const DESTRUCTIVE_TOOLS = [
  'axitools_builds_delete',
  'axitools_comp_presets_delete',
  ...AXIFORGE_DESTRUCTIVE_TOOLS
]

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
 * Among the confirm-gated tools/actions above, these are NOT destructive: they
 * publish or send outward but delete/overwrite nothing. They still require
 * confirmation — this only tells the dialog to drop the "destruction" framing.
 */
export const NON_DESTRUCTIVE_CONFIRM_TOOLS = [
  'axiforge_build_publish',
  'axiforge_comp_publish',
  'axiforge_comp_share_discord',
  'axiforge_build_share_discord'
]
export const NON_DESTRUCTIVE_CONFIRM_ACTIONS: Record<string, string[]> = {
  discord_action: ['member_dm', 'members_dm']
}

/**
 * Whether a confirm-gated call is destructive (irreversible / harmful) rather
 * than merely sensitive (a publish or a send). Drives the confirm dialog's
 * wording only — not whether confirmation is required. `bareTool` is the tool
 * name without the officer MCP prefix.
 */
export function isDestructiveConfirm(bareTool: string, input: Record<string, unknown>): boolean {
  const safeActions = NON_DESTRUCTIVE_CONFIRM_ACTIONS[bareTool]
  if (safeActions) return !safeActions.includes(String(input.action ?? ''))
  return !NON_DESTRUCTIVE_CONFIRM_TOOLS.includes(bareTool)
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
  return [
    ...buildAxitoolsTools(deps),
    ...buildDiscordTools(deps),
    ...buildGw2Tools(deps),
    ...buildAxiforgeTools(deps),
    ...buildAxibridgeTools(deps.axibridge),
    ...buildSkillTools(deps.loadSkill),
    ...buildMetaSearchTools(deps.metaIndex),
    ...buildCompCheckTools(),
    ...buildGw2WikiTools(deps.wikiFacts),
    ...buildGw2WikiSearchTools(deps.wikiIndex, deps.wikiLiveSearch),
    ...buildGeneralSearchTools(deps.generalIndex),
    ...buildMemoryTools(deps),
    ...buildAxilogTools(deps.axilog)
  ]
}
