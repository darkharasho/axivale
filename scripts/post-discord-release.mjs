// Post an AxiVale release announcement to Discord, mirroring how AxiForge /
// AxiBridge announce their releases. Reads DISCORD_WEBHOOK_URL from .env and
// the matching `## Version vX.Y.Z` section out of RELEASE_NOTES.md, then posts a
// newsprint-styled embed with the app icon attached (works even though the repo
// is private and raw.githubusercontent URLs would 404).
//
//   node scripts/post-discord-release.mjs [vX.Y.Z]
//
// Without an argument it uses the version from package.json.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(text) {
  const env = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

/** Pull the body of the `## Version <tag>` section out of RELEASE_NOTES.md. */
function extractNotes(md, tag) {
  const lines = md.split('\n')
  const out = []
  let capturing = false
  for (const line of lines) {
    const header = line.match(/^## Version (v\S+)/)
    if (header) {
      if (capturing) break // next version section — stop
      if (header[1] === tag) capturing = true
      continue
    }
    if (capturing) out.push(line)
  }
  return out.join('\n').trim()
}

async function main() {
  const tag = (process.argv[2] || `v${JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version}`)

  const env = loadEnv(await readFile(join(root, '.env'), 'utf8').catch(() => ''))
  const webhook = env.DISCORD_WEBHOOK_URL
  if (!webhook) {
    console.error('DISCORD_WEBHOOK_URL not set in .env')
    process.exit(1)
  }

  const md = await readFile(join(root, 'RELEASE_NOTES.md'), 'utf8')
  let notes = extractNotes(md, tag)
  if (!notes) {
    console.error(`No RELEASE_NOTES.md section found for ${tag}. Add a "## Version ${tag} — <date>" entry.`)
    process.exit(1)
  }
  if (notes.length > 3800) notes = notes.slice(0, 3800) + '\n\n*… see full notes on GitHub*'

  const releaseUrl = `https://github.com/darkharasho/axivale/releases/tag/${tag}`
  const embed = {
    title: `AxiVale ${tag}`,
    url: releaseUrl,
    description: notes,
    color: 0xc8423a, // AxiVale newsprint accent (--accent)
    thumbnail: { url: 'attachment://icon.png' },
    footer: { text: 'AxiVale Release' }
  }

  const icon = await readFile(join(root, 'build', 'icon.png')).catch(() => null)
  const form = new FormData()
  form.append('payload_json', JSON.stringify({ embeds: [embed] }))
  if (icon) {
    form.append('files[0]', new Blob([icon], { type: 'image/png' }), 'icon.png')
  } else {
    delete embed.thumbnail
  }

  const url = webhook + (webhook.includes('?') ? '&' : '?') + 'wait=true'
  const res = await fetch(url, { method: 'POST', body: form })
  if (!res.ok) {
    console.error(`Discord webhook failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  console.log(`Posted AxiVale ${tag} release to Discord.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
