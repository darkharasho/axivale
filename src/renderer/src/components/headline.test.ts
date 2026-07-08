import { describe, it, expect } from 'vitest'
import { splitHeadline, stripMarkdown } from './headline'

describe('splitHeadline', () => {
  it('splits at the first sentence end', () => {
    const { headline, rest } = splitHeadline('Roster amended. Three recruits sworn in.')
    expect(headline).toBe('Roster amended.')
    expect(rest).toBe('Three recruits sworn in.')
  })

  it('does not split at dots inside account names', () => {
    const { headline } = splitHeadline(
      'Mooliciouss.3492 is the longest-standing member. They joined in 2022.'
    )
    expect(headline).toBe('Mooliciouss.3492 is the longest-standing member.')
  })

  it('splits at newlines', () => {
    const { headline, rest } = splitHeadline('Roster update\nDetails follow here')
    expect(headline).toBe('Roster update')
    expect(rest).toBe('Details follow here')
  })

  it('falls back to a clause break for one long sentence', () => {
    const text =
      '**Mooliciouss.3492 is EWW’s longest-standing member**, joining 2022-11-04 at 03:36 UTC — edging out guild leader harasho.2840, who joined the same day less than an hour later (04:28).'
    const { headline, rest } = splitHeadline(text)
    expect(headline).toBe('**Mooliciouss.3492 is EWW’s longest-standing member**')
    expect(rest).toMatch(/^joining 2022-11-04/)
  })

  it('keeps short text wholly as headline', () => {
    expect(splitHeadline('All quiet on the wire')).toEqual({
      headline: 'All quiet on the wire',
      rest: ''
    })
  })

  it('never puts a leading {{figure}} marker in the headline', () => {
    const { headline, rest } = splitHeadline('{{figure}}\n\nHere is the build. More below.')
    expect(headline).toBe('Here is the build.')
    expect(rest).toBe('{{figure}}\n\nMore below.')
  })

  it('relocates a {{figure}} that lands inside the headline to the body', () => {
    const { headline, rest } = splitHeadline('The build {{figure}} is meta.\n\nDetails.')
    expect(headline).toBe('The build is meta.')
    expect(rest).toBe('{{figure}}\n\nDetails.')
  })

  it('preserves order across multiple leading figures', () => {
    const { headline, rest } = splitHeadline('{{figure}}\n{{figure}}\nTwo charts. Body.')
    expect(headline).toBe('Two charts.')
    expect(rest).toBe('{{figure}}\n\n{{figure}}\n\nBody.')
  })

  it('skips a meta preamble sentence and headlines the first real one', () => {
    const text =
      'One note: I tried to save "Not Haro = harasho" to durable memory but the memory tool hit an internal error, so it didn\'t stick — I\'ll re-attempt next time, or you can tell me to retry. Want me to line this up against the other active tags?'
    const { headline, rest } = splitHeadline(text)
    expect(headline).toBe('Want me to line this up against the other active tags?')
    expect(rest).toMatch(/^One note: I tried to save/)
  })

  it('skips other meta openers (FYI, heads-up) the same way', () => {
    const { headline, rest } = splitHeadline(
      'FYI, the wiki lookup was slow tonight so some icons may lag. Monday under Not Haro was a strong night. Details below.'
    )
    expect(headline).toBe('Monday under Not Haro was a strong night.')
    expect(rest).toMatch(/^FYI, the wiki lookup was slow tonight/)
    expect(rest).toMatch(/Details below\.$/)
  })

  it('keeps a lone meta sentence as headline when there is nothing else', () => {
    const text = 'One note: the memory save failed.'
    expect(splitHeadline(text).headline).toBe(text)
  })

  it('does not treat "Note harasho tags…" (no punctuation) as a meta opener', () => {
    const { headline } = splitHeadline(
      'Note harasho tags as a Troubadour support. Damage is expected to sit near the bottom.'
    )
    expect(headline).toBe('Note harasho tags as a Troubadour support.')
  })

  it('rejects stub clause fragments and breaks at the next clause instead', () => {
    const text =
      'So, the squad K/D collapsed on both outnumbered nights because the backline kept extending past cleave range without stability coverage or a rez priority call from the tag driving the engagement pattern'
    const { headline } = splitHeadline(text)
    expect(headline).not.toBe('So')
    expect(headline.length).toBeGreaterThanOrEqual(20)
    expect(headline.length).toBeLessThanOrEqual(140)
  })
})

describe('stripMarkdown', () => {
  it('removes inline markers and leading heading syntax', () => {
    expect(stripMarkdown('## **Roster** _amended_!')).toBe('Roster amended!')
  })
})
