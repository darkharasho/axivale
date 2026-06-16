import { describe, it, expect } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS, type ToolDeps } from './index'

const deps: ToolDeps = {
  axitools: {} as never,
  gw2: {} as never,
  discordGuildId: () => '1',
  gw2GuildId: () => 'g1',
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
  fetchBuildPageRaw: async () => null
}

describe('tools module split', () => {
  it('exposes exactly the expected tool inventory', () => {
    const names = buildOfficerTools(deps)
      .map((t) => t.name)
      .sort()
    expect(names).toEqual([
      'axibridge_attendance',
      'axibridge_commander_stats',
      'axibridge_compare',
      'axibridge_player_stats',
      'axibridge_query',
      'axibridge_render_chart',
      'axibridge_repos_status',
      'axibridge_run_summary',
      'axibridge_runs_list',
      'axiforge_build_chat_link',
      'axiforge_build_publish',
      'axiforge_builds_delete',
      'axiforge_builds_get',
      'axiforge_builds_list',
      'axiforge_builds_save',
      'axiforge_catalog',
      'axiforge_comp_publish',
      'axiforge_comps_delete',
      'axiforge_comps_get',
      'axiforge_comps_list',
      'axiforge_comps_save',
      'axiforge_import_chat_link',
      'axiforge_import_gw2skills',
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
      'comp_check',
      'comp_sketch',
      'discord_action',
      'discord_messages',
      'discord_overview',
      'discord_search',
      'gw2_account_info',
      'gw2_api',
      'gw2_build_card',
      'gw2_build_from_url',
      'gw2_guild_log',
      'gw2_guild_members',
      'gw2_wiki_facts',
      'gw2_wiki_search',
      'gw2skills_parse',
      'load_skill',
      'meta_search',
      'resolve_identity'
    ])
  })

  it('keeps the destructive lists intact', () => {
    expect(DESTRUCTIVE_TOOLS).toEqual([
      'axitools_builds_delete',
      'axitools_comp_presets_delete',
      'axiforge_builds_delete',
      'axiforge_comps_delete',
      'axiforge_build_publish',
      'axiforge_comp_publish'
    ])
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
