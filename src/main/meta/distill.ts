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
    `Write a tight summary (a few sentences, or short bullets) of the builds, professions, ` +
    `and comp staples that are currently meta for ${modeName}. State only what the excerpts ` +
    `support; do not invent specifics. No preamble.\n\n` +
    `SOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
