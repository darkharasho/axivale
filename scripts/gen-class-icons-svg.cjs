// Regenerate src/renderer/src/components/panels/classIconSvgData.ts from the
// gw2-class-icons package. Unlike the PNG pipeline (gen-class-icons.cjs), this
// inlines the *vector* wiki icons (full color + black outline) as cleaned,
// render-ready SVG markup so they stay crisp at any size. The SVGs use plain
// <path> fills — no gradients/filters/clip-paths or url(#) refs — so stripping
// ids and inlining multiple copies on a page is safe.
// Run: node scripts/gen-class-icons-svg.cjs
const fs = require('fs')
const path = require('path')
const pkg = require('gw2-class-icons')

const SIZE = 'svg'

/** Strip the XML prolog/comments, drop ids + the root width/height (so the
 *  icon scales to its container), and make it self-sizing via inline style. */
function clean(raw) {
  let svg = raw.slice(raw.indexOf('<svg')) // drop <?xml?> prolog + leading comments
  svg = svg.replace(/<!--[\s\S]*?-->/g, '') // strip comments
  svg = svg.replace(/\s+id="[^"]*"/g, '') // ids are unused refs; avoid dupes on a page
  // Rewrite the opening <svg ...> tag: keep viewBox + xmlns, drop fixed size.
  svg = svg.replace(/<svg\b[^>]*>/, (tag) => {
    const viewBox = (tag.match(/viewBox="[^"]*"/) || [''])[0]
    return `<svg xmlns="http://www.w3.org/2000/svg" ${viewBox} style="height:100%;width:auto;display:block" focusable="false">`
  })
  return svg.replace(/>\s+</g, '><').trim() // collapse inter-tag whitespace
}

const out = []
for (const name of pkg.iconNames) {
  if (!pkg.hasIcon(name, SIZE)) continue
  const raw = fs.readFileSync(pkg.getIconPath(name, SIZE, { absolute: true }), 'utf8')
  out.push(`  ${JSON.stringify(name.toLowerCase())}: ${JSON.stringify(clean(raw))}`)
}

const body = `// AUTO-GENERATED from gw2-class-icons by scripts/gen-class-icons-svg.cjs — do not edit.
// Vector class/elite-spec icons (full color + black outline), cleaned for inline
// rendering and self-sizing to their container's height.
export const CLASS_ICON_SVG_DATA: Record<string, string> = {
${out.join(',\n')}
}
`
const dest = path.join(
  __dirname,
  '..',
  'src/renderer/src/components/panels/classIconSvgData.ts'
)
fs.writeFileSync(dest, body)
console.log(`wrote ${out.length} class icon SVGs to ${dest}`)
