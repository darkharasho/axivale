// Post an AxiVale release announcement to a Discord channel via the bot,
// mirroring how AxiForge / AxiBridge announce their releases (but using the bot
// token rather than a webhook). Reads DISCORD_BOT_TOKEN from .env and the
// matching `## Version vX.Y.Z` section out of RELEASE_NOTES.md, then posts a
// newsprint-styled embed.
//
//   node scripts/post-discord-release.mjs <channel_id> [vX.Y.Z]
//
// Without a tag it uses the version from package.json. The bot needs View
// Channel + Send Messages + Embed Links in the target channel.

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
      if (capturing) break
      if (header[1] === tag) capturing = true
      continue
    }
    if (capturing) out.push(line)
  }
  return out.join('\n').trim()
}

async function main() {
  const channelId = process.argv[2]
  if (!channelId) {
    console.error('Usage: node scripts/post-discord-release.mjs <channel_id> [vX.Y.Z]')
    process.exit(1)
  }
  const tag = process.argv[3] || `v${JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version}`

  // Prefer the ambient env (CI passes DISCORD_BOT_TOKEN as a secret); fall back
  // to .env for local runs.
  const env = loadEnv(await readFile(join(root, '.env'), 'utf8').catch(() => ''))
  const token = process.env.DISCORD_BOT_TOKEN || env.DISCORD_BOT_TOKEN
  if (!token) {
    console.error('DISCORD_BOT_TOKEN not set (env or .env)')
    process.exit(1)
  }

  const md = await readFile(join(root, 'RELEASE_NOTES.md'), 'utf8')
  let notes = extractNotes(md, tag)
  if (!notes) {
    console.error(`No RELEASE_NOTES.md section found for ${tag}. Add a "## Version ${tag} — <date>" entry.`)
    process.exit(1)
  }
  if (notes.length > 4000) notes = notes.slice(0, 4000) + '\n\n*… see full notes on GitHub*'

  const embed = {
    title: `AxiVale ${tag}`,
    url: `https://github.com/darkharasho/axivale/releases/tag/${tag}`,
    description: notes,
    color: 0xc8423a, // AxiVale newsprint accent (--accent)
    thumbnail: { url: 'https://raw.githubusercontent.com/darkharasho/axivale/main/build/icon.png' },
    footer: { text: 'AxiVale Release' }
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  })
  if (!res.ok) {
    console.error(`Discord post failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  const msg = await res.json()
  console.log(`Posted AxiVale ${tag} release to channel ${channelId} (message ${msg.id}).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
