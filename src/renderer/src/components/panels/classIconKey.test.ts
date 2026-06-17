import { describe, it, expect } from 'vitest'
import { classIconKeys, lookupClassIcon } from './classIconKey'
import { classIconUrl } from './classIcons'

describe('classIconKeys', () => {
  it('lowercases and trims', () => {
    expect(classIconKeys('  Reaper ')[0]).toBe('reaper')
  })

  it('strips a "core" prefix qualifier', () => {
    expect(classIconKeys('Core Necromancer')).toContain('necromancer')
  })

  it('strips a "(core)" suffix qualifier', () => {
    expect(classIconKeys('Necromancer (core)')).toContain('necromancer')
  })

  it('strips a trailing plural "s"', () => {
    expect(classIconKeys('Spellbreakers')).toContain('spellbreaker')
  })
})

describe('lookupClassIcon', () => {
  const data = { necromancer: 'NECRO', spellbreaker: 'SB' }

  it('resolves a core-qualified profession', () => {
    expect(lookupClassIcon(data, 'Core Necromancer')).toBe('NECRO')
  })

  it('resolves a plural', () => {
    expect(lookupClassIcon(data, 'Spellbreakers')).toBe('SB')
  })

  it('returns null for unknown names', () => {
    expect(lookupClassIcon(data, 'Barbarian')).toBeNull()
  })
})

describe('classIconUrl (real data)', () => {
  it('resolves "Core Necromancer" to the necromancer icon', () => {
    expect(classIconUrl('Core Necromancer')).toBe(classIconUrl('Necromancer'))
  })

  it('resolves plurals to the singular icon', () => {
    expect(classIconUrl('Spellbreakers')).toBe(classIconUrl('Spellbreaker'))
  })
})
