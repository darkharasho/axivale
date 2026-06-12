// Regenerate src/renderer/src/components/panels/classIconData.ts from the
// gw2-class-icons package. We inline the optimized PNGs (full color, black
// outline) as base64 data URIs and render them as <img> — masking the SVGs
// flattened them to outline-less silhouettes. Run: node scripts/gen-class-icons.cjs
const fs = require('fs')
const path = require('path')
const pkg = require('gw2-class-icons')

const SIZE = 'optimized' // 40x40 RGBA, colored with black outline
const out = []
for (const name of pkg.iconNames) {
  if (!pkg.hasIcon(name, SIZE)) continue
  const buf = fs.readFileSync(pkg.getIconPath(name, SIZE, { absolute: true }))
  const uri = 'data:image/png;base64,' + buf.toString('base64')
  out.push(`  ${JSON.stringify(name.toLowerCase())}: ${JSON.stringify(uri)}`)
}

const body = `// AUTO-GENERATED from gw2-class-icons by scripts/gen-class-icons.cjs — do not edit.
// Optimized PNGs inlined as data URIs (full color + black outline), rendered as <img>.
export const CLASS_ICON_DATA: Record<string, string> = {
${out.join(',\n')}
}
`
const dest = path.join(
  __dirname,
  '..',
  'src/renderer/src/components/panels/classIconData.ts'
)
fs.writeFileSync(dest, body)
console.log(`wrote ${out.length} class icons (${SIZE}) to ${dest}`)
