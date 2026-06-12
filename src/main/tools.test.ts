import { describe, it, expect, vi } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, type ToolDeps } from './tools'

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
      putCompSchedule: vi.fn()
    } as never,
    gw2: {
      accountInfo: vi.fn().mockResolvedValue({ accountName: 'A.1', permissions: [], missingPermissions: [], guilds: [], guildLeader: [] }),
      guildMembers: vi.fn().mockResolvedValue([{ name: 'R.1', rank: 'Member', joined: null }]),
      guildLog: vi.fn().mockResolvedValue([])
    } as never,
    discordGuildId: () => 123,
    gw2GuildId: () => 'G-1'
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
    expect(deps.axitools.createBuild).toHaveBeenCalledWith(123, expect.objectContaining({ name: 'FB' }))
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
    deps.discordGuildId = () => 0
    const tools = buildOfficerTools(deps)
    const list = tools.find((t) => t.name === 'axitools_builds_list')!
    const result = await list.handler({}, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/guild.*not.*configured|configure.*guild/i)
  })
})
