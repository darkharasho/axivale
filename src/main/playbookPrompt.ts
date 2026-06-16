// src/main/playbookPrompt.ts
//
// Builds the per-turn "comp playbook" block appended to the system prompt: the
// guild's blessed, curated comp baseline + principles, surfaced as top-priority
// ground truth. Framed as a BASELINE TO ITERATE, never an optimal comp. Returns
// '' when no mode has a blessed playbook — zero overhead.

import type { MetaMode } from './metaStore'

export function buildPlaybookReference(modes: MetaMode[]): string {
  const blocks = modes
    .filter((m) => m.playbook?.blessed && (m.playbook.principles.trim() || m.playbook.derived))
    .map((m) => {
      const p = m.playbook
      const lines: string[] = [`## ${m.mode} comp playbook — guild baseline (a starting point to ITERATE from, NOT an optimal comp)`]
      const d = p.derived
      if (d) {
        lines.push(
          `Derived from ${d.sampleSize} reports (${d.window.fromISO}–${d.window.toISO}, last ${d.window.days}d) across ${d.sourceRepos.join(', ')}.${d.lowConfidence ? ' LOW CONFIDENCE — thin sample; weight the principles over the numbers.' : ''}`,
          `Squad ~${d.avgSquadSize}, ${d.supportPct}% support.`
        )
        if (d.professions.length) {
          const top = d.professions.slice(0, 12).map((x) => `${x.name} ${x.avgPerSquad}/squad (${x.presencePct}%, ${x.runAs})`)
          lines.push(`Builds actually run: ${top.join('; ')}.`)
        }
        if (d.subgroup.core.length) {
          lines.push(`Modal subgroup: ${d.subgroup.core.join(' + ')}${d.subgroup.flex.length ? ` + 1 flex (${d.subgroup.flex.join(' / ')})` : ''}.`)
        }
      }
      if (p.principles.trim()) lines.push(p.principles.trim())
      if (p.overrides.trim()) lines.push(`Guild overrides: ${p.overrides.trim()}`)
      lines.push(
        `When building or critiquing a ${m.mode} comp: start from this baseline, apply the principles, and prefer these builds over a generic DPS tier list. Explain tradeoffs and invite iteration; never present it as the single optimal comp.`
      )
      return lines.join('\n')
    })
  if (blocks.length === 0) return ''
  return `\n\n# Comp playbook\n${blocks.join('\n\n')}`
}
