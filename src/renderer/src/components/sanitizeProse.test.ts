import { describe, it, expect } from 'vitest'
import { stripRawJson, normalizeEntityMarkers } from './sanitizeProse'

describe('normalizeEntityMarkers', () => {
  it('strips an unsupported [[spec:Name]] marker down to the bare name (keeps the auto class icon working)', () => {
    expect(normalizeEntityMarkers('[[spec:Firebrand]] maintains stability.')).toBe(
      'Firebrand maintains stability.'
    )
  })

  it('strips [[boon:Name]] to clean text', () => {
    expect(normalizeEntityMarkers('Generates [[boon:Quickness]] and [[boon:Alacrity]].')).toBe(
      'Generates Quickness and Alacrity.'
    )
  })

  it('leaves supported skill/trait/item markers intact for the entity linker', () => {
    const md = 'Uses [[skill:Well of Corruption]], [[trait:Spiteful Spirit]], and [[item:Rune of the Monk]].'
    expect(normalizeEntityMarkers(md)).toBe(md)
  })

  it('handles a mix in one line', () => {
    expect(
      normalizeEntityMarkers('[[spec:Harbinger]] casts [[skill:Well of Corruption]] for [[boon:Quickness]].')
    ).toBe('Harbinger casts [[skill:Well of Corruption]] for Quickness.')
  })

  it('is a no-op on empty input', () => {
    expect(normalizeEntityMarkers('')).toBe('')
  })
})

describe('stripRawJson', () => {
  it('removes a ```json fenced block', () => {
    const md = 'Here is the data:\n\n```json\n{"member_id":"abc","score":7}\n```\n\nBrotalis leads.'
    const out = stripRawJson(md)
    expect(out).not.toContain('member_id')
    expect(out).toContain('Here is the data:')
    expect(out).toContain('Brotalis leads.')
  })

  it('removes an untagged fence whose body is JSON', () => {
    const md = 'Result:\n\n```\n[{"a":1},{"b":2}]\n```\n\nDone.'
    expect(stripRawJson(md)).not.toContain('"a":1')
  })

  it('removes a bare JSON object paragraph', () => {
    const md = 'The lookup returned:\n\n{"query":"Bob","matches":[]}\n\nNo match found.'
    const out = stripRawJson(md)
    expect(out).not.toContain('"query"')
    expect(out).toContain('No match found.')
  })

  it('keeps non-JSON code blocks (e.g. build chatcodes)', () => {
    const md = 'Copy this build:\n\n```\n[&DQIYMxhk]\n```\n'
    expect(stripRawJson(md)).toContain('[&DQIYMxhk]')
  })

  it('leaves ordinary prose with braces untouched', () => {
    const md = 'We won {decisively} and the Reaper held the line.'
    expect(stripRawJson(md)).toBe(md)
  })
})
