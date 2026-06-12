import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsStore, type Cipher } from './secrets'

const fakeCipher: Cipher = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`),
  decrypt: (buf) => buf.toString().replace(/^enc:/, '')
}

function makeStore(): SettingsStore {
  const dir = mkdtempSync(join(tmpdir(), 'axivale-'))
  return new SettingsStore(join(dir, 'settings.json'), fakeCipher)
}

describe('SettingsStore', () => {
  it('round-trips secrets through the cipher', () => {
    const store = makeStore()
    store.setSecret('gw2ApiKey', 'ABCD-1234')
    expect(store.getSecret('gw2ApiKey')).toBe('ABCD-1234')
  })

  it('persists across instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axivale-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).setSecret('axivaleKey', 'tok')
    expect(new SettingsStore(path, fakeCipher).getSecret('axivaleKey')).toBe('tok')
  })

  it('does not write plaintext secrets to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axivale-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).setSecret('gw2ApiKey', 'SUPERSECRET')
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain('SUPERSECRET')
  })

  it('stores plain settings unencrypted', () => {
    const store = makeStore()
    store.setSetting('gw2GuildId', 'G-1')
    expect(store.getSetting('gw2GuildId')).toBe('G-1')
  })

  it('returns null for missing values', () => {
    const store = makeStore()
    expect(store.getSecret('claudeOauthToken')).toBeNull()
    expect(store.getSetting('guildId')).toBeNull()
  })
})

describe('SettingsStore keyrings', () => {
  it('adds keys and lists labels without exposing key material', () => {
    const store = makeStore()
    store.addKey('gw2', 'main', 'KEY-MAIN')
    store.addKey('gw2', 'alt', 'KEY-ALT')
    expect(store.listKeyLabels('gw2')).toEqual([
      { label: 'main', active: true },
      { label: 'alt', active: false }
    ])
  })

  it('first key added becomes active; setActiveKey switches', () => {
    const store = makeStore()
    store.addKey('axivale', 'EWW', 'axt1.a.s1')
    store.addKey('axivale', 'VGL', 'axt1.b.s2')
    expect(store.getActiveKey('axivale')).toBe('axt1.a.s1')
    store.setActiveKey('axivale', 'VGL')
    expect(store.getActiveKey('axivale')).toBe('axt1.b.s2')
    expect(store.listKeyLabels('axivale')).toEqual([
      { label: 'EWW', active: false },
      { label: 'VGL', active: true }
    ])
  })

  it('re-adding a label replaces its key', () => {
    const store = makeStore()
    store.addKey('gw2', 'main', 'OLD')
    store.addKey('gw2', 'main', 'NEW')
    expect(store.getActiveKey('gw2')).toBe('NEW')
    expect(store.listKeyLabels('gw2')).toHaveLength(1)
  })

  it('removing the active key falls back to the first remaining', () => {
    const store = makeStore()
    store.addKey('gw2', 'main', 'K1')
    store.addKey('gw2', 'alt', 'K2')
    store.removeKey('gw2', 'main')
    expect(store.getActiveKey('gw2')).toBe('K2')
    expect(store.listKeyLabels('gw2')).toEqual([{ label: 'alt', active: true }])
    store.removeKey('gw2', 'alt')
    expect(store.getActiveKey('gw2')).toBeNull()
  })

  it('migrates a legacy single secret into the keyring on first read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axivale-'))
    const path = join(dir, 'settings.json')
    const old = new SettingsStore(path, fakeCipher)
    old.setSecret('gw2ApiKey', 'LEGACY-KEY')
    old.setSecret('axivaleKey', 'axt1.x.legacy')
    const store = new SettingsStore(path, fakeCipher)
    expect(store.getActiveKey('gw2')).toBe('LEGACY-KEY')
    expect(store.getActiveKey('axivale')).toBe('axt1.x.legacy')
    expect(store.listKeyLabels('gw2')).toEqual([{ label: 'default', active: true }])
  })

  it('persists keyrings encrypted across instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axivale-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).addKey('gw2', 'main', 'SUPERSECRET')
    expect(readFileSync(path, 'utf8')).not.toContain('SUPERSECRET')
    expect(new SettingsStore(path, fakeCipher).getActiveKey('gw2')).toBe('SUPERSECRET')
  })
})
