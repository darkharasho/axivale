import { resilientFetch, FetchTimeoutError } from './net/resilientFetch'

const BASE = 'https://api.guildwars2.com/v2'
const REQUIRED_PERMISSIONS = ['account', 'guilds'] as const

export class Gw2Error extends Error {}

export interface GuildRef {
  id: string
  name: string
  tag: string
  leader: boolean
}

export interface AccountInfo {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: GuildRef[]
}

export interface GuildMember {
  name: string
  rank: string
  joined: string | null
}

export interface GuildLogEntry {
  id: number
  time: string
  type: string
  user?: string
  [key: string]: unknown
}

export class Gw2Client {
  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string): Promise<T> {
    let resp: Response
    try {
      resp = await resilientFetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 10_000
      })
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        throw new Gw2Error('The GW2 API did not respond in time — try again in a moment.')
      }
      throw new Gw2Error('Could not reach the GW2 API — check your network connection.')
    }
    if (resp.status === 429) {
      throw new Gw2Error('GW2 API rate limit hit — wait a minute and try again.')
    }
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new Gw2Error(
        (data as { text?: string }).text ?? `GW2 API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  /**
   * Fetch any /v2 endpoint by relative path (with optional query string).
   * Rejects anything that could escape api.guildwars2.com/v2.
   */
  async apiGet(path: string): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) {
      throw new Gw2Error(`Invalid GW2 API path: ${path} — use a relative /v2 path like /items/1`)
    }
    return this.get(path)
  }

  async accountInfo(): Promise<AccountInfo> {
    const token = await this.get<{ permissions: string[] }>('/tokeninfo')
    const account = await this.get<{ name: string; guilds?: string[]; guild_leader?: string[] }>('/account')
    const leaderIds = new Set(account.guild_leader ?? [])
    // /guild/:id is public (name + tag); resolve in parallel and fall back to
    // the raw id if a lookup fails so account info never breaks on one guild.
    const guilds = await Promise.all(
      (account.guilds ?? []).map(async (id): Promise<GuildRef> => {
        try {
          const g = await this.get<{ name?: string; tag?: string }>(`/guild/${id}`)
          return { id, name: g.name ?? id, tag: g.tag ?? '', leader: leaderIds.has(id) }
        } catch {
          return { id, name: id, tag: '', leader: leaderIds.has(id) }
        }
      })
    )
    return {
      accountName: account.name,
      permissions: token.permissions,
      missingPermissions: REQUIRED_PERMISSIONS.filter((p) => !token.permissions.includes(p)),
      guilds
    }
  }

  /**
   * Resolve a guild name or id to a guild id.
   * GUIDs (matching /^[0-9a-f]{8}-/i) are returned as-is.
   * Otherwise, calls /guild/search?name=<encoded> and returns the first match.
   * Throws Gw2Error if no match is found.
   */
  async resolveGuildId(nameOrId: string): Promise<string> {
    if (/^[0-9a-f]{8}-/i.test(nameOrId)) return nameOrId
    const results = await this.get<string[]>(`/guild/search?name=${encodeURIComponent(nameOrId)}`)
    if (!Array.isArray(results) || results.length === 0) {
      throw new Gw2Error(
        `No guild found matching name "${nameOrId}" — check the spelling or pass the guild id directly (guild ids come from gw2_account_info).`
      )
    }
    return results[0]
  }

  guildMembers(guildId: string): Promise<GuildMember[]> {
    return this.get(`/guild/${guildId}/members`)
  }

  guildLog(guildId: string, sinceLogId?: number): Promise<GuildLogEntry[]> {
    const qs = sinceLogId !== undefined ? `?since=${sinceLogId}` : ''
    return this.get(`/guild/${guildId}/log${qs}`)
  }
}
