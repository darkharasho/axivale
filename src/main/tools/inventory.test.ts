import { describe, it, expect } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS, type ToolDeps } from './index'

const deps: ToolDeps = {
  axitools: {} as never,
  gw2: {} as never,
  discordGuildId: () => '1',
  gw2GuildId: () => 'g1'
}

describe('tools module split', () => {
  it('exposes exactly the pre-split tool inventory', () => {
    const names = buildOfficerTools(deps)
      .map((t) => t.name)
      .sort()
    expect(names).toEqual([
      'axitools_alliance',
      'axitools_audit',
      'axitools_builds_create',
      'axitools_builds_delete',
      'axitools_builds_list',
      'axitools_builds_update',
      'axitools_comp_presets_delete',
      'axitools_comp_presets_list',
      'axitools_comp_presets_save',
      'axitools_comp_schedules_list',
      'axitools_comp_schedules_save',
      'axitools_config',
      'axitools_guild_roles',
      'axitools_key_holders',
      'axitools_members',
      'axitools_rss',
      'axitools_streams',
      'discord_action',
      'discord_messages',
      'discord_overview',
      'gw2_account_info',
      'gw2_api',
      'gw2_guild_log',
      'gw2_guild_members'
    ])
  })

  it('keeps the destructive lists intact', () => {
    expect(DESTRUCTIVE_TOOLS).toEqual(['axitools_builds_delete', 'axitools_comp_presets_delete'])
    expect(ACTION_GATED_TOOLS).toEqual({
      discord_action: [
        'channel_delete',
        'role_update',
        'role_delete',
        'member_timeout',
        'member_kick',
        'member_ban',
        'member_dm',
        'members_dm'
      ],
      axitools_rss: ['delete'],
      axitools_streams: ['delete'],
      axitools_guild_roles: ['delete']
    })
  })
})
