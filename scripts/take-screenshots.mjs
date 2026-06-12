// Capture README screenshots from the real built app with stubbed demo data.
// Usage: npm run build && node scripts/take-screenshots.mjs
// (Linux: needs a display; use DISPLAY=:0 or xvfb-run.)
import { _electron as electron } from 'playwright-core'
import path from 'path'
import fs from 'fs'
import os from 'os'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'axivale-shots-'))

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=${PROFILE}`, ROOT],
  env,
  timeout: 30000
})
const page = await app.firstWindow()
await page.waitForSelector('.mnav', { timeout: 20000 })

// Stub the agent and the AxiTools bridge with lived-in demo data so the
// screenshots show a working newsroom, not empty states.
await app.evaluate(({ ipcMain }) => {
  ipcMain.removeHandler('agent:send')
  ipcMain.handle('agent:send', async (event) => {
    const send = (e) => event.sender.send('agent:event', e)
    send({ kind: 'tool-start', id: 't1', name: 'gw2_guild_members', input: {} })
    send({ kind: 'tool-result', id: 't1', isError: false, text: '[]' })
    send({ kind: 'tool-start', id: 't2', name: 'axitools_comp_presets_save', input: { preset: 'tuesday-wvw', add: ['Riversong', 'Tessa'] } })
    send({ kind: 'tool-result', id: 't2', isError: false, text: 'Preset saved. 2 members added.' })
    send({
      kind: 'text-delta',
      text: 'Tuesday roster amended; three recruits sworn in this week. At the Commander’s request the Tuesday WvW composition was updated:\n\n- **Riversong.2837** — sworn in as *Scout*, slotted on Firebrand ⚔️\n- **Tessa.1042** — sworn in as *Scout*, slotted on Scourge\n- **Moxie.9921** — vouch still pending, left off the active list ⚠️\n\nStanding orders remain unchanged until weekly reset.'
    })
    send({ kind: 'done', sessionId: null, error: null })
  })
  ipcMain.removeHandler('axitools:call')
  const data = {
    listBuilds: [
      { build_id: 'b1', name: 'Heal Quickness Firebrand', profession: 'Guardian', specialization: 'Firebrand', chat_code: '[&DQEpKj0lOTnXEgAAcwAAAIwBAADXEgAA1hIAAAAA]', description: 'Stability on demand for the frontline push; camp staff on the bomb.', url: 'https://example.com' },
      { build_id: 'b2', name: 'Vindicator’s Bane', profession: 'Revenant', specialization: 'Vindicator', chat_code: '[&DQERLSA9PzvXEgAA1hIAAEgBAACMAQAAyhIAAAAA]', description: 'Havoc pick for camp flips; disengage on cooldown.' },
      { build_id: 'b3', name: 'Sand Shroud Bomber', profession: 'Necromancer', specialization: 'Scourge', chat_code: '[&DQg1KTIlIjbBEgAAgQAAAEcBAAB1AQAAyhIAAAAA]', description: 'Wells on tag, shades on the choke.' },
      { build_id: 'b4', name: 'Boon Scrapper', profession: 'Engineer', specialization: 'Scrapper', chat_code: '[&DQMGOyYvOznZEgAAcQEAAMoSAADUEgAAyxIAAAAA]', description: 'Superspeed uptime and stealth on the regroup.' }
    ],
    listCompPresets: [{ name: 'tuesday-wvw', config: { classes: [{ name: 'Firebrand', required: 5 }, { name: 'Scourge', required: 10 }, { name: 'Herald', required: 5 }, { name: 'Spellbreaker', required: 5 }] } }],
    listCompSchedules: [{ schedule_id: 's1', name: 'Tuesday raid', preset_name: 'tuesday-wvw', post_days: [1], post_time: '18:00', timezone: 'UTC', signups: { Firebrand: ['101', '102', '103', '104'], Scourge: ['105', '106', '107'] } }],
    discordOverview: {
      channels: [{ id: '5', name: 'wvw-signups', type: 'text' }, { id: '6', name: 'builds', type: 'text' }],
      roles: [{ id: '9', name: 'Raiders' }],
      members: [
        { id: '101', display_name: 'harasho' }, { id: '102', display_name: 'voyl' },
        { id: '103', display_name: 'pillo' }, { id: '104', display_name: 'swt_spart' },
        { id: '105', display_name: 'jorhad' }, { id: '106', display_name: 'gammavahara' },
        { id: '107', display_name: 'riversong' }
      ]
    },
    compConfigGet: { channel_id: '5', ping_role_id: '9', post_days: [1], post_time: '18:00', timezone: 'UTC', active_preset: 'tuesday-wvw' },
    configGet: { build_channel_id: '6' },
    membersLinked: []
  }
  ipcMain.handle('axitools:call', (_e, method) => data[method] ?? (method.startsWith('list') ? [] : {}))
})

// --- Shot 1: Dispatches with a filed article + notices feed -----------------
await page.locator('.field').fill('Swear in the new recruits and update the Tuesday comp')
await page.locator('.filebtn').click()
await page.waitForSelector('.endmark', { timeout: 15000 })
await page.waitForTimeout(1200) // fonts/emoji icons settle
await page.screenshot({ path: path.join(OUT, 'dispatches.png') })
console.log('captured dispatches.png')

// --- Shot 2: The Build Ledger ------------------------------------------------
await page.evaluate(() => {
  ;[...document.querySelectorAll('.mnav button')].find((b) => b.textContent.includes('Builds'))?.click()
})
await page.waitForSelector('.bcard', { timeout: 10000 })
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(OUT, 'builds.png') })
console.log('captured builds.png')

await app.close()
fs.rmSync(PROFILE, { recursive: true, force: true })
console.log(`done — screenshots in ${OUT}`)
