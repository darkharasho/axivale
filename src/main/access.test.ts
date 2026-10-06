import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfig, hashIdentity, type AxiConfig, type Identity, type IdentityKind } from '@axiapps/axi-config'
import { startAccess, type AccessStore } from './access'

const quiet = { warn: () => {} }
const DISCORD_ID = '123456789012345678'
const GUILD = '4b1f2a3c-0000-4000-8000-000000000001'

type Listener = (...args: any[]) => void
class FakeWindow {
  static all: FakeWindow[] = []
  destroyed = false
  constructor(public options: Record<string, unknown> = {}) { FakeWindow.all.push(this) }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true }
  removeMenu() {}
  async loadURL() {}
  on() { return this }
  webContents: any = { setWindowOpenHandler() {}, on() { return this.webContents } }
}
function fakeElectron(userData: string) {
  return {
    app: { quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn(), on: (_e: string, _l: Listener) => {}, getPath: () => userData },
    BrowserWindow: Object.assign(FakeWindow, { getAllWindows: () => FakeWindow.all.filter((w) => !w.destroyed) }),
    shell: { openExternal: vi.fn(async () => {}) },
  } as any
}

const body = (denylist: string[]) =>
  new Response(JSON.stringify({ version: 1, flags: {}, minVersion: null, notice: null, denylist }), { status: 200, headers: { etag: '"v1"' } })

function fakeStore(opts: { gw2?: Record<string, string>; discord?: Array<{ label: string; id?: string }>; settings?: Record<string, string> } = {}): AccessStore {
  const gw2 = opts.gw2 ?? {}
  return {
    listKeyLabels: (service: string) =>
      service === 'gw2'
        ? Object.keys(gw2).map((label) => ({ label, active: false }))
        : (opts.discord ?? []).map((d) => ({ label: d.label, active: false, meta: d.id === undefined ? undefined : { id: d.id } })),
    getKey: (_service: string, label: string) => gw2[label] ?? null,
    getSetting: (key: string) => opts.settings?.[key] ?? null,
  } as AccessStore
}

let dir: string
let configs: AxiConfig[] = []
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'axivale-access-'))
  FakeWindow.all = []
})
afterEach(async () => {
  for (const c of configs) c.close()
  configs = []
  await rm(dir, { recursive: true, force: true })
})

async function make(denylist: Array<[IdentityKind, string]>, fetchImpl?: typeof fetch) {
  const hashes = await Promise.all(denylist.map(([k, v]) => hashIdentity(k, v)))
  const c = createConfig({
    appId: 'axivale',
    cacheDir: dir,
    url: 'https://cfg.test',
    fetch: fetchImpl ?? ((async () => body(hashes)) as typeof fetch),
    logger: quiet,
  })
  configs.push(c)
  return c
}

const lookupKey = async (key: string): Promise<Identity[]> => (key === 'KEY-A' ? [{ kind: 'gw2_account', value: 'Some Player.1234' }] : [])

async function boot(config: AxiConfig, store: AccessStore, onBlocked = vi.fn()) {
  const electron = fakeElectron(dir)
  const res = await startAccess({ electron, config, store, lookupKey, onBlocked })
  return { res, onBlocked, electron }
}

describe('access', () => {
  it('blocks at runtime when a stored GW2 key resolves to a listed account', async () => {
    const config = await make([['gw2_account', 'Some Player.1234']])
    await config.ready()
    await config.refresh()
    const { res, onBlocked } = await boot(config, fakeStore({ gw2: { main: 'KEY-A' } }))
    expect(res.blocked).toBe(false)
    if (res.blocked) return
    expect(await res.gate.recheck()).toBe(true)
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(onBlocked).toHaveBeenCalledWith({ persisted: true })
  })

  it('blocks on the cached gw2 account name and guild id settings', async () => {
    const config = await make([['gw2_guild', GUILD]])
    await config.ready()
    await config.refresh()
    const { res, onBlocked } = await boot(config, fakeStore({ settings: { gw2GuildId: GUILD } }))
    if (res.blocked) throw new Error('unexpected')
    await res.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)

    const config2 = await make([['gw2_account', 'Cached Name.4321']])
    await config2.ready()
    await config2.refresh()
    const second = await boot(config2, fakeStore({ settings: { gw2AccountName: 'Cached Name.4321' } }))
    if (second.res.blocked) throw new Error('unexpected')
    await second.res.gate.recheck()
    expect(second.onBlocked).toHaveBeenCalledTimes(1)
  })

  it('blocks when a key meta Discord server is listed', async () => {
    const config = await make([['discord_server', DISCORD_ID]])
    await config.ready()
    await config.refresh()
    const { res, onBlocked } = await boot(config, fakeStore({ discord: [{ label: 'srv', id: DISCORD_ID }] }))
    if (res.blocked) throw new Error('unexpected')
    await res.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('blocks on the guildId setting', async () => {
    const config = await make([['discord_server', DISCORD_ID]])
    await config.ready()
    await config.refresh()
    const { res, onBlocked } = await boot(config, fakeStore({ settings: { guildId: DISCORD_ID } }))
    if (res.blocked) throw new Error('unexpected')
    await res.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed Discord server id', async () => {
    const config = await make([['gw2_account', 'Unrelated.1111']])
    await config.ready()
    await config.refresh()
    const { res, onBlocked } = await boot(config, fakeStore({ discord: [{ label: 'srv', id: 'not-a-snowflake' }], settings: { guildId: '12ab' } }))
    if (res.blocked) throw new Error('unexpected')
    expect(await res.gate.recheck()).toBe(false)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('does not block clean identities', async () => {
    const config = await make([['gw2_account', 'Someone Else.9999']])
    await config.ready()
    await config.refresh()
    const { res, onBlocked } = await boot(config, fakeStore({ gw2: { main: 'KEY-A' }, discord: [{ label: 'srv', id: DISCORD_ID }] }))
    if (res.blocked) throw new Error('unexpected')
    expect(await res.gate.recheck()).toBe(false)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('boots into the block screen when the sticky trip is set', async () => {
    const first = await make([['discord_server', DISCORD_ID]])
    await first.ready()
    await first.refresh()
    const a = await boot(first, fakeStore({ discord: [{ label: 'srv', id: DISCORD_ID }] }))
    if (a.res.blocked) throw new Error('unexpected')
    await a.res.gate.recheck()
    first.close()

    const second = await make([], (async () => { throw new Error('offline') }) as typeof fetch)
    const { res, electron } = await boot(second, fakeStore())
    expect(res.blocked).toBe(true)
    expect(FakeWindow.all).toHaveLength(1)
    expect(electron.app.relaunch).not.toHaveBeenCalled()
  })

  it('fails open when the network is down and there is no cache', async () => {
    const config = await make([], (async () => { throw new Error('offline') }) as typeof fetch)
    await config.ready()
    const { res, onBlocked } = await boot(config, fakeStore({ gw2: { main: 'KEY-A' }, discord: [{ label: 'srv', id: DISCORD_ID }] }))
    expect(res.blocked).toBe(false)
    if (res.blocked) return
    expect(await res.gate.recheck()).toBe(false)
    expect(onBlocked).not.toHaveBeenCalled()
  })
})
