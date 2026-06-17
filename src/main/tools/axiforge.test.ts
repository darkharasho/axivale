import { describe, it, expect, vi } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS } from './index'
import type { ToolDeps } from './shared'
import { AxiforgeError, AxiforgeNotRunningError } from '../axiforgeClient'

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
      getBuild: vi.fn().mockResolvedValue({ id: 'b1', title: 'Heal FB', profession: 'Guardian', images: { icon: 'data:image/png;base64,abc123' } }),
      saveBuild: vi.fn().mockResolvedValue({ id: 'b1', title: 'Renamed', updatedAt: '2026-06-10T00:00:00.000Z' }),
      deleteBuild: vi.fn().mockResolvedValue(undefined),
      publishBuild: vi.fn().mockResolvedValue({ url: 'https://axiforge.app/b/heal-fb' }),
      listComps: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Zerg', folderId: null, updatedAt: '2026-06-02T00:00:00.000Z' }]),
      getComp: vi.fn().mockResolvedValue({ id: 'c1', name: 'Zerg' }),
      saveComp: vi.fn().mockResolvedValue({ id: 'c1', name: 'Zerg v2', updatedAt: '2026-06-10T00:00:00.000Z' }),
      deleteComp: vi.fn().mockResolvedValue(undefined),
      publishComp: vi.fn().mockResolvedValue({ url: 'https://axiforge.app/c/zerg' }),
      listFolders: vi.fn().mockResolvedValue([{ id: 'f1', name: 'WvW' }]),
      importChatLink: vi.fn().mockResolvedValue({ id: 'b9', title: 'Imported' }),
      importGw2skills: vi.fn().mockResolvedValue({ id: 'b10', title: 'Imported 2' }),
      catalogProfessions: vi.fn().mockResolvedValue([{ id: 'Guardian' }]),
      catalogProfession: vi.fn().mockResolvedValue({ id: 'Guardian', specializations: [] }),
      catalogUpgrades: vi.fn().mockResolvedValue([{ id: 24836 }]),
      buildChatLink: vi.fn().mockResolvedValue({ chatLink: '[&DQEK...]' }),
      parseGw2Skills: vi.fn().mockResolvedValue({
        title: 'Parsed Build',
        profession: 'Guardian',
        gameMode: 'wvw',
        equipment: {},
        images: { icon: 'data:image/png;base64,abc123' }
      }),
      parseChatLink: vi.fn().mockResolvedValue({
        title: 'Heal FB',
        profession: 'Guardian',
        gameMode: 'wvw',
        equipment: {},
        images: { icon: 'data:image/png;base64,abc123' }
      })
    } as never,
    axiforgeLauncher: { ensureRunning: vi.fn().mockResolvedValue(undefined) },
    axibridge: () => ({}) as never,
    loadSkill: () => null,
    rosterAnnotations: () => [],
    rosterLinks: () => [],
    metaIndex: () => ({}) as never,
    wikiIndex: () => ({}) as never,
    generalIndex: () => ({}) as never,
    wikiFacts: { lookup: async () => ({ name: '', found: false, hasSplit: false, pve: [], wvw: [], pvp: [], recharge: { pve: null, wvw: null, pvp: null }, activation: { pve: null, wvw: null, pvp: null } }) },
    fetchBuildPage: vi.fn().mockResolvedValue(null),
    fetchBuildPageRaw: vi.fn().mockResolvedValue(null),
    memory: () => ({}) as never,
    resolveEntityKey: async () => null
  }
}

function find(deps: ToolDeps, name: string) {
  return buildOfficerTools(deps).find((t) => t.name === name)!
}

describe('axiforge tools', () => {
  it('registers all 16 axiforge tools', () => {
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
      'gw2skills_parse',
      'gw2_build_card',
      'axiforge_build_chat_link',
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

  it('builds_get returns the build with images stripped', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_builds_get').handler({ build_id: 'b1' }, {})
    expect(deps.axiforge.getBuild).toHaveBeenCalledWith('b1')
    const parsed = JSON.parse((result.content[0] as { text: string }).text)
    expect(parsed.title).toBe('Heal FB')
    expect(parsed.images).toBeUndefined()
    expect(parsed.imageKeys).toEqual(['icon'])
    expect((result.content[0] as { text: string }).text).not.toContain('data:image/')
  })

  it('builds_save passes the full build object through (legacy: no id)', async () => {
    const deps = makeDeps()
    await find(deps, 'axiforge_builds_save').handler({ build: { title: 'New Build' } }, {})
    expect(deps.axiforge.saveBuild).toHaveBeenCalledWith({ title: 'New Build' })
  })

  it('auto-spawns headless AxiForge and retries once when a write hits a closed app', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.saveBuild as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AxiforgeNotRunningError())
      .mockResolvedValueOnce({ id: 'b1', title: 'Renamed', updatedAt: '2026-06-10T00:00:00.000Z' })
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

  // Pinning tests

  it('builds_get strips image base64 and lists image keys', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.getBuild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'b1',
      title: 'Heal FB',
      profession: 'Guardian',
      images: { icon: 'data:image/png;base64,LONGBASE64DATA', banner: 'data:image/jpeg;base64,MOREBIGDATA' }
    })
    const result = await find(deps, 'axiforge_builds_get').handler({ build_id: 'b1' }, {})
    const text = (result.content[0] as { text: string }).text
    expect(text).not.toContain('data:image/')
    expect(text).not.toContain('LONGBASE64DATA')
    const parsed = JSON.parse(text)
    expect(parsed.images).toBeUndefined()
    expect(parsed.imageKeys).toContain('icon')
    expect(parsed.imageKeys).toContain('banner')
  })

  it('builds_save with id preserves stored images and returns compact echo', async () => {
    const deps = makeDeps()
    const storedImages = { icon: 'data:image/png;base64,STOREDIMAGE' }
    ;(deps.axiforge.getBuild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'b1',
      title: 'Heal FB',
      profession: 'Guardian',
      images: storedImages
    })
    ;(deps.axiforge.saveBuild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'b1',
      title: 'Updated Title',
      updatedAt: '2026-06-10T12:00:00.000Z'
    })
    const result = await find(deps, 'axiforge_builds_save').handler(
      { build: { id: 'b1', title: 'Updated Title' } },
      {}
    )
    // saveBuild must have been called with stored images re-attached
    expect(deps.axiforge.saveBuild).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1', title: 'Updated Title', images: storedImages })
    )
    // Echo is compact: only id, title, updatedAt
    const parsed = JSON.parse((result.content[0] as { text: string }).text)
    expect(parsed.id).toBe('b1')
    expect(parsed.title).toBe('Updated Title')
    expect(parsed.updatedAt).toBeDefined()
    expect(parsed.profession).toBeUndefined()
  })

  describe('display payloads', () => {
    it('builds_get attaches a build-card display with the FULL build (images intact) while the model text stays stripped', async () => {
      const deps = makeDeps()
      const build = {
        id: 'b1',
        title: 'Heal FB',
        profession: 'Guardian',
        images: { icon: 'data:image/png;base64,abc123' }
      }
      ;(deps.axiforge.getBuild as ReturnType<typeof vi.fn>).mockResolvedValueOnce(build)
      const result = await find(deps, 'axiforge_builds_get').handler({ build_id: 'b1' }, {})
      expect(result.display).toEqual({ kind: 'build-card', data: { build } })
      // Model-visible JSON stays image-stripped — no display/image leakage.
      const text = (result.content[0] as { text: string }).text
      expect(text).not.toContain('data:image/')
      const parsed = JSON.parse(text)
      expect(parsed.images).toBeUndefined()
      expect(parsed.imageKeys).toEqual(['icon'])
    })

    it('builds_save attaches a build-card display of the saved record, echo stays compact', async () => {
      const deps = makeDeps()
      const saved = {
        id: 'b1',
        title: 'Renamed',
        profession: 'Guardian',
        updatedAt: '2026-06-10T00:00:00.000Z'
      }
      ;(deps.axiforge.saveBuild as ReturnType<typeof vi.fn>).mockResolvedValueOnce(saved)
      const result = await find(deps, 'axiforge_builds_save').handler(
        { build: { title: 'Renamed' } },
        {}
      )
      expect(result.display).toEqual({ kind: 'build-card', data: { build: saved } })
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed).toEqual({ id: 'b1', title: 'Renamed', updatedAt: '2026-06-10T00:00:00.000Z' })
    })

    it('comps_get attaches a comp-card display with referenced builds embedded by id', async () => {
      const deps = makeDeps()
      const comp = {
        id: 'c1',
        name: 'GvG',
        partyLines: [{ id: 'p1', capacity: 5, slots: ['b1'] }],
        buildIds: ['b2']
      }
      const b1 = { id: 'b1', title: 'FB', profession: 'Guardian' }
      const b2 = { id: 'b2', title: 'Scrapper', profession: 'Engineer' }
      ;(deps.axiforge.getComp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(comp)
      ;(deps.axiforge.getBuild as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
        id === 'b1' ? b1 : b2
      )
      const result = await find(deps, 'axiforge_comps_get').handler({ comp_id: 'c1' }, {})
      expect(result.display).toEqual({
        kind: 'comp-card',
        data: { comp, builds: { b1, b2 } }
      })
      expect((result.content[0] as { text: string }).text).toBe(JSON.stringify(comp))
    })

    it('comps_get tolerates failed build fetches: missing builds are left out, value still returns', async () => {
      const deps = makeDeps()
      const comp = { id: 'c1', name: 'GvG', partyLines: [{ slots: ['b1', 'b404'] }] }
      const b1 = { id: 'b1', title: 'FB', profession: 'Guardian' }
      ;(deps.axiforge.getComp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(comp)
      ;(deps.axiforge.getBuild as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
        if (id === 'b1') return b1
        throw new Error('not found')
      })
      const result = await find(deps, 'axiforge_comps_get').handler({ comp_id: 'c1' }, {})
      expect(result.isError).toBeUndefined()
      expect((result.content[0] as { text: string }).text).toBe(JSON.stringify(comp))
      expect(result.display).toEqual({ kind: 'comp-card', data: { comp, builds: { b1 } } })
    })

    it('list tools carry no display', async () => {
      const deps = makeDeps()
      const builds = await find(deps, 'axiforge_builds_list').handler({}, {})
      expect(builds.display).toBeUndefined()
      const comps = await find(deps, 'axiforge_comps_list').handler({}, {})
      expect(comps.display).toBeUndefined()
    })
  })

  it('write() does NOT call ensureRunning on plain AxiforgeError', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.saveBuild as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AxiforgeError('Something went wrong in AxiForge')
    )
    const result = await find(deps, 'axiforge_builds_save').handler({ build: { title: 'Test' } }, {})
    expect(deps.axiforgeLauncher.ensureRunning).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('Something went wrong')
  })

  describe('gw2skills_parse', () => {
    it('returns the parsed build (images stripped) and attaches a build-card display', async () => {
      const deps = makeDeps()
      const result = await find(deps, 'gw2skills_parse').handler(
        { url: 'http://gw2skills.net/editor/?abc', game_mode: 'wvw' },
        {}
      )
      expect(deps.axiforge.parseGw2Skills).toHaveBeenCalledWith({
        url: 'http://gw2skills.net/editor/?abc',
        gameMode: 'wvw'
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).not.toContain('data:image/')
      const parsed = JSON.parse(text)
      expect(parsed.profession).toBe('Guardian')
      expect(parsed.images).toBeUndefined()
      expect(parsed.imageKeys).toEqual(['icon'])
      // Full build (images intact) goes to the card.
      expect(result.display).toMatchObject({ kind: 'build-card' })
      expect(result.isError).toBeUndefined()
    })

    it('omits game_mode from the client call when not provided', async () => {
      const deps = makeDeps()
      await find(deps, 'gw2skills_parse').handler({ url: 'http://gw2skills.net/editor/?abc' }, {})
      expect(deps.axiforge.parseGw2Skills).toHaveBeenCalledWith({ url: 'http://gw2skills.net/editor/?abc' })
    })

    it('auto-spawns AxiForge and retries once when it is closed (parse needs the catalog)', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.parseGw2Skills as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new AxiforgeNotRunningError())
        .mockResolvedValueOnce({ title: 'Parsed', profession: 'Guardian', equipment: {} })
      const result = await find(deps, 'gw2skills_parse').handler(
        { url: 'http://gw2skills.net/editor/?abc' },
        {}
      )
      expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
      expect(deps.axiforge.parseGw2Skills).toHaveBeenCalledTimes(2)
      expect(result.isError).toBeUndefined()
    })

    it('never throws: a parse error comes back as an error result', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.parseGw2Skills as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AxiforgeError("Couldn't read that gw2skills link")
      )
      const result = await find(deps, 'gw2skills_parse').handler({ url: 'http://bad' }, {})
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('gw2skills link')
    })

    it('is not destructive', () => {
      expect(DESTRUCTIVE_TOOLS).not.toContain('gw2skills_parse')
    })
  })

  describe('gw2_build_card', () => {
    it('decodes a chat code into a build-card display (images stripped from model value)', async () => {
      const deps = makeDeps()
      const result = await find(deps, 'gw2_build_card').handler(
        { chat_code: '[&DQEAAA==]', game_mode: 'wvw' },
        {}
      )
      expect(deps.axiforge.parseChatLink).toHaveBeenCalledWith({
        link: '[&DQEAAA==]',
        gameMode: 'wvw'
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).not.toContain('data:image/')
      const parsed = JSON.parse(text)
      expect(parsed.profession).toBe('Guardian')
      expect(parsed.images).toBeUndefined()
      // Full build (images intact) goes to the card.
      expect(result.display).toEqual({
        kind: 'build-card',
        data: {
          build: {
            title: 'Heal FB',
            profession: 'Guardian',
            gameMode: 'wvw',
            equipment: {},
            images: { icon: 'data:image/png;base64,abc123' },
            chatCode: '[&DQEAAA==]'
          }
        }
      })
      expect(result.isError).toBeUndefined()
    })

    it('does not fetch a page when no source_url is given', async () => {
      const deps = makeDeps()
      await find(deps, 'gw2_build_card').handler({ chat_code: '[&DQEAAA==]' }, {})
      expect(deps.fetchBuildPage).not.toHaveBeenCalled()
    })

    it('scrapes gear from a raw fetch of the source page when source_url is given', async () => {
      const deps = makeDeps()
      // Embed-free HTML → scrapeBuildGear returns null without any GW2 API calls;
      // the extraction itself is covered in buildGear.test.ts. Gear is scraped from
      // the RAW fetch (the browser DOM strips armory embeds).
      deps.fetchBuildPageRaw = vi.fn().mockResolvedValue('<html><body>no embeds</body></html>')
      await find(deps, 'gw2_build_card').handler(
        { chat_code: '[&DQEAAA==]', source_url: 'https://metabattle.com/wiki/Build:X' },
        {}
      )
      expect(deps.fetchBuildPageRaw).toHaveBeenCalledWith('https://metabattle.com/wiki/Build:X')
    })

    it('attaches source_url as build.sourceUrl when given', async () => {
      const deps = makeDeps()
      const result = await find(deps, 'gw2_build_card').handler(
        { chat_code: '[&DQEAAA==]', source_url: 'https://snowcrows.com/builds/x' },
        {}
      )
      const build = (result.display as { data?: { build?: Record<string, unknown> } } | undefined)?.data?.build
      expect(build?.sourceUrl).toBe('https://snowcrows.com/builds/x')
    })

    it('omits gameMode from the client call when game_mode not provided', async () => {
      const deps = makeDeps()
      await find(deps, 'gw2_build_card').handler({ chat_code: '[&DQEAAA==]' }, {})
      expect(deps.axiforge.parseChatLink).toHaveBeenCalledWith({ link: '[&DQEAAA==]' })
    })

    it('auto-spawns AxiForge and retries once when it is closed', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.parseChatLink as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new AxiforgeNotRunningError())
        .mockResolvedValueOnce({ title: 'Decoded', profession: 'Guardian', equipment: {} })
      const result = await find(deps, 'gw2_build_card').handler({ chat_code: '[&DQEAAA==]' }, {})
      expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
      expect(deps.axiforge.parseChatLink).toHaveBeenCalledTimes(2)
      expect(result.isError).toBeUndefined()
    })

    it('never throws: a decode error comes back as an error result', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.parseChatLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AxiforgeError("Couldn't read that chat code")
      )
      const result = await find(deps, 'gw2_build_card').handler({ chat_code: 'garbage' }, {})
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('chat code')
    })

    it('is not destructive', () => {
      expect(DESTRUCTIVE_TOOLS).not.toContain('gw2_build_card')
    })
  })

  describe('gw2_build_from_url', () => {
    it('extracts the chat code from the page HTML and renders a build card', async () => {
      const deps = makeDeps()
      // HTML with a chat code but no armory embeds (so gear scrape is a no-op here).
      ;(deps.fetchBuildPage as ReturnType<typeof vi.fn>).mockResolvedValue('<html><code>[&DQYAAA==]</code></html>')
      const result = await find(deps, 'gw2_build_from_url').handler(
        { url: 'https://metabattle.com/wiki/Build:Catalyst_-_Fresh_Air_Cata_Roamer', game_mode: 'wvw' },
        {}
      )
      expect(deps.fetchBuildPage).toHaveBeenCalledWith(
        'https://metabattle.com/wiki/Build:Catalyst_-_Fresh_Air_Cata_Roamer'
      )
      expect(deps.axiforge.parseChatLink).toHaveBeenCalledWith({ link: '[&DQYAAA==]', gameMode: 'wvw' })
      expect((result.display as { kind?: string } | undefined)?.kind).toBe('build-card')
      expect(result.isError).toBeUndefined()
    })

    it('scrapes gear from a raw (non-JS) fetch, since the browser DOM strips armory embeds', async () => {
      const deps = makeDeps()
      // Browser fetch carries the chat code but its armory embeds are gone (consumed
      // by the page's GW2-Armory script). The raw fetch is where gear must be scraped.
      ;(deps.fetchBuildPage as ReturnType<typeof vi.fn>).mockResolvedValue('<html><code>[&DQYAAA==]</code></html>')
      deps.fetchBuildPageRaw = vi.fn().mockResolvedValue('<html><body>raw, no embeds here</body></html>')
      const result = await find(deps, 'gw2_build_from_url').handler(
        { url: 'https://metabattle.com/wiki/Build:Firebrand' },
        {}
      )
      expect(deps.fetchBuildPageRaw).toHaveBeenCalledWith('https://metabattle.com/wiki/Build:Firebrand')
      // Raw HTML had no embeds → no gear attached (proves we scraped raw, not browser).
      const build = (result.display as { data?: { build?: Record<string, unknown> } } | undefined)?.data?.build
      expect(build?.scrapedGear).toBeUndefined()
      expect((result.display as { kind?: string } | undefined)?.kind).toBe('build-card')
    })

    it('attaches the page URL as build.sourceUrl so the card can link to the source', async () => {
      const deps = makeDeps()
      ;(deps.fetchBuildPage as ReturnType<typeof vi.fn>).mockResolvedValue('<html><code>[&DQYAAA==]</code></html>')
      const result = await find(deps, 'gw2_build_from_url').handler(
        { url: 'https://metabattle.com/wiki/Build:Firebrand' },
        {}
      )
      const build = (result.display as { data?: { build?: Record<string, unknown> } } | undefined)?.data?.build
      expect(build?.sourceUrl).toBe('https://metabattle.com/wiki/Build:Firebrand')
    })

    it('returns a clean note (no card) when the page has no chat code', async () => {
      const deps = makeDeps()
      ;(deps.fetchBuildPage as ReturnType<typeof vi.fn>).mockResolvedValue('<html><p>no code here</p></html>')
      const result = await find(deps, 'gw2_build_from_url').handler(
        { url: 'https://metabattle.com/wiki/Build:Whatever' },
        {}
      )
      expect(deps.axiforge.parseChatLink).not.toHaveBeenCalled()
      expect(result.display).toBeUndefined()
      expect((result.content[0] as { text: string }).text).toContain('No in-game build template code')
    })

    it('returns a clean note when the page could not be loaded', async () => {
      const deps = makeDeps()
      ;(deps.fetchBuildPage as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const result = await find(deps, 'gw2_build_from_url').handler({ url: 'https://metabattle.com/wiki/Build:X' }, {})
      expect((result.content[0] as { text: string }).text).toContain('Could not load')
    })

    it('is not destructive', () => {
      expect(DESTRUCTIVE_TOOLS).not.toContain('gw2_build_from_url')
    })
  })

  describe('axiforge_build_chat_link', () => {
    it('returns the chat link for a build id', async () => {
      const deps = makeDeps()
      const result = await find(deps, 'axiforge_build_chat_link').handler({ build_id: 'b1' }, {})
      expect(deps.axiforge.buildChatLink).toHaveBeenCalledWith('b1')
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed.chatLink).toBe('[&DQEK...]')
      expect(result.isError).toBeUndefined()
    })

    it('surfaces an unknown-build error as an error result (never throws)', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.buildChatLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AxiforgeError('Build not found: nope')
      )
      const result = await find(deps, 'axiforge_build_chat_link').handler({ build_id: 'nope' }, {})
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('Build not found')
    })

    it('is not destructive', () => {
      expect(DESTRUCTIVE_TOOLS).not.toContain('axiforge_build_chat_link')
    })
  })
})
