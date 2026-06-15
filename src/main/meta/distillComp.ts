// src/main/meta/distillComp.ts
//
// Compresses WvW comp-RULE pages (guides + wiki mechanics) into a tight
// "Squad Composition" section appended to a mode's meta notes. Sibling of
// distill.ts (which handles build tables); same pure, model-injected contract:
// empty input or empty model output → null, so the caller keeps prior notes.

import type { MetaModel } from './distill'

export async function distillComp(
  modeName: string,
  ruleTexts: string[],
  model: MetaModel
): Promise<string | null> {
  const joined = ruleTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
  if (!joined) return null

  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} squad-composition RULES ` +
    `from community guides and the official wiki. The excerpts are raw page text with ` +
    `navigation, ads, and headings — IGNORE that boilerplate. Extract COMPOSITION rules, ` +
    `not a list of individual builds.\n\n` +
    `FORMAT your answer as a section that begins with the exact heading ` +
    `"## Squad Composition" followed by:\n` +
    `1. The ROLE TAXONOMY — each squad role and the boons/duties it covers (e.g. ` +
    `Primary Support → Stability, Resistance, Protection; Boon Strip DPS → enemy boon ` +
    `removal + CC).\n` +
    `2. PER-SUBGROUP requirements — what every 5-player subgroup must cover, and which ` +
    `roles pair together.\n` +
    `3. SQUAD-WIDE notes — scale (havoc vs zerg), boon-target caps, and any ratios the ` +
    `sources state. If a source gives a hard number (e.g. boons affect 5 targets, max 15 ` +
    `subgroups), include it and attribute it to the wiki.\n\n` +
    `Be concise; state only what the excerpts support. Do NOT invent ratios the sources ` +
    `do not give — say "sources give no fixed ratio" instead.\n\n` +
    `CRITICAL — faithfulness over prior knowledge: GW2 has expansions and elite specs ` +
    `released after your training. Copy every profession, elite-spec, and role name ` +
    `VERBATIM from the excerpts (e.g. Evoker, Untamed, Amalgam, Luminary, Spectre, ` +
    `Paragon, Troubadour); never rename, "correct", or reassign one from your own ` +
    `knowledge.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
