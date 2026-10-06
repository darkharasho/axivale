// Access check: blocks the app when one of its identities is on the Axi
// denylist. See README "Access".
import {
  createAccessGate,
  createConfig,
  gw2AccountIdentities,
  gw2GuildIdentity,
  gw2KeyIdentities,
  type AccessGate,
  type AxiConfig,
  type Identity,
} from '@axiapps/axi-config'
import { blockIfTripped, handleBlocked, type ElectronLike, type RelaunchableApp } from '@axiapps/axi-config/electron'
import type { SettingsStore } from './secrets'

export type AccessStore = Pick<SettingsStore, 'listKeyLabels' | 'getKey' | 'getSetting'>

export interface AccessDeps {
  electron: ElectronLike & { app: RelaunchableApp & { getPath(name: 'userData'): string } }
  store: AccessStore
  config?: AxiConfig // tests inject one; production creates it
  onBlocked?: (info: { persisted: boolean }) => void // tests inject a spy
  lookupKey?: (apiKey: string) => Promise<Identity[]> // tests inject; production calls /v2/account
}

export type AccessBoot = { blocked: true } | { blocked: false; gate: AccessGate; config: AxiConfig }

const SNOWFLAKE = /^\d{5,25}$/

function discordServer(value: unknown): Identity[] {
  return typeof value === 'string' && SNOWFLAKE.test(value.trim()) ? [{ kind: 'discord_server', value: value.trim() }] : []
}

export async function startAccess(deps: AccessDeps): Promise<AccessBoot> {
  const { store } = deps
  const lookupKey = deps.lookupKey ?? ((key: string) => gw2KeyIdentities(key))
  const config = deps.config ?? createConfig({ appId: 'axivale', cacheDir: deps.electron.app.getPath('userData') })
  await config.ready()
  if (blockIfTripped(deps.electron, config)) return { blocked: true }
  const gate = createAccessGate({ config, onBlocked: deps.onBlocked ?? ((info) => handleBlocked(deps.electron, config, info)) })

  gate.addSource('gw2', async () => {
    const out: Identity[] = []
    for (const { label } of store.listKeyLabels('gw2')) {
      const key = store.getKey('gw2', label)
      if (key) out.push(...(await lookupKey(key)))
    }
    const name = store.getSetting('gw2AccountName')
    if (name) out.push(...gw2AccountIdentities({ name }))
    out.push(...gw2GuildIdentity(store.getSetting('gw2GuildId')))
    return out
  })

  gate.addSource('discord', () => {
    const out: Identity[] = []
    for (const { meta } of store.listKeyLabels('axivale')) out.push(...discordServer(meta?.id))
    out.push(...discordServer(store.getSetting('guildId')))
    return out
  })

  config.onChange(() => void gate.recheck())
  return { blocked: false, gate, config }
}
