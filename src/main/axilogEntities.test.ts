import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildEntityIndex, type AxilogReport } from './axilogEntities'

const report = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'wvw-small.report.json'), 'utf8')
) as AxilogReport

describe('buildEntityIndex', () => {
  it('resolves a by_entity string key back to its entity', () => {
    const index = buildEntityIndex(report)
    const someKey = Object.keys(report.blocks.damage?.by_entity ?? {})[0]
    expect(someKey).toBeTypeOf('string')
    const ref = index.get(someKey)
    expect(ref).not.toBeNull()
    expect(ref!.id).toBe(someKey)
    expect(ref!.name).not.toBe('')
  })

  it('accepts a numeric id and a string id interchangeably', () => {
    const index = buildEntityIndex(report)
    const first = report.entities[0]
    expect(index.get(first.id)).toEqual(index.get(String(first.id)))
  })

  it('treats 12 and "12" identically, not just the first entity', () => {
    // The whole reason this module exists: by_entity keys arrive as strings
    // even though entities[].id is numeric. Exercise a non-trivial id.
    const index = buildEntityIndex(report)
    const numeric = index.get(12)
    const stringy = index.get('12')
    expect(numeric).not.toBeNull()
    expect(numeric).toEqual(stringy)
  })

  it('returns null for an unknown id rather than a placeholder entity', () => {
    expect(buildEntityIndex(report).get('99999999')).toBeNull()
  })

  it('separates squad from enemy players', () => {
    const index = buildEntityIndex(report)
    const squad = index.byRole('squad')
    expect(squad.length).toBeGreaterThan(0)
    expect(squad.every((e) => e.role === 'squad')).toBe(true)
    expect(index.roleCounts().squad).toBe(squad.length)
  })

  it('matches the known role histogram for the committed fixture', () => {
    // Ground truth from a spike parse of wvw-small.anon.zevtc with
    // { everything: true } — see task-2-report.md.
    const index = buildEntityIndex(report)
    expect(index.roleCounts()).toEqual({
      squad: 38,
      friendly_player: 4,
      enemy_player: 32,
      npc: 48
    })
  })

  it('finds every minions.by_entity key and confirms they are all squad', () => {
    const index = buildEntityIndex(report)
    const minionKeys = Object.keys(
      (report.blocks.minions as { by_entity?: Record<string, unknown> } | undefined)?.by_entity ??
        {}
    )
    expect(minionKeys).toHaveLength(15)
    for (const key of minionKeys) {
      const ref = index.get(key)
      expect(ref).not.toBeNull()
      expect(ref!.role).toBe('squad')
    }
  })

  it('substitutes a readable placeholder when a name is missing', () => {
    const index = buildEntityIndex({
      ...report,
      entities: [{ id: 7, role: 'npc' }]
    } as AxilogReport)
    expect(index.get(7)!.name).toBe('Unknown #7')
  })

  it('prefers character over name for player roles', () => {
    // Real axilog entities never carry a `name` field on player roles, but
    // the resolver should not silently produce "Unknown #n" if one is
    // absent — character is the correct source, confirmed here directly.
    const index = buildEntityIndex({
      ...report,
      entities: [
        { id: 1, role: 'squad', character: 'Anon133', account: 'Anon133.1234' }
      ]
    } as AxilogReport)
    expect(index.get(1)!.name).toBe('Anon133')
    expect(index.get(1)!.account).toBe('Anon133.1234')
  })

  it('uses name for non-player roles that carry no character/account', () => {
    const index = buildEntityIndex({
      ...report,
      entities: [{ id: 42, role: 'enemy_player', name: 'Anon100' }]
    } as AxilogReport)
    expect(index.get(42)!.name).toBe('Anon100')
    expect(index.get(42)!.account).toBe('')
  })

  it('resolves a loose name case-insensitively, and null when ambiguous', () => {
    const index = buildEntityIndex(report)
    const target = index.byRole('squad')[0]
    expect(index.resolveName(target.name.toLowerCase())!.id).toBe(target.id)
    expect(index.resolveName('definitely-not-a-player')).toBeNull()
  })

  it('resolves by account handle as well as by character name', () => {
    const index = buildEntityIndex(report)
    const target = index.byRole('squad').find((r) => r.account)!
    expect(target.account).not.toBe('')
    expect(index.resolveName(target.account)!.id).toBe(target.id)
    expect(index.resolveName(target.account.toUpperCase())!.id).toBe(target.id)
  })

  it('is ambiguous (returns null) when two entities share a name, not a guess', () => {
    const index = buildEntityIndex({
      ...report,
      entities: [
        { id: 1, role: 'squad', character: 'Duplicate', account: 'Duplicate.1111' },
        { id: 2, role: 'enemy_player', name: 'Duplicate' }
      ]
    } as AxilogReport)
    expect(index.resolveName('Duplicate')).toBeNull()
    // But the unambiguous account handle still resolves.
    expect(index.resolveName('Duplicate.1111')!.id).toBe('1')
  })

  it('trims incidental whitespace from a loose query', () => {
    const index = buildEntityIndex(report)
    const target = index.byRole('squad')[0]
    expect(index.resolveName(`  ${target.name}  `)!.id).toBe(target.id)
  })

  it('falls back to a unique substring match when no exact match exists', () => {
    // "133" is a unique substring across every entity's name+account in the
    // committed fixture -- it only matches entity id 1 ("Anon133" /
    // "Anon133.5921"), so a query for it should still resolve.
    const index = buildEntityIndex(report)
    const target = index.get(1)!
    expect(target.name).toBe('Anon133')
    expect(index.resolveName('133')!.id).toBe('1')
  })

  it('returns null for a substring shared by many entities', () => {
    // "Anon" is a prefix of dozens of entities' names in the fixture, so a
    // partial match must not silently pick one.
    const index = buildEntityIndex(report)
    expect(index.resolveName('Anon')).toBeNull()
  })

  it('prefers an exact match over being a substring of another entity', () => {
    const index = buildEntityIndex({
      ...report,
      entities: [
        { id: 1, role: 'squad', character: 'Anon1', account: 'Anon1.1111' },
        { id: 2, role: 'squad', character: 'Anon10', account: 'Anon10.2222' }
      ]
    } as AxilogReport)
    // "Anon1" is an exact match for entity 1 even though it is ALSO a
    // substring of entity 2's "Anon10" -- exact must win outright, not just
    // be preferred among ties.
    expect(index.resolveName('Anon1')!.id).toBe('1')
    // Its true substring-only counterpart still resolves via stage 2.
    expect(index.resolveName('non10')!.id).toBe('2')
  })
})
