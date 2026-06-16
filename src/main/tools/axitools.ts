import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, requireDiscordGuild, type ToolDeps } from './shared'
import { rankIdentities, mergeManualLinks, type ResolveMemberLite } from '../identityResolve'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxitoolsTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'axitools_builds_list',
      'List all GW2 builds stored in the AxiTools Discord bot for this guild.',
      {},
      safe(async () => deps.axitools.listBuilds(requireDiscordGuild(deps)))
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
      safe(async (args) => deps.axitools.createBuild(requireDiscordGuild(deps), args))
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
        deps.axitools.updateBuild(requireDiscordGuild(deps), build_id, patch)
      )
    ),
    tool(
      'axitools_builds_delete',
      'Permanently delete a GW2 build from the AxiTools Discord bot. This is destructive — the user will be asked to confirm before it runs.',
      { build_id: z.string().describe('Id of the build to delete') },
      safe(async ({ build_id }) => {
        await deps.axitools.deleteBuild(requireDiscordGuild(deps), build_id)
        return { deleted: build_id }
      })
    ),
    tool(
      'axitools_comp_presets_list',
      'List all squad composition presets stored in the AxiTools Discord bot for this guild.',
      {},
      safe(async () => deps.axitools.listCompPresets(requireDiscordGuild(deps)))
    ),
    tool(
      'axitools_comp_presets_save',
      'Create or replace a squad composition preset. Pass the FULL preset config — to edit an existing preset, list presets first, modify its config, then save it back.',
      {
        name: z.string().describe('Preset name (also the key it is saved under)'),
        config: z.record(z.string(), z.unknown()).describe('Full preset configuration object')
      },
      safe(async ({ name, config }) =>
        deps.axitools.putCompPreset(requireDiscordGuild(deps), { name, config })
      )
    ),
    tool(
      'axitools_comp_presets_delete',
      'Permanently delete a squad composition preset. This is destructive — the user will be asked to confirm before it runs.',
      { name: z.string().describe('Name of the preset to delete') },
      safe(async ({ name }) => {
        await deps.axitools.deleteCompPreset(requireDiscordGuild(deps), name)
        return { deleted: name }
      })
    ),
    tool(
      'axitools_comp_schedules_list',
      'List all squad composition posting schedules stored in the AxiTools Discord bot for this guild.',
      {},
      safe(async () => deps.axitools.listCompSchedules(requireDiscordGuild(deps)))
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
      safe(async (args) => deps.axitools.putCompSchedule(requireDiscordGuild(deps), args))
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
          ? deps.axitools.auditDiscord(requireDiscordGuild(deps), { event_type, actor, target, limit })
          : deps.axitools.auditGw2(requireDiscordGuild(deps), { event_type, user, since_log_id, limit })
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
        const gid = requireDiscordGuild(deps)
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
        const gid = requireDiscordGuild(deps)
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
        const gid = requireDiscordGuild(deps)
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
        const gid = requireDiscordGuild(deps)
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
        const gid = requireDiscordGuild(deps)
        if (action === 'get') return deps.axitools.configGet(gid)
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        )
        return deps.axitools.configPatch(gid, patch)
      })
    ),
    tool(
      'axitools_members',
      'Linked-member roster derived from the GW2 API keys members registered with the bot IN THIS Discord server: each member’s GW2 account names (and optionally characters and guild memberships — omitted by default to keep the result small). Any user-maintained annotations (nickname/aliases/notes/tags) are folded in when present, so you can tie loose name references to accounts. Key material is never included. NOTE: members who registered their key in a different server the bot shares do not appear here — use axitools_key_holders to check key existence across all servers.',
      {
        include_characters: z.boolean().optional().describe('Include character name lists'),
        include_guilds: z.boolean().optional().describe('Include GW2 guild ids and labels')
      },
      safe(async ({ include_characters, include_guilds }) => {
        const raw = (await deps.axitools.membersLinked(requireDiscordGuild(deps))) as Array<{
          member_id?: string
          accounts?: Array<Record<string, unknown>>
          [key: string]: unknown
        }>
        // Append manually-linked accounts to their member so they show alongside
        // the AxiTools auto-links.
        const manualByMember = new Map<string, string[]>()
        for (const l of deps.rosterLinks()) {
          const arr = manualByMember.get(l.memberId) ?? []
          arr.push(l.accountName)
          manualByMember.set(l.memberId, arr)
        }
        for (const m of raw) {
          const extra = m.member_id ? manualByMember.get(m.member_id) : undefined
          if (!extra) continue
          const present = new Set(
            (m.accounts ?? []).map((a) => String(a.account_name ?? '').toLowerCase())
          )
          m.accounts = [
            ...(m.accounts ?? []),
            ...extra
              .filter((name) => !present.has(name.toLowerCase()))
              .map((name) => ({ account_name: name, manual_link: true }))
          ]
        }
        // Fold in local annotations keyed by Discord member_id, when present.
        const annByMember = new Map(deps.rosterAnnotations().map((a) => [a.memberId, a]))
        const annotate = <T extends { member_id?: string }>(m: T): T => {
          const a = m.member_id ? annByMember.get(m.member_id) : undefined
          if (!a) return m
          return {
            ...m,
            ...(a.nickname ? { nickname: a.nickname } : {}),
            ...(a.aliases.length ? { aliases: a.aliases } : {}),
            ...(a.notes ? { notes: a.notes } : {}),
            ...(a.tags.length ? { tags: a.tags } : {})
          }
        }
        if (include_characters && include_guilds) return raw.map(annotate)
        return raw.map((m) =>
          annotate({
            ...m,
            accounts: (m.accounts ?? []).map((a) => {
              const slim: Record<string, unknown> = { account_name: a.account_name }
              if (include_characters) slim.characters = a.characters
              if (include_guilds) {
                slim.gw2_guild_ids = a.gw2_guild_ids
                slim.guild_labels = a.guild_labels
              }
              return slim
            })
          })
        )
      })
    ),
    tool(
      'axitools_key_holders',
      'Check which GW2 account names have an API key registered with the AxiTools bot in ANY Discord server it serves (existence booleans only — no key data, no server details). Use this to answer "who has a key" for a guild roster: feed it the account names from gw2_guild_members. Max 500 names per call.',
      {
        account_names: z.array(z.string()).describe('GW2 account names, e.g. ["Logan.1234"]')
      },
      safe(async ({ account_names }) =>
        deps.axitools.keyHolders(requireDiscordGuild(deps), account_names)
      )
    ),
    tool(
      'resolve_identity',
      'Resolve a loose or partial name reference — a nickname, Discord display name, first name, or in-game shorthand like "Bob" or "@bobby" — to the guild member(s) it most likely refers to. Searches the user-maintained roster annotations (nicknames/aliases/notes/tags) joined with the linked roster (member name, GW2 account names, characters), and returns ranked candidates with their GW2 account name(s) and notes. Use this whenever the user names a person you cannot already match to an exact GW2 account.',
      {
        name: z.string().describe('The loose/partial name to resolve, e.g. "Bob", "@bobby", "Logan"'),
        limit: z.number().optional().describe('Max candidates to return (default 8)')
      },
      safe(async ({ name, limit }) => {
        const raw = (await deps.axitools.membersLinked(
          requireDiscordGuild(deps)
        )) as ResolveMemberLite[]
        const anns = deps.rosterAnnotations()
        // Annotations made on an unlinked GW2 account are keyed "acct:<name>" —
        // surface them as resolvable account-only identities.
        const acctMembers: ResolveMemberLite[] = anns
          .filter((a) => a.memberId.startsWith('acct:'))
          .map((a) => ({ member_id: a.memberId, accounts: [{ account_name: a.memberId.slice(5) }] }))
        const members = [...mergeManualLinks(raw, deps.rosterLinks()), ...acctMembers]
        const matches = rankIdentities(name, members, anns, limit ?? 8)
        return { query: name, matches }
      })
    )
  ]
}
