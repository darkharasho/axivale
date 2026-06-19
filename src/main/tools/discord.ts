import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, requireDiscordGuild, type ToolDeps } from './shared'

/** Shape the bot returns from /discord/messages (see _handle_discord_messages). */
interface DiscordMessage {
  id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
  pinned: boolean
}

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
  'members_dm',
  'message_delete',
  'forum_tag_delete',
  'emoji_delete'
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
      'discord_search',
      'Search a Discord channel or thread for messages matching a substring and/or author and/or date range. Discord gives bots no true server search, so this scans a bounded window newest→older (up to max_messages, default 500, hard cap 1000) and filters in code. Returns { matches, scanned, reachedCap, oldestScannedAt }: when reachedCap is true the channel has more history than was scanned — tell the user and offer to narrow by `to`/`from` date or raise max_messages rather than implying an exhaustive search. Pass channel_id OR thread_id.',
      {
        channel_id: z.string().optional().describe('Channel id (from discord_overview)'),
        thread_id: z.string().optional().describe('Thread id to search instead of a channel'),
        query: z.string().optional().describe('Case-insensitive substring to match in message content'),
        author: z.string().optional().describe('Author name (case-insensitive) or exact author id'),
        from: z.string().optional().describe('ISO date — only messages at or after this time'),
        to: z.string().optional().describe('ISO date — only messages at or before this time'),
        max_messages: z
          .number()
          .optional()
          .describe('How many messages to scan before stopping (default 500, hard cap 1000)')
      },
      safe(async ({ channel_id, thread_id, query, author, from, to, max_messages }) => {
        const guildId = requireDiscordGuild(deps)
        const cap = Math.min(Math.max(1, max_messages ?? 500), 1000)
        const needle = query?.toLowerCase()
        const authorNeedle = author?.toLowerCase()
        const fromMs = from ? Date.parse(from) : undefined
        const toMs = to ? Date.parse(to) : undefined

        const matches: DiscordMessage[] = []
        let scanned = 0
        let oldestScannedAt: string | null = null
        let before: string | undefined

        while (scanned < cap) {
          const pageSize = Math.min(100, cap - scanned)
          const page = (await deps.axitools.discordMessages(guildId, {
            channelId: channel_id,
            threadId: thread_id,
            limit: pageSize,
            before
          })) as DiscordMessage[]
          if (page.length === 0) break
          for (const m of page) {
            scanned += 1
            oldestScannedAt = m.created_at
            if (needle && !m.content.toLowerCase().includes(needle)) continue
            if (
              authorNeedle &&
              m.author_name.toLowerCase() !== authorNeedle &&
              m.author_id !== author
            )
              continue
            const ts = Date.parse(m.created_at)
            if (fromMs !== undefined && ts < fromMs) continue
            if (toMs !== undefined && ts > toMs) continue
            matches.push(m)
          }
          before = page[page.length - 1].id
          // Watertight against a malformed page (no id): without advancing
          // `before` we'd re-fetch the same newest page forever.
          if (!before) break
          if (page.length < pageSize) break
        }
        return { matches, scanned, reachedCap: scanned >= cap, oldestScannedAt }
      })
    ),
    tool(
      'discord_action',
      `Perform a management action on the connected Discord server. Actions: channel_create {name, type?, category_id?, topic?}, channel_update {channel_id, name?, topic?, category_id?, slowmode_seconds?, nsfw?}, channel_delete {channel_id, reason?}, role_create {name, color?, hoist?, mentionable?, permissions?}, role_update {role_id, …same fields}, role_delete {role_id, reason?}, role_assign {member_id, role_id}, role_unassign {member_id, role_id}, member_nick {member_id, nick}, member_timeout {member_id, minutes, reason?}, member_kick {member_id, reason?}, member_ban {member_id, reason?, delete_message_days?}, member_dm {member_id, content}, members_dm {member_ids (max 250), content} — bulk DMs are paced bot-side and report per-member sent/failed, message_send {channel_id, content}, message_pin {channel_id, message_id}, thread_create {channel_id, name, message_id?}, thread_update {thread_id, name?, pinned? (pin/unpin a forum post), applied_tags? (forum tag names or ids, e.g. ["Active"]; replaces current tags), archived?, locked?, slowmode_seconds?}, message_unpin {channel_id, message_id}, message_delete {channel_id, message_id, reason?}, message_edit {channel_id, message_id, content} (bot's own messages only), reaction_add {channel_id, message_id, emoji (unicode, '<:name:id>', or custom emoji id)}, reaction_remove {channel_id, message_id, emoji}, forum_tag_create {channel_id, name, emoji?, moderated?}, forum_tag_edit {channel_id, tag (name or id), name?, emoji?, moderated?}, forum_tag_delete {channel_id, tag}, emoji_create {name, image_url (png/gif <=256KB)}, emoji_edit {emoji_id, name}, emoji_delete {emoji_id, reason?}, event_create {name, start_time, end_time?, description?, channel_id? or location}. discord_overview lists each forum's available_tags and the server's custom emojis (with ids) for use here. Destructive actions (${DESTRUCTIVE_DISCORD_ACTIONS.join(', ')}) ask the user to confirm first. Ids come from discord_overview.`,
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
