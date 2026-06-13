import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, type ToolDeps } from './shared'

/**
 * Resolve the guild to query. Resolution order:
 *   1. explicit `guild` param (name OR id) — resolved via resolveGuildId
 *   2. legacy `guild_id` param (always a GUID, passed through)
 *   3. configured default guild id from settings
 * Throws with a helpful message if nothing resolves.
 */
async function resolveGw2Guild(deps: ToolDeps, guild?: string, guildId?: string): Promise<string> {
  if (guild) return deps.gw2.resolveGuildId(guild)
  if (guildId) return guildId
  const id = deps.gw2GuildId()
  if (id === '')
    throw new Error(
      'No guild given and no default guild configured — pass guild (a guild name like "Defiance" or id like "23b352fb-…") or guild_id, or set a default in Settings. Guild names and ids come from gw2_account_info.'
    )
  return id
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2Tools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'gw2_api',
      'Query ANY endpoint of the official GW2 API (api.guildwars2.com/v2) with the stored API key — items, prices, wvw matches, achievements, characters, guild upgrades, and everything else not covered by the dedicated tools. Pass a relative path like /items?ids=1,2 or /wvw/matches?world=1008. Large responses are truncated; prefer ?ids= filters over fetching whole collections.',
      { path: z.string().describe('Relative /v2 path including any query string, e.g. /commerce/prices/19684') },
      async ({ path }: { path: string }) => {
        try {
          const text = JSON.stringify(await deps.gw2.apiGet(path))
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
      "Validate the stored GW2 API key and return the account name, granted/missing key permissions, and the account's guilds (id, name, tag, leader flag).",
      {},
      safe(async () => deps.gw2.accountInfo())
    ),
    tool(
      'gw2_guild_members',
      'List the member roster (name, rank, join date) of a GW2 guild the API key can access. Defaults to the configured guild; pass guild (name or id) for any other guild. Guild names, ids, and tags come from gw2_account_info.',
      {
        guild: z
          .string()
          .optional()
          .describe(
            'Guild name (e.g. "Defiance") or guild id (GUID) to query; omit for the configured guild'
          ),
        guild_id: z
          .string()
          .optional()
          .describe('Legacy: guild id (GUID) to query — prefer guild instead')
      },
      safe(async ({ guild, guild_id }) => deps.gw2.guildMembers(await resolveGw2Guild(deps, guild, guild_id)))
    ),
    tool(
      'gw2_guild_log',
      'Fetch the activity log (joins, kicks, rank changes, stash, upgrades…) of a GW2 guild the API key can access, newest first. Defaults to the configured guild; pass guild (name or id) for any other guild. Guild names, ids, and tags come from gw2_account_info.',
      {
        guild: z
          .string()
          .optional()
          .describe(
            'Guild name (e.g. "Defiance") or guild id (GUID) to query; omit for the configured guild'
          ),
        guild_id: z
          .string()
          .optional()
          .describe('Legacy: guild id (GUID) to query — prefer guild instead'),
        since_log_id: z
          .number()
          .optional()
          .describe('Only return entries newer than this log id')
      },
      safe(async ({ guild, guild_id, since_log_id }) =>
        deps.gw2.guildLog(await resolveGw2Guild(deps, guild, guild_id), since_log_id)
      )
    )
  ]
}
