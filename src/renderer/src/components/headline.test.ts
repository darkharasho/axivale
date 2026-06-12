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
})

describe('stripMarkdown', () => {
  it('removes inline markers and leading heading syntax', () => {
    expect(stripMarkdown('## **Roster** _amended_!')).toBe('Roster amended!')
  })
})
