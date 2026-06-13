import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, requireDiscordGuild, type ToolDeps } from './shared'

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
  'member_ban',
  'member_dm',
  'members_dm'
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildDiscordTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'discord_overview',
      'Full snapshot of the connected Discord server: channels, categories, roles (with permissions and member counts), threads, and scheduled events. Pass include_members for the member list with roles (capped at 1000). Use this to find channel/role/member ids before acting.',
      {
        include_members: z.boolean().optional().describe('Also list members with their role ids')
      },
      safe(async ({ include_members }) =>
        deps.axitools.discordOverview(requireDiscordGuild(deps), include_members ?? false)
      )
    ),
    tool(
      'discord_messages',
      'Read messages from a channel or thread in the connected Discord server, newest first (default 25, max 100). Pass channel_id OR thread_id (ids from discord_overview). To read OLDER messages, call again with `before` set to the oldest message id you got in the previous page. `before`/`after` each accept a message id or an ISO-8601 date (e.g. "2026-06-01"); after bounds the oldest, before bounds the newest.',
      {
        channel_id: z.string().optional().describe('Channel id (from discord_overview)'),
        thread_id: z.string().optional().describe('Thread id to read instead of a channel'),
        limit: z.number().optional().describe('How many messages, max 100'),
        before: z.string().optional().describe('Message id or ISO date — return messages older than this'),
        after: z.string().optional().describe('Message id or ISO date — return messages newer than this')
      },
      safe(async ({ channel_id, thread_id, limit, before, after }) =>
        deps.axitools.discordMessages(requireDiscordGuild(deps), {
          channelId: channel_id,
          threadId: thread_id,
          limit,
          before,
          after
        })
      )
    ),
    tool(
      'discord_action',
      `Perform a management action on the connected Discord server. Actions: channel_create {name, type?, category_id?, topic?}, channel_update {channel_id, name?, topic?, category_id?, slowmode_seconds?, nsfw?}, channel_delete {channel_id, reason?}, role_create {name, color?, hoist?, mentionable?, permissions?}, role_update {role_id, …same fields}, role_delete {role_id, reason?}, role_assign {member_id, role_id}, role_unassign {member_id, role_id}, member_nick {member_id, nick}, member_timeout {member_id, minutes, reason?}, member_kick {member_id, reason?}, member_ban {member_id, reason?, delete_message_days?}, member_dm {member_id, content}, members_dm {member_ids (max 250), content} — bulk DMs are paced bot-side and report per-member sent/failed, message_send {channel_id, content}, message_pin {channel_id, message_id}, thread_create {channel_id, name, message_id?}, event_create {name, start_time, end_time?, description?, channel_id? or location}. Destructive actions (${DESTRUCTIVE_DISCORD_ACTIONS.join(', ')}) ask the user to confirm first. Ids come from discord_overview.`,
      {
        action: z.string().describe('Action name from the list above'),
        params: z.record(z.string(), z.unknown()).optional().describe('Parameters for the action')
      },
      safe(async ({ action, params }) =>
        deps.axitools.discordAction(requireDiscordGuild(deps), action, params ?? {})
      )
    )
  ]
}
