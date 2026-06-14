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
    `IGNORE that boilerplate. Extract the meta builds: name the profession and ELITE SPEC ` +
    `for each, its role (e.g. heal/quickness, power DPS, condi DPS, boon support), and any ` +
    `tier/rating if present. Group by role or tier. Be specific and concise; state only what ` +
    `the excerpts support and do not invent traits or gear. No preamble.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
