import { describe, it, expect, vi } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS } from './index'
import type { ToolDeps } from './shared'
import { AxiforgeNotRunningError } from '../axiforgeClient'

function makeDeps(): ToolDeps {
  return {
    axitools: {} as never,
    gw2: {} as never,
    discordGuildId: () => '1',
    gw2GuildId: () => 'g1',
    axiforge: {
      listBuilds: vi.fn().mockResolvedValue([
        { id: 'b1', title: 'Heal FB', profession: 'Guardian', tags: ['wvw'], folderId: 'f1', updatedAt: '2026-06-01T00:00:00.000Z', skills: { heal: 1 } }
      ]),
      getBuild: vi.fn().mockResolvedValue({ id: 'b1', title: 'Heal FB', profession: 'Guardian' }),
      saveBuild: vi.fn().mockResolvedValue({ id: 'b1', title: 'Renamed' }),
      deleteBuild: vi.fn().mockResolvedValue(undefined),
      publishBuild: vi.fn().mockResolvedValue({ url: 'https://axiforge.app/b/heal-fb' }),
      listComps: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Zerg', folderId: null, updatedAt: '2026-06-02T00:00:00.000Z' }]),
      getComp: vi.fn().mockResolvedValue({ id: 'c1', name: 'Zerg' }),
      saveComp: vi.fn().mockResolvedValue({ id: 'c1', name: 'Zerg v2' }),
      deleteComp: vi.fn().mockResolvedValue(undefined),
      publishComp: vi.fn().mockResolvedValue({ url: 'https://axiforge.app/c/zerg' }),
      listFolders: vi.fn().mockResolvedValue([{ id: 'f1', name: 'WvW' }]),
      importChatLink: vi.fn().mockResolvedValue({ id: 'b9', title: 'Imported' }),
      importGw2skills: vi.fn().mockResolvedValue({ id: 'b10', title: 'Imported 2' }),
      catalogProfessions: vi.fn().mockResolvedValue([{ id: 'Guardian' }]),
      catalogProfession: vi.fn().mockResolvedValue({ id: 'Guardian', specializations: [] }),
      catalogUpgrades: vi.fn().mockResolvedValue([{ id: 24836 }])
    } as never,
    axiforgeLauncher: { ensureRunning: vi.fn().mockResolvedValue(undefined) }
  }
}

function find(deps: ToolDeps, name: string) {
  return buildOfficerTools(deps).find((t) => t.name === name)!
}

describe('axiforge tools', () => {
  it('registers all 13 axiforge tools', () => {
    const names = buildOfficerTools(makeDeps()).map((t) => t.name)
    for (const n of [
      'axiforge_builds_list',
      'axiforge_builds_get',
      'axiforge_builds_save',
      'axiforge_builds_delete',
      'axiforge_comps_list',
      'axiforge_comps_get',
      'axiforge_comps_save',
      'axiforge_comps_delete',
      'axiforge_build_publish',
      'axiforge_comp_publish',
      'axiforge_import_chat_link',
      'axiforge_import_gw2skills',
      'axiforge_catalog'
    ]) {
      expect(names).toContain(n)
    }
  })

  it('marks deletes and publishes destructive', () => {
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_builds_delete')
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_comps_delete')
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_build_publish')
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_comp_publish')
  })

  it('builds_list is compact: id/title/profession/tags/folder/updatedAt only', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_builds_list').handler({}, {})
    const text = (result.content[0] as { text: string }).text
    expect(JSON.parse(text)).toEqual([
      { id: 'b1', title: 'Heal FB', profession: 'Guardian', tags: ['wvw'], folder: 'WvW', updatedAt: '2026-06-01T00:00:00.000Z' }
    ])
    expect(text).not.toContain('skills')
  })

  it('builds_get returns the full build', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_builds_get').handler({ build_id: 'b1' }, {})
    expect(deps.axiforge.getBuild).toHaveBeenCalledWith('b1')
    expect((result.content[0] as { text: string }).text).toContain('Heal FB')
  })

  it('builds_save passes the full build object through', async () => {
    const deps = makeDeps()
    await find(deps, 'axiforge_builds_save').handler({ build: { id: 'b1', title: 'Renamed' } }, {})
    expect(deps.axiforge.saveBuild).toHaveBeenCalledWith({ id: 'b1', title: 'Renamed' })
  })

  it('auto-spawns headless AxiForge and retries once when a write hits a closed app', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.saveBuild as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AxiforgeNotRunningError())
      .mockResolvedValueOnce({ id: 'b1', title: 'Renamed' })
    const result = await find(deps, 'axiforge_builds_save').handler({ build: { id: 'b1', title: 'Renamed' } }, {})
    expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
    expect(deps.axiforge.saveBuild).toHaveBeenCalledTimes(2)
    expect(result.isError).toBeUndefined()
  })

  it('returns a friendly error string (never throws) when spawn fails', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.deleteBuild as ReturnType<typeof vi.fn>).mockRejectedValue(new AxiforgeNotRunningError())
    ;(deps.axiforgeLauncher.ensureRunning as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('AxiForge does not appear to be installed on this machine — install it via AxiOM, or open it once so AxiVale can find it.')
    )
    const result = await find(deps, 'axiforge_builds_delete').handler({ build_id: 'b1' }, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/install/i)
  })

  it('publishes return the share URL', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_build_publish').handler({ build_id: 'b1' }, {})
    expect((result.content[0] as { text: string }).text).toContain('https://axiforge.app/b/heal-fb')
  })

  it('imports are writes: chat-link import auto-spawns too', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.importChatLink as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AxiforgeNotRunningError())
      .mockResolvedValueOnce({ id: 'b9' })
    await find(deps, 'axiforge_import_chat_link').handler({ chat_code: '[&DQE...]' }, {})
    expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
  })

  it('catalog routes kinds to the right client methods', async () => {
    const deps = makeDeps()
    const catalog = find(deps, 'axiforge_catalog')
    await catalog.handler({ kind: 'professions' }, {})
    expect(deps.axiforge.catalogProfessions).toHaveBeenCalled()
    await catalog.handler({ kind: 'profession', profession_id: 'Guardian', game_mode: 'wvw' }, {})
    expect(deps.axiforge.catalogProfession).toHaveBeenCalledWith('Guardian', 'wvw')
    await catalog.handler({ kind: 'upgrades' }, {})
    expect(deps.axiforge.catalogUpgrades).toHaveBeenCalled()
    const bad = await catalog.handler({ kind: 'profession' }, {})
    expect(bad.isError).toBe(true)
  })
})
