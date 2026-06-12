const BASE = 'https://api.guildwars2.com/v2'
const REQUIRED_PERMISSIONS = ['account', 'guilds'] as const

export class Gw2Error extends Error {}

export interface AccountInfo {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: string[]
  guildLeader: string[]
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
      resp = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      })
    } catch {
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
    return {
      accountName: account.name,
      permissions: token.permissions,
      missingPermissions: REQUIRED_PERMISSIONS.filter((p) => !token.permissions.includes(p)),
      guilds: account.guilds ?? [],
      guildLeader: account.guild_leader ?? []
    }
  }

  guildMembers(guildId: string): Promise<GuildMember[]> {
    return this.get(`/guild/${guildId}/members`)
  }

  guildLog(guildId: string, sinceLogId?: number): Promise<GuildLogEntry[]> {
    const qs = sinceLogId !== undefined ? `?since=${sinceLogId}` : ''
    return this.get(`/guild/${guildId}/log${qs}`)
  }
}
