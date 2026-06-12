import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AxitoolsClient } from './axitoolsClient'
import type { Gw2Client } from './gw2Client'

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  /** active Discord guild id from settings as a string — snowflakes overflow JS numbers ('' = unset) */
  discordGuildId: () => string
  /** active GW2 guild id from settings ('' = unset) */
  gw2GuildId: () => string
}

/** Tools that mutate data irreversibly — the UI asks the user to confirm before running these. */
export const DESTRUCTIVE_TOOLS = ['axitools_builds_delete', 'axitools_comp_presets_delete']

/**
 * discord_action verbs that get the confirm dialog. Must mirror the
 * `destructive: True` entries in axitools' api/discord_actions.py registry.
 */
export const DESTRUCTIVE_DISCORD_ACTIONS = [
  'channel_delete',
  'role_update',
  'role_delete',
  'member_timeout',
  'member_kick',
  'member_ban'
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
  const requireDiscordGuild = (): string => {
    const id = deps.discordGuildId()
    if (id === '') throw new Error('Discord guild not connected — save an AxiVale key in Settings (05)')
    return id
  }
  // Explicit guild_id wins; otherwise fall back to the configured guild.
  const resolveGw2Guild = (explicit?: string): string => {
    if (explicit) return explicit
    const id = deps.gw2GuildId()
    if (id === '')
      throw new Error(
        'No guild_id given and no default guild configured — pass guild_id (your key’s guild ids come from gw2_account_info, or resolve a name via gw2_api /guild/search?name=…), or set a default in Settings (05)'
      )
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
      'discord_overview',
      'Full snapshot of the connected Discord server: channels, categories, roles (with permissions and member counts), threads, and scheduled events. Pass include_members for the member list with roles (capped at 1000). Use this to find channel/role/member ids before acting.',
      {
        include_members: z.boolean().optional().describe('Also list members with their role ids')
      },
      safe(async ({ include_members }) =>
        deps.axitools.discordOverview(requireDiscordGuild(), include_members ?? false)
      )
    ),
    tool(
      'discord_messages',
      'Read recent messages from a channel in the connected Discord server, newest first (default 25, max 100).',
      {
        channel_id: z.string().describe('Channel id (from discord_overview)'),
        limit: z.number().optional().describe('How many messages, max 100')
      },
      safe(async ({ channel_id, limit }) =>
        deps.axitools.discordMessages(requireDiscordGuild(), channel_id, limit)
      )
    ),
    tool(
      'discord_action',
      `Perform a management action on the connected Discord server. Actions: channel_create {name, type?, category_id?, topic?}, channel_update {channel_id, name?, topic?, category_id?, slowmode_seconds?, nsfw?}, channel_delete {channel_id, reason?}, role_create {name, color?, hoist?, mentionable?, permissions?}, role_update {role_id, …same fields}, role_delete {role_id, reason?}, role_assign {member_id, role_id}, role_unassign {member_id, role_id}, member_nick {member_id, nick}, member_timeout {member_id, minutes, reason?}, member_kick {member_id, reason?}, member_ban {member_id, reason?, delete_message_days?}, message_send {channel_id, content}, message_pin {channel_id, message_id}, thread_create {channel_id, name, message_id?}, event_create {name, start_time, end_time?, description?, channel_id? or location}. Destructive actions (${DESTRUCTIVE_DISCORD_ACTIONS.join(', ')}) ask the user to confirm first. Ids come from discord_overview.`,
      {
        action: z.string().describe('Action name from the list above'),
        params: z.record(z.string(), z.unknown()).optional().describe('Parameters for the action')
      },
      safe(async ({ action, params }) =>
        deps.axitools.discordAction(requireDiscordGuild(), action, params ?? {})
      )
    ),
    tool(
      'axitools_audit',
      'Query the audit log AxiTools keeps for this Discord server. source "discord" = server events (member joins/leaves/bans, message edits/deletes, role and channel changes); source "gw2" = synced GW2 guild log events. Entries are retained ~30 days.',
      {
        source: z.enum(['discord', 'gw2']).describe('Which audit stream to query'),
        event_type: z.string().optional().describe('Filter by event type, e.g. member_join'),
        actor: z.string().optional().describe('discord only: filter by acting user'),
        target: z.string().optional().describe('discord only: filter by target user'),
        user: z.string().optional().describe('gw2 only: filter by GW2 account name'),
        since_log_id: z.number().optional().describe('gw2 only: entries newer than this log id'),
        limit: z.number().optional().describe('Max entries (default 50, max 200)')
      },
      safe(async ({ source, event_type, actor, target, user, since_log_id, limit }) =>
        source === 'discord'
          ? deps.axitools.auditDiscord(requireDiscordGuild(), { event_type, actor, target, limit })
          : deps.axitools.auditGw2(requireDiscordGuild(), { event_type, user, since_log_id, limit })
      )
    ),
    tool(
      'axitools_rss',
      'Manage RSS/Atom feed subscriptions the bot posts to Discord channels. action "list"; "set" (create or update — needs name, url, channel_id); "delete" (needs name; asks the user to confirm).',
      {
        action: z.enum(['list', 'set', 'delete']),
        name: z.string().optional().describe('Feed name'),
        url: z.string().optional().describe('Feed URL (set)'),
        channel_id: z.string().optional().describe('Discord channel to post to (set)')
      },
      safe(async ({ action, name, url, channel_id }) => {
        const gid = requireDiscordGuild()
        if (action === 'list') return deps.axitools.rssList(gid)
        if (!name) throw new Error('name is required for set/delete')
        if (action === 'delete') return deps.axitools.rssDelete(gid, name)
        if (!url || !channel_id) throw new Error('set requires url and channel_id')
        return deps.axitools.rssSet(gid, name, { url, channel_id })
      })
    ),
    tool(
      'axitools_streams',
      'Manage Twitch/YouTube stream announcement subscriptions. action "list"; "set" (create or update — needs name, platform, channel_ref, discord_channel_id, optional ping_role_id); "delete" (needs name; asks the user to confirm).',
      {
        action: z.enum(['list', 'set', 'delete']),
        name: z.string().optional().describe('Subscription name'),
        platform: z.enum(['twitch', 'youtube']).optional(),
        channel_ref: z.string().optional().describe('Streamer URL, handle, or channel id'),
        discord_channel_id: z.string().optional().describe('Channel for announcements'),
        ping_role_id: z.string().optional().describe('Role to ping on live')
      },
      safe(async ({ action, name, platform, channel_ref, discord_channel_id, ping_role_id }) => {
        const gid = requireDiscordGuild()
        if (action === 'list') return deps.axitools.streamsList(gid)
        if (!name) throw new Error('name is required for set/delete')
        if (action === 'delete') return deps.axitools.streamDelete(gid, name)
        if (!platform || !channel_ref || !discord_channel_id)
          throw new Error('set requires platform, channel_ref, and discord_channel_id')
        return deps.axitools.streamSet(gid, name, {
          platform,
          channel_ref,
          discord_channel_id,
          ...(ping_role_id ? { ping_role_id } : {})
        })
      })
    ),
    tool(
      'axitools_alliance',
      'Read or change the WvW alliance matchup settings (tracked guild, announcement channel, prediction/current post days+times, relink announcements). action "get" or "set" with any subset of fields.',
      {
        action: z.enum(['get', 'set']),
        channel_id: z.string().optional(),
        guild_id: z.string().optional().describe('GW2 guild id to track'),
        guild_name: z.string().optional(),
        prediction_day: z.string().optional().describe('e.g. Thursday'),
        prediction_time: z.string().optional().describe('HH:MM, PST'),
        current_day: z.string().optional(),
        current_time: z.string().optional(),
        relink_enabled: z.boolean().optional()
      },
      safe(async ({ action, ...fields }) => {
        const gid = requireDiscordGuild()
        if (action === 'get') return deps.axitools.allianceGet(gid)
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        )
        return deps.axitools.allianceSet(gid, patch)
      })
    ),
    tool(
      'axitools_guild_roles',
      'Manage GW2-guild→Discord-role mappings (members with a linked account in that GW2 guild get the role) and the preferred-role allowlist. action "list"; "set" (gw2_guild_id + role_id); "delete" (gw2_guild_id; asks the user to confirm); "set_allowlist" (role_ids replaces the whole list).',
      {
        action: z.enum(['list', 'set', 'delete', 'set_allowlist']),
        gw2_guild_id: z.string().optional(),
        role_id: z.string().optional(),
        role_ids: z.array(z.string()).optional()
      },
      safe(async ({ action, gw2_guild_id, role_id, role_ids }) => {
        const gid = requireDiscordGuild()
        if (action === 'list') return deps.axitools.guildRolesGet(gid)
        if (action === 'set_allowlist') {
          if (!role_ids) throw new Error('set_allowlist requires role_ids')
          return deps.axitools.guildRolesAllowlist(gid, role_ids)
        }
        if (!gw2_guild_id) throw new Error('gw2_guild_id is required')
        if (action === 'delete') return deps.axitools.guildRoleDelete(gid, gw2_guild_id)
        if (!role_id) throw new Error('set requires role_id')
        return deps.axitools.guildRoleSet(gid, gw2_guild_id, role_id)
      })
    ),
    tool(
      'axitools_config',
      'Read or change the bot’s server wiring: which channels receive builds, update notes, ArcDPS releases, and audit posts, plus moderator roles. action "get" or "set" with any subset (null clears a channel).',
      {
        action: z.enum(['get', 'set']),
        build_channel_id: z.string().nullable().optional(),
        update_notes_channel_id: z.string().nullable().optional(),
        arcdps_channel_id: z.string().nullable().optional(),
        audit_channel_id: z.string().nullable().optional(),
        moderator_role_ids: z.array(z.string()).optional()
      },
      safe(async ({ action, ...fields }) => {
        const gid = requireDiscordGuild()
        if (action === 'get') return deps.axitools.configGet(gid)
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        )
        return deps.axitools.configPatch(gid, patch)
      })
    ),
    tool(
      'axitools_members',
      'Linked-member roster derived from the GW2 API keys members registered with the bot IN THIS Discord server: each member’s GW2 account names, characters, GW2 guild memberships, and preferred guild role. Key material is never included. NOTE: members who registered their key in a different server the bot shares do not appear here — use axitools_key_holders to check key existence across all servers.',
      {},
      safe(async () => deps.axitools.membersLinked(requireDiscordGuild()))
    ),
    tool(
      'axitools_key_holders',
      'Check which GW2 account names have an API key registered with the AxiTools bot in ANY Discord server it serves (existence booleans only — no key data, no server details). Use this to answer "who has a key" for a guild roster: feed it the account names from gw2_guild_members. Max 500 names per call.',
      {
        account_names: z.array(z.string()).describe('GW2 account names, e.g. ["Logan.1234"]')
      },
      safe(async ({ account_names }) =>
        deps.axitools.keyHolders(requireDiscordGuild(), account_names)
      )
    ),
    tool(
      'gw2_api',
      'Query ANY endpoint of the official GW2 API (api.guildwars2.com/v2) with the stored API key — items, prices, wvw matches, achievements, characters, guild upgrades, and everything else not covered by the dedicated tools. Pass a relative path like /items?ids=1,2 or /wvw/matches?world=1008. Large responses are truncated; prefer ?ids= filters over fetching whole collections.',
      { path: z.string().describe('Relative /v2 path including any query string, e.g. /commerce/prices/19684') },
      async ({ path }: { path: string }) => {
        try {
          const text = JSON.stringify(await deps.gw2.apiGet(path), null, 2)
          const MAX = 30_000
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  text.length > MAX
                    ? `${text.slice(0, MAX)}\n… [truncated ${text.length - MAX} chars — narrow the query with ?ids=…]`
                    : text
              }
            ]
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return { isError: true, content: [{ type: 'text' as const, text: message }] }
        }
      }
    ),
    tool(
      'gw2_account_info',
      'Validate the stored GW2 API key and return the account name, granted/missing key permissions, and guild ids.',
      {},
      safe(async () => deps.gw2.accountInfo())
    ),
    tool(
      'gw2_guild_members',
      'List the member roster (name, rank, join date) of a GW2 guild the API key can access. Defaults to the configured guild; pass guild_id for any other guild from the account’s guild list.',
      { guild_id: z.string().optional().describe('Guild id to query; omit for the configured guild') },
      safe(async ({ guild_id }) => deps.gw2.guildMembers(resolveGw2Guild(guild_id)))
    ),
    tool(
      'gw2_guild_log',
      'Fetch the activity log (joins, kicks, rank changes, stash, upgrades…) of a GW2 guild the API key can access, newest first. Defaults to the configured guild; pass guild_id for any other guild from the account’s guild list.',
      {
        guild_id: z.string().optional().describe('Guild id to query; omit for the configured guild'),
        since_log_id: z
          .number()
          .optional()
          .describe('Only return entries newer than this log id')
      },
      safe(async ({ guild_id, since_log_id }) =>
        deps.gw2.guildLog(resolveGw2Guild(guild_id), since_log_id)
      )
    )
  ]
}
