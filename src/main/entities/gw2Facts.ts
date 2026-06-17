// gw2Facts.ts — Pure GW2 fact → EntityFact mapper.
// Text logic ported from AxiForge's formatFactHtml / formatBuffConditionText
// (axiforge/src/renderer/modules/detail-panel.js). Per-fact <img> icons and
// weapon-damage math are intentionally omitted (we have no weapon stats here).

import { normalizeFactType, stripGw2Markup } from '@axiapps/gw2-data'
import type { Gw2Fact } from '@axiapps/gw2-data'
import type { EntityFact } from './types'

// Buff-like normalized type names handled by formatBuffConditionText.
const BUFF_NORMALIZED = new Set(['Buff'])

/**
 * Ported from AxiForge's formatBuffConditionText.
 * Returns a single label string: "Name ×N (Ds)[: description]"
 */
function formatBuffConditionText(fact: Gw2Fact): string {
  const rawStatus = String(fact.status || fact.text || 'Unknown').replace(/\s*\(effect\)\s*$/i, '')
  const hasAltText = !!(fact.text && fact.status && fact.text !== fact.status
    && fact.text !== 'Apply Buff/Condition' && !/\(effect\)$/i.test(fact.text))
  const name = hasAltText ? String(fact.text) : rawStatus
  const count = Number(fact.apply_count) || 0
  const stackPart = count > 1 ? ` ×${count}` : ''
  const duration = fact.duration ? ` (${fact.duration}s)` : ''
  const extra = fact.description
    ? `: ${String(fact.description)}`
    : (fact.text && fact.status && fact.text !== fact.status && fact.text !== 'Apply Buff/Condition')
      ? `: ${String(fact.text)}`
      : ''
  return `${name}${stackPart}${duration}${extra}`
}

/**
 * Convert a single GW2 API fact object into an { label, value? } display row.
 * Returns null for facts that should not be shown (NoData, StunBreak, Unblockable,
 * or any type with no usable text).
 */
export function formatFact(fact: Gw2Fact): EntityFact | null {
  if (!fact || typeof fact !== 'object') return null

  // Normalise GW2 markup in text field upfront (mirrors AxiForge).
  const rawText = fact.text ? stripGw2Markup(String(fact.text)) : undefined

  const type = normalizeFactType(String(fact.type || ''))

  // ── Silently drop non-display facts ────────────────────────────────────────
  // NoData: section headers (conditional stances etc.) — return null.
  // StunBreak, Unblockable: icon-only in GW2 UI; no text value to show.
  if (type === 'NoData' || type === 'StunBreak' || type === 'Unblockable') return null

  // ── Recharge ───────────────────────────────────────────────────────────────
  if (type === 'Recharge' && fact.value != null) {
    return { label: 'Recharge', value: `${fact.value}s` }
  }

  // ── Time / Duration ────────────────────────────────────────────────────────
  if (type === 'Time' && fact.duration != null) {
    return { label: rawText || 'Duration', value: `${fact.duration}s` }
  }

  // ── Damage (text only; no weapon math) ────────────────────────────────────
  // Ported from AxiForge's "×coeff (N hits)" branch, dmgStats path dropped.
  if (type === 'Damage' && fact.dmg_multiplier != null) {
    const label = rawText || 'Damage'
    const hits = Number(fact.hit_count) || 1
    const coeff = (Number(fact.dmg_multiplier) * hits).toFixed(2)
    const value = hits > 1 ? `×${coeff} (${hits} hits)` : `×${coeff}`
    return { label, value }
  }

  // ── Buff / ApplyBuffCondition / PrefixedBuff (all normalize to "Buff") ─────
  if (BUFF_NORMALIZED.has(type)) {
    const label = formatBuffConditionText(fact)
    return { label }
  }

  // ── AttributeAdjust ────────────────────────────────────────────────────────
  if (type === 'AttributeAdjust' && fact.value != null) {
    const rawTarget = String((fact as { target?: string }).target || '')
    const targetLabel = rawTarget.replace(/([A-Z])/g, ' $1').trim()
    const label = (rawText && rawText !== 'AttributeAdjust') ? rawText : (targetLabel || 'Attribute')
    const val = fact.value
    const value = `${val > 0 ? '+' : ''}${val}`
    return { label, value }
  }

  // ── Radius / Range / Distance (Distance normalizes to Radius) ──────────────
  if (type === 'Radius' || type === 'Range') {
    const label = rawText || 'Range'
    const val = fact.value ?? fact.distance
    if (val != null) return { label, value: String(val) }
    return { label }
  }

  // ── Number ─────────────────────────────────────────────────────────────────
  if (type === 'Number' && fact.value != null) {
    const label = rawText || 'Number'
    return { label, value: String(fact.value) }
  }

  // ── Percent ────────────────────────────────────────────────────────────────
  if (type === 'Percent' && fact.percent != null) {
    const label = (rawText && rawText !== 'Percent') ? rawText : 'Percent'
    return { label, value: `${fact.percent}%` }
  }

  // ── ComboFinisher ──────────────────────────────────────────────────────────
  if (type === 'ComboFinisher') {
    const finisher = String(fact.finisher_type || '')
    // Ported from AxiForge: only append percent when < 100 (100% is implicit)
    const pct = fact.percent != null && fact.percent < 100 ? ` (${fact.percent}%)` : ''
    const value = finisher ? `${finisher}${pct}` : undefined
    return { label: 'Combo Finisher', value }
  }

  // ── ComboField ─────────────────────────────────────────────────────────────
  if (type === 'ComboField') {
    const value = fact.field_type ? String(fact.field_type) : undefined
    return { label: 'Combo Field', value }
  }

  // ── Unknown type fallback ──────────────────────────────────────────────────
  if (rawText) return { label: rawText }
  return null
}

/**
 * Map an array of GW2 API facts to display rows, dropping nulls and capping at max.
 */
export function formatFacts(facts: Gw2Fact[] | undefined, max = 10): EntityFact[] {
  if (!facts) return []
  const result: EntityFact[] = []
  for (const fact of facts) {
    if (result.length >= max) break
    const row = formatFact(fact)
    if (row) result.push(row)
  }
  return result
}
