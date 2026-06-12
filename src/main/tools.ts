import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AxitoolsClient } from './axitoolsClient'
import type { Gw2Client } from './gw2Client'

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  /** active Discord guild id from settings (0 = unset) */
  discordGuildId: () => number
  /** active GW2 guild id from settings ('' = unset) */
  gw2GuildId: () => string
}

/** Tools that mutate data irreversibly — the UI asks the user to confirm before running these. */
export const DESTRUCTIVE_TOOLS = ['axitools_builds_delete', 'axitools_comp_presets_delete']

interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** Wraps a handler so thrown errors come back as MCP error results instead of exceptions. */
function safe<A>(fn: (args: A) => Promise<unknown>): (args: A, extra: unknown) => Promise<ToolResult> {
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
  const requireDiscordGuild = (): number => {
    const id = deps.discordGuildId()
    if (id === 0) throw new Error('Discord guild not configured — set one in Settings (05)')
    return id
  }
  const requireGw2Guild = (): string => {
    const id = deps.gw2GuildId()
    if (id === '') throw new Error('GW2 guild not configured — set one in Settings (05)')
    return id
  }

  return [
    tool(
      'axitools_builds_list',
      'List all GW2 builds stored in the AxiTools Discord bot for this guild.',
      {},
      safe(async () => deps.axitools.listBuilds(requireDiscordGuild()))
    ),
    tool(
      'axitools_builds_create',
      'Create a new GW2 build in the AxiTools Discord bot for this guild.',
      {
        name: z.string().describe('Build name'),
        profession: z.string().describe('Base profession, e.g. Guardian'),
        specialization: z.string().optional().describe('Elite specialization, e.g. Firebrand'),
        chat_code: z.string().describe('In-game build template chat code, e.g. [&DQE...]'),
        url: z.string().optional().describe('Link to a full build guide'),
        description: z.string().optional().describe('Short description of the build')
      },
      safe(async (args) => deps.axitools.createBuild(requireDiscordGuild(), args))
    ),
    tool(
      'axitools_builds_update',
      'Update an existing GW2 build in the AxiTools Discord bot. Only the provided fields change.',
      {
        build_id: z.string().describe('Id of the build to update'),
        name: z.string().optional(),
        profession: z.string().optional().describe('Base profession, e.g. Guardian'),
        specialization: z.string().optional(),
        chat_code: z.string().optional().describe('In-game build template chat code'),
        url: z.string().optional(),
        description: z.string().optional()
      },
      safe(async ({ build_id, ...patch }) =>
        deps.axitools.updateBuild(requireDiscordGuild(), build_id, patch)
      )
    ),
    tool(
      'axitools_builds_delete',
      'Permanently delete a GW2 build from the AxiTools Discord bot. This is destructive — the user will be asked to confirm before it runs.',
      { build_id: z.string().describe('Id of the build to delete') },
      safe(async ({ build_id }) => {
        await deps.axitools.deleteBuild(requireDiscordGuild(), build_id)
        return { deleted: build_id }
      })
    ),
    tool(
      'axitools_comp_presets_list',
      'List all squad composition presets stored in the AxiTools Discord bot for this guild.',
      {},
      safe(async () => deps.axitools.listCompPresets(requireDiscordGuild()))
    ),
    tool(
      'axitools_comp_presets_save',
      'Create or replace a squad composition preset. Pass the FULL preset config — to edit an existing preset, list presets first, modify its config, then save it back.',
      {
        name: z.string().describe('Preset name (also the key it is saved under)'),
        config: z.record(z.string(), z.unknown()).describe('Full preset configuration object')
      },
      safe(async ({ name, config }) =>
        deps.axitools.putCompPreset(requireDiscordGuild(), { name, config })
      )
    ),
    tool(
      'axitools_comp_presets_delete',
      'Permanently delete a squad composition preset. This is destructive — the user will be asked to confirm before it runs.',
      { name: z.string().describe('Name of the preset to delete') },
      safe(async ({ name }) => {
        await deps.axitools.deleteCompPreset(requireDiscordGuild(), name)
        return { deleted: name }
      })
    ),
    tool(
      'axitools_comp_schedules_list',
      'List all squad composition posting schedules stored in the AxiTools Discord bot for this guild.',
      {},
      safe(async () => deps.axitools.listCompSchedules(requireDiscordGuild()))
    ),
    tool(
      'axitools_comp_schedules_save',
      'Create or replace a squad composition posting schedule.',
      {
        schedule_id: z.string().describe('Id of the schedule (also the key it is saved under)'),
        name: z.string().describe('Display name of the schedule'),
        preset_name: z.string().optional().describe('Name of the comp preset to post'),
        post_days: z
          .array(z.number())
          .optional()
          .describe('Days of week to post on (0 = Sunday … 6 = Saturday)'),
        post_time: z.string().optional().describe("Time of day to post, 'HH:MM' 24-hour"),
        timezone: z.string().optional().describe('IANA timezone, e.g. America/New_York')
      },
      safe(async (args) => deps.axitools.putCompSchedule(requireDiscordGuild(), args))
    ),
    tool(
      'gw2_account_info',
      'Validate the stored GW2 API key and return the account name, granted/missing key permissions, and guild ids.',
      {},
      safe(async () => deps.gw2.accountInfo())
    ),
    tool(
      'gw2_guild_members',
      'List the member roster (name, rank, join date) of the configured GW2 guild.',
      {},
      safe(async () => deps.gw2.guildMembers(requireGw2Guild()))
    ),
    tool(
      'gw2_guild_log',
      'Fetch the activity log (joins, kicks, rank changes, stash, upgrades…) of the configured GW2 guild, newest first.',
      {
        since_log_id: z
          .number()
          .optional()
          .describe('Only return entries newer than this log id')
      },
      safe(async ({ since_log_id }) => deps.gw2.guildLog(requireGw2Guild(), since_log_id))
    )
  ]
}
