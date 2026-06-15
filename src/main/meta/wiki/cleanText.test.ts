import { describe, it, expect } from 'vitest'
import { cleanWikiText } from './cleanText'

describe('cleanWikiText', () => {
  it('strips HTML tags, bold quotes, and table attributes from a rune-stat row', () => {
    const raw =
      "'''Gain concentration equal to 2% of your precision'''<br>'''Gain concentration equal to 2% of your healing power'''<br> +10% Experience from kills. | 30 minutes | 30 | style=\"text-align:right;\" | |- | | '''Gain concentration equal to 2% of your precision'''<br> done"
    const out = cleanWikiText(raw)
    expect(out).not.toMatch(/<[^>]+>/) // no HTML tags
    expect(out).not.toContain("'''") // no bold markers
    expect(out).not.toContain('style=') // no cell attributes
    expect(out).not.toContain('|') // no pipe delimiters
    expect(out).not.toContain('|-') // no row separators
    // real content survives
    expect(out).toContain('Gain concentration equal to 2% of your precision')
    expect(out).toContain('30 minutes')
    expect(out).toContain('+10% Experience from kills.')
  })

  it('cleans a table-heavy "List of runes" tail to readable prose', () => {
    const raw =
      '|- ! colspan="7" | <h3>Ferocity</h3> |- |- ! colspan="7" | <h3>Healing Power</h3> |- |} == List of runes == * The following table gives an overview of all available runes. ;Other == Notes == * With the release of the \'\'Secrets of the Obscure\'\' expansion, many 6th tier bonuses in runes were reworked as Relics replaced this functionality. == See also == * Sigil * de:Rune es:Runa fr:Run'
    const out = cleanWikiText(raw)
    expect(out).not.toContain('colspan')
    expect(out).not.toMatch(/<[^>]+>/)
    expect(out).not.toContain('|')
    expect(out).not.toContain('==')
    expect(out).not.toMatch(/\bde:Rune\b/) // interlanguage links gone
    // headings and content survive as plain text
    expect(out).toContain('Ferocity')
    expect(out).toContain('Healing Power')
    expect(out).toContain('List of runes')
    expect(out).toContain('Secrets of the Obscure')
    expect(out).toContain('Relics replaced this functionality')
  })

  it('keeps exclamation marks inside prose (only table ! markers go)', () => {
    expect(cleanWikiText('Watch out! This hits hard.')).toBe('Watch out! This hits hard.')
  })

  it('decodes common HTML entities', () => {
    expect(cleanWikiText('Spike Trap &amp; Flame Trap&nbsp;deal damage')).toBe(
      'Spike Trap & Flame Trap deal damage'
    )
  })

  it('returns empty string for empty input', () => {
    expect(cleanWikiText('')).toBe('')
  })
})
