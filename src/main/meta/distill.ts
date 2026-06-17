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
  model: MetaModel,
  specMap: Record<string, string> = {},
  today = ''
): Promise<string | null> {
  const joined = rawTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
  if (!joined) return null

  const specLines = Object.entries(specMap)
    .map(([spec, prof]) => `${spec} = ${prof}`)
    .join('; ')
  const specBlock = specLines
    ? `\n\nAUTHORITATIVE elite-spec → profession map (from the official GW2 API — this is GROUND TRUTH and OVERRIDES both the source text and your own assumptions). When the source names an elite spec, ALWAYS pair it with the profession listed here:\n${specLines}\n`
    : ''

  const dateBlock = today
    ? `\n\nRECENCY — today is ${today}. GW2 balance patches reshuffle the meta, so an old ` +
      `tier list can be actively wrong. As you read, hunt for each source's date signals: a ` +
      `"last updated"/"published" date, a balance-patch name or date it references, a ` +
      `"季/quarter" or month/year, or a news-article date. Capture the most recent such date you ` +
      `can find PER tier list/source. If a source gives NO date, say so — do not assume it is ` +
      `current. When two sources disagree, weight the more recent one and note the conflict.\n`
    : ''

  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} meta from community sources.\n` +
    `The excerpts are raw page text and contain navigation menus, ads, and headings — ` +
    `IGNORE that boilerplate. Extract the meta builds: the profession and ELITE SPEC for each, ` +
    `its role (e.g. heal/quickness, power DPS, condi DPS, boon support), and any tier/rating.\n\n` +
    `FORMAT your answer exactly as:\n` +
    `1. An \`### As of\` line FIRST: the newest date or balance patch any source references ` +
    `(e.g. "As of: June 2026 balance patch (gw2mists); MetaBattle page undated"). If you found ` +
    `no date anywhere, write "As of: no source date found — treat tiers as possibly stale".\n` +
    `2. A markdown TABLE of the meta builds — one row per build, columns: ` +
    `\`Build\` (Profession + Elite Spec) | \`Role\` | \`Tier\` (if the source gives one) | ` +
    `\`Updated\` (the source's date/patch for this build or list, blank if none) | ` +
    `\`Notes\` (key weapons/sigils/runes or a one-line why). Leave a cell blank if the source ` +
    `doesn't say. If the source groups by tier (S/A/B…) or role, order the rows that way.\n` +
    `3. Then a short \`### Notes\` section — a few bullets on standout picks, the tradeoffs ` +
    `between variants, any recent shifts the sources mention, and EXPLICITLY flag any list that ` +
    `looks outdated (undated, or older than another source) so its tier rankings are not trusted blindly.\n` +
    `Be specific and concise; state only what the excerpts support and do not invent traits, ` +
    `gear, or DATES. No preamble before the As-of line.\n` +
    dateBlock + `\n` +
    `CRITICAL — faithfulness over prior knowledge: Guild Wars 2 has expansions and elite ` +
    `specializations released after your training. Treat every profession, elite-spec, build, ` +
    `and item name in the excerpts as AUTHORITATIVE and copy it VERBATIM — including which ` +
    `profession each elite spec belongs to. Do NOT rename, "correct", reassign, or substitute ` +
    `any name from your own knowledge; if an elite spec looks unfamiliar (e.g. Amalgam, ` +
    `Luminary, Paragon, Ritualist), keep it exactly as written with whatever profession the ` +
    `source pairs it with. Never pair a profession and elite spec the source did not pair.` +
    (specBlock
      ? ` When a spec appears in the AUTHORITATIVE map below, that map is GROUND TRUTH and ` +
        `overrides any conflicting pairing in the source text.`
      : '') +
    specBlock +
    `\n\nSOURCE EXCERPTS:\n${joined}`

  const out = (await model(prompt)).trim()
  return out || null
}
