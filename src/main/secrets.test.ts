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
  const dir = mkdtempSync(join(tmpdir(), 'gw2officer-'))
  return new SettingsStore(join(dir, 'settings.json'), fakeCipher)
}

describe('SettingsStore', () => {
  it('round-trips secrets through the cipher', () => {
    const store = makeStore()
    store.setSecret('gw2ApiKey', 'ABCD-1234')
    expect(store.getSecret('gw2ApiKey')).toBe('ABCD-1234')
  })

  it('persists across instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw2officer-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).setSecret('axitoolsToken', 'tok')
    expect(new SettingsStore(path, fakeCipher).getSecret('axitoolsToken')).toBe('tok')
  })

  it('does not write plaintext secrets to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw2officer-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).setSecret('gw2ApiKey', 'SUPERSECRET')
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain('SUPERSECRET')
  })

  it('stores plain settings unencrypted', () => {
    const store = makeStore()
    store.setSetting('axitoolsUrl', 'http://127.0.0.1:8642')
    expect(store.getSetting('axitoolsUrl')).toBe('http://127.0.0.1:8642')
  })

  it('returns null for missing values', () => {
    const store = makeStore()
    expect(store.getSecret('claudeOauthToken')).toBeNull()
    expect(store.getSetting('guildId')).toBeNull()
  })
})
