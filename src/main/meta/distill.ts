// src/main/meta/distill.ts
//
// Compresses raw source excerpts for one game mode into a tight current-meta
// summary via a single cheap Claude call. Pure: the model is injected so it is
// fully testable, and so a missing/failed model simply yields null (the caller
// then leaves the previous notes intact — knowledge never regresses).

export type MetaModel = (prompt: string) => Promise<string>

/** One source's scraped text, tagged with its configured label so the distiller
 *  can attribute builds and dates to a REAL source (and never invent one). */
export interface SourceExcerpt {
  source: string
  text: string
}

export async function distill(
  modeName: string,
  excerpts: SourceExcerpt[],
  model: MetaModel,
  specMap: Record<string, string> = {},
  today = ''
): Promise<string | null> {
  const blocks = excerpts
    .map((e) => ({ source: e.source.trim() || 'unknown source', text: e.text.trim() }))
    .filter((e) => e.text)
  if (blocks.length === 0) return null
  // Prefix each excerpt with its source label so the model can only ever cite a
  // real, named source — the cure for invented attributions like "Aros site".
  const joined = blocks.map((e) => `## SOURCE: ${e.source}\n${e.text}`).join('\n\n---\n\n')
  const sourceNames = blocks.map((e) => e.source)

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
      `month/year, or a news-article date. Capture the most recent such date you can find PER ` +
      `source. If a source gives NO date, say so — do not assume it is current. When two sources ` +
      `disagree, weight the more recent one and note the conflict.\n`
    : ''

  const consensusBlock =
    `\n\nCONSENSUS — each excerpt is prefixed with "## SOURCE: <name>"; the only valid source ` +
    `names are: ${sourceNames.join(', ')}. Rank builds by BOTH cross-source agreement AND tier:\n` +
    `- A build MULTIPLE sources list, all at a high tier, is consensus meta — put it first.\n` +
    `- When sources DISAGREE on tier (e.g. Meta on one, Great on another), the build is NOT ` +
    `unambiguously Meta: NEVER upgrade it to the single highest tier a source gives. Record the ` +
    `split in the Tier cell (e.g. "Meta (MetaBattle) / Great (gw2mists)") and rank it BELOW builds ` +
    `every source rates Meta.\n` +
    `- A build only ONE source lists is lower-confidence: keep it, but write "single-source: <name>" ` +
    `in its Notes so it is not treated as equal to corroborated picks.\n` +
    `Cite ONLY the exact source names above — NEVER attribute a build to a source that did not ` +
    `list it, and NEVER invent a source name (e.g. do not write a site name that is not in that list).\n`

  const prompt =
    `You are compiling the CURRENT Guild Wars 2 ${modeName} meta from community sources.\n` +
    `The excerpts are raw page text and contain navigation menus, ads, and headings — ` +
    `IGNORE that boilerplate. Extract the meta builds: the profession and ELITE SPEC for each, ` +
    `its role (e.g. heal/quickness, power DPS, condi DPS, boon support), and any tier/rating.\n\n` +
    `FORMAT your answer exactly as:\n` +
    `1. An \`### As of\` line FIRST: the newest date or balance patch any source references, ` +
    `naming the source (e.g. "As of: June 2026 patch (MetaBattle); gw2mists undated"). If you ` +
    `found no date anywhere, write "As of: no source date found — treat tiers as possibly stale".\n` +
    `2. A markdown TABLE of the meta builds — one row per build, columns: ` +
    `\`Build\` (Profession + Elite Spec) | \`Role\` | \`Tier\` (the rating each source gives; if ` +
    `sources disagree, show the split per source — do NOT collapse to the highest) | ` +
    `\`Sources\` (which of the named sources list this build — exact names only, comma-separated) | ` +
    `\`Updated\` (the source's date/patch for this build or list, blank if none) | ` +
    `\`Notes\` (key weapons/sigils/runes or a one-line why; add "single-source: <name>" when only one ` +
    `source lists it). Leave a cell blank if the source doesn't say. Order rows by consensus first, ` +
    `then tier (S/A/B…) or role.\n` +
    `3. Then a short \`### Notes\` section — a few bullets on standout picks, the tradeoffs ` +
    `between variants, any recent shifts the sources mention, and EXPLICITLY flag any list that ` +
    `looks outdated (undated, or older than another source) or any build only one source backs.\n` +
    `Be specific and concise; state only what the excerpts support and do not invent traits, ` +
    `gear, DATES, or SOURCE NAMES. No preamble before the As-of line.\n` +
    dateBlock +
    consensusBlock +
    `\nCRITICAL — faithfulness over prior knowledge: Guild Wars 2 has expansions and elite ` +
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
