import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { dirname } from 'path'

// gw2ApiKey/axivaleKey are legacy single-key secrets, migrated into keyrings on read.
export type SecretKey =
  | 'claudeOauthToken'
  | 'gw2ApiKey'
  | 'axivaleKey'
  | 'gw2Keys'
  | 'axivaleKeys'
  | 'geminiKeys'
  | 'openaiKeys'
  | 'githubKeys'
export type SettingKey =
  | 'guildId'
  | 'gw2GuildId'
  | 'gw2GuildName'
  | 'gw2AccountName'
  | 'model'
  | 'gw2ActiveKey'
  | 'axivaleActiveKey'
  | 'provider'
  | 'localEndpoint'
  | 'geminiModel'
  | 'openaiModel'
  | 'localModel'
  | 'geminiActiveKey'
  | 'openaiActiveKey'
  | 'githubActiveKey'
  | 'axibridgeRepos'
  | 'axibridgeCacheCapBytes'
  | 'windowBounds'
  | 'wikiIngestedAt'
  /** 'true'/'false' (default on): desktop notifications + app-icon unread badge. */
  | 'notifySystem'
  | 'notifyBadge'
  /** JSON map of Discord guild id -> guild-member role id; anchors the reconciled
   *  roster per server (each connected server has its own roles). */
  | 'discordMemberRoleByGuild'

/** Services that hold a ring of labeled keys with one active. */
export type KeyService = 'gw2' | 'axivale' | 'gemini' | 'openai' | 'github'

/** Resolved identity for a key (e.g. the Discord server an AxiVale key binds to),
 *  cached so the keyring can show which server/account each key talks to. */
export interface KeyMeta {
  name?: string
  id?: string
}

export interface KeyLabel {
  label: string
  active: boolean
  meta?: KeyMeta
}

interface StoredKey {
  label: string
  key: string
  meta?: KeyMeta
}

const RING_SECRET: Record<KeyService, SecretKey> = {
  gw2: 'gw2Keys',
  axivale: 'axivaleKeys',
  gemini: 'geminiKeys',
  openai: 'openaiKeys',
  github: 'githubKeys'
}
// Only the original services have pre-keyring single secrets to migrate.
const LEGACY_SECRET: Partial<Record<KeyService, SecretKey>> = {
  gw2: 'gw2ApiKey',
  axivale: 'axivaleKey'
}
const ACTIVE_SETTING: Record<KeyService, SettingKey> = {
  gw2: 'gw2ActiveKey',
  axivale: 'axivaleActiveKey',
  gemini: 'geminiActiveKey',
  openai: 'openaiActiveKey',
  github: 'githubActiveKey'
}

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

interface FileShape {
  secrets: Partial<Record<SecretKey, string>> // base64 of encrypted bytes
  settings: Partial<Record<SettingKey, string>>
}

export class SettingsStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher
  ) {}

  private read(): FileShape {
    if (!existsSync(this.path)) return { secrets: {}, settings: {} }
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as FileShape
    } catch {
      // Corrupt/truncated file (interrupted write, manual edit): start fresh
      // rather than wedging every settings access.
      return { secrets: {}, settings: {} }
    }
  }

  private write(data: FileShape): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600 })
    // writeFileSync's mode only applies on creation; re-tighten on rewrites.
    chmodSync(this.path, 0o600)
  }

  setSecret(key: SecretKey, value: string): void {
    const data = this.read()
    data.secrets[key] = this.cipher.encrypt(value).toString('base64')
    this.write(data)
  }

  getSecret(key: SecretKey): string | null {
    const stored = this.read().secrets[key]
    if (!stored) return null
    return this.cipher.decrypt(Buffer.from(stored, 'base64'))
  }

  setSetting(key: SettingKey, value: string): void {
    const data = this.read()
    data.settings[key] = value
    this.write(data)
  }

  getSetting(key: SettingKey): string | null {
    return this.read().settings[key] ?? null
  }

  // --- keyrings: labeled keys per service, one active ---------------------

  private readRing(service: KeyService): StoredKey[] {
    const raw = this.getSecret(RING_SECRET[service])
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredKey[]
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall through to legacy migration
      }
    }
    // Migrate a legacy single secret into the ring on first read.
    const legacySecret = LEGACY_SECRET[service]
    const legacy = legacySecret ? this.getSecret(legacySecret) : null
    if (legacy) {
      const ring = [{ label: 'default', key: legacy }]
      this.writeRing(service, ring)
      return ring
    }
    return []
  }

  private writeRing(service: KeyService, ring: StoredKey[]): void {
    this.setSecret(RING_SECRET[service], JSON.stringify(ring))
  }

  private activeLabel(service: KeyService, ring: StoredKey[]): string | null {
    const wanted = this.getSetting(ACTIVE_SETTING[service])
    if (wanted && ring.some((k) => k.label === wanted)) return wanted
    return ring[0]?.label ?? null
  }

  /** The active key's label, or null when the ring is empty. */
  getActiveLabel(service: KeyService): string | null {
    return this.activeLabel(service, this.readRing(service))
  }

  listKeyLabels(service: KeyService): KeyLabel[] {
    const ring = this.readRing(service)
    const active = this.activeLabel(service, ring)
    return ring.map((k) => ({ label: k.label, active: k.label === active, meta: k.meta }))
  }

  addKey(service: KeyService, label: string, key: string): void {
    // Re-adding an existing label replaces its key; carry no stale meta forward.
    const ring = this.readRing(service).filter((k) => k.label !== label)
    ring.push({ label, key })
    this.writeRing(service, ring)
  }

  removeKey(service: KeyService, label: string): void {
    const ring = this.readRing(service).filter((k) => k.label !== label)
    this.writeRing(service, ring)
    // If the removed key was the chosen active one, retarget the setting at the
    // new first key (or clear it) so the active pointer never dangles.
    if (this.getSetting(ACTIVE_SETTING[service]) === label) {
      const next = ring[0]?.label
      if (next) this.setSetting(ACTIVE_SETTING[service], next)
      else this.setSetting(ACTIVE_SETTING[service], '')
    }
  }

  setActiveKey(service: KeyService, label: string): void {
    this.setSetting(ACTIVE_SETTING[service], label)
  }

  /** Cache resolved identity (server/account) on a key by label; no-op if gone. */
  setKeyMeta(service: KeyService, label: string, meta: KeyMeta): void {
    const ring = this.readRing(service)
    const entry = ring.find((k) => k.label === label)
    if (!entry) return
    entry.meta = meta
    this.writeRing(service, ring)
  }

  /** The active key's material — for main-process consumers only. */
  getActiveKey(service: KeyService): string | null {
    const ring = this.readRing(service)
    const active = this.activeLabel(service, ring)
    return ring.find((k) => k.label === active)?.key ?? null
  }
}

/** Production cipher backed by Electron safeStorage. Imported lazily so tests
 *  (plain node) never load the electron module. */
export async function electronCipher(): Promise<Cipher> {
  const { safeStorage } = await import('electron')
  return {
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (buf) => safeStorage.decryptString(buf)
  }
}
