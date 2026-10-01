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
    // background-color + background-image (not the background shorthand) so
    // glass's --axi-ground-image atmosphere is not discarded; both still
    // resolve to var(--axi-ground) / var(--axi-ground-image), and the latter
    // is 'none' outside glass, so this is inert everywhere else.
    expect(bodyRule).toMatch(/background-color:\s*var\(--axi-ground\)/)
    expect(bodyRule).toMatch(/background-image:\s*var\(--axi-ground-image\)/)
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

  // Departure 1 of 2: the torn paper edge on user clippings. The composer used
  // to carry a second one; it became a card, and a card's accent strip already
  // draws its top edge — two competing top edges is one too many. One torn
  // edge left, and it is the one that reads as a clipping.
  it('keeps exactly one clip-path torn edge, drawn on the axi surface', () => {
    expect(themeCss.match(/clip-path/g)).toHaveLength(1)
    expect(themeCss).toMatch(/\.msg\.user \.body::after\{[^}]*clip-path/)
    expect(themeCss).not.toMatch(/\.msg\.user \.body::after\{[^}]*var\(--paper\)/)
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
    for (const sel of ['.folio', '.masthead', '.prose hr', '.mtop']) {
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
    expect(themeCss).toMatch(/\.folio-act:hover\{[^}]*box-shadow:var\(--axi-shadow-control\)/)
  })
})

/** Pulls a single rule block out by selector, for the per-selector checks. */
function ruleFor(selector: string): string {
  // Part of this file is minified and part is prettier-formatted, so the brace
  // may or may not be preceded by whitespace.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return themeCss.match(new RegExp(escaped + '\\s*\\{[^}]*\\}'))?.[0] ?? ''
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
      /box-shadow:var\(--axi-shadow-panel\)/
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
      /box-shadow:var\(--axi-shadow-panel\)/
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
      /\.btn-stamp:hover\{[^}]*box-shadow:var\(--axi-shadow-control-hover\)[^}]*transform:translate\(-2px,-2px\)/
    )
    expect(themeCss).toMatch(
      /\.btn-out:hover\{[^}]*box-shadow:var\(--axi-shadow-control\)[^}]*transform:translate\(-2px,-2px\)/
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
  // Whitespace-tolerant and order-independent, and it covers --accent-b too:
  // --accent-b is the accent mixed TOWARD white, so white on it is strictly
  // worse than white on the accent. Half this file is minified and half is
  // prettier-formatted, and the first version of this assertion could only
  // match the minified half — which is how .mi-tab.sel and .mi-pill.sel
  // survived the first sweep.
  it('never prints white on an accent fill', () => {
    const offenders = (themeCss.match(/[^{}]+\{[^}]*\}/g) ?? []).filter((rule) => {
      const filled = /background(?:-color)?:\s*var\(--(?:axi-)?accent(?:-b)?\)/.test(rule)
      const white = /color:\s*(?:#fff(?:fff)?\b|white\b|rgba\(\s*255\s*,\s*255\s*,\s*255)/.test(rule)
      return filled && white
    })
    expect(offenders.map((r) => r.slice(0, r.indexOf('{')).trim())).toEqual([])
  })

  // The inverse pattern: accent-coloured text on a white fill. axi-gold on
  // white is 1.58:1 — the update banner's action button disappears.
  it('never prints the accent on a white fill', () => {
    const offenders = (themeCss.match(/[^{}]+\{[^}]*\}/g) ?? []).filter(
      (rule) =>
        /background(?:-color)?:\s*(?:#fff(?:fff)?\b|white\b)/.test(rule) &&
        /color:\s*var\(--(?:axi-)?accent(?:-b)?\)/.test(rule)
    )
    expect(offenders.map((r) => r.slice(0, r.indexOf('{')).trim())).toEqual([])
  })

  // Translucent white borders and text read as "white" against whatever is
  // under them, and every one of these sits on an accent fill.
  it('draws nothing in translucent white on the update banner', () => {
    for (const sel of ['.ub-flag', '.ub-dismiss', '.ub-dismiss:hover', '.ub-btn', '.sbtn']) {
      expect(ruleFor(sel), sel).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255|#fff\b/)
    }
  })

  // Rule 5 and rule 6: the accent is not a status. Close is the one
  // destructive control in the chrome.
  it('fills the close button with the danger ink, not the accent', () => {
    expect(themeCss).toMatch(/\.winctl button\.close:hover\{[^}]*background:var\(--axi-danger\)/)
  })

  // --axi-ink-line is the *outline* colour. Flat and glass relight it to a
  // translucent white, so a glyph written in it on a saturated fill washes out
  // — which is why --axi-ink-on-fill was split out of it. The close button's X
  // was the live bug: near-black on axi, a ghost on the red under glass.
  it('writes on a saturated fill with an ink meant for a fill', () => {
    const offenders = (themeCss.match(/[^{}]+\{[^}]*\}/g) ?? []).filter(
      (rule) =>
        /background(?:-color)?:\s*var\(--(?:axi-)?(?:accent|accent-b|danger|ok|warn)\)/.test(rule) &&
        /[;{]\s*color:\s*var\(--axi-ink-line\)/.test(rule)
    )
    expect(offenders.map((r) => r.slice(0, r.indexOf('{')).trim())).toEqual([])
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

describe('tables', () => {
  // Rule 8: the panel is the raised thing and the table is what is inside it.
  // The header rule is the control weight so the head reads as a lid on the
  // column; the row rules are the hairline, which is the case that token
  // exists for — a line inside running content.
  it('wraps the table in the panel and leaves the table itself unoutlined', () => {
    const wrap = ruleFor('.dtable')
    expect(wrap).toMatch(/border:var\(--axi-border-panel\) solid var\(--axi-ink-line\)/)
    expect(wrap).toMatch(/background:var\(--axi-surface\)/)
  })

  it('gives the header the control weight and the rows the hairline', () => {
    expect(ruleFor('.dtable th')).toMatch(
      /border-bottom:var\(--axi-border-control\) solid var\(--axi-rule\)/
    )
    expect(ruleFor('.dtable td')).toMatch(
      /border-bottom:var\(--axi-border-hairline\) solid var\(--axi-rule\)/
    )
  })

  it('hovers a row on the neutral ramp, not an ink', () => {
    expect(ruleFor('.dtable tbody tr:hover td')).toMatch(/background:var\(--axi-surface-raised\)/)
  })

  // Zebra striping and a hover highlight answer the same question. axi answers
  // it with the hover, and forty rows each carrying a translucent wash is the
  // tinted-everything failure rule 2 is about.
  it('does not stripe rows with a translucent wash', () => {
    expect(themeCss).not.toMatch(/nth-child\(even\)\{[^}]*rgba/)
  })

  it('keeps the sortable-header affordance', () => {
    expect(ruleFor('.richtable th')).toMatch(/cursor:pointer/)
  })
})

describe('quantities', () => {
  // Rule 9: a quantity is drawn as length, never intensity. The track is the
  // ground, the fill is the value, and the fill is one ink at full strength.
  it('draws the learning meter as a track and a fill', () => {
    expect(ruleFor('.learn-bar')).toMatch(
      /border:\s*var\(--axi-border-control\) solid var\(--axi-ink-line\)/
    )
    expect(ruleFor('.learn-fill')).toMatch(/background:\s*var\(--axi-series,\s*var\(--axi-accent\)\)/)
  })

  // MetaLearningBanner.test.tsx reads .learn-fill's inline style.width, so a
  // competing width declaration here would be a real bug, not a style nit.
  it('leaves .learn-fill’s width to the component', () => {
    expect(ruleFor('.learn-fill')).not.toMatch(/[^-]width:/)
  })

  it('draws the confidence bar in the status inks', () => {
    expect(ruleFor('.cfillbar')).toMatch(/background:var\(--axi-ok\)/)
    expect(ruleFor('.csign.partial .cfillbar')).toMatch(/background:var\(--axi-warn\)/)
  })

  // Rule 11: an indicator of work animates a composited property.
  // background-position is neither composited nor legal under rule 1.
  it.each(['.wskel .wbar::after', '.axi-ecard__row::after'])(
    '%s sweeps with a transform rather than a gradient',
    (sel) => {
      expect(ruleFor(sel), sel).toMatch(/animation:/)
    }
  )

  it('animates no background-position anywhere', () => {
    expect(themeCss).not.toMatch(/background-position:\s*-?\d+%/)
  })
})

describe('the gradient allowlist', () => {
  // Ruling P1: an allowlist rather than a count. A count says "three" and
  // tells a reader nothing about which three are sanctioned; this fails the
  // moment a gradient appears on a selector nobody argued for.
  //
  // - .chatcol  departure 2 of 2, the halftone scanline
  //
  // The two overflow masks that used to sit here (.edition .ed-acts and
  // .meta-summary.collapsed::after) are gone: both faded a surface out to
  // hide an overflow, which is exactly the depth-by-atmosphere effect rule 1
  // rejects. They are a solid ground and a hairline cut now.
  it('permits gradients only on the scanline', () => {
    const rules = themeCss.match(/[^{}]+\{[^}]*gradient[^}]*\}/g) ?? []
    const selectors = rules.map((r) => r.slice(0, r.indexOf('{')).trim().split('\n').pop()!.trim())
    expect(selectors.sort()).toEqual(['.chatcol'])
  })

  it('uses no repeating gradient but the scanline', () => {
    expect(themeCss.match(/repeating-linear-gradient/g)).toHaveLength(1)
  })

  it('draws no radial gradient at all', () => {
    expect(themeCss).not.toMatch(/radial-gradient/)
  })
})

describe('accent propagation', () => {
  // The picker is only as good as the rules that follow it. These washes were
  // written when the accent was always AxiVale's crimson, so they were spelled
  // as literal rgba of that colour — pick teal-ocean and the chrome goes teal
  // while every hover, the selection colour and the active row stay red.
  it('hardcodes the legacy crimson nowhere', () => {
    expect(themeCss).not.toMatch(/rgba\(\s*200\s*,\s*66\s*,\s*58/)
    expect(themeCss).not.toMatch(/rgba\(\s*224\s*,\s*90\s*,\s*80/)
  })
})

describe('reduced motion', () => {
  // The file had already decided to suppress the tactile nudge; the hover
  // lifts added later have to answer to the same decision.
  it('suppresses every hover translate it introduces', () => {
    const block =
      themeCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(block).not.toBe('')
    for (const sel of ['.btn-stamp', '.btn-out', '.folio-act', '.accent-swatch']) {
      expect(block, sel + ' not suppressed').toContain(sel)
    }
    expect(block).toMatch(/transform:\s*none/)
  })
})

describe('entity autolinks', () => {
  // .axi-entity is a <span>, not an <a>, so it has no UA underline to fall
  // back on. Stripping its text-decoration left it visually identical to
  // every other accent-coloured run of text, and the hover-card affordance
  // undiscoverable.
  it('keeps an underline on the entity autolink', () => {
    expect(ruleFor('.axi-entity')).toMatch(/text-decoration:/)
  })
})

describe('the form steps', () => {
  // The redo's whole argument in three assertions. Every surface below the
  // chat column used to draw itself with 1px rules, soft radii and blurred
  // drops; those are three separate vocabularies axi does not have, and each
  // one crept back in the last time by being copied from the rule above it.
  // These fail on the copy, not on the review.

  it('draws no 1px border — axi has no 1px step', () => {
    // 2px hairline (subordinate), 3px control, 4px panel. Nothing else.
    expect(themeCss).not.toMatch(/:\s*1px\s+solid/)
  })

  it('rounds nothing but the spinner', () => {
    const radii = themeCss.match(/border-radius:\s*[^;}]+/g) ?? []
    const nonZero = radii.filter((r) => !/:\s*(0|var\(--axi-radius\b)/.test(r))
    // .meta-spin is a rotating ring: a square one would read as a tumbling
    // box, which says "broken", not "working".
    expect(nonZero).toEqual(['border-radius: 50%'])
  })

  // Every lift asks the language for its relief instead of spelling one out.
  // Hand-composing `var(--axi-offset-panel) var(--axi-offset-panel) 0
  // var(--axi-ink-line)` pinned this app to the default surface's hard step:
  // flat and glass zero the offsets and restate --axi-shadow-* as a soft drop,
  // so a hand-assembled block simply vanished under them. --axi-shadow-* is
  // the one token a theme repaints to say what "raised" means in its material,
  // which is why this now pins the composed token and nothing else.
  it('lifts with the theme’s composed block, never a hand-assembled one', () => {
    const shadows = themeCss.match(/box-shadow:\s*[^;}]+/g) ?? []
    for (const shadow of shadows) {
      if (/^box-shadow:\s*(none|inset)/.test(shadow)) continue
      expect(shadow, 'every lift asks for the composed block').toMatch(
        /^box-shadow:\s*var\(--axi-shadow-(control|panel)(-hover)?\)\s*$/
      )
    }
  })

  it('raises a panel off the page rather than sinking a well into it', () => {
    // The bug the redo fixed: a card drawn darker than --axi-ground reads as
    // a hole, so a screen of cards reads as mostly background.
    // .sgroup, .panel-empty and .deskset joined the list once it was clear
    // the panel *bodies* were still bare page: a form ruled off with a
    // hairline is not a card, it is dark on dark.
    for (const sel of [
      '.spcard',
      '.bcard',
      '.ccard',
      '.scard',
      '.share-dialog',
      '.sgroup',
      '.panel-empty',
      '.deskset',
      // the notices rail: each card was a black wash darker than the rail it
      // sat in, which is the hole again, one column over
      '.ncard',
      // the rails' own text had no surface at all: a notice and two empty
      // states printed straight onto the page beside a column of raised
      // cards, which made them read as captions rather than as items
      '.rail .item',
      '.sk2-empty',
      '.errnotice'
    ]) {
      const rule = ruleFor(sel)
      expect(rule, `${sel} not found`).not.toBe('')
      expect(rule, sel).toMatch(/background:var\(--axi-surface\)/)
      expect(rule, sel).toMatch(/border:var\(--axi-border-panel\) solid var\(--axi-ink-line\)/)
      expect(rule, sel).toMatch(/box-shadow:var\(--axi-shadow-panel\)/)
    }
  })

  it('sinks the fields into the card they sit on', () => {
    // .tool, .post-figure, .prose pre and .picker .pi are the same shape of
    // thing in the chat column: quoted material, or a row you pick from,
    // set into the surface around it rather than washed with black.
    for (const sel of [
      '.sfield-input',
      '.sfield-area',
      '.rst-input',
      '.mem-add-input',
      '.sinput',
      '.clspick-btn',
      '.tool',
      '.post-figure',
      '.prose pre',
      '.picker .pi',
      // memory rows: quoted material on the face of the card that holds them,
      // separated by a hairline and otherwise unset
      '.mem-row'
    ]) {
      const rule = ruleFor(sel)
      expect(rule, `${sel} not found`).not.toBe('')
      expect(rule, sel).toMatch(/background:var\(--axi-ground\)/)
      expect(rule, sel).toMatch(/border:var\(--axi-border-control\) solid var\(--axi-ink-line\)/)
    }
  })

  it('keeps no hard-coded greys now that the accent drives the palette', () => {
    expect(themeCss).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })

  it('fills every surface from a token, never a hand-mixed rgba', () => {
    // How the holes got in: a card wanting to look recessed was painted
    // rgba(0,0,0,.16) instead of stepping to --axi-ground, so it came out
    // darker than the page and read as a gap. Depth is a token step here,
    // never an opacity. The scanline is the one sanctioned exception and is
    // a background-image, so it is not caught by this.
    const fills = themeCss.match(/background(?:-color)?:\s*rgba\([^)]*\)/g) ?? []
    expect(fills).toEqual([])
  })

  it('marks a selected row with a surface step and an edge, not an accent wash', () => {
    // An 8% accent over the ground is not a colour, it is a smudge: too weak
    // to read as selection, strong enough to muddy the row. .snav-item settled
    // this — the selected row steps up to --axi-surface and takes the accent
    // on its left edge, where it is a line you can actually see.
    for (const sel of ['.snav-item.on', '.sk2-item.on', '.edition.active']) {
      const rule = ruleFor(sel)
      expect(rule, `${sel} not found`).not.toBe('')
      expect(rule, sel).toMatch(/background:var\(--axi-surface\)/)
      expect(rule, sel).toMatch(/border-left-color:var\(--axi-accent\)/)
    }
  })

  // The same wash by another spelling, and it had spread: eight menu rows,
  // the active keyring entry and the final forge step all signalled state
  // with a film of accent instead of a step up the neutral ramp. A state is
  // a surface step. The exceptions below are highlights over running text,
  // where a translucent mark over what it marks is the whole point.
  const ACCENT_WASH_OK = ['::selection', '.skill-token', '.inwrap.drag-over', '.rst-chip']

  it('tints no surface with the accent outside the text highlights', () => {
    const offenders = themeCss
      .split('}')
      .filter((r) => /background(?:-color)?:\s*color-mix\([^)]*--axi-accent/.test(r))
      .map((r) => r.slice(r.lastIndexOf('\n') + 1, r.indexOf('{')).trim())
      .filter((sel) => !ACCENT_WASH_OK.some((ok) => sel.includes(ok)))
    expect(offenders).toEqual([])
  })

  it('states a signal colour as a mix of its token, not a raw rgba', () => {
    // rgba(111,174,111,.45) is --axi-ok at 45%, written out by hand: it stops
    // tracking the token the moment the palette moves.
    const strays = (themeCss.match(/rgba\([^)]*\)/g) ?? []).filter(
      (c) => !/rgba\(0,0,0,\.05\)/.test(c)
    )
    expect(strays).toEqual([])
  })
})
