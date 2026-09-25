import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// import.meta.url, not __dirname: package.json sets "type": "module", so this
// file is ESM and __dirname does not exist in it.
const themeCss = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

/** The :root block only — where tokens are declared. */
const rootBlock = themeCss.slice(
  themeCss.indexOf(':root{'),
  themeCss.indexOf('}', themeCss.indexOf(':root{')) + 1
)

describe('token bridge', () => {
  it('declares no raw hex colours in :root', () => {
    expect(rootBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('aliases every legacy token onto an axi token', () => {
    for (const name of [
      'bg',
      'bg2',
      'paper',
      'line',
      'rule',
      'rule2',
      'ink',
      'ink-dim',
      'faint',
      'accent',
      'green',
      'amber'
    ]) {
      expect(rootBlock).toMatch(new RegExp(`--${name}\\s*:\\s*var\\(--axi-`))
    }
  })

  it('derives --accent-b from the live accent rather than pinning it', () => {
    expect(rootBlock).toMatch(
      /--accent-b\s*:\s*color-mix\(in srgb,\s*var\(--axi-accent\)\s*82%,\s*white\)/
    )
  })

  it('derives --focus from the live accent rather than pinning it', () => {
    expect(rootBlock).toMatch(/--focus\s*:\s*color-mix\(in srgb,\s*var\(--axi-accent\)/)
  })
})

/** The `body{...}` rule, which is where the app's ground is drawn. */
const bodyRule = themeCss.match(/(?:^|\n)body\{[^}]*\}/)?.[0] ?? ''

describe('sanctioned departures', () => {
  // Without this, an extraction that silently matches nothing turns every
  // `not.toMatch` below into a test that passes because it asserts on ''.
  it('extracts a non-empty body rule to assert against', () => {
    expect(bodyRule).toMatch(/^\nbody\{/)
  })

  it('draws the body on the flat ground, with no gradient', () => {
    expect(bodyRule).toMatch(/background:\s*var\(--axi-ground\)/)
    expect(bodyRule).not.toMatch(/gradient/)
  })

  it('does not set a serif body font', () => {
    expect(bodyRule).not.toMatch(/font-family/)
  })

  // Departure 2 of 2: the halftone scanline, scoped to the reading column
  // rather than painted across the app.
  it('scopes the scanline to the editorial column', () => {
    const chatcol = themeCss.match(/\.chatcol\{[^}]*\}/)?.[0] ?? ''
    expect(chatcol).toMatch(/repeating-linear-gradient/)
  })

  it('uses repeating-linear-gradient nowhere but the scanline', () => {
    expect(themeCss.match(/repeating-linear-gradient/g)).toHaveLength(1)
  })

  // Departure 1 of 2: the torn paper edges, on user clippings and the input.
  it('keeps exactly two clip-path torn edges, drawn on the axi surface', () => {
    expect(themeCss.match(/clip-path/g)).toHaveLength(2)
    expect(themeCss).not.toMatch(/\.msg\.user \.body::after\{[^}]*var\(--paper\)/)
    expect(themeCss).not.toMatch(/\.inputzone::before\{[^}]*var\(--paper\)/)
  })
})

describe('editorial typography', () => {
  // body is sans now, so anything that used to inherit its serif has to say so
  // itself. These two are the reading column: the AI article and the user's
  // clipping sit side by side, and one of them turning sans is the bug this
  // pins. .prose in particular inherited serif and declared nothing.
  it.each(['.prose', '.msg.user .body'])('%s declares its serif rather than inheriting it', (sel) => {
    const rule = themeCss.match(new RegExp(`\\${sel.replace(/ /g, ' ')}\\{[^}]*\\}`))?.[0] ?? ''
    expect(rule).not.toBe('')
    expect(rule).toMatch(/font-family:\s*'Source Serif 4'/)
  })

  it('keeps Playfair on the selectors the spec names', () => {
    for (const sel of ['.lede', '.folio h1', '.action-modal__title']) {
      const rule = themeCss.match(new RegExp(`\\${sel}\\{[^}]*\\}`))?.[0] ?? ''
      expect(rule, sel).toMatch(/font-family:\s*'Playfair Display'/)
    }
    expect(themeCss).toMatch(
      /\.prose > p:first-child::first-letter\{[^}]*'Playfair Display'/
    )
    expect(themeCss).toMatch(/\.prose h1,\.prose h2,\.prose h3,\.prose h4\{[^}]*'Playfair Display'/)
  })

  // Inventory pin, not a target. The spec named five Playfair selectors from
  // memory of the article surface; the file has 27, and they include the
  // masthead nameplate and every panel headline. A headline is editorial
  // wherever it sits, so they stay — but a new one has to change this number
  // deliberately rather than drift in. See ledger Ruling T4.
  it('pins the Playfair inventory so new display type is a deliberate choice', () => {
    expect(themeCss.match(/'Playfair Display'/g)).toHaveLength(27)
  })

  // --axi-t-* shorthands resolve var(--axi-mono) at :root and inherit already
  // substituted, so overriding the token here would re-font nothing while
  // looking like it should. IBM Plex Mono is applied by name instead.
  it('never overrides the --axi-mono token', () => {
    expect(themeCss).not.toMatch(/--axi-mono\s*:/)
  })
})

describe('line vocabulary', () => {
  // axi draws one rule colour at two weights; AxiVale drew three colours in
  // three styles. Weight carries the hierarchy now, so the styles go.
  it.each(['dashed', 'dotted', 'double'])('draws no %s rule anywhere', (style) => {
    expect(themeCss).not.toMatch(new RegExp(`\\b${style}\\b`))
  })

  it('converts the structural rules to the control weight', () => {
    for (const sel of ['.folio', '.mnav', '.prose hr', '.mtop']) {
      const rule = themeCss.match(new RegExp(`\\${sel}\\{[^}]*\\}`))?.[0] ?? ''
      expect(rule, `${sel} not found`).not.toBe('')
      expect(rule, sel).toMatch(/var\(--axi-border-control\) solid var\(--axi-rule\)/)
    }
  })

  it('converts the subordinate rules to the hairline weight', () => {
    for (const sel of ['.byline', '.rip .t']) {
      const rule = themeCss.match(new RegExp(`\\${sel.replace('.t', '\\.t')}\\{[^}]*\\}`))?.[0] ?? ''
      expect(rule, `${sel} not found`).not.toBe('')
      expect(rule, sel).toMatch(/var\(--axi-border-hairline\) solid var\(--axi-rule\)/)
    }
  })

  it('deletes the reading column’s side rules rather than thickening them', () => {
    const chatcol = themeCss.match(/\.chatcol\{[^}]*\}/)?.[0] ?? ''
    expect(chatcol).not.toMatch(/border-left|border-right/)
  })

  it('gives prose links axi’s treatment', () => {
    expect(themeCss).toMatch(/\.prose a\{color:var\(--axi-accent\);font-weight:600;text-underline-offset:2px\}/)
  })

  it('takes axi’s blockquote: an accent bar on the ground, not a doubled rule', () => {
    const bq = themeCss.match(/\.prose blockquote\{[^}]*\}/)?.[0] ?? ''
    expect(bq).toMatch(/border-left:var\(--axi-border-panel\) solid var\(--axi-accent\)/)
    expect(bq).toMatch(/background:var\(--axi-ground\)/)
  })

  it('adopts the family diamond as the prose bullet (rule 7)', () => {
    const bullet = themeCss.match(/\.prose ul > li::before\{[^}]*\}/)?.[0] ?? ''
    expect(bullet).toMatch(/transform:rotate\(45deg\)/)
    expect(bullet).toMatch(/background:var\(--axi-accent\)/)
  })

  it('makes .folio-act a real control rather than a dashed outline', () => {
    const act = themeCss.match(/\.folio-act\{[^}]*\}/)?.[0] ?? ''
    expect(act).toMatch(/border:var\(--axi-border-control\) solid var\(--axi-ink-line\)/)
    expect(themeCss).toMatch(/\.folio-act:hover\{[^}]*box-shadow:var\(--axi-offset-control\)/)
  })
})

/** Pulls a single rule block out by selector, for the per-selector checks. */
function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return themeCss.match(new RegExp(escaped + '\\{[^}]*\\}'))?.[0] ?? ''
}

describe('raised surfaces', () => {
  // These were nine hand-copied implementations of one idea: background
  // var(--paper), 1px solid var(--rule2), 4px 4px 0 rgba(0,0,0,.4) — which is
  // an axi panel, copied eight times at the wrong border weight.
  const POPOVERS = [
    '.earsw-menu',
    '.ctx-menu',
    '.ssel-menu',
    '.clspick-menu',
    '.skill-typeahead',
    '.wnm'
  ]

  it.each(POPOVERS)('%s is drawn at panel weight on the ink line', (sel) => {
    const rule = ruleFor(sel)
    expect(rule, sel + ' not found').not.toBe('')
    expect(rule, sel + ' border').toMatch(
      /border:var\(--axi-border-panel\) solid var\(--axi-ink-line\)/
    )
    expect(rule, sel + ' block').toMatch(
      /box-shadow:var\(--axi-offset-panel\) var\(--axi-offset-panel\) 0 var\(--axi-ink-line\)/
    )
  })

  const SCRIMS = ['.overlay', '.share-overlay', '.action-overlay', '.wnm-scrim']

  it.each(SCRIMS)('%s uses the shared scrim token', (sel) => {
    const rule = ruleFor(sel)
    expect(rule, sel + ' not found').not.toBe('')
    expect(rule, sel).toMatch(/background:var\(--axi-scrim\)/)
  })

  it('draws no blur anywhere - rule 3 replaces depth cues with a block', () => {
    expect(themeCss).not.toMatch(/backdrop-filter|filter:\s*blur/)
  })

  it('gives the action modal panel weight and drops its inset newsprint frame', () => {
    const modal = ruleFor('.action-modal')
    expect(modal).toMatch(/border:var\(--axi-border-panel\) solid var\(--axi-ink-line\)/)
    expect(modal).toMatch(
      /box-shadow:var\(--axi-offset-panel\) var\(--axi-offset-panel\) 0 var\(--axi-ink-line\)/
    )
    // The inset 1px frame was a newsprint device standing in for the outline
    // axi now draws properly.
    expect(themeCss).not.toMatch(/\.action-modal::before/)
  })

  it('draws the stamp statuses in status inks, not translucent washes', () => {
    expect(themeCss).toMatch(/\.action-modal__stamp\.ok\{color:var\(--axi-ok\)\}/)
    expect(themeCss).toMatch(/\.action-modal__stamp\.fail\{color:var\(--axi-danger\)\}/)
  })
})

describe('controls', () => {
  it.each(['.btn-stamp', '.btn-out'])('%s is outlined on the ink line at control weight', (sel) => {
    const rule = ruleFor(sel)
    expect(rule, sel + ' not found').not.toBe('')
    expect(rule, sel).toMatch(/border:var\(--axi-border-control\) solid var\(--axi-ink-line\)/)
  })

  it('gives the primary button the accent ink rather than white', () => {
    const rule = ruleFor('.btn-stamp')
    expect(rule).toMatch(/color:var\(--axi-accent-ink\)/)
    expect(rule).not.toMatch(/#fff/)
  })

  // Rule 4: hover lifts. The primary button rests with a block already under
  // it, so it deepens the block rather than gaining one — translating both
  // together would leave the lower-right edge where it started, which reads
  // as growing rather than lifting.
  it('lifts the buttons on hover rather than fading them', () => {
    expect(themeCss).toMatch(
      /\.btn-stamp:hover\{[^}]*box-shadow:var\(--axi-offset-control-hover\)[^}]*transform:translate\(-2px,-2px\)/
    )
    expect(themeCss).toMatch(
      /\.btn-out:hover\{[^}]*box-shadow:var\(--axi-offset-control\)[^}]*transform:translate\(-2px,-2px\)/
    )
  })

  it('drops the outline the stamp button used as a second border', () => {
    expect(themeCss).not.toMatch(/outline-color:var\(--accent-b\)/)
    expect(themeCss).not.toMatch(/outline:3px solid var\(--accent\)/)
  })

  // Anything filled with the accent takes --axi-accent-ink on top, never a
  // hardcoded white. The accent is now user-chosen, and four of the eleven
  // (axi-gold, amber-warm, emerald-mint, slate-silver) are light enough that
  // white-on-accent is unreadable. This was invisible while the accent was
  // always AxiVale's dark red.
  it('never prints white on an accent fill', () => {
    expect(themeCss).not.toMatch(/color:#fff;background:var\(--accent\)/)
    expect(themeCss).not.toMatch(/background:var\(--accent\);color:#fff/)
  })

  // Rule 5 and rule 6: the accent is not a status. Close is the one
  // destructive control in the chrome.
  it('fills the close button with the danger ink, not the accent', () => {
    expect(themeCss).toMatch(/\.winctl button\.close:hover\{[^}]*background:var\(--axi-danger\)/)
  })

  it('hovers icon buttons on the neutral ramp, not a translucent wash', () => {
    const hover = ruleFor('.edition .ed-acts button:hover')
    expect(hover).toMatch(/background:var\(--axi-surface-raised\)/)
    expect(hover).not.toMatch(/rgba/)
  })
})

describe('fields', () => {
  // The underlined field was the last newsprint device left in the chrome.
  // axi boxes its fields, so an input reads as a control rather than as a
  // ruled line someone happens to type on.
  it.each(['.sinput', '.ed-search'])('%s is boxed rather than underlined', (sel) => {
    const rule = ruleFor(sel)
    expect(rule, sel + ' not found').not.toBe('')
    expect(rule, sel).toMatch(/border:var\(--axi-border-control\) solid var\(--axi-ink-line\)/)
    expect(rule, sel + ' still underlined').not.toMatch(/border-bottom:/)
  })

  it('sits fields on the ground, not on a translucent black wash', () => {
    for (const sel of ['.sinput', '.ed-search']) {
      expect(ruleFor(sel), sel).toMatch(/background:var\(--axi-ground\)/)
    }
  })

  // The checkbox mark is always in the DOM and revealed with opacity, so the
  // box never changes size as it toggles.
  it('draws the checkbox in axi terms, with the mark in the accent ink', () => {
    expect(ruleFor('.wt-opt input')).toMatch(
      /border:var\(--axi-border-control\) solid var\(--axi-ink-line\)/
    )
    expect(ruleFor('.wt-opt input::after')).toMatch(/var\(--axi-accent-ink\)/)
    expect(ruleFor('.wt-opt input::after')).toMatch(/opacity:0/)
  })
})
