import { describe, it, expect, vi } from 'vitest'
import {
  buildOfficerTools,
  DESTRUCTIVE_TOOLS,
  DESTRUCTIVE_DISCORD_ACTIONS,
  type ToolDeps
} from './tools'

function makeDeps(): ToolDeps {
  return {
    axitools: {
      listGuilds: vi.fn().mockResolvedValue([{ id: 123, name: 'Vigil Keep' }]),
      listBuilds: vi.fn().mockResolvedValue([]),
      createBuild: vi.fn().mockResolvedValue({ build_id: 'b1', name: 'FB' }),
      updateBuild: vi.fn(),
      deleteBuild: vi.fn().mockResolvedValue(undefined),
      listCompPresets: vi.fn().mockResolvedValue([]),
      putCompPreset: vi.fn(),
      deleteCompPreset: vi.fn(),
      listCompSchedules: vi.fn().mockResolvedValue([]),
      putCompSchedule: vi.fn(),
      discordOverview: vi.fn().mockResolvedValue({ guild: { id: 123, name: 'Vigil Keep' } }),
      discordMessages: vi.fn().mockResolvedValue([]),
      discordAction: vi.fn().mockResolvedValue({ ok: true, result: { id: '9' } }),
      auditDiscord: vi.fn().mockResolvedValue([]),
      auditGw2: vi.fn().mockResolvedValue([]),
      rssList: vi.fn().mockResolvedValue([]),
      rssSet: vi.fn().mockResolvedValue({ name: 'news' }),
      rssDelete: vi.fn().mockResolvedValue(undefined),
      streamsList: vi.fn().mockResolvedValue([]),
      streamSet: vi.fn().mockResolvedValue({ name: 'tv' }),
      streamDelete: vi.fn().mockResolvedValue(undefined),
      allianceGet: vi.fn().mockResolvedValue({ relink_enabled: false }),
      allianceSet: vi.fn().mockResolvedValue({ relink_enabled: true }),
      guildRolesGet: vi.fn().mockResolvedValue({ mappings: [], allowlist: [] }),
      guildRoleSet: vi.fn().mockResolvedValue({}),
      guildRoleDelete: vi.fn().mockResolvedValue(undefined),
      guildRolesAllowlist: vi.fn().mockResolvedValue({}),
      configGet: vi.fn().mockResolvedValue({}),
      configPatch: vi.fn().mockResolvedValue({}),
      membersLinked: vi.fn().mockResolvedValue([]),
      keyHolders: vi.fn().mockResolvedValue({ holders: { 'A.1': true }, matched: 1 })
    } as never,
    gw2: {
      accountInfo: vi.fn().mockResolvedValue({ accountName: 'A.1', permissions: [], missingPermissions: [], guilds: [] }),
      guildMembers: vi.fn().mockResolvedValue([{ name: 'R.1', rank: 'Member', joined: null }]),
      guildLog: vi.fn().mockResolvedValue([]),
      apiGet: vi.fn().mockResolvedValue({ id: 1, name: 'Zojja' }),
      resolveGuildId: vi.fn().mockImplementation(async (nameOrId: string) => {
        // Simulate GUID passthrough and name→id resolution
        if (/^[0-9a-f]{8}-/i.test(nameOrId)) return nameOrId
        if (nameOrId === 'Defiance') return 'G-DEFI'
        throw new Error(`No guild found matching name "${nameOrId}"`)
      })
    } as never,
    discordGuildId: () => '123',
    gw2GuildId: () => 'G-1',
    axiforge: {} as never,
    axiforgeLauncher: { ensureRunning: async () => {} },
    axibridge: () => ({}) as never,
    loadSkill: () => null,
    rosterAnnotations: () => [],
    rosterLinks: () => [],
    metaIndex: () => ({}) as never,
    wikiIndex: () => ({}) as never,
    generalIndex: () => ({}) as never,
    wikiFacts: { lookup: async () => ({ name: '', found: false, hasSplit: false, pve: [], wvw: [], pvp: [], recharge: { pve: null, wvw: null, pvp: null }, activation: { pve: null, wvw: null, pvp: null } }) },
    fetchBuildPage: async () => null,
    fetchBuildPageRaw: async () => null,
    memory: () => ({}) as never,
    resolveEntityKey: async () => null
  }
}

describe('officer tools', () => {
  it('exposes the expected tool names', () => {
    const tools = buildOfficerTools(makeDeps())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'axitools_builds_list',
        'axitools_builds_create',
        'axitools_builds_update',
        'axitools_builds_delete',
        'axitools_comp_presets_list',
        'axitools_comp_presets_save',
        'axitools_comp_presets_delete',
        'axitools_comp_schedules_list',
        'axitools_comp_schedules_save',
        'gw2_account_info',
        'gw2_guild_members',
        'gw2_guild_log'
      ])
    )
  })

  it('marks deletes destructive', () => {
    expect(DESTRUCTIVE_TOOLS).toContain('axitools_builds_delete')
    expect(DESTRUCTIVE_TOOLS).toContain('axitools_comp_presets_delete')
  })

  it('builds_create calls the client with the active guild', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const create = tools.find((t) => t.name === 'axitools_builds_create')!
    const result = await create.handler(
      { name: 'FB', profession: 'Guardian', chat_code: '[&x]' },
      {}
    )
    expect(deps.axitools.createBuild).toHaveBeenCalledWith('123', expect.objectContaining({ name: 'FB' }))
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toContain('b1')
  })

  it('gw2_guild_members uses the configured GW2 guild', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({}, {})
    expect(deps.gw2.guildMembers).toHaveBeenCalledWith('G-1')
    expect((result.content[0] as { text: string }).text).toContain('R.1')
  })

  it('discord_overview fetches the snapshot, with members on request', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const overview = tools.find((t) => t.name === 'discord_overview')!
    await overview.handler({}, {})
    expect(deps.axitools.discordOverview).toHaveBeenCalledWith('123', false)
    await overview.handler({ include_members: true }, {})
    expect(deps.axitools.discordOverview).toHaveBeenCalledWith('123', true)
  })

  it('discord_messages forwards channel/thread/limit/before/after', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const messages = tools.find((t) => t.name === 'discord_messages')!
    await messages.handler({ channel_id: '555', limit: 50 }, {})
    expect(deps.axitools.discordMessages).toHaveBeenCalledWith('123', {
      channelId: '555',
      threadId: undefined,
      limit: 50,
      before: undefined,
      after: undefined
    })
    await messages.handler({ thread_id: '777', before: '101' }, {})
    expect(deps.axitools.discordMessages).toHaveBeenCalledWith('123', {
      channelId: undefined,
      threadId: '777',
      limit: undefined,
      before: '101',
      after: undefined
    })
  })

  it('discord_action forwards action and params', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const action = tools.find((t) => t.name === 'discord_action')!
    const result = await action.handler(
      { action: 'message_send', params: { channel_id: '555', content: 'hi' } },
      {}
    )
    expect(deps.axitools.discordAction).toHaveBeenCalledWith('123', 'message_send', {
      channel_id: '555',
      content: 'hi'
    })
    expect(result.isError).toBeUndefined()
  })

  it('axitools_audit queries either source', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const audit = tools.find((t) => t.name === 'axitools_audit')!
    await audit.handler({ source: 'discord', event_type: 'member_join', limit: 10 }, {})
    expect(deps.axitools.auditDiscord).toHaveBeenCalledWith('123', {
      event_type: 'member_join',
      limit: 10
    })
    await audit.handler({ source: 'gw2', user: 'R.1' }, {})
    expect(deps.axitools.auditGw2).toHaveBeenCalledWith('123', { user: 'R.1' })
  })

  it('axitools_rss routes actions', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const rss = tools.find((t) => t.name === 'axitools_rss')!
    await rss.handler({ action: 'list' }, {})
    expect(deps.axitools.rssList).toHaveBeenCalledWith('123')
    await rss.handler({ action: 'set', name: 'news', url: 'https://x', channel_id: '5' }, {})
    expect(deps.axitools.rssSet).toHaveBeenCalledWith('123', 'news', {
      url: 'https://x',
      channel_id: '5'
    })
    await rss.handler({ action: 'delete', name: 'news' }, {})
    expect(deps.axitools.rssDelete).toHaveBeenCalledWith('123', 'news')
  })

  it('axitools_streams set requires platform fields', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const streams = tools.find((t) => t.name === 'axitools_streams')!
    const bad = await streams.handler({ action: 'set', name: 'tv' }, {})
    expect(bad.isError).toBe(true)
    await streams.handler(
      { action: 'set', name: 'tv', platform: 'twitch', channel_ref: 'mox', discord_channel_id: '5' },
      {}
    )
    expect(deps.axitools.streamSet).toHaveBeenCalled()
  })

  it('axitools_members returns derived data', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'axitools_members')!
    await members.handler({}, {})
    expect(deps.axitools.membersLinked).toHaveBeenCalledWith('123')
  })

  it('axitools_members is compact by default and expands on request', async () => {
    const deps = makeDeps()
    ;(deps.axitools.membersLinked as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        member_id: '7',
        member_name: 'harasho',
        accounts: [
          {
            account_name: 'harasho.4281',
            characters: ['Axi', 'Vale'],
            gw2_guild_ids: ['G1'],
            guild_labels: { G1: 'EWW' }
          }
        ],
        preferred_role_id: '9'
      }
    ])
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'axitools_members')!

    const compact = await members.handler({}, {})
    const compactText = (compact.content[0] as { text: string }).text
    expect(compactText).toContain('harasho.4281')
    expect(compactText).not.toContain('characters')
    expect(compactText).not.toContain('EWW')

    const full = await members.handler({ include_characters: true, include_guilds: true }, {})
    const fullText = (full.content[0] as { text: string }).text
    expect(fullText).toContain('Axi')
    expect(fullText).toContain('EWW')
  })

  it('tool results are compact JSON, not pretty-printed', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const create = tools.find((t) => t.name === 'axitools_builds_create')!
    const result = await create.handler({ name: 'FB', profession: 'G', chat_code: '[&x]' }, {})
    expect((result.content[0] as { text: string }).text).not.toMatch(/\n {2}/)
  })

  it('axitools_key_holders checks account names', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const kh = tools.find((t) => t.name === 'axitools_key_holders')!
    const result = await kh.handler({ account_names: ['A.1', 'B.2'] }, {})
    expect(deps.axitools.keyHolders).toHaveBeenCalledWith('123', ['A.1', 'B.2'])
    expect(result.isError).toBeUndefined()
  })

  it('action-gated tools mark their destructive verbs', async () => {
    const { ACTION_GATED_TOOLS } = await import('./tools')
    expect(ACTION_GATED_TOOLS.axitools_rss).toEqual(['delete'])
    expect(ACTION_GATED_TOOLS.axitools_streams).toEqual(['delete'])
    expect(ACTION_GATED_TOOLS.axitools_guild_roles).toEqual(['delete'])
    expect(ACTION_GATED_TOOLS.discord_action).toContain('member_ban')
  })

  it('lists the destructive discord actions', () => {
    expect(DESTRUCTIVE_DISCORD_ACTIONS).toEqual([
      'channel_delete',
      'role_update',
      'role_delete',
      'member_timeout',
      'member_kick',
      'member_ban',
      'member_dm',
      'members_dm'
    ])
  })

  it('gw2_guild_members accepts an explicit guild_id, bypassing the configured guild', async () => {
    const deps = makeDeps()
    deps.gw2GuildId = () => '' // nothing configured
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({ guild_id: 'G-EWW' }, {})
    expect(deps.gw2.guildMembers).toHaveBeenCalledWith('G-EWW')
    expect(result.isError).toBeUndefined()
  })

  it('gw2_guild_log accepts an explicit guild_id', async () => {
    const deps = makeDeps()
    deps.gw2GuildId = () => ''
    const tools = buildOfficerTools(deps)
    const log = tools.find((t) => t.name === 'gw2_guild_log')!
    const result = await log.handler({ guild_id: 'G-EWW' }, {})
    expect(deps.gw2.guildLog).toHaveBeenCalledWith('G-EWW', undefined)
    expect(result.isError).toBeUndefined()
  })

  it('gw2 guild tools error helpfully when no guild given and none configured', async () => {
    const deps = makeDeps()
    deps.gw2GuildId = () => ''
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({}, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/guild/)
    expect((result.content[0] as { text: string }).text).toMatch(/gw2_account_info/)
  })

  it('gw2_guild_members resolves a guild name to an id via resolveGuildId', async () => {
    const deps = makeDeps()
    deps.gw2GuildId = () => '' // no default configured
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({ guild: 'Defiance' }, {})
    expect(deps.gw2.resolveGuildId).toHaveBeenCalledWith('Defiance')
    expect(deps.gw2.guildMembers).toHaveBeenCalledWith('G-DEFI')
    expect(result.isError).toBeUndefined()
  })

  it('gw2_guild_log resolves a guild name to an id', async () => {
    const deps = makeDeps()
    deps.gw2GuildId = () => ''
    const tools = buildOfficerTools(deps)
    const log = tools.find((t) => t.name === 'gw2_guild_log')!
    const result = await log.handler({ guild: 'Defiance' }, {})
    expect(deps.gw2.resolveGuildId).toHaveBeenCalledWith('Defiance')
    expect(deps.gw2.guildLog).toHaveBeenCalledWith('G-DEFI', undefined)
    expect(result.isError).toBeUndefined()
  })

  it('gw2_guild_members passes a GUID through resolveGuildId without a search call', async () => {
    const deps = makeDeps()
    deps.gw2GuildId = () => ''
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const guid = '23b352fb-1111-2222-3333-444444444444'
    const result = await members.handler({ guild: guid }, {})
    expect(deps.gw2.resolveGuildId).toHaveBeenCalledWith(guid)
    expect(deps.gw2.guildMembers).toHaveBeenCalledWith(guid)
    expect(result.isError).toBeUndefined()
  })

  it('gw2_api queries an arbitrary endpoint', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const api = tools.find((t) => t.name === 'gw2_api')!
    const result = await api.handler({ path: '/items/1' }, {})
    expect(deps.gw2.apiGet).toHaveBeenCalledWith('/items/1')
    expect((result.content[0] as { text: string }).text).toContain('Zojja')
  })

  it('gw2_api truncates oversized responses', async () => {
    const deps = makeDeps()
    ;(deps.gw2.apiGet as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `Item number ${i}` }))
    )
    const tools = buildOfficerTools(deps)
    const api = tools.find((t) => t.name === 'gw2_api')!
    const result = await api.handler({ path: '/items?ids=all' }, {})
    const text = (result.content[0] as { text: string }).text
    expect(text.length).toBeLessThan(31000)
    expect(text).toContain('truncated')
  })

  it('tool errors come back as is_error text, not exceptions', async () => {
    const deps = makeDeps()
    ;(deps.gw2.guildMembers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({}, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('boom')
  })

  it('errors when no guild is configured', async () => {
    const deps = makeDeps()
    deps.discordGuildId = () => ''
    const tools = buildOfficerTools(deps)
    const list = tools.find((t) => t.name === 'axitools_builds_list')!
    const result = await list.handler({}, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/guild not connected.*AxiVale key/i)
  })
})
