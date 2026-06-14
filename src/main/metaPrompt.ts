// src/main/metaPrompt.ts
//
// Builds the per-turn "GW2 meta reference" block appended to the system prompt:
// the current-meta ground-truth sources (+ notes) per game mode, so the model
// biases build/comp/squad advice toward meta and cites the right source. Returns
// '' (with no leading separator) when there are no modes — zero overhead.

import type { MetaMode } from './metaStore'

export function buildMetaReference(modes: MetaMode[]): string {
  if (modes.length === 0) return ''
  const lines = modes
    .map((m) => {
      const srcs = m.sources.map((s) => `${s.label} (${s.url})`).join(', ')
      const head = `- ${m.mode} — sources: ${srcs || 'none'}`
      return m.notes.trim() ? `${head}\n  notes: ${m.notes.trim()}` : head
    })
    .join('\n')
  return (
    `\n\n# GW2 meta reference\n` +
    `For build/comp/squad advice, treat these per-mode sources as the current-meta ` +
    `ground truth — prefer and cite them (e.g. "per Snowcrows…"), and flag when a ` +
    `build differs from meta. Still verify specifics via axiforge_catalog and ` +
    `gw2_api; never invent.\n` +
    lines
  )
}
