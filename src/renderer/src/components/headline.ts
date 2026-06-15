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

function rawSplitHeadline(text: string): { headline: string; rest: string } {
  const trimmed = text.replace(/^\s+/, '')
  const sentenceEnd = trimmed.match(/[.!?](?=\s|$)|\n/)
  if (sentenceEnd && sentenceEnd.index !== undefined) {
    const isNewline = trimmed[sentenceEnd.index] === '\n'
    const end = isNewline ? sentenceEnd.index : sentenceEnd.index + 1
    if (end <= HEADLINE_MAX) {
      return { headline: trimmed.slice(0, end).trim(), rest: trimmed.slice(end).trim() }
    }
  }
  // Long single sentence: break at a clause boundary instead.
  const clause = trimmed.match(/[,;:—](?=\s)/)
  if (clause && clause.index !== undefined && clause.index <= HEADLINE_MAX) {
    return {
      headline: trimmed.slice(0, clause.index).trim(),
      rest: trimmed.slice(clause.index + 1).trim()
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
