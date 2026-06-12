// Regenerate src/renderer/src/components/panels/classIconData.ts from the
// gw2-class-icons package. SVGs are inlined as data URIs so they bundle
// cleanly (the package is a file: dependency whose symlink defeats Vite's
// import.meta.glob). Run: node scripts/gen-class-icons.cjs
const fs = require('fs')
const path = require('path')
const pkg = require('gw2-class-icons')

const out = []
for (const name of pkg.iconNames) {
  if (!pkg.hasIcon(name, 'svg')) continue
  let svg = fs.readFileSync(pkg.getIconPath(name, 'svg', { absolute: true }), 'utf8')
  svg = svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg)
  out.push(`  ${JSON.stringify(name.toLowerCase())}: ${JSON.stringify(uri)}`)
}

const body = `// AUTO-GENERATED from gw2-class-icons by scripts/gen-class-icons.cjs — do not edit.
// SVGs inlined as data URIs so they survive bundling without runtime paths.
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
console.log(`wrote ${out.length} class icons to ${dest}`)
