// gw2Facts.test.ts — TDD: written before implementation (RED phase)
import { describe, it, expect } from 'vitest'
import { formatFact, formatFacts } from './gw2Facts'

describe('formatFact', () => {
  it('Recharge → label Recharge, value Xs', () => {
    expect(formatFact({ type: 'Recharge', value: 4 })).toEqual({ label: 'Recharge', value: '4s' })
  })

  it('Time → label from text or Duration, value Xs', () => {
    expect(formatFact({ type: 'Time', text: 'Duration', duration: 3 })).toEqual({ label: 'Duration', value: '3s' })
    expect(formatFact({ type: 'Time', duration: 6 })).toEqual({ label: 'Duration', value: '6s' })
  })

  it('Range → label from text, value as string', () => {
    expect(formatFact({ type: 'Range', text: 'Range', value: 1200 })).toEqual({ label: 'Range', value: '1200' })
  })

  it('Radius → label from text, value as string (distance fallback)', () => {
    expect(formatFact({ type: 'Radius', text: 'Radius', value: 240 })).toEqual({ label: 'Radius', value: '240' })
    // Distance normalizes to Radius
    expect(formatFact({ type: 'Distance', text: 'Radius', distance: 120 })).toEqual({ label: 'Radius', value: '120' })
  })

  it('Number → label from text, value as string', () => {
    expect(formatFact({ type: 'Number', text: 'Targets', value: 5 })).toEqual({ label: 'Targets', value: '5' })
  })

  it('Percent → label from text, value as N%', () => {
    expect(formatFact({ type: 'Percent', text: 'Boon Duration', percent: 20 })).toEqual({ label: 'Boon Duration', value: '20%' })
  })

  it('AttributeAdjust → label from text, value with + sign', () => {
    expect(formatFact({ type: 'AttributeAdjust', text: 'Power', value: 100 })).toEqual({ label: 'Power', value: '+100' })
    expect(formatFact({ type: 'AttributeAdjust', text: 'Power', value: -50 })).toEqual({ label: 'Power', value: '-50' })
  })

  it('Buff with apply_count > 1 and duration → Name ×N (Ds)', () => {
    expect(formatFact({ type: 'Buff', status: 'Might', apply_count: 3, duration: 8 }))
      .toEqual({ label: 'Might ×3 (8s)' })
  })

  it('Buff single stack with duration → Name (Ds)', () => {
    expect(formatFact({ type: 'Buff', status: 'Fury', duration: 5 }))
      .toEqual({ label: 'Fury (5s)' })
  })

  it('Buff without duration → just name', () => {
    expect(formatFact({ type: 'Buff', status: 'Regeneration' }))
      .toEqual({ label: 'Regeneration' })
  })

  it('ApplyBuffCondition normalizes to Buff', () => {
    expect(formatFact({ type: 'ApplyBuffCondition', status: 'Bleeding', apply_count: 2, duration: 4 }))
      .toEqual({ label: 'Bleeding ×2 (4s)' })
  })

  it('PrefixedBuff normalizes to Buff', () => {
    expect(formatFact({ type: 'PrefixedBuff', status: 'Stability', duration: 3 }))
      .toEqual({ label: 'Stability (3s)' })
  })

  it('ComboFinisher → label Combo Finisher, value finisher_type + percent if < 100', () => {
    expect(formatFact({ type: 'ComboFinisher', finisher_type: 'Blast', percent: 100 }))
      .toEqual({ label: 'Combo Finisher', value: 'Blast' })
    expect(formatFact({ type: 'ComboFinisher', finisher_type: 'Projectile', percent: 20 }))
      .toEqual({ label: 'Combo Finisher', value: 'Projectile (20%)' })
  })

  it('ComboField → label Combo Field, value field_type', () => {
    expect(formatFact({ type: 'ComboField', field_type: 'Fire' }))
      .toEqual({ label: 'Combo Field', value: 'Fire' })
  })

  it('Damage → label from text, value ×coeff (N hits)', () => {
    expect(formatFact({ type: 'Damage', text: 'Damage', hit_count: 3, dmg_multiplier: 1.5 }))
      .toEqual({ label: 'Damage', value: '×4.50 (3 hits)' })
    expect(formatFact({ type: 'Damage', text: 'Damage', hit_count: 1, dmg_multiplier: 0.8 }))
      .toEqual({ label: 'Damage', value: '×0.80' })
  })

  it('strips GW2 markup from text fields', () => {
    expect(formatFact({ type: 'Number', text: '<c=@reminder>colored</c>', value: 5 }))
      .toEqual({ label: 'colored', value: '5' })
  })

  it('Buff description strips GW2 color markup', () => {
    const result = formatFact({ type: 'Buff', status: 'Regeneration', duration: 5, description: 'Gain <c=@reminder>health</c> every second.' })
    expect(result?.label).toContain('health')
    expect(result?.label).not.toContain('<c=')
    expect(result?.label).not.toContain('</c>')
  })

  it('unknown type with text falls back to label only', () => {
    expect(formatFact({ type: 'SomeFutureType', text: 'Special thing' }))
      .toEqual({ label: 'Special thing' })
  })

  it('unknown type without text returns null', () => {
    expect(formatFact({ type: 'SomeFutureType' })).toBeNull()
  })

  it('NoData returns null', () => {
    expect(formatFact({ type: 'NoData', text: 'Section header' })).toBeNull()
  })

  it('StunBreak returns null', () => {
    expect(formatFact({ type: 'StunBreak' })).toBeNull()
  })

  it('Unblockable returns null', () => {
    expect(formatFact({ type: 'Unblockable' })).toBeNull()
  })

  it('null/undefined fact returns null', () => {
    expect(formatFact(null as never)).toBeNull()
    expect(formatFact(undefined as never)).toBeNull()
  })
})

describe('formatFacts', () => {
  it('drops null-returning facts', () => {
    const facts = [
      { type: 'NoData', text: 'Header' },
      { type: 'Recharge', value: 4 },
    ]
    expect(formatFacts(facts)).toEqual([{ label: 'Recharge', value: '4s' }])
  })

  it('caps at max (default 10)', () => {
    const facts = Array.from({ length: 15 }, (_, i) => ({ type: 'Recharge', value: i + 1 }))
    expect(formatFacts(facts)).toHaveLength(10)
  })

  it('respects custom max', () => {
    const facts = Array.from({ length: 5 }, (_, i) => ({ type: 'Recharge', value: i + 1 }))
    expect(formatFacts(facts, 3)).toHaveLength(3)
  })

  it('returns empty array for undefined input', () => {
    expect(formatFacts(undefined)).toEqual([])
  })
})
