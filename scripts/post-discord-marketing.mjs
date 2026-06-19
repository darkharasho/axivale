// Post the AxiVale launch announcement to a Discord channel via the bot,
// pinging @everyone. Reads DISCORD_BOT_TOKEN from .env. The message body lives
// in MARKETING below — edit it there.
//
//   node scripts/post-discord-marketing.mjs <channel_id>
//
// Requires the bot to have View Channel + Send Messages + Mention Everyone in
// the target channel.

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

const MARKETING = `@everyone

📰  **AxiVale 1.0 is off the presses.**

Your guild's new virtual officer — an AI agent with real tools, styled as a dark-newsprint broadsheet. It ties your whole Axi stack together and runs the guild from one desk.

🤖  **Your AI, your call**
Runs on **Claude, ChatGPT, or Gemini** — sign in with the one you already pay for and pick the model. No lock-in, no extra subscription.

📚  **Actually knows the GW2 meta**
AxiVale keeps a living library of the community's best sources — Snowcrows, MetaBattle, Discretize, GuildJen, Hardstuck, and the Wiki — crawled fresh and dated. Ask *"what's the meta for X?"* or *"how do we approach this boss?"* and it answers from real, current sources and cites them, flagging anything that's gone stale. No made-up builds.

🔨  **AxiForge, built in**
Full control of your AxiForge builds & squad comps right from chat. Ask for a comp and it renders as a rich card, publish a build for a share URL, or drop a composition into Discord as a party-grid embed — even when AxiForge is closed (it spins up headless for you).

📊  **AxiBridge, built in**
Point it at your AxiBridge WvW logs and it writes the article for you: weekly trend reviews, commander report cards, K/D and attendance over time, charts and tables inline. *"How did we do this week?"* → a filed front-page story, every number sourced.

🛡️  **Discord management, with a brake pedal**
Channels, roles, events, threads, and DMs across all your servers. Anything destructive stops at a *Notice of Destruction* you approve first.

📈  **Guild intelligence**
Roster, join history, and live GW2 API data on demand — just file orders in plain English and it does the work, filing each reply as a newspaper article with a receipt for every action.

Signed & notarized for Linux, Windows, and macOS. Updates itself. Every key encrypted in the OS keychain.

**📥  Download → https://github.com/darkharasho/axivale/releases**`

async function main() {
  const channelId = process.argv[2]
  if (!channelId) {
    console.error('Usage: node scripts/post-discord-marketing.mjs <channel_id>')
    process.exit(1)
  }

  const env = loadEnv(await readFile(join(root, '.env'), 'utf8').catch(() => ''))
  const token = env.DISCORD_BOT_TOKEN
  if (!token) {
    console.error('DISCORD_BOT_TOKEN not set in .env')
    process.exit(1)
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: MARKETING,
      allowed_mentions: { parse: ['everyone'] }
    })
  })
  if (!res.ok) {
    console.error(`Discord post failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  const msg = await res.json()
  console.log(`Posted launch announcement to channel ${channelId} (message ${msg.id}).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
