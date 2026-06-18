import { describe, it, expect } from 'vitest'
import { domainsIn, gradeSource } from './grade'

describe('domainsIn', () => {
  it('extracts hostnames and strips www', () => {
    expect(domainsIn('see https://www.gw2mists.com/en/builds/x and http://snowcrows.com/y')).toEqual([
      'gw2mists.com',
      'snowcrows.com'
    ])
  })
})

describe('gradeSource', () => {
  it('passes when includes match and excludes are absent', () => {
    expect(() =>
      gradeSource('DPS Warrior — Berserker (gw2mists)', { include: [/Berserker/], exclude: [/snowcrows/i] })
    ).not.toThrow()
  })

  it('throws when an excluded pattern appears', () => {
    expect(() => gradeSource('wrong source: snowcrows', { exclude: [/snowcrows/i] })).toThrow()
  })
})
