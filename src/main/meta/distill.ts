// src/main/meta/distill.ts
//
// Compresses raw source excerpts for one game mode into a tight current-meta
// summary via a single cheap Claude call. Pure: the model is injected so it is
// fully testable, and so a missing/failed model simply yields null (the caller
// then leaves the previous notes intact — knowledge never regresses).

export type MetaModel = (prompt: string) => Promise<string>

export async function distill(
  modeName: string,
  rawTexts: string[],
  model: MetaModel
): Promise<string | null> {
  const joined = rawTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
  if (!joined) return null

  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} meta from community sources.\n` +
    `The excerpts are raw page text and contain navigation menus, ads, and headings — ` +
    `IGNORE that boilerplate. Extract the meta builds: the profession and ELITE SPEC for each, ` +
    `its role (e.g. heal/quickness, power DPS, condi DPS, boon support), and any tier/rating.\n\n` +
    `FORMAT your answer exactly as:\n` +
    `1. A markdown TABLE of the meta builds — one row per build, columns: ` +
    `\`Build\` (Profession + Elite Spec) | \`Role\` | \`Tier\` (if the source gives one) | ` +
    `\`Notes\` (key weapons/sigils/runes or a one-line why). Leave a cell blank if the source ` +
    `doesn't say. If the source groups by tier (S/A/B…) or role, order the rows that way.\n` +
    `2. Then a short \`### Notes\` section — a few bullets on standout picks, the tradeoffs ` +
    `between variants, and any recent shifts the sources mention.\n` +
    `Be specific and concise; state only what the excerpts support and do not invent traits ` +
    `or gear. No preamble before the table.\n\n` +
    `CRITICAL — faithfulness over prior knowledge: Guild Wars 2 has expansions and elite ` +
    `specializations released after your training. Treat every profession, elite-spec, build, ` +
    `and item name in the excerpts as AUTHORITATIVE and copy it VERBATIM — including which ` +
    `profession each elite spec belongs to. Do NOT rename, "correct", reassign, or substitute ` +
    `any name from your own knowledge; if an elite spec looks unfamiliar (e.g. Amalgam, ` +
    `Luminary, Paragon, Ritualist), keep it exactly as written with whatever profession the ` +
    `source pairs it with. Never pair a profession and elite spec the source did not pair.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
