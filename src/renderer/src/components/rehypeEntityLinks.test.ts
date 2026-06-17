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

// Dictionary with icons for testing data-entity-icon
const dictWithIcons = {
  entries: [
    { name: 'Shelter', type: 'skill' as const, icon: 'https://render.guildwars2.com/file/shelter.png' },
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

function runAuto(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeEntityLinks, { dictionary: dict, autoTextMatch: true })
      .use(rehypeStringify)
      .processSync(html)
  )
}

function runWithIcons(html: string): string {
  return String(
    unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeEntityLinks, { dictionary: dictWithIcons })
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

describe('rehypeEntityLinks — default (markers-only, autoTextMatch=false)', () => {
  it('still wraps [[skill:Shelter]] marker', () => {
    expect(run('<p>Use [[skill:Shelter]] now</p>')).toContain('data-entity-name="Shelter"')
  })
  it('does NOT wrap bare "Shelter" in prose (Leap fix)', () => {
    expect(run('<p>Cast Shelter here</p>')).not.toContain('axi-entity')
  })
  it('does NOT wrap bare entity names at all', () => {
    expect(run('<p>Superior Rune of the Monk rocks</p>')).not.toContain('axi-entity')
  })
})

describe('rehypeEntityLinks — data-entity-icon attribute', () => {
  it('emits data-entity-icon when dictionary entry has an icon (marker)', () => {
    const out = runWithIcons('<p>Use [[skill:Shelter]] now</p>')
    expect(out).toContain('data-entity-icon="https://render.guildwars2.com/file/shelter.png"')
  })
  it('does NOT emit data-entity-icon when dictionary entry has no icon (marker)', () => {
    const out = runWithIcons('<p>Use [[item:Rune]] now</p>')
    expect(out).toContain('data-entity-name="Rune"')
    expect(out).not.toContain('data-entity-icon')
  })
  it('emits data-entity-icon when dictionary entry has an icon (text pass)', () => {
    const outAuto = String(
      unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeEntityLinks, { dictionary: dictWithIcons, autoTextMatch: true })
        .use(rehypeStringify)
        .processSync('<p>Cast Shelter here</p>')
    )
    expect(outAuto).toContain('data-entity-icon="https://render.guildwars2.com/file/shelter.png"')
  })
  it('does NOT emit data-entity-icon when text-pass entry has no icon', () => {
    const outAuto = String(
      unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeEntityLinks, { dictionary: dictWithIcons, autoTextMatch: true })
        .use(rehypeStringify)
        .processSync('<p>Uses Rune here</p>')
    )
    expect(outAuto).toContain('data-entity-name="Rune"')
    expect(outAuto).not.toContain('data-entity-icon')
  })
})

describe('rehypeEntityLinks — text pass (autoTextMatch: true)', () => {
  it('wraps a bare exact name match', () => {
    expect(runAuto('<p>Cast Shelter here</p>')).toContain('data-entity-name="Shelter"')
  })
  it('prefers the longest match', () => {
    const out = runAuto('<p>Superior Rune of the Monk rocks</p>')
    expect(out).toContain('data-entity-name="Superior Rune of the Monk"')
    expect(out).not.toContain('>Rune</span>')
  })
  it('does not match inside a word (token boundary)', () => {
    expect(runAuto('<p>Sheltered units</p>')).not.toContain('axi-entity')
  })
  it('is case-sensitive', () => {
    expect(runAuto('<p>take shelter</p>')).not.toContain('axi-entity')
  })
  it('skips text inside code and anchors', () => {
    expect(runAuto('<p><code>Shelter</code> and <a href="x">Shelter</a></p>')).not.toContain('axi-entity')
  })
  it('does not double-wrap an existing entity span', () => {
    const once = runAuto('<p>Shelter</p>')
    expect(runAuto(once)).toBe(once.replace(/<\/?html>|<\/?head>|<\/?body>/g, ''))
  })

  // Nested skip-zone tests — text nested under a skip ancestor (not just an immediate skip parent)
  it('skips text inside <pre> (immediate parent skip)', () => {
    expect(runAuto('<pre>Shelter</pre>')).not.toContain('axi-entity')
  })
  it('skips text inside a heading <h2>', () => {
    expect(runAuto('<h2>Shelter</h2>')).not.toContain('axi-entity')
  })
  it('skips text nested via <em> inside <h2>', () => {
    expect(runAuto('<h2><em>Shelter</em></h2>')).not.toContain('axi-entity')
  })
  it('skips text nested via <strong> inside <a>', () => {
    expect(runAuto('<a href="x"><strong>Shelter</strong></a>')).not.toContain('axi-entity')
  })
  it('skips text nested via <code> inside <pre>', () => {
    expect(runAuto('<pre><code>Shelter</code></pre>')).not.toContain('axi-entity')
  })
})

describe('rehypeEntityLinks — shared-regex lastIndex safety', () => {
  it('correctly wraps entities on two sequential runs reusing the same dictionary object', () => {
    // Both runs use the same `dict` object (same WeakMap entry → same shared regex).
    // If lastIndex were not reset between runs, the second run could miss matches.
    const run1 = runAuto('<p>Cast Shelter here</p>')
    const run2 = runAuto('<p>Cast Shelter again</p>')
    expect(run1).toContain('data-entity-name="Shelter"')
    expect(run2).toContain('data-entity-name="Shelter"')
  })
})
