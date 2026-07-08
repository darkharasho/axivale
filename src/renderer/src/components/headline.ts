const HEADLINE_MAX = 140

/**
 * Split agent text into a headline (lede) and the remaining body.
 *
 * A sentence ends at . ! or ? only when followed by whitespace or
 * end-of-text — dots inside account names (Mooliciouss.3492) don't count.
 * If the first sentence runs long, fall back to the first clause break;
 * past that, the whole text stays in the headline.
 */
const FIGURE_MARKER = /\{\{\s*figure\s*\}\}/gi
const LEADING_FIGURES = /^(?:\s*\{\{\s*figure\s*\}\}\s*)+/i

export function splitHeadline(text: string): { headline: string; rest: string } {
  // Figure markers ({{figure}}) are inline-figure placeholders for the body —
  // they must never become the headline. Pull any that lead the text off the
  // top, and (below) relocate any that land inside the chosen headline, so the
  // figures still render in the body in their original order.
  let trimmed = text.replace(/^\s+/, '')
  const lead = trimmed.match(LEADING_FIGURES)
  let figureCount = lead ? (lead[0].match(FIGURE_MARKER) || []).length : 0
  if (lead) trimmed = trimmed.slice(lead[0].length).replace(/^\s+/, '')

  let { headline, rest } = rawSplitHeadline(trimmed)

  const inHeadline = headline.match(FIGURE_MARKER)
  if (inHeadline) {
    headline = headline.replace(FIGURE_MARKER, '').replace(/\s{2,}/g, ' ').trim()
    figureCount += inHeadline.length
  }
  if (figureCount > 0) {
    const markers = Array(figureCount).fill('{{figure}}').join('\n\n')
    rest = rest ? `${markers}\n\n${rest}` : markers
  }
  return { headline, rest }
}

// A headline shorter than this is a stub ("One note", "So") — not a title.
const HEADLINE_MIN = 20

// Meta preambles are asides, not headlines: "One note: …", "FYI, …",
// "Heads up — …". The opener must be followed by punctuation so real prose
// like "Note harasho tags as a Troubadour" doesn't match.
const META_OPENER =
  /^(?:(?:one|a)\s+(?:quick\s+|small\s+|last\s+|final\s+)?(?:note|caveat|aside|thing)|(?:quick|small|side|final|last)\s+(?:note|caveat|aside)|note|fyi|btw|by the way|heads[\s-]?up|psa|housekeeping)\s*[:,—–-]/i

const SENTENCE_END = /[.!?](?=\s|$)|\n/

function firstSentence(text: string): { body: string; end: number } | null {
  const m = text.match(SENTENCE_END)
  if (!m || m.index === undefined) return null
  const end = text[m.index] === '\n' ? m.index : m.index + 1
  return { body: text.slice(0, end), end }
}

function rawSplitHeadline(text: string): { headline: string; rest: string } {
  let trimmed = text.replace(/^\s+/, '')
  // Skip up to two meta preamble sentences and headline the first real one.
  // The skipped sentences aren't lost — they lead the body instead.
  let preamble = ''
  for (let skips = 0; skips < 2; skips++) {
    const s = firstSentence(trimmed)
    if (!s || !META_OPENER.test(s.body)) break
    const after = trimmed.slice(s.end).replace(/^\s+/, '')
    if (!after) break // a lone meta sentence still has to be the headline
    preamble = preamble ? `${preamble} ${s.body.trim()}` : s.body.trim()
    trimmed = after
  }
  const { headline, rest } = pickHeadline(trimmed)
  if (!preamble) return { headline, rest }
  return { headline, rest: rest ? `${preamble}\n\n${rest}` : preamble }
}

function pickHeadline(trimmed: string): { headline: string; rest: string } {
  const sentenceEnd = trimmed.match(SENTENCE_END)
  if (sentenceEnd && sentenceEnd.index !== undefined) {
    const isNewline = trimmed[sentenceEnd.index] === '\n'
    const end = isNewline ? sentenceEnd.index : sentenceEnd.index + 1
    if (end <= HEADLINE_MAX) {
      return { headline: trimmed.slice(0, end).trim(), rest: trimmed.slice(end).trim() }
    }
  }
  // Long single sentence: break at a clause boundary — the first one that
  // yields something title-sized, not a stub like "So" or "One note".
  for (const clause of trimmed.matchAll(/[,;:—](?=\s)/g)) {
    if (clause.index === undefined || clause.index > HEADLINE_MAX) break
    if (clause.index < HEADLINE_MIN) continue
    return {
      headline: trimmed.slice(0, clause.index).trim(),
      rest: trimmed.slice(clause.index + 1).trim()
    }
  }
  // No title-sized clause either: cut at the last word boundary inside the
  // limit rather than letting a wall of text be the headline.
  if (trimmed.length > HEADLINE_MAX) {
    const cut = trimmed.lastIndexOf(' ', HEADLINE_MAX)
    if (cut >= HEADLINE_MIN) {
      return { headline: trimmed.slice(0, cut).trim(), rest: trimmed.slice(cut + 1).trim() }
    }
  }
  if (sentenceEnd && sentenceEnd.index !== undefined) {
    const end = trimmed[sentenceEnd.index] === '\n' ? sentenceEnd.index : sentenceEnd.index + 1
    return { headline: trimmed.slice(0, end).trim(), rest: trimmed.slice(end).trim() }
  }
  return { headline: trimmed, rest: '' }
}

/** The lede is set in display type; markdown syntax would show literally. */
export function stripMarkdown(text: string): string {
  return text.replace(/^[#>\s]+/, '').replace(/[*_`~]/g, '')
}
