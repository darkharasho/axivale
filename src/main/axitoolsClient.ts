export class AxitoolsError extends Error {}

export interface DiscordGuild { id: number; name: string }
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
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      throw new AxitoolsError(
        'The AxiTools bot is not reachable — is it running on this machine?'
      )
    }
    if (resp.status === 204) return undefined as T
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new AxitoolsError(
        (data as { error?: string }).error ?? `AxiTools API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  listGuilds(): Promise<DiscordGuild[]> {
    return this.request('GET', '/guilds')
  }

  listBuilds(guildId: number): Promise<Build[]> {
    return this.request('GET', `/guilds/${guildId}/builds`)
  }

  createBuild(guildId: number, build: Omit<Build, 'build_id'>): Promise<Build> {
    return this.request('POST', `/guilds/${guildId}/builds`, build)
  }

  updateBuild(guildId: number, buildId: string, patch: Partial<Build>): Promise<Build> {
    return this.request('PUT', `/guilds/${guildId}/builds/${buildId}`, patch)
  }

  deleteBuild(guildId: number, buildId: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/builds/${buildId}`)
  }

  listCompPresets(guildId: number): Promise<CompPreset[]> {
    return this.request('GET', `/guilds/${guildId}/comp-presets`)
  }

  putCompPreset(guildId: number, preset: CompPreset): Promise<CompPreset> {
    return this.request(
      'PUT',
      `/guilds/${guildId}/comp-presets/${encodeURIComponent(preset.name)}`,
      preset
    )
  }

  deleteCompPreset(guildId: number, name: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/comp-presets/${encodeURIComponent(name)}`)
  }

  listCompSchedules(guildId: number): Promise<CompSchedule[]> {
    return this.request('GET', `/guilds/${guildId}/comp-schedules`)
  }

  putCompSchedule(guildId: number, schedule: CompSchedule): Promise<CompSchedule> {
    return this.request(
      'PUT',
      `/guilds/${guildId}/comp-schedules/${encodeURIComponent(schedule.schedule_id)}`,
      schedule
    )
  }
}
