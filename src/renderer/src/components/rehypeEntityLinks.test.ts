// src/renderer/src/components/rehypeEntityLinks.test.ts
import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { rehypeEntityLinks } from './rehypeEntityLinks'

const dict = {
  entries: [
    { name: 'Superior Rune of the Monk', type: 'item' as const },
    { name: 'Lily of the Elon', type: 'skill' as const },
    { name: 'Shelter', type: 'skill' as const },
    { name: 'Rune', type: 'item' as const }
  ]
}

function run(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeEntityLinks, { dictionary: dict })
      .use(rehypeStringify)
      .processSync(html)
  )
}

describe('rehypeEntityLinks — marker pass', () => {
  it('wraps [[skill:Shelter]] into an entity span', () => {
    expect(run('<p>Use [[skill:Shelter]] now</p>')).toContain(
      '<span class="axi-entity axi-entity--skill" data-entity-type="skill" data-entity-name="Shelter">Shelter</span>'
    )
  })
})

describe('rehypeEntityLinks — text pass', () => {
  it('wraps a bare exact name match', () => {
    expect(run('<p>Cast Shelter here</p>')).toContain('data-entity-name="Shelter"')
  })
  it('prefers the longest match', () => {
    const out = run('<p>Superior Rune of the Monk rocks</p>')
    expect(out).toContain('data-entity-name="Superior Rune of the Monk"')
    expect(out).not.toContain('>Rune</span>')
  })
  it('does not match inside a word (token boundary)', () => {
    expect(run('<p>Sheltered units</p>')).not.toContain('axi-entity')
  })
  it('is case-sensitive', () => {
    expect(run('<p>take shelter</p>')).not.toContain('axi-entity')
  })
  it('skips text inside code and anchors', () => {
    expect(run('<p><code>Shelter</code> and <a href="x">Shelter</a></p>')).not.toContain('axi-entity')
  })
  it('does not double-wrap an existing entity span', () => {
    const once = run('<p>Shelter</p>')
    expect(run(once)).toBe(once.replace(/<\/?html>|<\/?head>|<\/?body>/g, ''))
  })
})
