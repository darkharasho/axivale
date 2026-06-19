import { describe, it, expect } from 'vitest'
import { resolveServerEntry, type ServerEntry } from './serverResolve'

const S = (label: string, name: string | null = label): ServerEntry => ({ label, name, guildId: '1' })

describe('resolveServerEntry', () => {
  it('returns the only server when none requested', () => {
    expect(resolveServerEntry([S('DEFI')]).label).toBe('DEFI')
  })
  it('matches by label, case-insensitive', () => {
    expect(resolveServerEntry([S('DEFI'), S('EWW')], 'eww').label).toBe('EWW')
  })
  it('matches by cached server name', () => {
    expect(resolveServerEntry([S('DEFI', 'Engaging Without Warning')], 'engaging without warning').label).toBe('DEFI')
  })
  it('throws listing servers when ambiguous (omitted + multiple)', () => {
    expect(() => resolveServerEntry([S('DEFI'), S('EWW')])).toThrow(/Multiple Discord servers connected \(DEFI, EWW\)/)
  })
  it('throws on unknown server', () => {
    expect(() => resolveServerEntry([S('DEFI')], 'nope')).toThrow(/Unknown Discord server "nope". Connected servers: DEFI/)
  })
  it('throws when none configured', () => {
    expect(() => resolveServerEntry([], 'x')).toThrow(/No Discord server is configured/)
  })
})
