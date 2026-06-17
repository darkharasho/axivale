import { describe, it, expect } from 'vitest'
import { extractPublishDate, newestDate } from './publishDate'

const NOW = Date.parse('2026-06-17T00:00:00Z')

describe('extractPublishDate', () => {
  it('reads JSON-LD dateModified', () => {
    const html = `<script type="application/ld+json">{"@type":"Article","datePublished":"2026-01-02","dateModified":"2026-06-10T09:00:00Z"}</script>`
    expect(extractPublishDate(html, NOW)).toBe('2026-06-10')
  })

  it('reads OpenGraph article:modified_time meta', () => {
    const html = `<meta property="article:modified_time" content="2026-05-20T12:00:00+00:00">`
    expect(extractPublishDate(html, NOW)).toBe('2026-05-20')
  })

  it('reads a <time datetime> element', () => {
    expect(extractPublishDate('<time datetime="2026-04-01">Apr 1</time>', NOW)).toBe('2026-04-01')
  })

  it('returns the newest across mixed signals', () => {
    const html = `<meta name="last-modified" content="2026-03-01">
      <time datetime="2026-06-15">latest</time>
      <script type="application/ld+json">{"datePublished":"2026-01-01"}</script>`
    expect(extractPublishDate(html, NOW)).toBe('2026-06-15')
  })

  it('ignores bogus pre-GW2 and far-future dates', () => {
    const html = `<time datetime="1998-01-01"></time><meta property="article:modified_time" content="2099-12-31">`
    expect(extractPublishDate(html, NOW)).toBeNull()
  })

  it('returns null when no date signal is present', () => {
    expect(extractPublishDate('<p>Power Reaper is strong</p>', NOW)).toBeNull()
    expect(extractPublishDate('', NOW)).toBeNull()
  })
})

describe('newestDate', () => {
  it('picks the latest parseable date', () => {
    expect(newestDate(['2026-01-01', undefined, '2026-06-10', null])).toBe('2026-06-10')
  })
  it('returns undefined when none parse', () => {
    expect(newestDate([null, undefined, 'not-a-date'])).toBeUndefined()
  })
})
