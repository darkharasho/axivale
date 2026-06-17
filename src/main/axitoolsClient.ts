export class AxitoolsError extends Error {}

export interface DiscordGuild { id: string; name: string }
export interface Build {
  build_id: string
  name: string
  profession: string
  specialization?: string | null
  url?: string | null
  chat_code: string
  description?: string | null
}
export interface CompPreset { name: string; config: Record<string, unknown> }
export interface CompSchedule {
  schedule_id: string
  name: string
  preset_name?: string | null
  post_days?: number[]
  post_time?: string | null
  timezone?: string
  [key: string]: unknown
}

export class AxitoolsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let resp: Response
    try {
      resp = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Without a deadline an unreachable/hung host wedges the status check.
        signal: AbortSignal.timeout(8000)
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new AxitoolsError('The AxiTools bot did not respond in time — is it running?')
      }
      throw new AxitoolsError(
        'The AxiTools bot is not reachable — is it running on this machine?'
      )
    }
    if (resp.status === 204) return undefined as T
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      // A rejected key is distinct from a generic API fault — say so plainly.
      if (resp.status === 401 || resp.status === 403) {
        throw new AxitoolsError(
          (data as { error?: string }).error ??
            'This AxiVale key was rejected (invalid or revoked). Regenerate it in Discord with /config apikey generate.'
        )
      }
      throw new AxitoolsError(
        (data as { error?: string }).error ?? `AxiTools API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  listGuilds(): Promise<DiscordGuild[]> {
    return this.request('GET', '/guilds')
  }

  listBuilds(guildId: string): Promise<Build[]> {
    return this.request('GET', `/guilds/${guildId}/builds`)
  }

  createBuild(guildId: string, build: Omit<Build, 'build_id'>): Promise<Build> {
    return this.request('POST', `/guilds/${guildId}/builds`, build)
  }

  updateBuild(guildId: string, buildId: string, patch: Partial<Build>): Promise<Build> {
    return this.request('PUT', `/guilds/${guildId}/builds/${buildId}`, patch)
  }

  deleteBuild(guildId: string, buildId: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/builds/${buildId}`)
  }

  listCompPresets(guildId: string): Promise<CompPreset[]> {
    return this.request('GET', `/guilds/${guildId}/comp-presets`)
  }

  putCompPreset(guildId: string, preset: CompPreset): Promise<CompPreset> {
    return this.request(
      'PUT',
      `/guilds/${guildId}/comp-presets/${encodeURIComponent(preset.name)}`,
      preset
    )
  }

  deleteCompPreset(guildId: string, name: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/comp-presets/${encodeURIComponent(name)}`)
  }

  discordOverview(guildId: string, includeMembers = false): Promise<unknown> {
    const qs = includeMembers ? '?include=members' : ''
    return this.request('GET', `/guilds/${guildId}/discord${qs}`)
  }

  discordMessages(
    guildId: string,
    opts: {
      channelId?: string
      threadId?: string
      limit?: number
      before?: string
      after?: string
    }
  ): Promise<unknown> {
    const qs = new URLSearchParams()
    if (opts.channelId) qs.set('channel_id', opts.channelId)
    if (opts.threadId) qs.set('thread_id', opts.threadId)
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit))
    if (opts.before) qs.set('before', opts.before)
    if (opts.after) qs.set('after', opts.after)
    return this.request('GET', `/guilds/${guildId}/discord/messages?${qs}`)
  }

  discordAction(
    guildId: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    return this.request('POST', `/guilds/${guildId}/discord/actions`, { action, params })
  }

  private getWithQuery(path: string, filters: Record<string, unknown>): Promise<unknown> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    }
    const suffix = qs.size > 0 ? `?${qs}` : ''
    return this.request('GET', `${path}${suffix}`)
  }

  auditDiscord(guildId: string, filters: Record<string, unknown> = {}): Promise<unknown> {
    return this.getWithQuery(`/guilds/${guildId}/audit/discord`, filters)
  }

  auditGw2(guildId: string, filters: Record<string, unknown> = {}): Promise<unknown> {
    return this.getWithQuery(`/guilds/${guildId}/audit/gw2`, filters)
  }

  rssList(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/rss`)
  }

  rssSet(guildId: string, name: string, body: { url: string; channel_id: string }): Promise<unknown> {
    return this.request('PUT', `/guilds/${guildId}/rss/${encodeURIComponent(name)}`, body)
  }

  rssDelete(guildId: string, name: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/rss/${encodeURIComponent(name)}`)
  }

  streamsList(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/streams`)
  }

  streamSet(guildId: string, name: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('PUT', `/guilds/${guildId}/streams/${encodeURIComponent(name)}`, body)
  }

  streamDelete(guildId: string, name: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/streams/${encodeURIComponent(name)}`)
  }

  allianceGet(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/alliance`)
  }

  allianceSet(guildId: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.request('PUT', `/guilds/${guildId}/alliance`, patch)
  }

  guildRolesGet(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/guild-roles`)
  }

  guildRoleSet(guildId: string, gw2GuildId: string, roleId: string): Promise<unknown> {
    return this.request('PUT', `/guilds/${guildId}/guild-roles/${encodeURIComponent(gw2GuildId)}`, {
      role_id: roleId
    })
  }

  guildRoleDelete(guildId: string, gw2GuildId: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/guild-roles/${encodeURIComponent(gw2GuildId)}`)
  }

  guildRolesAllowlist(guildId: string, roleIds: string[]): Promise<unknown> {
    return this.request('PUT', `/guilds/${guildId}/guild-roles-allowlist`, { role_ids: roleIds })
  }

  configGet(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/config`)
  }

  configPatch(guildId: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.request('PATCH', `/guilds/${guildId}/config`, patch)
  }

  membersLinked(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/members-linked`)
  }

  keyHolders(guildId: string, accountNames: string[]): Promise<unknown> {
    return this.request('POST', `/guilds/${guildId}/key-holders`, { account_names: accountNames })
  }

  listCompSchedules(guildId: string): Promise<CompSchedule[]> {
    return this.request('GET', `/guilds/${guildId}/comp-schedules`)
  }

  compConfigGet(guildId: string): Promise<unknown> {
    return this.request('GET', `/guilds/${guildId}/comp-config`)
  }

  compConfigPatch(guildId: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.request('PATCH', `/guilds/${guildId}/comp-config`, patch)
  }

  deleteCompSchedule(guildId: string, scheduleId: string): Promise<void> {
    return this.request(
      'DELETE',
      `/guilds/${guildId}/comp-schedules/${encodeURIComponent(scheduleId)}`
    )
  }

  putCompSchedule(guildId: string, schedule: CompSchedule): Promise<CompSchedule> {
    return this.request(
      'PUT',
      `/guilds/${guildId}/comp-schedules/${encodeURIComponent(schedule.schedule_id)}`,
      schedule
    )
  }
}
