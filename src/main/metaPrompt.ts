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
      const srcs = m.sources
        .map((s) => `${s.label} (${s.url}${s.sourceDate ? `, updated ${s.sourceDate}` : ''})`)
        .join(', ')
      const crawled = m.refreshedAt ? ` (crawled ${m.refreshedAt.slice(0, 10)})` : ''
      const head = `- ${m.mode}${crawled} — sources: ${srcs || 'none'}`
      return m.notes.trim() ? `${head}\n  notes: ${m.notes.trim()}` : head
    })
    .join('\n')
  return (
    `\n\n# GW2 meta reference\n` +
    `For build/comp/squad advice, treat these per-mode sources as the current-meta ` +
    `ground truth — prefer and cite them (e.g. "per Snowcrows…"), and flag when a ` +
    `build differs from meta. Still verify specifics via axiforge_catalog and ` +
    `gw2_api; never invent.\n` +
    `RECENCY: GW2 balance patches reshuffle tiers — a stale tier list can be wrong. ` +
    `Each mode's notes lead with an "As of" date, and a source's "updated <date>" label (when shown) ` +
    `is its own declared publish/modified date. Prefer the most recent source, and if a list is ` +
    `undated or predates a newer one, say so rather than presenting its tiers as current. ` +
    `The crawl date shows when AxiVale last fetched, not when the source was published.\n` +
    lines
  )
}
